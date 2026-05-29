const dataFiles = require('./data-files');
const fileLogs = require('./file-logs');
const { ensureDataPath } = require('./data-path');

class AutoHashQueue {
  constructor({ getSettings, fetchUserHash }) {
    this.getSettings = getSettings;
    this.fetchUserHash = fetchUserHash;
    this.queue = [];
    this.checkedToday = new Set();
    this.processing = false;
    this.lastDailyKey = '';
    this.dailyTimer = null;
    this.dailyTimer = setInterval(() => this._checkDailyReset(), 30000);
  }

  dispose() {
    if (this.dailyTimer) clearInterval(this.dailyTimer);
    this.dailyTimer = null;
  }

  reloadCheckedToday() {
    this.checkedToday = dataFiles.loadCheckedUsersToday(ensureDataPath());
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
    dataFiles.clearCheckedUsersToday(ensureDataPath());
    this.checkedToday.clear();
  }

  enqueue(username) {
    const name = String(username || '').trim();
    if (!name) return;
    const s = this.getSettings();
    if (!s.logHash) return;

    this._checkDailyReset();
    if (this.checkedToday.has(name.toLowerCase())) return;
    if (this.queue.some((q) => q.toLowerCase() === name.toLowerCase())) return;
    this.queue.push(name);
    this._pump();
  }

  async _pump() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length) {
      const name = this.queue.shift();
      const s = this.getSettings();
      if (!s.logHash) break;
      if (this.checkedToday.has(name.toLowerCase())) continue;

      try {
        const data = await this.fetchUserHash(name);
        const u = data?.user;
        if (u?.name && u?.hashedIp) {
          const dir = ensureDataPath();
          fileLogs.appendHashIp(dir, u.name, u.hashedIp);
          dataFiles.appendCheckedUserToday(dir, u.name);
          this.checkedToday.add(u.name.toLowerCase());
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
