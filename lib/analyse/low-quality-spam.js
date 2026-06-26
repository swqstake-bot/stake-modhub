const { normalizeText, stripForDedupeKey, isCommunityShort } = require('./dedupe');

/** Aus Chat-Studie: typische Low-Quality-/Spam-Mutes (Mods swaqline, wheelyboy321, Kartenstapel, droz). */
const LOW_QUALITY_TERMS = new Set([
  'bust',
  'bustly',
  'bustl',
  'rekt',
  'rip',
  'f',
  'l',
  'w',
  'k',
  'same',
  'true',
  'abfuckbude',
  'fickbude',
  'ballern'
]);

const GZ_VARIANT_RE = /^(g+z+|gg+|gl+|gf+|gn+|gzzz|gzgz|gzly)$/i;
const EMOJI_TOKEN_RE = /:[\w]+:/g;

function foldKey(text) {
  return stripForDedupeKey(text).replace(/\s/g, '');
}

function isGzOrBustVariant(text) {
  const k = foldKey(text);
  if (!k) return false;
  if (GZ_VARIANT_RE.test(k)) return true;
  if (LOW_QUALITY_TERMS.has(k)) return true;
  return false;
}

/** Emoji-Flut wie Jituvishnoi (:pepe: :pepe: …). */
function emojiMetrics(text) {
  const raw = String(text || '');
  const tokens = raw.match(EMOJI_TOKEN_RE) || [];
  if (!tokens.length) return { isFlood: false, count: 0, maxSame: 0 };
  const by = new Map();
  for (const t of tokens) by.set(t, (by.get(t) || 0) + 1);
  let maxSame = 0;
  for (const n of by.values()) if (n > maxSame) maxSame = n;
  const letters = raw.replace(/:[\w]+:/g, '').replace(/\s/g, '');
  const isFlood = tokens.length >= 4 && (maxSame >= 3 || letters.length < 8);
  return { isFlood, count: tokens.length, maxSame };
}

function isLowQualitySpamMessage(text) {
  const msg = normalizeText(text);
  if (!msg) return false;
  if (isGzOrBustVariant(msg)) return true;
  if (isCommunityShort(msg)) return true;
  const em = emojiMetrics(msg);
  if (em.isFlood) return true;
  if (msg.length <= 5 && !/^\?+$/.test(msg)) return true;
  if (/^(lol|haha|xd|hehe|hihi)+$/i.test(foldKey(msg))) return true;
  return false;
}

function collectGzDuplicateStats(messages) {
  const byKey = new Map();
  let gzLines = 0;
  let gzDupExtra = 0;
  for (const m of messages) {
    const msg = m.message || '';
    if (!isGzOrBustVariant(msg)) continue;
    gzLines++;
    const key = foldKey(msg) || 'gz';
    const prev = byKey.get(key) || 0;
    byKey.set(key, prev + 1);
    if (prev >= 1) gzDupExtra++;
  }
  return {
    gzLines,
    gzDupExtra,
    gzDupRatio: gzLines ? gzDupExtra / gzLines : 0,
    maxGzSame: Math.max(1, ...byKey.values())
  };
}

function collectLowQualityStats(messages) {
  let lowQualityHits = 0;
  let gzBustHits = 0;
  let emojiFloodHits = 0;
  let emojiFloodMax = 0;
  let shortHits = 0;

  for (const m of messages) {
    const msg = m.message || '';
    if (isLowQualitySpamMessage(msg)) lowQualityHits++;
    if (isGzOrBustVariant(msg)) gzBustHits++;
    const em = emojiMetrics(msg);
    if (em.isFlood) {
      emojiFloodHits++;
      if (em.maxSame > emojiFloodMax) emojiFloodMax = em.maxSame;
    }
    if (normalizeText(msg).length <= 8) shortHits++;
  }

  const n = messages.length || 1;
  const gzDup = collectGzDuplicateStats(messages);

  return {
    lowQualityHits,
    lowQualityRatio: lowQualityHits / n,
    gzBustRatio: gzBustHits / n,
    gzDupRatio: gzDup.gzDupRatio,
    gzLines: gzDup.gzLines,
    maxGzSame: gzDup.maxGzSame,
    emojiFloodHits,
    emojiFloodMax,
    shortRatio: shortHits / n
  };
}

