/**
 * Friendlist-Scoring — kalibriert an Kontrollgruppe vs. Mod-Mutes (Datengrube-Studie).
 * Gute Chatter: LQ ~29%, Ein-Wort ~28% | Spam-Mutes: LQ ~56%, Ein-Wort ~51%
 * Friendlist-Ziel: deutlich unter Kontroll-Niveau + hohe Aktivität & Substanz.
 */

const DEFAULTS = {
  minMessages: 150,
  minActiveDays: 10,
  maxOneWordRatio: 0.2,
  maxLowQualityRatio: 0.18,
  maxToxicRatio: 0.025,
  maxBeggingRatio: 0.012,
  /** Anteil gz/bust — Spam-Mutes ~21 %, Kontrollgruppe ~6 % */
  maxGzBustRatio: 0.14,
  maxDuplicateRatio: 0.22,
  minAvgWords: 3.5,
  minReplyRatio: 0.1
};

function scoreFriendlistMatch(row) {
  let score = 0;

  const msgs = row.totalMessages || 0;
  const days = row.activeDays || 0;
  const lq = row.lowQualityRatio || 0;
  const owr = row.oneWordRatio || 0;
  const toxic = row.toxicRatio || 0;
  const reply = row.replyRatio || 0;
  const words = row.avgWordsPerMessage || 0;

  // Aktivität (0–22): ~5 Msgs/Tag über den Monat
  if (msgs >= 400) score += 22;
  else if (msgs >= 250) score += 18;
  else if (msgs >= 150) score += 14;

  // Regelmäßigkeit (0–18)
  if (days >= 18) score += 18;
  else if (days >= 14) score += 14;
  else if (days >= 10) score += 10;

  // Substanz — weit weg von Spam-Mute-Profil (0–30)
  if (lq < 0.08) score += 12;
  else if (lq < 0.12) score += 8;
  else if (lq < 0.16) score += 4;

  if (owr < 0.08) score += 10;
  else if (owr < 0.14) score += 6;
  else if (owr < 0.2) score += 3;

  if (words >= 6) score += 8;
  else if (words >= 4.5) score += 5;
  else if (words >= 3.5) score += 2;

  // Engagement — echte Unterhaltung, nicht gz-only (0–18)
  if (reply >= 0.35) score += 18;
  else if (reply >= 0.22) score += 12;
  else if (reply >= 0.12) score += 6;

  // Sauberkeit (0–12)
  if (toxic < 0.008 && (row.beggingRatio || 0) < 0.005) score += 12;
  else if (toxic < 0.02 && (row.beggingRatio || 0) < 0.01) score += 6;

  const gzBust = row.gzBustRatio || 0;
  if (gzBust < 0.04) score += 5;
  else if (gzBust < 0.08) score += 3;

  // Bestehende Qualitätsbewertung einbeziehen
  score += Math.min(10, (row.qualityScore || 0) / 10);

  return Math.min(100, Math.round(score));
}

function passesFriendlistFilter(row, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const key = (row.username || '').toLowerCase();

  if (o.excludeSet?.has(key)) return false;
  if (o.mutedSet?.has(key) || o.warnedSet?.has(key)) return false;
  if ((row.totalMessages || 0) < o.minMessages) return false;
  if ((row.activeDays || 0) < o.minActiveDays) return false;
  if ((row.oneWordRatio || 0) > o.maxOneWordRatio) return false;
  if ((row.lowQualityRatio || 0) > o.maxLowQualityRatio) return false;
  if ((row.toxicRatio || 0) > o.maxToxicRatio) return false;
  if ((row.beggingRatio || 0) > o.maxBeggingRatio) return false;
  if ((row.gzBustRatio || 0) > o.maxGzBustRatio) return false;
  if ((row.duplicateRatio || 0) > o.maxDuplicateRatio) return false;
  if ((row.avgWordsPerMessage || 0) < o.minAvgWords) return false;
  if ((row.replyRatio || 0) < o.minReplyRatio) return false;
  if ((row.concernScore || 0) > 0.9) return false;
  /** Spam/Flood-Tier trifft aktive Stammchatter oft wegen gz — nur echte Problem-Stufen ausschließen */
  if (['bot', 'toxic', 'begging', 'coord'].includes(row.enforcementTier)) return false;
  if (row.firstDaySuspicious) return false;
  if (row.coordStrong) return false;
  if (row.botLevel === 'hoch' || row.botLevel === 'mittel') return false;
  return true;
}

module.exports = {
  FRIENDLIST_DEFAULTS: DEFAULTS,
  scoreFriendlistMatch,
  passesFriendlistFilter
};
