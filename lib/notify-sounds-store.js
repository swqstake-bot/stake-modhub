const fs = require('fs');
const path = require('path');

const SOUNDS_SUBDIR = 'NotifySounds';
const ALLOWED_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.webm']);

function soundsDir(dataPath) {
  return path.join(dataPath || '', SOUNDS_SUBDIR);
}

function ensureSoundsDir(dataPath) {
  const dir = soundsDir(dataPath);
  if (!dir) return null;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function newCustomSoundId() {
  return `snd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeFilename(name) {
  return String(name || 'sound')
    .replace(/[^\w.\-()+ ]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function mimeForExt(ext) {
  const map = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.webm': 'audio/webm'
  };
  return map[String(ext || '').toLowerCase()] || 'audio/mpeg';
}

function listCustomSounds(settings) {
  return Array.isArray(settings?.customNotifySounds) ? settings.customNotifySounds : [];
}

function findCustomSound(settings, id) {
  return listCustomSounds(settings).find((s) => s.id === id) || null;
}

function resolveCustomFilePath(dataPath, settings, id) {
  const entry = findCustomSound(settings, id);
  if (!entry?.filename) return null;
  const fp = path.join(soundsDir(dataPath), entry.filename);
  return fs.existsSync(fp) ? fp : null;
}

function importCustomSound(dataPath, settings, sourcePath, label) {
  const ext = path.extname(sourcePath).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error('unsupported_format');
  }
  const dir = ensureSoundsDir(dataPath);
  if (!dir) throw new Error('no_data_path');
  const id = newCustomSoundId();
  const base = sanitizeFilename(label || path.basename(sourcePath, ext));
  const filename = `${base}-${id.slice(-6)}${ext}`;
  const dest = path.join(dir, filename);
  fs.copyFileSync(sourcePath, dest);
  const entry = {
    id,
    label: String(label || base || 'Eigener Sound').trim() || 'Eigener Sound',
    filename
  };
  const customNotifySounds = [...listCustomSounds(settings), entry];
  return { entry, customNotifySounds };
}

function deleteCustomSound(dataPath, settings, id) {
  const list = listCustomSounds(settings);
  const entry = list.find((s) => s.id === id);
  if (!entry) return settings.customNotifySounds || [];
  const fp = path.join(soundsDir(dataPath), entry.filename);
  if (fs.existsSync(fp)) {
    try {
      fs.unlinkSync(fp);
    } catch (_) {
      /* ignore */
    }
  }
  return list.filter((s) => s.id !== id);
}

function readCustomSoundDataUrl(dataPath, settings, id) {
  const fp = resolveCustomFilePath(dataPath, settings, id);
  if (!fp) return null;
  const buf = fs.readFileSync(fp);
  const mime = mimeForExt(path.extname(fp));
  return `data:${mime};base64,${buf.toString('base64')}`;
}

module.exports = {
  SOUNDS_SUBDIR,
  ALLOWED_EXT,
  soundsDir,
  listCustomSounds,
  findCustomSound,
  importCustomSound,
  deleteCustomSound,
  readCustomSoundDataUrl,
  mimeForExt
};
