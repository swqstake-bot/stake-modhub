const { MUTE_PERIODS } = require('./stake-constants');

const PERIOD_MINUTES = {
  '10 minutes': 10,
  '30 minutes': 30,
  '1 hour': 60,
  '2 hours': 120,
  '4 hours': 240,
  '1 day': 1440,
  '2 days': 2880,
  '3 days': 4320,
  '5 days': 7200,
  '1 week': 10080,
  '2 weeks': 20160,
  '1 month': 43200,
  '6 months': 259200,
  '1 year': 525600,
  indefinite: Infinity
};

const DEFAULT_STRIKE_PERIODS = ['10 minutes', '1 hour', '1 day', '1 week'];

function isValidMutePeriod(period) {
  return MUTE_PERIODS.includes(String(period || '').trim());
}

function minutesToClosestPeriod(mins) {
  const m = Math.max(1, Number(mins) || 10);
  let best = '10 minutes';
  let bestDiff = Infinity;
  for (const period of MUTE_PERIODS) {
    const pm = PERIOD_MINUTES[period];
    if (!Number.isFinite(pm)) continue;
    const diff = Math.abs(pm - m);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = period;
    }
  }
  return best;
}

function normalizeMutePeriod(raw) {
  const s = String(raw || '').trim();
  if (isValidMutePeriod(s)) return s;
  if (Number.isFinite(Number(raw))) return minutesToClosestPeriod(raw);
  return '10 minutes';
}

function normalizeMutePeriods(rule) {
  if (Array.isArray(rule?.mutePeriods) && rule.mutePeriods.length) {
    return rule.mutePeriods.map(normalizeMutePeriod);
  }
  if (Array.isArray(rule?.durationsMinutes) && rule.durationsMinutes.length) {
    return rule.durationsMinutes.map((m) => minutesToClosestPeriod(m));
  }
  return [...DEFAULT_STRIKE_PERIODS];
}

function pickMutePeriod(rule, strike) {
  const arr = normalizeMutePeriods(rule);
  const idx = Math.max(0, Math.min(strike - 1, arr.length - 1));
  return arr[idx];
}

function formatChatNotifyText(template, username) {
  const u = String(username || '').replace(/^@/, '').trim();
  if (!u) return '';
  const t = String(template || '').trim();
  if (!t) return '';
  return t.replace(/@user\b/gi, `@${u}`).replace(/\{user\}/gi, `@${u}`);
}

module.exports = {
  MUTE_PERIODS,
  DEFAULT_STRIKE_PERIODS,
  isValidMutePeriod,
  normalizeMutePeriod,
  normalizeMutePeriods,
  pickMutePeriod,
  formatChatNotifyText
};