/**
 * GZ-Spam-Signal: Anteil gz/bust an allen Msgs (Spam-Mutes ~21 %, Stammchatter ~6 %).
 * maxGzSame zählt nur mit, wenn der GZ-Anteil erhöht ist — nicht „9× gz in 700 Msgs“.
 */
function scoreGzSpamComponent(stats, maxPts = 40) {
  if (!stats) return 0;
  const gzb = stats.gzBustRatio || 0;
  const gz = stats.maxGzSame || 0;
  const gzLines = stats.gzLines || 0;
  let pts = 0;

  if (gzb >= 0.35) pts += 18;
  else if (gzb >= 0.22) pts += 14;
  else if (gzb >= 0.12) pts += 8;
  else if (gzb >= 0.08) pts += 4;

  if (gzb >= 0.1 && gz >= 5) pts += 8;
  else if (gzb >= 0.15 && gz >= 3) pts += 5;

  if (gzb >= 0.2 && gzLines >= 10) pts += 6;

  return Math.min(maxPts, pts);
}

/** Chat fast nur Gratulationen / bust — wenig echte Unterhaltung. */
function isGzDominantChatter(stats, totalMessages, oneWordRatio, avgWords) {
  const n = totalMessages || 0;
  if (n < 8) return false;
  const gzb = stats?.gzBustRatio || 0;
  const owr = oneWordRatio ?? 0;
  const words = avgWords ?? 0;
  if (gzb >= 0.28) return true;
  if (gzb >= 0.18 && words <= 2.8) return true;
  if (gzb >= 0.14 && owr >= 0.45) return true;
  return false;
}
function lowQualityRiskBonus(stats, totalMessages, oneWordRatio) {
  if (!stats || totalMessages < 4) return 0;
  let bonus = 0;
  const owr = oneWordRatio ?? stats.lowQualityRatio;

  // Kombination wie Mod-Mutes: viel Kurz + LQ
  if (stats.lowQualityRatio >= 0.45 && owr >= 0.45 && totalMessages >= 5) bonus += 20;
  else if (stats.lowQualityRatio >= 0.32 && owr >= 0.33 && totalMessages >= 5) bonus += 14;
  else if (stats.lowQualityRatio >= 0.55 && totalMessages >= 8) bonus += 16;
  else if (stats.lowQualityRatio >= 0.4 && totalMessages >= 6) bonus += 10;

  bonus += scoreGzSpamComponent(stats, 22);

  if (stats.gzBustRatio >= 0.4 && stats.gzLines >= 8) bonus += 8;
  else if (stats.gzBustRatio >= 0.3 && stats.gzLines >= 5) bonus += 5;

  if (stats.emojiFloodHits >= 2) bonus += 15;
  else if (stats.emojiFloodHits >= 1 && stats.emojiFloodMax >= 4) bonus += 10;

  return Math.min(40, bonus);
}

/** True wenn Muster wie echte Mod-Spam-Mutes (Hayvanmodus, Spielboy, metzgii …). */
function isLikelySpamUser(stats, totalMessages, oneWordRatio) {
  if (totalMessages < 5) return false;
  if (stats.lowQualityRatio >= 0.45 && oneWordRatio >= 0.4) return true;
  if (stats.gzBustRatio >= 0.2 && stats.gzLines >= 6 && stats.maxGzSame >= 4) return true;
  if (isGzDominantChatter(stats, totalMessages, oneWordRatio)) return true;
  if (stats.lowQualityRatio >= 0.55 && totalMessages >= 6) return true;
  if (stats.emojiFloodHits >= 1 && stats.lowQualityRatio >= 0.3) return true;
  return false;
}

module.exports = {
  isLowQualitySpamMessage,
  isGzOrBustVariant,
  emojiMetrics,
  collectLowQualityStats,
  scoreGzSpamComponent,
  isGzDominantChatter,
  lowQualityRiskBonus,
  isLikelySpamUser
};
