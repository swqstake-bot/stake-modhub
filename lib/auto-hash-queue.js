const dataFiles = require('./data-files');
const fileLogs = require('./file-logs');
const { ensureDataPath } = require('./data-path');

function siteKey(site) {
  return site === 'eu' ? 'eu' : 'com';
}

class AutoHashQueue {
  constructor({ getSettings, fetchUserHash }) {
    this.getSettings = getSettings;
    this.fetchUserHash = fetchUserHash;
    /** @type {{ name: string, site: string }[]} */
    this.queue = [];
    /** @type {Map<string, Set<string>>} site → lowercase usernames */
    this.checkedTodayBySite = new Map([
      ['com', new Set()],
      ['eu', new Set()]
    ]);
    this.processing = false;
    this.lastDailyKey = '';
    this.dailyTimer = null;
    this.dailyTimer = setInterval(() => this._checkDailyReset(), 30000);
    this.reloadCheckedToday();
  }

  dispose() {
    if (this.dailyTimer) clearInterval(this.dailyTimer);
    this.dailyTimer = null;
  }

  _checkedSet(site) {
    const key = siteKey(site);
    if (!this.checkedTodayBySite.has(key)) this.checkedTodayBySite.set(key, new Set());
    return this.checkedTodayBySite.get(key);
  }

  reloadCheckedToday(site) {
    const sites = site ? [siteKey(site)] : ['com', 'eu'];
    for (const s of sites) {
      const dir = ensureDataPath(s);
      this.checkedTodayBySite.set(s, dataFiles.loadCheckedUsersToday(dir));
    }
  }

  _dailyKey() {
    const s = this.getSettings();
    const h = Number(s.autodelHour);
    const m = Number(s.autodelMinute);
    const now = new Date();
    return `${now.toLocaleDateString('de-DE')}|${h}|${m}`;
  }

  _checkDailyReset() {
    const s = this.getSettings();
    if (!s.logHash) return;
    const now = new Date();
    if (now.getHours() !== Number(s.autodelHour) || now.getMinutes() !== Number(s.autodelMinute)) return;
    const key = this._dailyKey();
    if (key === this.lastDailyKey) return;
    this.lastDailyKey = key;
    for (const site of ['com', 'eu']) {
      dataFiles.clearCheckedUsersToday(ensureDataPath(site));
      this._checkedSet(site).clear();
    }
  }

  enqueue(username, site = 'com') {
    const name = String(username || '').trim();
    if (!name) return;
    const s = this.getSettings();
    if (!s.logHash) return;
    const sk = siteKey(site);

    this._checkDailyReset();
    if (this._checkedSet(sk).has(name.toLowerCase())) return;
    if (this.queue.some((q) => q.site === sk && q.name.toLowerCase() === name.toLowerCase())) return;
    this.queue.push({ name, site: sk });
    this._pump();
  }

  async _pump() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length) {
      const job = this.queue.shift();
      const name = job?.name;
      const site = siteKey(job?.site);
      const s = this.getSettings();
      if (!s.logHash) break;
      if (!name) continue;
      if (this._checkedSet(site).has(name.toLowerCase())) continue;

      try {
        const data = await this.fetchUserHash(name, site);
        const u = data?.user;
        if (u?.name && u?.hashedIp) {
          const dir = ensureDataPath(site);
          fileLogs.appendHashIp(dir, u.name, u.hashedIp);
          dataFiles.appendCheckedUserToday(dir, u.name);
          this._checkedSet(site).add(u.name.toLowerCase());
        }
      } catch (_) {
        /* skip failed user */
      }
      await new Promise((r) => setTimeout(r, 450));
    }
    this.processing = false;
  }
}

module.exports = { AutoHashQueue };
