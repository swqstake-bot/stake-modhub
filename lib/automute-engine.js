const dataFiles = require('./data-files');
const { normalizeForAutomute } = require('./automute-normalize');
const { migrateAutoMuteRules } = require('./automute-defaults');

const SKIP_KINDS = new Set(['rain', 'tip', 'trivia', 'race', 'bot']);
const QUEUE_DELAY_MS = 500;
const MAX_LOG = 100;

function minutesToExpireString(mins) {
  const m = Math.max(1, Math.round(Number(mins) || 10));
  if (m < 60) return `${m} minutes`;
  if (m < 1440) {
    const h = Math.round(m / 60);
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  if (m < 43200) {
    const d = Math.round(m / 1440);
    return d === 1 ? '1 day' : `${d} days`;
  }
  if (m < 525600) {
    const mo = Math.round(m / 43200);
    return mo === 1 ? '1 month' : `${mo} months`;
  }
  const y = Math.round(m / 525600);
  return y === 1 ? '1 year' : `${y} years`;
}

function shouldSkipUsername(username) {
  const u = String(username || '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
  if (!u) return true;
  if (u === 'trivia' || u === 'race') return true;
  if (/rain-bot/i.test(u)) return true;
  return false;
}

function patternMatches(normalizedMessage, pattern, matchMode) {
  const p = normalizeForAutomute(pattern);
  if (!p) return false;
  if (matchMode === 'regex') {
    try {
      return new RegExp(pattern, 'i').test(normalizedMessage);
    } catch (_) {
      return normalizedMessage.includes(p);
    }
  }
  return normalizedMessage.includes(p);
}

function ruleMatches(rule, message) {
  if (!rule?.enabled || !rule.patterns?.length) return false;
  const norm = normalizeForAutomute(message);
  if (!norm) return false;
  if (rule.minLength > 0 && norm.length < rule.minLength) return false;

  const checks = rule.patterns.map((pat) =>
    patternMatches(norm, pat, rule.matchMode || 'contains')
  );
  if (rule.matchAll) return checks.every(Boolean);
  return checks.some(Boolean);
}

function pickDurationMinutes(rule, strike) {
  const arr = rule.durationsMinutes || [10];
  const idx = Math.max(0, Math.min(strike - 1, arr.length - 1));
  return arr[idx];
}

function findMatchingRule(rules, message) {
  for (const rule of rules || []) {
    if (ruleMatches(rule, message)) return rule;
  }
  return null;
}

function previewAutomute(message, rules, { username, strikes = {} } = {}) {
  const rule = findMatchingRule(rules, message);
  if (!rule) return { match: false };
  const uname = String(username || '').replace(/^@/, '').trim().toLowerCase();
  const strikeKey = uname ? `${rule.id}|${uname}` : '';
  const prev = strikeKey && strikes[strikeKey]?.count ? strikes[strikeKey].count : 0;
  const strike = prev + 1;
  const durationMinutes = pickDurationMinutes(rule, strike);
  return {
    match: true,
    ruleId: rule.id,
    ruleLabel: rule.label,
    strike,
    durationMinutes,
    expire: minutesToExpireString(durationMinutes),
    muteReason: rule.muteReason
  };
}

class AutoMuteEngine {
  constructor({ getSettings, getDataDir, resolveUserId, muteUser, getModNames, onAction }) {
    this.getSettings = getSettings;
    this.getDataDir = getDataDir;
    this.resolveUserId = resolveUserId;
    this.muteUser = muteUser;
    this.getModNames = getModNames;
    this.onAction = onAction;
    this.queue = [];
    this.processing = false;
    this.recentLog = [];
    this.todayCount = 0;
    this.todayKey = '';
  }

  getRules() {
    const s = this.getSettings();
    return migrateAutoMuteRules(s).filter((r) => r.enabled);
  }

  isModUser(username) {
    const u = String(username || '')
      .replace(/^@/, '')
      .trim()
      .toLowerCase();
    if (!u) return true;
    const names = new Set((this.getModNames?.() || []).map((n) => String(n).toLowerCase()).filter(Boolean));
    return names.has(u);
  }

  _touchToday() {
    const key = new Date().toLocaleDateString('de-DE');
    if (key !== this.todayKey) {
      this.todayKey = key;
      this.todayCount = 0;
    }
  }

  _pushLog(entry) {
    this._touchToday();
    if (entry.ok || entry.dryRun) this.todayCount += 1;
    this.recentLog.unshift(entry);
    if (this.recentLog.length > MAX_LOG) this.recentLog.length = MAX_LOG;
    const dir = this.getDataDir();
    if (dir) {
      dataFiles.appendAutomuteLog(dir, entry);
    }
    this.onAction?.(entry);
  }

  processMessage(m) {
    const s = this.getSettings();
    if (!s.automuteEnabled) return;
    if (!m || !m.username || SKIP_KINDS.has(m.kind)) return;
    if (shouldSkipUsername(m.username)) return;
    if (this.isModUser(m.username)) return;

    const message = String(m.message || '').trim();
    if (!message) return;

    const rules = this.getRules();
    for (const rule of rules) {
      if (!ruleMatches(rule, message)) continue;
      this.enqueue({ username: m.username, message, rule });
      break;
    }
  }

  enqueue(job) {
    const username = String(job.username || '').trim();
    if (!username) return;
    const key = `${job.rule.id}|${username.toLowerCase()}`;
    if (this.queue.some((q) => `${q.rule.id}|${q.username.toLowerCase()}` === key)) return;
    this.queue.push(job);
    this._pump();
  }

  async _pump() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length) {
      const job = this.queue.shift();
      await this._execute(job);
      await new Promise((r) => setTimeout(r, QUEUE_DELAY_MS));
    }
    this.processing = false;
  }

  async _execute({ username, message, rule }) {
    const s = this.getSettings();
    const dir = this.getDataDir();
    const dryRun = s.automuteDryRun !== false;
    const uname = String(username).replace(/^@/, '').trim();
    const strikeKey = `${rule.id}|${uname.toLowerCase()}`;

    if (rule.cooldownMinutes > 0 && dir) {
      const lastAt = dataFiles.getAutomuteStrikeLastAt(dir, strikeKey);
      if (lastAt && Date.now() - lastAt < rule.cooldownMinutes * 60000) {
        this._pushLog({
          at: Date.now(),
          username: uname,
          ruleId: rule.id,
          ruleLabel: rule.label,
          strike: null,
          durationMinutes: null,
          expire: null,
          dryRun,
          ok: false,
          skipped: 'cooldown',
          preview: message.slice(0, 80)
        });
        return;
      }
    }

    const strike = dir ? dataFiles.incrementAutomuteStrike(dir, strikeKey) : 1;
    const durationMinutes = pickDurationMinutes(rule, strike);
    const expire = minutesToExpireString(durationMinutes);
    const muteReason = rule.muteReason || 'low quality chat / spam';

    const entry = {
      at: Date.now(),
      username: uname,
      ruleId: rule.id,
      ruleLabel: rule.label,
      strike,
      durationMinutes,
      expire,
      muteReason,
      dryRun,
      ok: false,
      preview: message.slice(0, 120),
      notifyEnabled: rule.notifyEnabled !== false,
      notifySound: rule.notifySound || '5'
    };

    if (dryRun) {
      entry.ok = true;
      entry.skipped = 'dry-run';
      this._pushLog(entry);
      return;
    }

    try {
      const userId = await this.resolveUserId(uname);
      if (!userId) {
        entry.error = 'user_not_found';
        this._pushLog(entry);
        return;
      }
      await this.muteUser({ userId, expire, message: muteReason });
      entry.ok = true;
      this._pushLog(entry);
    } catch (e) {
      entry.error = e.message || String(e);
      this._pushLog(entry);
    }
  }

  getStatus() {
    this._touchToday();
    const s = this.getSettings();
    return {
      enabled: !!s.automuteEnabled,
      dryRun: s.automuteDryRun !== false,
      rules: this.getRules().length,
      todayCount: this.todayCount,
      queueLength: this.queue.length
    };
  }

  getRecentLog(limit = 50) {
    return this.recentLog.slice(0, limit);
  }
}

module.exports = {
  AutoMuteEngine,
  ruleMatches,
  findMatchingRule,
  previewAutomute,
  minutesToExpireString,
  shouldSkipUsername
};
