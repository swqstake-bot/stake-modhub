const { normalizeText, foldGermanUmlauts } = require('./dedupe');

function fold(text) {
  return foldGermanUmlauts(normalizeText(text).toLowerCase());
}

function scoreBeggingMessage(text) {
  const raw = normalizeText(text);
  if (!raw) return { score: 0, hits: [] };
  const t = fold(raw);
  const hits = [];
  let score = 0;

  if (
    /\b(?:bitte|pls|please)\s+(?:rain|regen|tip|tips|spende|geld|coins?)\b/.test(t) ||
    /\b(?:rain|regen|tip)\s+bitte\b/.test(t)
  ) {
    score += 2;
    hits.push('rain-tip');
  }
  if (/\b(?:kann|koenn|könnt)\s+(?:mir|jemand|einer|wer)\s/.test(t) && /tip|rain|geld|spende|borg/.test(t)) {
    score += 2;
    hits.push('direkt-bettel');
  }
  if (/\b(?:borg|borgen|leihen|loan|spenden|brauche?\s+geld|kein\s+geld)\b/.test(t)) {
    score += 2;
    hits.push('geld-bettel');
  }
  if (/\bpassive\s+begging\b/.test(t) || /\bgebettel/.test(t)) {
    score += 3;
    hits.push('passiv');
  }
  if (/<3\s+wen?\s+du\s+tip/.test(t) || /<3\s+wenn\s+du\s+tip/.test(t)) {
    score += 2;
    hits.push('herz-tip');
  }
  if (/\b(?:jemand|wer)\s+(?:tip|rain|spend)/.test(t)) {
    score += 1;
    hits.push('crowd-tip');
  }
  if (/@\w+/.test(t) && /\b(?:tip|rain|spende|gib|geben)\b/.test(t)) {
    score += 1;
    hits.push('mention-bettel');
  }

  return { score, hits };
}

function collectBeggingStats(messages) {
  let beggingHits = 0;
  let beggingScoreSum = 0;
  const byType = {};

  for (const m of messages) {
    const r = scoreBeggingMessage(m.message || '');
    if (r.score <= 0) continue;
    beggingHits++;
    beggingScoreSum += r.score;
    for (const h of r.hits) byType[h] = (byType[h] || 0) + 1;
  }

  const n = messages.length || 1;
  return {
    beggingHits,
    beggingScoreSum,
    beggingRatio: beggingHits / n,
    beggingTypes: byType
  };
}

function beggingRiskBonus(stats, totalMessages) {
  if (!stats || totalMessages < 4) return 0;
  let bonus = 0;
  if (stats.beggingRatio >= 0.12) bonus += 18;
  else if (stats.beggingRatio >= 0.06) bonus += 12;
  else if (stats.beggingHits >= 3) bonus += 8;
  if (stats.beggingTypes.passiv) bonus += 10;
  if (stats.beggingTypes['rain-tip'] >= 2) bonus += 6;
  return Math.min(28, bonus);
}

function isLikelyBeggar(stats, totalMessages, ruleBeggingHits = 0) {
  if (totalMessages < 5) return false;
  if (stats.beggingHits >= 2 && stats.beggingRatio >= 0.04) return true;
  if (ruleBeggingHits >= 4 && stats.beggingRatio >= 0.01) return true;
  if (stats.beggingRatio >= 0.08) return true;
  if (stats.beggingTypes.passiv) return true;
  return false;
}

module.exports = {
  scoreBeggingMessage,
  collectBeggingStats,
  beggingRiskBonus,
  isLikelyBeggar
};
