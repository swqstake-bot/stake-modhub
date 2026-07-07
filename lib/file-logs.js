const fs = require('fs');
const path = require('path');
const { enqueueCsvLine, flushAll } = require('./csv-write-queue');

const BETS_FILE_RE = /Bets_de\.csv$/i;

function ensureDir(dir) {
  if (!dir) return false;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return true;
}

function daySuffix() {
  return new Date().toLocaleDateString('de-DE').replace(/\./g, '');
}

function escCsvCell(value) {
  return String(value ?? '')
    .replace(/;/g, ',')
    .replace(/\r?\n/g, ' ');
}

function appendCsvLine(dir, filename, header, line) {
  enqueueCsvLine(dir, filename, header, line);
}

function chatLogFilename() {
  return `${daySuffix()}Chat_de.csv`;
}

function rainLogFilename() {
  return `${daySuffix()}Rain_de.csv`;
}

/** Wie StakeModHub.exe: nur Text/Bot/Tip im Chat-Log (Rain separat). */
function appendChatLog(dir, user, message) {
  const ts = new Date().toLocaleString('de-DE');
  appendCsvLine(dir, chatLogFilename(), 'Date;User;Message', `${ts};${escCsvCell(user)};${escCsvCell(message)}`);
}

function appendRainLog(dir, payload) {
  const ts = new Date().toLocaleString('de-DE');
  const giver = payload.giver || payload.username || '';
  const amount = payload.amount != null ? String(payload.amount) : '';
  const currency = payload.currency || '';
  const recipients = payload.recipients || '';
  const count = payload.recipientCount != null ? String(payload.recipientCount) : '';
  const summary = payload.summary || payload.message || '';
  appendCsvLine(
    dir,
    rainLogFilename(),
    'Date;Giver;Amount;Currency;RecipientCount;Recipients;Summary',
    `${ts};${escCsvCell(giver)};${amount};${escCsvCell(currency)};${count};${escCsvCell(recipients)};${escCsvCell(summary)}`
  );
}

function appendHashIp(dir, user, hashedIp) {
  const ts = new Date().toLocaleString('de-DE');
  appendCsvLine(dir, 'HashIP_All.csv', 'Timestamp;User;HashedIP', `${ts};${user};${hashedIp}`);
}

function appendMuted(dir, user, muteMessage, period) {
  const ts = new Date().toLocaleString('de-DE');
  appendCsvLine(dir, 'Muted_Users.csv', 'Timestamp;User;MuteMessage;Period', `${ts};${user};${muteMessage};${period}`);
}

function appendWarned(dir, user, message) {
  const ts = new Date().toLocaleString('de-DE');
  appendCsvLine(dir, 'Warned_Users.csv', 'Timestamp;User;Message', `${ts};${user};${message.replace(/;/g, ',')}`);
}

function appendSessionTxt(dir, line) {
  if (!ensureDir(dir)) return;
  const fp = path.join(dir, 'rh_session_log.txt');
  fs.appendFileSync(fp, line + '\n', 'utf8');
}

function betsLogFilename() {
  return `${daySuffix()}Bets_de.csv`;
}

function appendBetLog(dir, record) {
  if (!record) return;
  const ts = new Date(record.lastSeenAt || record.firstSeenAt || Date.now()).toLocaleString('de-DE');
  const ok = record.lookupOk ? 'ok' : 'fail';
  appendCsvLine(
    dir,
    betsLogFilename(),
    'Timestamp;BetId;User;Game;Multiplier;Amount;Currency;Payout;Status;ChatMessage',
    `${ts};${escCsvCell(record.betId)};${escCsvCell(record.username)};${escCsvCell(record.game)};${record.multiplier || 0};${record.amount != null ? record.amount : ''};${escCsvCell(record.currency)};${record.payout != null ? record.payout : ''};${ok};${escCsvCell(record.message)}`
  );
}

function parseBetsCsvLines(lines, byKey) {
  const { registryKey } = require('./bet-registry');
  for (const line of lines) {
    const cols = line.split(';');
    if (cols.length < 4) continue;
    const betId = cols[1] || '';
    if (!betId) continue;
    const key = registryKey(betId);
    const ts = Date.parse(cols[0]) || Date.now();
    const chatUser = cols[2] || '';
    const existing = byKey.get(key);
    if (existing) {
      existing.lastSeenAt = Math.max(existing.lastSeenAt, ts);
      if (chatUser) {
        existing.lastUsername = chatUser;
        if (!existing.username) existing.username = chatUser;
      }
      existing.seenCount = (existing.seenCount || 1) + 1;
      if (cols[9]) existing.message = cols[9];
      continue;
    }
    byKey.set(key, {
      key,
      betId,
      username: chatUser,
      lastUsername: chatUser,
      game: cols[3] || '',
      multiplier: Number(cols[4]) || 0,
      amount: cols[5] !== '' ? Number(cols[5]) : null,
      currency: cols[6] || '',
      payout: cols[7] !== '' ? Number(cols[7]) : null,
      lookupOk: (cols[8] || '').toLowerCase() === 'ok',
      message: cols[9] || '',
      firstSeenAt: ts,
      lastSeenAt: ts,
      seenCount: 1,
      lookupError: (cols[8] || '').toLowerCase() === 'ok' ? '' : cols[8] || 'fail'
    });
  }
}

function listBetsLogFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => BETS_FILE_RE.test(f))
    .sort();
}

function loadBetsLog(dir, limit = Infinity) {
  if (!dir) return [];
  const files = listBetsLogFiles(dir);
  if (!files.length) return [];

  const byKey = new Map();
  for (const filename of files) {
    const fp = path.join(dir, filename);
    if (!fs.existsSync(fp)) continue;
    const raw = fs.readFileSync(fp, 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length <= 1) continue;
    parseBetsCsvLines(lines.slice(1), byKey);
  }

  const all = [...byKey.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  return Number.isFinite(limit) ? all.slice(0, limit) : all;
}

function logLiveMessage(dir, m) {
  if (!m || !m.username) return;
  const kind = m.kind || 'text';
  if (kind === 'rain') {
    appendRainLog(dir, m.rain || { username: m.username, message: m.message });
    return;
  }
  let line = m.message || '';
  if (kind === 'tip') line = line.startsWith('[TIP]') ? line : `[TIP] ${line}`;
  if (kind === 'bot') line = `[BOT] ${line}`;
  appendChatLog(dir, m.username, line);
}

module.exports = {
  appendChatLog,
  appendRainLog,
  appendHashIp,
  appendMuted,
  appendWarned,
  appendSessionTxt,
  logLiveMessage,
  appendBetLog,
  loadBetsLog,
  listBetsLogFiles,
  betsLogFilename,
  chatLogFilename,
  rainLogFilename,
  flushAll
};
