const fs = require('fs');
const path = require('path');
const { ensureDataPath, getDatengrubePath } = require('./data-path');

const DEFAULT_DIR = path.join(__dirname, '..', 'defaults');

function readBundledFile(filename) {
  const source = path.join(DEFAULT_DIR, filename);
  if (!fs.existsSync(source)) return [];
  return fs
    .readFileSync(source, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function readBundledBlueprints() {
  return {
    chat: readBundledFile('ChatBlueprints.txt'),
    mute: readBundledFile('MuteBlueprints.txt'),
    warn: readBundledFile('WarnBlueprints.txt'),
    rh: readBundledFile('RhBlueprints.txt')
  };
}

function bundledAvailable() {
  return (
    fs.existsSync(path.join(DEFAULT_DIR, 'ChatBlueprints.txt')) &&
    fs.existsSync(path.join(DEFAULT_DIR, 'MuteBlueprints.txt')) &&
    fs.existsSync(path.join(DEFAULT_DIR, 'WarnBlueprints.txt')) &&
    fs.existsSync(path.join(DEFAULT_DIR, 'RhBlueprints.txt'))
  );
}

function copyIfMissing(dataPath, filename) {
  const target = path.join(dataPath, filename);
  const source = path.join(DEFAULT_DIR, filename);
  if (!fs.existsSync(source)) return false;
  if (fs.existsSync(target)) {
    const cur = fs.readFileSync(target, 'utf8').trim();
    if (cur.length > 0) return false;
  }
  fs.copyFileSync(source, target);
  return true;
}

function copyForce(dataPath, filename) {
  const target = path.join(dataPath, filename);
  const source = path.join(DEFAULT_DIR, filename);
  if (!fs.existsSync(source)) return false;
  fs.copyFileSync(source, target);
  return true;
}

/** Seeds ChatBlueprints.txt / MuteBlueprints.txt from bundled defaults. */
function seedBlueprintDefaults(dataPath, { force = false } = {}) {
  if (!dataPath) return { chat: false, mute: false, warn: false, rh: false };
  if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
  if (force) {
    return {
      chat: copyForce(dataPath, 'ChatBlueprints.txt'),
      mute: copyForce(dataPath, 'MuteBlueprints.txt'),
      warn: copyForce(dataPath, 'WarnBlueprints.txt'),
      rh: copyForce(dataPath, 'RhBlueprints.txt')
    };
  }
  return {
    chat: copyIfMissing(dataPath, 'ChatBlueprints.txt'),
    mute: copyIfMissing(dataPath, 'MuteBlueprints.txt'),
    warn: copyIfMissing(dataPath, 'WarnBlueprints.txt'),
    rh: copyIfMissing(dataPath, 'RhBlueprints.txt')
  };
}

module.exports = {
  seedBlueprintDefaults,
  readBundledBlueprints,
  bundledAvailable,
  ensureDataPath,
  getDatengrubePath,
  DEFAULT_DIR
};
