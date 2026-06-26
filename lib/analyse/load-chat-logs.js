const fs = require('fs');
const path = require('path');
const { parseStakeChatCsvFile } = require('./parse-chat-csv');

const CHAT_FILE_RE = /^(\d+)Chat_de\.csv$/i;

function parseFilenameDayKey(basename) {
  const m = basename.match(CHAT_FILE_RE);
  if (!m) return null;
  const digits = m[1];
  const year = parseInt(digits.slice(-4), 10);
  if (!Number.isFinite(year) || year < 2000) return null;
  const rest = digits.slice(0, -4);
  if (!rest.length) return null;

  let day;
  let month;
  if (rest.length <= 2) {
    day = parseInt(rest[0], 10);
    month = parseInt(rest.slice(1), 10);
  } else if (rest.length === 3) {
    const asDDm = parseInt(rest.slice(0, 2), 10);
    const m1 = parseInt(rest.slice(2), 10);
    if (asDDm >= 10 && asDDm <= 31 && m1 >= 1 && m1 <= 12) {
      day = asDDm;
      month = m1;
    } else {
      day = parseInt(rest[0], 10);
      month = parseInt(rest.slice(1), 10);
    }
  } else {
    day = parseInt(rest.slice(0, rest.length - 2), 10);
    month = parseInt(rest.slice(-2), 10);
  }
  if (!day || !month || month < 1 || month > 12) return null;
  const date = new Date(year, month - 1, day);
  return {
    basename,
    year,
    month,
    day,
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    startMs: date.getTime(),
    endMs: date.getTime() + 86400000 - 1
  };
}

function listChatLogFilesFromDirs(dirs) {
  const map = new Map();
  for (const dir of (Array.isArray(dirs) ? dirs : [dirs]).filter(Boolean)) {
    for (const f of listChatLogFiles(dir)) {
      if (!map.has(f.basename)) {
        map.set(f.basename, { ...f, paths: [f.path] });
      } else {
        map.get(f.basename).paths.push(f.path);
      }
    }
  }
  return [...map.values()].sort((a, b) => a.startMs - b.startMs);
}

function dedupeMessages(messages) {
  const seen = new Set();
  const out = [];
  for (const m of messages) {
    const key = `${m.timestamp}|${m.username}|${String(m.message || '').trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function listChatLogFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => CHAT_FILE_RE.test(f))
    .map((f) => {
      const meta = parseFilenameDayKey(f);
      if (!meta) return null;
      return { ...meta, path: path.join(dir, f) };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMs - b.startMs);
}

function filterFilesByRange(files, fromMs, toMs) {
  return files.filter((f) => f.endMs >= fromMs && f.startMs <= toMs);
}

function loadMessagesFromFiles(files, opts = {}) {
  const all = [];
  const fileStats = [];
  const total = files.length;
  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi];
    const paths = f.paths || [f.path];
    let totalParsed = 0;
    const batch = [];
    const errors = [];
    for (const p of paths) {
      try {
        const { messages } = parseStakeChatCsvFile(p);
        totalParsed += messages.length;
        for (const m of messages) {
          if (opts.filterMessage && !opts.filterMessage(m)) continue;
          if (typeof m.timestamp === 'number' && Number.isFinite(m.timestamp)) {
            if (opts.fromMs != null && m.timestamp < opts.fromMs) continue;
            if (opts.toMs != null && m.timestamp > opts.toMs) continue;
          }
          batch.push(m);
        }
      } catch (e) {
        errors.push(e.message);
      }
    }
    const kept = dedupeMessages(batch);
    all.push(...kept);
    const stat = {
      file: f.basename,
      count: totalParsed,
      kept: kept.length,
      sources: paths.length,
      error: errors.length ? errors.join('; ') : undefined
    };
    fileStats.push(stat);
    if (typeof opts.onFileLoaded === 'function') {
      opts.onFileLoaded(fi + 1, total, stat, all.length);
    }
  }
  return { messages: all, fileStats };
}

function monthRangeMs(refDate = new Date()) {
  const y = refDate.getFullYear();
  const m = refDate.getMonth();
  return {
    fromMs: new Date(y, m, 1).getTime(),
    toMs: new Date(y, m + 1, 0, 23, 59, 59, 999).getTime()
  };
}

function todayRangeMs(refDate = new Date()) {
  const y = refDate.getFullYear();
  const m = refDate.getMonth();
  const d = refDate.getDate();
  return {
    fromMs: new Date(y, m, d).getTime(),
    toMs: new Date(y, m, d, 23, 59, 59, 999).getTime()
  };
}

/** Strikter Zeitraum — kein Fallback auf andere Tage/Monate. */
function resolveRange(preset, refDate = new Date()) {
  if (preset === 'month') {
    return { ...monthRangeMs(refDate), label: 'Monat' };
  }
  if (preset === 'today') {
    return { ...todayRangeMs(refDate), label: 'Heute' };
  }
  return { ...todayRangeMs(refDate), label: 'Heute' };
}

module.exports = {
  listChatLogFiles,
  listChatLogFilesFromDirs,
  dedupeMessages,
  filterFilesByRange,
  loadMessagesFromFiles,
  monthRangeMs,
  todayRangeMs,
  parseFilenameDayKey,
  resolveRange
};
