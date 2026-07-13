const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!dir) return false;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return true;
}

function readLinesFile(dir, filename) {
  if (!dir) return [];
  const fp = path.join(dir, filename);
  if (!fs.existsSync(fp)) return [];
  return fs
    .readFileSync(fp, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function appendLineFile(dir, filename, line) {
  if (!ensureDir(dir)) return false;
  const fp = path.join(dir, filename);
  fs.appendFileSync(fp, line + '\n', 'utf8');
  return true;
}

function readCsvBody(dir, filename) {
  if (!dir) return [];
  const fp = path.join(dir, filename);
  if (!fs.existsSync(fp)) return [];
  const raw = fs.readFileSync(fp, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length <= 1) return [];
  return lines.slice(1).map((line) => line.split(';'));
}

function ensureLineFile(dir, filename) {
  if (!ensureDir(dir)) return;
  const fp = path.join(dir, filename);
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, '', 'utf8');
}

/** Disk lines first, then bundled defaults not already present. */
function mergeBlueprintLists(diskLines, bundledLines) {
  const disk = diskLines || [];
  const bundled = bundledLines || [];
  if (!bundled.length) return disk;
  if (!disk.length) return [...bundled];
  const seen = new Set(disk);
  const out = [...disk];
  for (const line of bundled) {
    if (!seen.has(line)) {
      out.push(line);
      seen.add(line);
    }
  }
  return out;
}

function seedBlueprintFileIfEmpty(dir, filename, bundledLines) {
  if (!ensureDir(dir) || !bundledLines?.length) return false;
  const existing = readLinesFile(dir, filename);
  if (existing.length) return false;
  const fp = path.join(dir, filename);
  fs.writeFileSync(fp, `${bundledLines.join('\n')}\n`, 'utf8');
  return true;
}

function loadBlueprints(dir, bundledFallback = null) {
  const bundled = bundledFallback || { chat: [], mute: [], warn: [], rh: [] };
  if (!dir) {
    return {
      chat: bundled.chat || [],
      mute: bundled.mute || [],
      warn: bundled.warn || [],
      rh: bundled.rh || [],
      source: 'bundled'
    };
  }
  const chatDisk = readLinesFile(dir, 'ChatBlueprints.txt');
  const muteDisk = readLinesFile(dir, 'MuteBlueprints.txt');
  const warnDisk = readLinesFile(dir, 'WarnBlueprints.txt');
  const rhDisk = readLinesFile(dir, 'RhBlueprints.txt');
  const chat = mergeBlueprintLists(chatDisk, bundled.chat);
  const mute = mergeBlueprintLists(muteDisk, bundled.mute);
  const warn = mergeBlueprintLists(warnDisk, bundled.warn);
  const rh = mergeBlueprintLists(rhDisk, bundled.rh);
  if (!chatDisk.length) ensureLineFile(dir, 'ChatBlueprints.txt');
  if (!muteDisk.length) ensureLineFile(dir, 'MuteBlueprints.txt');
  if (!warnDisk.length) ensureLineFile(dir, 'WarnBlueprints.txt');
  if (!rhDisk.length) ensureLineFile(dir, 'RhBlueprints.txt');
  return {
    chat,
    mute,
    warn,
    rh,
    source: chatDisk.length || muteDisk.length || warnDisk.length || rhDisk.length ? 'disk' : 'bundled'
  };
}

function loadVeri2(dir) {
  ensureLineFile(dir, 'Veri2Users.txt');
  return readLinesFile(dir, 'Veri2Users.txt').map((u) => u.toLowerCase());
}

function addVeri2User(dir, username) {
  const u = String(username || '').trim();
  if (!u || !ensureDir(dir)) return false;
  const fp = path.join(dir, 'Veri2Users.txt');
  const existing = new Set(loadVeri2(dir));
  if (existing.has(u.toLowerCase())) return true;
  fs.appendFileSync(fp, u + '\n', 'utf8');
  return true;
}

function loadMutedWarned(dir) {
  const muted = readCsvBody(dir, 'Muted_Users.csv').map((cols) => ({
    timestamp: cols[0] || '',
    user: cols[1] || '',
    message: cols[2] || '',
    period: cols[3] || ''
  }));
  const warned = readCsvBody(dir, 'Warned_Users.csv').map((cols) => ({
    timestamp: cols[0] || '',
    user: cols[1] || '',
    message: cols[2] || ''
  }));
  return { muted, warned };
}

function loadCheckedUsersToday(dir) {
  const set = new Set();
  if (!dir) return set;
  const fp = path.join(dir, 'Checked_Users_Today.csv');
  if (!fs.existsSync(fp)) return set;
  const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';');
    const user = (cols[1] || '').trim();
    if (user) set.add(user.toLowerCase());
  }
  return set;
}

