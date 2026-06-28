const fs = require('fs');
const path = require('path');

const DATENGRUBE_DIR = 'Datengrube';
const MIGRATION_MARKER = '.migrated-from-installdir';

function isPackagedApp() {
  try {
    const { app } = require('electron');
    return !!app?.isPackaged;
  } catch (_) {
    return false;
  }
}

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

/** Installationsordner — NSIS-Update räumt diesen Pfad leer. */
function getLegacyInstallDatengrubePath() {
  if (!isPackagedApp()) return null;
  try {
    const { app } = require('electron');
    return path.join(path.dirname(app.getPath('exe')), DATENGRUBE_DIR);
  } catch (_) {
    return null;
  }
}

function copyFileIfNewer(src, dest) {
  const srcStat = fs.statSync(src);
  if (!srcStat.isFile()) return false;
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
    return true;
  }
  const destStat = fs.statSync(dest);
  if (srcStat.mtimeMs > destStat.mtimeMs || srcStat.size > destStat.size) {
    fs.copyFileSync(src, dest);
    return true;
  }
  return false;
}

function migrateLegacyInstallDatengrube(target, legacyOverride = null) {
  const legacy = legacyOverride || getLegacyInstallDatengrubePath();
  if (!legacy || legacy === target || !fs.existsSync(legacy)) {
    return { migrated: 0, legacy };
  }

  let migrated = 0;
  for (const name of fs.readdirSync(legacy)) {
    if (name === MIGRATION_MARKER) continue;
    const src = path.join(legacy, name);
    try {
      if (copyFileIfNewer(src, path.join(target, name))) migrated += 1;
    } catch (_) {
      /* ignore einzelne Dateien */
    }
  }

  if (migrated > 0 || !fs.existsSync(path.join(target, MIGRATION_MARKER))) {
    try {
      fs.writeFileSync(
        path.join(target, MIGRATION_MARKER),
        `Migriert von ${legacy} am ${new Date().toISOString()}\n`,
        'utf8'
      );
    } catch (_) {
      /* ignore */
    }
  }

  return { migrated, legacy };
}

/**
 * Alle Tool-Daten:
 * - installiert: %APPDATA%/<app>/Datengrube (überlebt Updates)
 * - Entwicklung: modhub-electron/Datengrube
 */
function getDatengrubePath() {
  let target;
  if (isPackagedApp()) {
    const { app } = require('electron');
    target = path.join(app.getPath('userData'), DATENGRUBE_DIR);
  } else {
    target = path.join(__dirname, '..', DATENGRUBE_DIR);
  }

  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  migrateLegacyInstallDatengrube(target);
  return target;
}

function ensureDataPath() {
  return getDatengrubePath();
}

module.exports = {
  DATENGRUBE_DIR,
  MIGRATION_MARKER,
  getModhubRoot,
  getLegacyInstallDatengrubePath,
  migrateLegacyInstallDatengrube,
  getDatengrubePath,
  ensureDataPath
};
