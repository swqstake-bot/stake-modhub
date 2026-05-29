const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { DEFAULT_SETTINGS } = require('./stake-constants');

function settingsPath() {
  return path.join(app.getPath('userData'), 'modhub-settings.json');
}

function loadSettings() {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) return { ...DEFAULT_SETTINGS };
    const v = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ...DEFAULT_SETTINGS, ...v };
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
