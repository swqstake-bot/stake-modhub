function stdDev(nums) {
  if (!nums.length) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((s, x) => s + (x - mean) ** 2, 0) / nums.length;
  return Math.sqrt(v);
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * @param {Array<{timestamp:number|null}>} messages sorted by time
 */
function analyseBotSignals(messages) {
  const ts = messages
    .map((m) => m.timestamp)
    .filter((t) => typeof t === 'number' && Number.isFinite(t))
    .sort((a, b) => a - b);

  if (ts.length < 5) {
    return {
      botScore: 0,
      botLevel: '',
      intervalMedianSec: 0,
      intervalCv: 0,
      regularHits: 0
    };
  }

  const gaps = [];
  for (let i = 1; i < ts.length; i++) {
    const g = (ts[i] - ts[i - 1]) / 1000;
    if (g > 0 && g < 3600) gaps.push(g);
  }
  if (gaps.length < 4) {
    return {
      botScore: 0,
      botLevel: '',
      intervalMedianSec: 0,
      intervalCv: 0,
      regularHits: 0
    };
  }

  const med = median(gaps);
  const sd = stdDev(gaps);
  const cv = med > 0 ? sd / med : 1;
  let regularHits = 0;
  for (const g of gaps) {
    if (Math.abs(g - med) <= 2) regularHits++;
  }

  let botScore = 0;
  const hasRhythm = cv < 0.35 && med >= 8 && med <= 180;
  if (hasRhythm) botScore += cv < 0.22 ? 35 : 22;
  if (regularHits >= 5) botScore += 25;
  else if (regularHits >= 4) botScore += 15;

  let botLevel = '';
  if (botScore >= 50) botLevel = 'hoch';
  else if (botScore >= 28) botLevel = 'mittel';
  else if (botScore >= 12) botLevel = 'niedrig';

  return {
    botScore: Math.min(100, botScore),
    botLevel,
    intervalMedianSec: Math.round(med * 10) / 10,
    intervalCv: Math.round(cv * 1000) / 1000,
    regularHits
  };
}

function countFloodBursts(messages, windowMs = 60000, threshold = 6) {
  const ts = messages
    .map((m) => m.timestamp)
    .filter((t) => typeof t === 'number' && Number.isFinite(t))
    .sort((a, b) => a - b);
  let bursts = 0;
  for (let i = 0; i < ts.length; i++) {
    let count = 1;
    for (let j = i + 1; j < ts.length && ts[j] - ts[i] <= windowMs; j++) count++;
    if (count >= threshold) {
      bursts++;
      i += count - 1;
    }
  }
  return bursts;
}

module.exports = {
  analyseBotSignals,
  countFloodBursts
};
