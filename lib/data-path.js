const fs = require('fs');
const path = require('path');

const DATENGRUBE_DIR = 'Datengrube';
const MIGRATION_MARKER = '.migrated-from-installdir';
const SITE_SPLIT_MARKER = '.migrated-flat-to-sites';
const SITE_DIRS = new Set(['com', 'eu']);
const KEEP_AT_ROOT = new Set([MIGRATION_MARKER, SITE_SPLIT_MARKER, 'NotifySounds']);

/** EU daily logs that may still sit in the flat root before site-dir migration. */
const EU_FILE_RE = /(Chat|Rain|Bets)_eu\.csv$/i;

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
    if (name === MIGRATION_MARKER || name === SITE_SPLIT_MARKER) continue;
    const src = path.join(legacy, name);
    try {
      const st = fs.statSync(src);
      if (st.isDirectory()) continue;
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

function normalizeSiteKey(site) {
  return site === 'eu' ? 'eu' : 'com';
}

function movePath(src, dest) {
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dest)) {
    try {
      fs.rmSync(src, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
    return false;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
    return true;
  } catch (_) {
    try {
      const st = fs.statSync(src);
      if (st.isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
        fs.rmSync(src, { recursive: true, force: true });
      } else {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
      }
      return true;
    } catch (_) {
      return false;
    }
  }
}

/**
 * Flat Datengrube → com/ + eu/.
 * EU-Tageslogs (*_eu.csv) → eu/, alles andere (inkl. HashIP/Mute/Veri2/Blueprints) → com/.
 * NotifySounds bleibt im Root (global).
 */
function migrateFlatRootToSiteDirs(root) {
  if (!root || !fs.existsSync(root)) return { moved: 0 };
  const marker = path.join(root, SITE_SPLIT_MARKER);
  if (fs.existsSync(marker)) return { moved: 0, skipped: true };

  for (const site of SITE_DIRS) {
    const dir = path.join(root, site);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  let moved = 0;
  for (const name of fs.readdirSync(root)) {
    if (KEEP_AT_ROOT.has(name) || SITE_DIRS.has(name)) continue;
    const src = path.join(root, name);
    let st;
    try {
      st = fs.statSync(src);
    } catch (_) {
      continue;
    }
    const targetSite = !st.isDirectory() && EU_FILE_RE.test(name) ? 'eu' : 'com';
    if (movePath(src, path.join(root, targetSite, name))) moved += 1;
  }

  try {
    fs.writeFileSync(
      marker,
      `Site-Ordner com/eu angelegt am ${new Date().toISOString()} (moved=${moved})\n`,
      'utf8'
    );
  } catch (_) {
    /* ignore */
  }
  return { moved };
}

/**
 * Root: %APPDATA%/<app>/Datengrube bzw. Dev-Datengrube.
 * Site-Daten: Root/com | Root/eu.
 */
function getDatengrubeRoot() {
  let target;
  if (isPackagedApp()) {
    const { app } = require('electron');
    target = path.join(app.getPath('userData'), DATENGRUBE_DIR);
  } else {
    target = path.join(__dirname, '..', DATENGRUBE_DIR);
  }

  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  migrateLegacyInstallDatengrube(target);
  migrateFlatRootToSiteDirs(target);
  return target;
}

/** @deprecated Prefer getDatengrubeRoot() or ensureDataPath(site). Returns root. */
function getDatengrubePath() {
  return getDatengrubeRoot();
}

function ensureDataPath(site) {
  const root = getDatengrubeRoot();
  const key = normalizeSiteKey(site);
  const dir = path.join(root, key);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getNotifySoundsRoot() {
  const root = getDatengrubeRoot();
  const dir = path.join(root, 'NotifySounds');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return root;
}

module.exports = {
  DATENGRUBE_DIR,
  MIGRATION_MARKER,
  SITE_SPLIT_MARKER,
  getModhubRoot,
  getLegacyInstallDatengrubePath,
  migrateLegacyInstallDatengrube,
  migrateFlatRootToSiteDirs,
  normalizeSiteKey,
  getDatengrubeRoot,
  getDatengrubePath,
  ensureDataPath,
  getNotifySoundsRoot
};
