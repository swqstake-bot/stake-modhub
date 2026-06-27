const { scoreToxicMessage } = require('./toxic-heuristics');
const { scoreBeggingMessage } = require('./begging-heuristics');
const { isLowQualitySpamMessage, isGzOrBustVariant, emojiMetrics } = require('./low-quality-spam');
const { normalizeText, stripForDedupeKey, isCommunityShort } = require('./dedupe');

const SKIP_KINDS = new Set(['rain', 'tip', 'trivia', 'race', 'bot']);

function shouldSkipUser(username) {
  const u = String(username || '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
  if (!u) return true;
  if (u === 'trivia' || u === 'race') return true;
  if (/rain-bot/i.test(u)) return true;
  return false;
}

function scoreRollingSignals(recentTexts) {
  const texts = (recentTexts || []).map((t) => normalizeText(t)).filter(Boolean);
  if (texts.length < 4) return { tags: [], score: 0 };

  const tags = [];
  let score = 0;

  let gz = 0;
  for (const text of texts) {
    if (isGzOrBustVariant(text)) gz++;
  }
  const gzRatio = gz / texts.length;
  if (gz >= 4 && gzRatio >= 0.35) {
    tags.push('GZ-Spam');
    score += 4;
  }

  const byKey = new Map();
  for (const text of texts) {
    if (isCommunityShort(text)) continue;
    const key = stripForDedupeKey(text);
    if (!key) continue;
    byKey.set(key, (byKey.get(key) || 0) + 1);
  }
  let maxSame = 0;
  for (const n of byKey.values()) if (n > maxSame) maxSame = n;
  if (maxSame >= 3) {
    tags.push('Wdh');
    score += 3;
  }

  return { tags, score };
}

/**
 * Live-Heuristik für einzelne Chat-Zeilen (Hub-Spalte „Auffällig“).
 * @param {object} input
 * @returns {null|{ tags: string[], score: number, primary: string, label: string }}
 */
function scoreLiveMessage(input = {}) {
  const {
    username,
    message,
    kind,
    recentTexts = [],
    mutedLocal = false,
    warnedLocal = false,
    veri2 = false,
    isModUser = false
  } = input;

  if (isModUser || shouldSkipUser(username)) return null;
  if (SKIP_KINDS.has(kind)) return null;

  const text = normalizeText(message);
  if (!text) return null;

  const tags = [];
  let score = 0;
  let primary = '';

  const tox = scoreToxicMessage(text);
  if (tox.score >= 2 || tox.hits.includes('schwere-beleidigung')) {
    tags.push('Toxic');
    score += Math.max(4, tox.score * 4);
    primary = 'Toxic';
  }

  const beg = scoreBeggingMessage(text);
  if (beg.score >= 2) {
    tags.push('Bettel');
    score += beg.score * 3;
    if (!primary || beg.score * 3 >= score / 2) primary = 'Bettel';
  }

  const em = emojiMetrics(text);
  if (em.isFlood) {
    tags.push('Emoji');
    score += 4;
    if (!primary) primary = 'Spam';
  }

  if (isLowQualitySpamMessage(text) && !isCommunityShort(text) && !isGzOrBustVariant(text)) {
    if (text.length <= 5) {
      tags.push('Kurz');
      score += 2;
      if (!primary) primary = 'Spam';
    }
  }

  const rolling = scoreRollingSignals(recentTexts);
  for (const t of rolling.tags) {
    if (!tags.includes(t)) tags.push(t);
  }
  score += rolling.score;
  if (rolling.tags.includes('GZ-Spam') && !primary) primary = 'Spam';
  if (rolling.tags.includes('Wdh') && !primary) primary = 'Spam';

  if (mutedLocal || warnedLocal) {
    tags.push('Repeat');
    score += 5;
    if (!primary) primary = 'Repeat';
  }

  if (veri2 && tags.length) score += 1;

  if (!tags.length || score < 4) return null;

  return {
    tags,
    score,
    primary: primary || tags[0],
    label: tags.slice(0, 3).join(' · ')
  };
}

module.exports = {
  scoreLiveMessage,
  shouldSkipUser,
  scoreRollingSignals
};
