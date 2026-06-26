const fs = require('fs');
const path = require('path');

const FLUSH_MS = 400;
/** @type {Map<string, { lines: string[], header?: string, timer: NodeJS.Timeout | null }>} */
const queues = new Map();

function ensureFileHeader(fp, header) {
  if (!header || fs.existsSync(fp)) return;
  fs.writeFileSync(fp, `${header}\n`, 'utf8');
}

function flushFile(fp) {
  const q = queues.get(fp);
  if (!q) return;
  if (q.timer) {
    clearTimeout(q.timer);
    q.timer = null;
  }
  if (!q.lines.length) return;

  const lines = q.lines.splice(0);
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  ensureFileHeader(fp, q.header);
  fs.appendFileSync(fp, `${lines.join('\n')}\n`, 'utf8');
}

function scheduleFlush(fp) {
  const q = queues.get(fp);
  if (!q || q.timer) return;
  q.timer = setTimeout(() => flushFile(fp), FLUSH_MS);
}

function enqueueCsvLine(dir, filename, header, line) {
  if (!dir || !filename || line == null) return;
  const fp = path.join(dir, filename);
  let q = queues.get(fp);
  if (!q) {
    q = { lines: [], header: header || undefined, timer: null };
    queues.set(fp, q);
  } else if (header && !q.header) {
    q.header = header;
  }
  q.lines.push(line);
  scheduleFlush(fp);
}

function flushAll() {
  for (const fp of [...queues.keys()]) {
    flushFile(fp);
  }
}

module.exports = {
  FLUSH_MS,
  enqueueCsvLine,
  flushAll,
  flushFile
};