function appendCheckedUserToday(dir, username) {
  const u = String(username || '').trim();
  if (!u || !ensureDir(dir)) return false;
  const fp = path.join(dir, 'Checked_Users_Today.csv');
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(fp, 'Timestamp;User\n', 'utf8');
  }
  const ts = new Date().toLocaleString('de-DE');
  fs.appendFileSync(fp, `${ts};${u}\n`, 'utf8');
  return true;
}

function clearCheckedUsersToday(dir) {
  if (!dir) return;
  const fp = path.join(dir, 'Checked_Users_Today.csv');
  if (fs.existsSync(fp)) {
    try {
      fs.unlinkSync(fp);
    } catch (_) {
      /* ignore */
    }
  }
}

function findDuplicateIps(dir) {
  const rows = readCsvBody(dir, 'HashIP_All.csv');
  const byIp = new Map();
  for (const cols of rows) {
    const user = (cols[1] || '').trim();
    const ip = (cols[2] || '').trim();
    if (!user || !ip) continue;
    if (!byIp.has(ip)) byIp.set(ip, new Set());
    byIp.get(ip).add(user);
  }
  const groups = [];
  for (const [ip, users] of byIp) {
    if (users.size > 1) {
      groups.push({ ip, users: Array.from(users) });
    }
  }
  return groups.sort((a, b) => b.users.length - a.users.length);
}

function automuteStrikesPath(dir) {
  return path.join(dir, 'automute-strikes.json');
}

function loadAutomuteStrikes(dir) {
  if (!dir) return {};
  const fp = automuteStrikesPath(dir);
  if (!fs.existsSync(fp)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function saveAutomuteStrikes(dir, data) {
  if (!ensureDir(dir)) return false;
  fs.writeFileSync(automuteStrikesPath(dir), JSON.stringify(data, null, 2), 'utf8');
  return true;
}

function getAutomuteStrikeLastAt(dir, key) {
  const strikes = loadAutomuteStrikes(dir);
  const row = strikes[key];
  return row?.lastAt ? Number(row.lastAt) : 0;
}

function incrementAutomuteStrike(dir, key) {
  const strikes = loadAutomuteStrikes(dir);
  const prev = strikes[key]?.count || 0;
  const count = prev + 1;
  strikes[key] = { count, lastAt: Date.now() };
  saveAutomuteStrikes(dir, strikes);
  return count;
}

function escAutomuteCell(s) {
  return String(s ?? '')
    .replace(/;/g, ',')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function appendAutomuteLog(dir, entry) {
  if (!entry || !ensureDir(dir)) return false;
  const fp = path.join(dir, 'Automute_Log.csv');
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(
      fp,
      'Timestamp;User;Regel;Strike;DauerMin;Expire;DryRun;OK;Grund;Preview\n',
      'utf8'
    );
  }
  const ts = new Date(entry.at || Date.now()).toLocaleString('de-DE');
  const line = [
    ts,
    escAutomuteCell(entry.username),
    escAutomuteCell(entry.ruleLabel || entry.ruleId),
    entry.strike != null ? entry.strike : '',
    entry.durationMinutes != null ? entry.durationMinutes : '',
    escAutomuteCell(entry.expire),
    entry.dryRun ? 'ja' : 'nein',
    entry.ok ? 'ok' : escAutomuteCell(entry.error || entry.skipped || 'fail'),
    escAutomuteCell(entry.muteReason),
    escAutomuteCell(entry.preview)
  ].join(';');
  fs.appendFileSync(fp, `${line}\n`, 'utf8');
  return true;
}

module.exports = {
  loadBlueprints,
  mergeBlueprintLists,
  seedBlueprintFileIfEmpty,
  appendLineFile,
  loadVeri2,
  addVeri2User,
  loadMutedWarned,
  findDuplicateIps,
  readLinesFile,
  loadCheckedUsersToday,
  appendCheckedUserToday,
  clearCheckedUsersToday,
  loadAutomuteStrikes,
  saveAutomuteStrikes,
  getAutomuteStrikeLastAt,
  incrementAutomuteStrike,
  appendAutomuteLog
};
