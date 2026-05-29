const fs = require('fs');
const path = require('path');

const DATENGRUBE_DIR = 'Datengrube';

function getModhubRoot() {
  return path.join(__dirname, '..');
}

/** Alle Tool-Daten: modhub-electron/Datengrube */
function getDatengrubePath() {
  const p = path.join(getModhubRoot(), DATENGRUBE_DIR);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

function ensureDataPath() {
  return getDatengrubePath();
}

module.exports = {
  DATENGRUBE_DIR,
  getModhubRoot,
  getDatengrubePath,
  ensureDataPath
};
