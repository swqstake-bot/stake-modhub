/** Standard-Automute-Regeln (Account-Verkauf / Discord-Spam). */

const { DEFAULT_STRIKE_PERIODS } = require('./automute-periods');

const DEFAULT_AUTOMUTE_RULES = [
  {
    id: 'account-spam-default',
    label: 'Account-Verkauf / Discord Spam',
    enabled: false,
    matchMode: 'contains',
    matchAll: true,
    patterns: [
      'buying stake',
      'discord'
    ],
    minLength: 20,
    muteReason: 'low quality chat / spam',
    mutePeriods: [...DEFAULT_STRIKE_PERIODS],
    chatNotifyEnabled: false,
    chatNotifyText: '@user Muted - Account Trading - Deutsche Chatregeln',
    notifyEnabled: true,
    notifySound: '5'
  }
];

function normalizeNotifySound(raw) {
  const s = String(raw ?? '5').trim();
  if (s.startsWith('custom:')) return s;
  if (s.startsWith('snd-')) return `custom:${s}`;
  const n = Number(s);
  if (Number.isFinite(n) && n >= 1 && n <= 5) return String(n);
  return '5';
}

function normalizeRule(rule) {
  const { normalizeMutePeriods } = require('./automute-periods');
  return {
    id: String(rule.id || `am-${Date.now()}`),
    label: String(rule.label || 'Regel').trim() || 'Regel',
    enabled: rule.enabled !== false,
    matchMode: rule.matchMode === 'regex' ? 'regex' : 'contains',
    matchAll: !!rule.matchAll,
    patterns: (rule.patterns || []).map((p) => String(p).trim()).filter(Boolean),
    minLength: Math.max(0, Number(rule.minLength) || 0),
    muteReason: String(rule.muteReason || 'low quality chat / spam').trim(),
    mutePeriods: normalizeMutePeriods(rule),
    chatNotifyEnabled: !!rule.chatNotifyEnabled,
    chatNotifyText: String(rule.chatNotifyText || '').trim(),
    notifyEnabled: rule.notifyEnabled !== false,
    notifySound: normalizeNotifySound(rule.notifySound)
  };
}

function migrateAutoMuteRules(settings = {}) {
  if (Array.isArray(settings.autoMuteRules) && settings.autoMuteRules.length) {
    return settings.autoMuteRules.map((r) => normalizeRule(r));
  }
  return DEFAULT_AUTOMUTE_RULES.map((r) => ({ ...r, patterns: [...r.patterns] }));
}

function newAutoMuteRuleId() {
  return `am-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

module.exports = {
  DEFAULT_AUTOMUTE_RULES,
  migrateAutoMuteRules,
  normalizeRule,
  newAutoMuteRuleId
};
