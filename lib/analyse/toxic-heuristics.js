const { normalizeText, foldGermanUmlauts } = require('./dedupe');

function fold(text) {
  return foldGermanUmlauts(normalizeText(text));
}

/**
 * Kalibriert an 19 Toxic-Mutes aus Chatlogs-Studie (447k Msgs).
 * Toxic: ~10% toxicRatio vs 1.8% Kontrolle; oft Beleidigungen, nicht gz-Spam.
 */
function scoreToxicMessage(text) {
  const raw = normalizeText(text);
  if (!raw) return { score: 0, hits: [] };
  const t = fold(raw);
  const hits = [];
  let score = 0;

  if (
    /\bfick|fuck|fotz|huren|hurens|wichser|spast|spasti|idiot|opfer|nutte|bastard|arschloch|kacke|scheiss|scheiss|penis|mose|koep?gi|amk\b/.test(
      t
    )
  ) {
    score += 2;
    hits.push('beleidigung');
  }
  if (/\bstfu\b|halt(?:\s+dein)?(?:\s+)?maul|klappe|verpiss|hau\s+ab|leck.*eier|elendiger/.test(t)) {
    score += 2;
    hits.push('aggressiv');
  }
  if (/\beddie\b/.test(t) && /huren|bastard|scheis|fick|idiot|nutte/.test(t)) {
    score += 2;
    hits.push('eddie-toxic');
  }
  if (/\bhundesohn|kleinene?\s+huren|gesindel/.test(t)) {
    score += 2;
    hits.push('schwere-beleidigung');
  }
  if (/\brtp\b/.test(t) && /scheis|betrug|fake|abzock|manip/.test(t)) {
    score += 1;
    hits.push('rtp-rant');
  }
  if (/\bnix\s+geht|nichts\s+geht|alles\s+schrott|so\s+ein\s+dreck|ekelhaft/.test(t)) {
    score += 1;
    hits.push('negativ');
  }
  if (/@\w+/.test(t) && score > 0) hits.push('mention+insult');

  return { score, hits };
}

function collectToxicStats(messages) {
  let toxicHits = 0;
  let toxicScoreSum = 0;
  const byType = {};

  for (const m of messages) {
    const r = scoreToxicMessage(m.message || '');
    if (r.score <= 0) continue;
    toxicHits++;
    toxicScoreSum += r.score;
    for (const h of r.hits) byType[h] = (byType[h] || 0) + 1;
  }

  const n = messages.length || 1;
  return {
    toxicHits,
    toxicScoreSum,
    toxicRatio: toxicHits / n,
    toxicTypes: byType
  };
}

/** Risiko-Zuschlag 0–32 (kalibriert: toxic p50 ~5.5%, p75 ~12.5%). */
function toxicRiskBonus(stats, totalMessages) {
  if (!stats || totalMessages < 6) return 0;
  let bonus = 0;

  if (stats.toxicRatio >= 0.12) bonus += 22;
  else if (stats.toxicRatio >= 0.06) bonus += 14;
  else if (stats.toxicRatio >= 0.03 && stats.toxicHits >= 2) bonus += 8;

  if (stats.toxicHits >= 4) bonus += 12;
  else if (stats.toxicHits >= 2) bonus += 6;

  if (stats.toxicTypes['schwere-beleidigung']) bonus += 15;
  else if (stats.toxicTypes.beleidigung >= 2) bonus += 8;

  return Math.min(32, bonus);
}

function isLikelyToxicUser(stats, totalMessages) {
  if (totalMessages < 8) return false;
  if (stats.toxicHits >= 2 && stats.toxicRatio >= 0.05) return true;
  if (stats.toxicRatio >= 0.1) return true;
  if (stats.toxicTypes['schwere-beleidigung']) return true;
  return false;
}

module.exports = {
  scoreToxicMessage,
  collectToxicStats,
  toxicRiskBonus,
  isLikelyToxicUser
};
