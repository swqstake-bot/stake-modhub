const fs = require('fs');
const path = require('path');

const STRIKES_FILE = path.join(__dirname, 'automute-strikes-shared.json');

function loadStrikes() {
  try {
    if (!fs.existsSync(STRIKES_FILE)) return {};
    const raw = JSON.parse(fs.readFileSync(STRIKES_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function saveStrikes(data) {
  fs.writeFileSync(STRIKES_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function incrementStrike(key) {
  const strikes = loadStrikes();
  const prev = strikes[key]?.count || 0;
  const count = prev + 1;
  strikes[key] = { count, lastAt: Date.now() };
  saveStrikes(strikes);
  return { count, lastAt: strikes[key].lastAt };
}

function getStrike(key) {
  const row = loadStrikes()[key];
  return row ? { count: row.count || 0, lastAt: row.lastAt || 0 } : { count: 0, lastAt: 0 };
}

module.exports = {
  STRIKES_FILE,
  loadStrikes,
  incrementStrike,
  getStrike
};
