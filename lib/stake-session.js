const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { DEFAULT_SETTINGS } = require('./stake-constants');

function settingsPath() {
  return path.join(app.getPath('userData'), 'modhub-settings.json');
}

function isLegacyModChatUrl(url) {
  const u = String(url || '').trim().toLowerCase();
  if (!u) return false;
  if (/trycloudflare\.com/.test(u)) return false;
  return (
    /^wss?:\/\/(192\.168\.|10\.|127\.0\.0\.1|localhost\b)/.test(u) ||
    (/:3847/.test(u) && !/trycloudflare\.com/.test(u))
  );
}

function loadSettings() {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) return { ...DEFAULT_SETTINGS };
    const v = JSON.parse(fs.readFileSync(p, 'utf8'));
    let next = { ...DEFAULT_SETTINGS, ...v };
    let dirty = false;
    if (isLegacyModChatUrl(next.modChatUrl)) {
      next.modChatUrl = DEFAULT_SETTINGS.modChatUrl;
      dirty = true;
    }
    if ('modChatToken' in next) {
      delete next.modChatToken;
      dirty = true;
    }
    if (dirty) {
      try {
        fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
      } catch (_) {
        /* ignore */
      }
    }
    return next;
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(partial) {
  const cur = loadSettings();
  const next = { ...cur, ...partial };
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function normalizeHostname(domain) {
  if (!domain || typeof domain !== 'string') return 'stake.bet';
  return domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim() || 'stake.bet';
}

module.exports = {
  settingsPath,
  loadSettings,
  saveSettings,
  normalizeHostname
};
