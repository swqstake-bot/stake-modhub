function normalizeText(msg) {
  return String(msg == null ? '' : msg)
    .replace(/\s+/g, ' ')
    .trim();
}

function foldGermanUmlauts(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

const COMMUNITY_SHORT = new Set([
  'gz',
  'gg',
  'gl',
  'gf',
  'gn',
  'moin',
  'mooin',
  'servus',
  'servuas',
  'ehre',
  'danke',
  'thx',
  'ty',
  'nice',
  'korrekt',
  'prost',
  'mahlzeit',
  'hi',
  'hey',
  'yo',
  'lol',
  'haha',
  'xd',
  'rip',
  'f',
  'w',
  'l',
  'k',
  'joa',
  'jo',
  'ja',
  'ne',
  'nö',
  'ok',
  'okay',
  'top',
  'stabil',
  'same',
  'true',
  'same',
  'gzly',
  'gzzz',
  'gzgz'
]);

function stripForDedupeKey(text) {
  let t = normalizeText(text).toLowerCase();
  t = t.replace(/@[\w\u00C0-\u024f]{2,}/g, ' ');
  t = t.replace(/casino:\d+/gi, ' ');
  t = t.replace(/https?:\/\/\S+/gi, ' ');
  t = t.replace(/:[\w]+:/g, ' ');
  t = t.replace(/[^\w\säöüß]/gi, ' ');
  t = foldGermanUmlauts(t);
  return t.replace(/\s+/g, ' ').trim();
}

function isCommunityShort(text) {
  const key = stripForDedupeKey(text);
  if (!key) return true;
  if (COMMUNITY_SHORT.has(key)) return true;
  if (/^g+z+$/i.test(key.replace(/\s/g, ''))) return true;
  return key.length <= 3;
}

function collectDuplicateStats(messages) {
  const byKey = new Map();
  for (const m of messages) {
    const key = stripForDedupeKey(m.message);
    if (!key || isCommunityShort(m.message)) continue;
    byKey.set(key, (byKey.get(key) || 0) + 1);
  }
  let duplicateLines = 0;
  let maxSame = 1;
  let topRepeat = '';
  for (const [k, n] of byKey) {
    if (n > 1) duplicateLines += n - 1;
    if (n > maxSame) {
      maxSame = n;
      topRepeat = k;
    }
  }
  const substantive = messages.filter((m) => !isCommunityShort(m.message)).length || messages.length;
  return {
    uniqueTexts: byKey.size,
    duplicateLines,
    maxSameMessageCount: maxSame,
    duplicateRatio: substantive ? duplicateLines / substantive : 0,
    topRepeatText: topRepeat
  };
}

module.exports = {
  normalizeText,
  foldGermanUmlauts,
  stripForDedupeKey,
  isCommunityShort,
  collectDuplicateStats,
  COMMUNITY_SHORT
};
