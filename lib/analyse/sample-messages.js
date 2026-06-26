const { normalizeText, stripForDedupeKey } = require('./dedupe');
const { isLowQualitySpamMessage, isGzOrBustVariant } = require('./low-quality-spam');
const { scoreToxicMessage } = require('./toxic-heuristics');
const { scoreBeggingMessage } = require('./begging-heuristics');

const MAX_SAMPLES = 12;

function msgKey(m) {
  return `${m.timestamp || 0}|${normalizeText(m.message || '')}`;
}

function scoreMessageRelevance(message, ctx) {
  const text = message || '';
  let score = 0;
  const tags = [];

  const tox = scoreToxicMessage(text);
  if (tox.score > 0) {
    score += tox.score * 4 + (ctx.enforcementTier === 'toxic' ? 2 : 0);
    tags.push('Toxic');
  }

  const beg = scoreBeggingMessage(text);
  if (beg.score > 0) {
    score += beg.score * 4 + (ctx.enforcementTier === 'begging' ? 2 : 0);
    tags.push('Bettel');
  }

  if (isLowQualitySpamMessage(text)) {
    score += 3;
    if (isGzOrBustVariant(text)) tags.push('GZ/LQ');
    else tags.push('LQ');
  }

  if (ctx.topRepeatText) {
    const a = stripForDedupeKey(text);
    const b = stripForDedupeKey(ctx.topRepeatText);
    if (a && b && a === b) {
      score += 5;
      if (!tags.includes('Wdh')) tags.push('Wdh');
    }
  }

  for (const sample of ctx.coordSampleTexts || []) {
    const a = stripForDedupeKey(text);
    const b = stripForDedupeKey(sample);
    if (a && b && a === b) {
      score += 4;
      if (!tags.includes('Multi')) tags.push('Multi');
      break;
    }
  }

  if (ctx.enforcementTier === 'bot' && isLowQualitySpamMessage(text)) {
    score += 1;
  }

  return { score, tags: [...new Set(tags)] };
}

/**
 * Wählt echte Beispiel-Nachrichten: zuerst auffällige (Toxic, LQ, Bettel, Wdh),
 * Rest mit neuesten Msgs als Kontext auffüllen.
 */
function pickSampleMessages(messages, ctx = {}) {
  if (!messages?.length) return [];

  const scored = messages
    .map((m) => {
      const { score, tags } = scoreMessageRelevance(m.message, ctx);
      return { m, score, tags };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.m.timestamp || 0) - (a.m.timestamp || 0)
    );

  const picked = [];
  const seen = new Set();

  const take = (entry, reason) => {
    const key = msgKey(entry.m);
    if (seen.has(key) || picked.length >= MAX_SAMPLES) return;
    seen.add(key);
    picked.push({ m: entry.m, reason: reason || entry.tags.slice(0, 2).join(' · ') || '' });
  };

  for (const entry of scored) take(entry);

  const recent = [...messages].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  for (const m of recent) {
    if (picked.length >= MAX_SAMPLES) break;
    const key = msgKey(m);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({ m, reason: '' });
  }

  picked.sort((a, b) => (b.m.timestamp || 0) - (a.m.timestamp || 0));

  return picked.map(({ m, reason }, i, arr) => {
    const prev = arr[i + 1]?.m;
    const gapSec =
      prev && m.timestamp && prev.timestamp
        ? Math.round(((m.timestamp - prev.timestamp) / 1000) * 10) / 10
        : null;
    return {
      time: m.timestamp ? new Date(m.timestamp).toLocaleString('de-DE') : '',
      message: m.message,
      gapSec,
      reason
    };
  });
}

module.exports = {
  pickSampleMessages,
  scoreMessageRelevance
};
