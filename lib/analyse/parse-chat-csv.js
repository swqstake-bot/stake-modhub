const fs = require('fs');

const ROW_START_RE =
  /^(\d{1,2}\.\d{1,2}\.\d{4}),?\s*(\d{1,2}:\d{1,2}:\d{1,2});([^;]+);(.*)$/;
const HEADER_RE = /^Date\s*;\s*User\s*;\s*Message\s*$/i;

function stripBom(s) {
  return String(s == null ? '' : s).replace(/^\uFEFF/, '');
}

function parseGermanChatDateTime(datePart, timePart) {
  const dm = String(datePart || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const tm = String(timePart || '').trim().match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (!dm || !tm) return NaN;
  return new Date(
    parseInt(dm[3], 10),
    parseInt(dm[2], 10) - 1,
    parseInt(dm[1], 10),
    parseInt(tm[1], 10),
    parseInt(tm[2], 10),
    parseInt(tm[3], 10)
  ).getTime();
}

/** @returns {{ messages: Array<{username:string,message:string,timestamp:number|null}> }} */
function parseStakeChatCsv(text) {
  const lines = stripBom(text).split(/\r?\n/);
  const messages = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && HEADER_RE.test(line.trim())) continue;

    const match = line.match(ROW_START_RE);
    if (match) {
      if (current) messages.push(current);
      const ts = parseGermanChatDateTime(match[1], match[2]);
      current = {
        username: (match[3] || '').trim(),
        message: match[4] != null ? String(match[4]) : '',
        timestamp: Number.isFinite(ts) ? ts : null
      };
    } else if (current) {
      current.message += (current.message ? '\n' : '') + line;
    }
  }
  if (current) messages.push(current);
  return { messages };
}

function parseStakeChatCsvFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return parseStakeChatCsv(text);
}

module.exports = {
  parseStakeChatCsv,
  parseStakeChatCsvFile,
  parseGermanChatDateTime
};
