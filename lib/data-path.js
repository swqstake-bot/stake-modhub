const fs = require('fs');
const path = require('path');

const DATENGRUBE_DIR = 'Datengrube';

function getModhubRoot() {
  try {
    const { app } = require('electron');
    if (app?.isPackaged) {
      const appPath = app.getAppPath();
      if (appPath.includes('.asar')) {
        return path.dirname(app.getPath('exe'));
      }
      return appPath;
    }
  } catch (_) {
    /* electron not ready — dev fallback */
  }
  return path.join(__dirname, '..');
}

/** Alle Tool-Daten: …/Datengrube (neben EXE bei asar-Build, sonst im App-Ordner) */
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
