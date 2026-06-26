const { collectLowQualityStats } = require('./low-quality-spam');

function dayKey(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function collectFirstDayStats(messages) {
  if (!messages.length) {
    return {
      firstDayKey: null,
      firstDayMessages: 0,
      firstDayShare: 0,
      firstDayLowQualityRatio: 0,
      firstDayBurst: false
    };
  }

  let firstTs = Infinity;
  for (const m of messages) {
    if (typeof m.timestamp === 'number' && m.timestamp < firstTs) firstTs = m.timestamp;
  }
  const firstDay = dayKey(firstTs);
  const firstDayMsgs = messages.filter((m) => dayKey(m.timestamp) === firstDay);
  const lq = collectLowQualityStats(firstDayMsgs);
  const total = messages.length;
  const share = total ? firstDayMsgs.length / total : 0;

  let maxBurst = 0;
  const ts = firstDayMsgs
    .map((m) => m.timestamp)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  for (let i = 0; i < ts.length; i++) {
    let c = 1;
    for (let j = i + 1; j < ts.length && ts[j] - ts[i] <= 120000; j++) c++;
    if (c > maxBurst) maxBurst = c;
  }

  return {
    firstDayKey: firstDay,
    firstDayMessages: firstDayMsgs.length,
    firstDayShare: share,
    firstDayLowQualityRatio: lq.lowQualityRatio,
    firstDayBurst: maxBurst >= 8,
    firstDayMaxBurst: maxBurst
  };
}

function firstDayRiskBonus(stats, activeDays, totalMessages) {
  if (!stats || totalMessages < 8) return 0;
  let bonus = 0;
  const heavyFirstDay = stats.firstDayMessages >= 20 && activeDays <= 2;
  const spammyFirstDay =
    stats.firstDayLowQualityRatio >= 0.45 && stats.firstDayMessages >= 12;

  if (heavyFirstDay && spammyFirstDay) bonus += 20;
  else if (spammyFirstDay) bonus += 14;
  else if (heavyFirstDay && stats.firstDayBurst) bonus += 12;
  else if (stats.firstDayMessages >= 30 && activeDays === 1) bonus += 10;

  return Math.min(25, bonus);
}

function isFirstDaySuspicious(stats, activeDays, totalMessages) {
  if (totalMessages < 10) return false;
  if (activeDays <= 1 && stats.firstDayMessages >= 25) return true;
  if (activeDays <= 2 && stats.firstDayLowQualityRatio >= 0.5 && stats.firstDayMessages >= 15) {
    return true;
  }
  return false;
}

module.exports = {
  collectFirstDayStats,
  firstDayRiskBonus,
  isFirstDaySuspicious
};
