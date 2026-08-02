const dataFiles = require('./data-files');
const { normalizeForAutomute } = require('./automute-normalize');
const { migrateAutoMuteRules } = require('./automute-defaults');
const { pickMutePeriod, formatChatNotifyText } = require('./automute-periods');

const SKIP_KINDS = new Set(['rain', 'tip', 'trivia', 'race', 'bot']);
const QUEUE_DELAY_MS = 500;
const MAX_LOG = 100;

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
  const expire = pickMutePeriod(rule, strike);
  return {
    match: true,
    ruleId: rule.id,
    ruleLabel: rule.label,
    strike,
    expire,
    muteReason: rule.muteReason,
    chatNotifyText: rule.chatNotifyEnabled
      ? formatChatNotifyText(rule.chatNotifyText, username)
      : ''
  };
}

class AutoMuteEngine {
  constructor({ getSettings, getSettingsForSite, getDataDir, resolveUserId, muteUser, sendChatAnnounce, getModNames, onAction, getRelay }) {
    this.getSettings = getSettings;
    this.getSettingsForSite = getSettingsForSite || ((site) => getSettings());
    this.getDataDir = getDataDir;
    this.resolveUserId = resolveUserId;
    this.muteUser = muteUser;
    this.sendChatAnnounce = sendChatAnnounce;
    this.getModNames = getModNames;
    this.onAction = onAction;
    this.getRelay = getRelay;
    this.queue = [];
    this.processing = false;
    this.recentLog = [];
    this.todayCount = 0;
    this.todayKey = '';
    this.recentActionUntil = new Map();
  }

  getRules(site = 'com') {
    const s = this.getSettingsForSite(site);
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
    const site = m.site === 'eu' ? 'eu' : 'com';
    const s = this.getSettingsForSite(site);
    if (!s.automuteEnabled) return;
    const relay = this.getRelay?.();
    if (relay?.isCoordinationActive?.() && !relay.isLocalExecutor()) return;
    if (!m || !m.username || SKIP_KINDS.has(m.kind)) return;
    if (shouldSkipUsername(m.username)) return;
    if (this.isModUser(m.username)) return;

    const message = String(m.message || '').trim();
    if (!message) return;

    const rules = this.getRules(site);
    for (const rule of rules) {
      if (!ruleMatches(rule, message)) continue;
      this.enqueue({ username: m.username, message, rule, site });
      break;
    }
  }

  enqueue(job) {
    const username = String(job.username || '').trim();
    if (!username) return;
    const uname = username.replace(/^@/, '').trim().toLowerCase();
    const site = job.site === 'eu' ? 'eu' : 'com';
    const queueKey = `${site}|${job.rule.id}|${uname}`;
    if (this.queue.some((q) => `${q.site || 'com'}|${q.rule.id}|${q.username.toLowerCase()}` === queueKey)) return;

    const msgKey = normalizeForAutomute(job.message).slice(0, 80);
    const actionKey = `${site}|${job.rule.id}|${uname}|${msgKey}`;
    const blockedUntil = this.recentActionUntil.get(actionKey);
    if (blockedUntil && Date.now() < blockedUntil) return;

    this.recentActionUntil.set(actionKey, Date.now() + 120000);
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

  async _execute({ username, message, rule, site: jobSite }) {
    const site = jobSite === 'eu' ? 'eu' : 'com';
    const s = this.getSettingsForSite(site);
    const dir = this.getDataDir();
    const dryRun = s.automuteDryRun !== false;
    const uname = String(username).replace(/^@/, '').trim();
    const strikeKey = `${site}|${rule.id}|${uname.toLowerCase()}`;

    let strike;
    const relay = this.getRelay?.();
    if (relay?.isCoordinationActive?.()) {
      const inc = await relay.incrementStrike(strikeKey);
      if (!inc?.ok) return;
      strike = inc.count;
    } else {
      strike = dir ? dataFiles.incrementAutomuteStrike(dir, strikeKey) : 1;
    }
    const expire = pickMutePeriod(rule, strike);
    const muteReason = rule.muteReason || 'low quality chat / spam';
    const chatText = rule.chatNotifyEnabled
      ? formatChatNotifyText(rule.chatNotifyText, uname)
      : '';

    const entry = {
      at: Date.now(),
      username: uname,
      ruleId: rule.id,
      ruleLabel: rule.label,
      strike,
      expire,
      muteReason,
      chatText: chatText || null,
      dryRun,
      ok: false,
      preview: message.slice(0, 120),
      notifyEnabled: rule.notifyEnabled !== false,
      notifySound: rule.notifySound || '5',
      site
    };

    if (dryRun) {
      entry.ok = true;
      entry.skipped = 'dry-run';
      this._pushLog(entry);
      return;
    }

    try {
      const userId = await this.resolveUserId(uname, { site });
      if (!userId) {
        entry.error = 'user_not_found';
        this._pushLog(entry);
        return;
      }
      await this.muteUser({ userId, expire, message: muteReason, site });
      if (chatText && this.sendChatAnnounce) {
        try {
          await this.sendChatAnnounce(chatText, { site });
        } catch (e) {
          entry.chatError = e.message || String(e);
        }
      }
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
    const relay = this.getRelay?.();
    return {
      enabled: !!s.automuteEnabled,
      dryRun: s.automuteDryRun !== false,
      rules: this.getRules(s.activeSite === 'eu' ? 'eu' : 'com').length,
      todayCount: this.todayCount,
      queueLength: this.queue.length,
      relay: relay?.getStatus?.() || null
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
  shouldSkipUsername
};
