/** Stake bet ID extraction (chat / RH / lookup) — aligned with ModHub EXE + ChatCheck extension */

const UUID_RE = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;

function digitCount(s) {
  return String(s || '').replace(/\D/g, '').length;
}

function isPlausibleBetId(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  if (UUID_RE.test(s)) return true;
  if (/^casino:\d{12}$/i.test(s)) return true;
  if (/^house:\d{12}$/i.test(s)) return true;
  const n = digitCount(s);
  return n >= 12 && n <= 20;
}

function normalizeBetIdForLookup(raw) {
  const clean = String(raw || '').trim().replace(/\s+/g, '');
  if (!clean) return '';
  if (/^casino:/i.test(clean)) {
    const rest = clean.replace(/^casino:/i, '').replace(/\./g, '');
    if (UUID_RE.test(rest)) return `casino:${rest}`;
    if (/^\d+$/.test(rest)) return `house:${rest}`;
    return clean;
  }
  if (/^house:/i.test(clean)) {
    const rest = clean.replace(/^house:/i, '').replace(/\./g, '');
    if (/^\d+$/.test(rest)) return `house:${rest}`;
    return clean;
  }
  if (UUID_RE.test(clean)) return `casino:${clean}`;
  const digits = clean.replace(/\./g, '');
  if (/^\d+$/.test(digits) && digits.length >= 12) return `house:${digits}`;
  return clean;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractBetIds(text) {
  const t = String(text || '');
  if (!t) return [];
  const found = new Set();

  const add = (raw) => {
    const id = String(raw || '').trim();
    if (id && isPlausibleBetId(id)) found.add(id);
  };

  let m;
  const casinoFull = /casino:\d{12}/gi;
  while ((m = casinoFull.exec(t))) add(m[0]);

  const houseFull = /house:\d{12}/gi;
  while ((m = houseFull.exec(t))) add(m[0]);

  const hashPat = /#([\d.]+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/gi;
  while ((m = hashPat.exec(t))) add(m[1]);

  const prefixPat =
    /(?:casino:|house:|bet[\s_-]*id[:\s]*)\s*([0-9][0-9.]*|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/gi;
  while ((m = prefixPat.exec(t))) add(m[1]);

  const dottedPat = /\b(\d{1,4}(?:\.\d{3}){2,}(?:\.\d{1,4})?)\b/g;
  while ((m = dottedPat.exec(t))) add(m[1]);

  const barePat = /(?:^|[^\d])(\d{12})(?:[^\d]|$)/g;
  while ((m = barePat.exec(t))) add(m[1]);

  const uuidPat = new RegExp(UUID_RE.source, 'gi');
  while ((m = uuidPat.exec(t))) add(m[0]);

  return [...found];
}

function extractPrimaryBetId(text) {
  const ids = extractBetIds(text);
  if (!ids.length) return '';
  const ranked = ids.sort((a, b) => {
    const score = (id) => {
      if (/^casino:\d{12}$/i.test(id)) return 5;
      if (/^house:\d{12}$/i.test(id)) return 5;
      if (id.includes('.')) return 4;
      if (UUID_RE.test(id)) return 3;
      return 2;
    };
    return score(b) - score(a);
  });
  return ranked[0];
}

module.exports = {
  extractBetIds,
  extractPrimaryBetId,
  normalizeBetIdForLookup,
  isPlausibleBetId
};
