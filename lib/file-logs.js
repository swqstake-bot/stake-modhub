const fs = require('fs');
const path = require('path');

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
  if (!ensureDir(dir)) return;
  const fp = path.join(dir, filename);
  if (!fs.existsSync(fp) && header) {
    fs.writeFileSync(fp, header + '\n', 'utf8');
  }
  fs.appendFileSync(fp, line + '\n', 'utf8');
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

function loadBetsLog(dir, limit = 500) {
  if (!dir) return [];
  const fp = path.join(dir, betsLogFilename());
  if (!fs.existsSync(fp)) return [];
  const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length <= 1) return [];
  const rows = lines.slice(1).slice(-limit);
  const { registryKey } = require('./bet-registry');
  const byKey = new Map();
  for (const line of rows) {
    const cols = line.split(';');
    if (cols.length < 4) continue;
    const betId = cols[1] || '';
    if (!betId) continue;
    const key = registryKey(betId);
    const rec = {
      key,
      betId,
      username: cols[2] || '',
      lastUsername: cols[2] || '',
      game: cols[3] || '',
      multiplier: Number(cols[4]) || 0,
      amount: cols[5] !== '' ? Number(cols[5]) : null,
      currency: cols[6] || '',
      payout: cols[7] !== '' ? Number(cols[7]) : null,
      lookupOk: (cols[8] || '').toLowerCase() === 'ok',
      message: cols[9] || '',
      firstSeenAt: Date.parse(cols[0]) || Date.now(),
      lastSeenAt: Date.parse(cols[0]) || Date.now(),
      seenCount: 1,
      lookupError: (cols[8] || '').toLowerCase() === 'ok' ? '' : cols[8] || 'fail'
    };
    byKey.set(key, rec);
  }
  return [...byKey.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
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
  betsLogFilename,
  chatLogFilename,
  rainLogFilename
};
