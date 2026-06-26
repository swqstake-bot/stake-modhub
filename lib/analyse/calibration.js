const fs = require('fs');
const { scoreGzSpamComponent } = require('./low-quality-spam');
const path = require('path');

const CAL_PATH = path.join(__dirname, 'mute-calibration.json');
let cached = null;

function loadCalibration() {
  if (cached) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(CAL_PATH, 'utf8'));
  } catch (_) {
    cached = { thresholds: {}, categories: {} };
  }
  return cached;
}

function getThresholds() {
  return loadCalibration().thresholds || {};
}

function getCalibrationMeta() {
  const c = loadCalibration();
  return {
    generatedAt: c.generatedAt || null,
    source: c.source || null,
    spamCases: c.categories?.spam?.cases || 0,
    toxicCases: c.categories?.toxic?.cases || 0
  };
}

/** 0–100: Nähe zu echten Mod-Spam-Mutes (45 Fälle, Datengrube-Studie). */
function scoreSpamMatch(row) {
  const t = getThresholds().spam || {};
  if ((row.totalMessages || 0) < (t.minMessages || 4)) return 0;

  let score = 0;
  const lq = row.lowQualityRatio || 0;
  const owr = row.oneWordRatio || 0;

  if (lq >= 0.55) score += 28;
  else if (lq >= (t.lowQualityRatio || 0.25)) score += 18;
  else if (lq >= 0.15) score += 6;

  if (owr >= 0.5) score += 22;
  else if (owr >= (t.oneWordRatio || 0.2)) score += 12;

  score += scoreGzSpamComponent(row, 32);

  if ((row.emojiFloodHits || 0) >= 3) score += 20;
  else if ((row.emojiFloodHits || 0) >= 1) score += 10;

  const gzb = row.gzBustRatio || 0;
  if (gzb >= 0.2 && lq >= 0.35) score += 10;

  return Math.min(100, score);
}

/** 0–100: Nähe zu echten Mod-Toxic-Mutes (14 Fälle). */
function scoreToxicMatch(row) {
  const t = getThresholds().toxic || {};
  if ((row.totalMessages || 0) < (t.minMessages || 6)) return 0;

  let score = 0;
  const tr = row.toxicRatio || 0;
  const hits = row.toxicHits || 0;

  if (tr >= 0.12) score += 35;
  else if (tr >= 0.06) score += 24;
  else if (tr >= 0.03) score += 12;

  if (hits >= 4) score += 18;
  else if (hits >= 2) score += 10;

  if (row.toxicTypes?.['schwere-beleidigung']) score += 20;
  else if ((row.toxicTypes?.beleidigung || 0) >= 2) score += 10;

  if ((row.byCategory?.toxic_behavior || 0) >= 2) score += 8;
  if ((row.byCategory?.racism_hate || 0) >= 1) score += 15;

  return Math.min(100, score);
}

function scoreBeggingMatch(row) {
  if ((row.totalMessages || 0) < 5) return 0;
  let score = 0;
  const br = row.beggingRatio || 0;
  if (br >= 0.08) score += 30;
  else if (br >= 0.04) score += 18;
  else if ((row.beggingHits || 0) >= 2) score += 10;
  if ((row.byCategory?.begging || 0) >= 3) score += 12;
  return Math.min(100, score);
}

/**
 * Leitet Stufe + Match-Score aus Kalibrierung ab (nicht aus vagen Regel-Treffern).
 */
function deriveEnforcementSignals(row) {
  const spamMatch = scoreSpamMatch(row);
  const toxicMatch = scoreToxicMatch(row);
  const beggingMatch = scoreBeggingMatch(row);

  let tier = 'review';
  let muteMatchScore = 0;
  let primarySignal = '';

  const botLike = row.enforcementTier === 'bot' || row.botLevel === 'hoch';

  if (botLike) {
    tier = 'bot';
    muteMatchScore = Math.max(70, row.riskScore || 0);
    primarySignal = 'bot';
  } else {
    const options = [];
    if (spamMatch >= 42) options.push({ tier: 'spam', score: spamMatch, signal: 'spam' });
    if (toxicMatch >= 38) options.push({ tier: 'toxic', score: toxicMatch, signal: 'toxic' });
    if (beggingMatch >= 35) options.push({ tier: 'begging', score: beggingMatch, signal: 'begging' });

    if (options.length) {
      options.sort((a, b) => b.score - a.score);
      tier = options[0].tier;
      muteMatchScore = options[0].score;
      primarySignal = options[0].signal;
    } else if (row.coordStrong && spamMatch < 38) {
      tier = 'coord';
      muteMatchScore = Math.min(58, 22 + (row.coordStrongHits || 0) * 5);
      primarySignal = 'multi';
    } else if (row.spamFlood) {
      tier = 'flood';
      muteMatchScore = Math.min(70, 30 + (row.floodBursts || 0) * 4);
      primarySignal = 'flood';
    } else if (spamMatch >= 28 || toxicMatch >= 22 || beggingMatch >= 22) {
      tier = 'review';
      muteMatchScore = Math.max(spamMatch, toxicMatch, beggingMatch);
      primarySignal =
        spamMatch >= toxicMatch && spamMatch >= beggingMatch
          ? 'spam?'
          : toxicMatch >= beggingMatch
            ? 'toxic?'
            : 'bettel?';
    }
  }

  if (row.repeatOffender) muteMatchScore = Math.min(100, muteMatchScore + 12);

  return {
    muteMatchScore: Math.round(muteMatchScore),
    enforcementTier: tier,
    primarySignal,
    spamMatch: Math.round(spamMatch),
    toxicMatch: Math.round(toxicMatch),
    beggingMatch: Math.round(beggingMatch)
  };
}

module.exports = {
  loadCalibration,
  getThresholds,
  getCalibrationMeta,
  scoreSpamMatch,
  scoreToxicMatch,
  scoreBeggingMatch,
  deriveEnforcementSignals
};
