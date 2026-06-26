const { stripForDedupeKey, isCommunityShort } = require('./dedupe');
const { isGzOrBustVariant } = require('./low-quality-spam');

const DEFAULT_WINDOW_MS = 90000;
const MIN_KEY_LEN = 18;
const MAX_COMMUNITY_USERS = 4;

/** Häufige Chat-Floskeln — kein Multi-Account-Verdacht. */
const COORD_PHRASE_DENY = new Set([
  'danke dir',
  'danke',
  'gute besserung',
  'schoenen feierabend',
  'schoene nacht',
  'gute nacht',
  'guten morgen',
  'guten abend',
  'viel glueck',
  'viel gluck',
  'glueckwunsch',
  'gluckwunsch',
  'willkommen im chat',
  'herzlich willkommen',
  'auf weitere gewinne',
  'gute fahrt',
  'schoenes wochenende',
  'schoenen tag',
  'guten rutsch',
  'frohes fest'
]);

function isSpamLikeCoordText(key) {
  if (!key) return false;
  const compact = key.replace(/\s/g, '');
  return isGzOrBustVariant(key) || /^g+z+$/i.test(compact) || /^bust+$/i.test(compact);
}

function detectCoordinatedSpam(messages, opts = {}) {
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const minKeyLen = opts.minKeyLen ?? MIN_KEY_LEN;
  const globalUsersByKey = new Map();

  for (const m of messages) {
    if (!m.username || isCommunityShort(m.message)) continue;
    const key = stripForDedupeKey(m.message);
    if (!key || key.length < 8 || COORD_PHRASE_DENY.has(key)) continue;
    const uKey = m.username.toLowerCase();
    if (!globalUsersByKey.has(key)) globalUsersByKey.set(key, new Set());
    globalUsersByKey.get(key).add(uKey);
  }

  const byBucket = new Map();

  for (const m of messages) {
    if (!m.username || isCommunityShort(m.message)) continue;
    const key = stripForDedupeKey(m.message);
    if (!key || COORD_PHRASE_DENY.has(key)) continue;
    const globalUsers = globalUsersByKey.get(key)?.size || 0;
    if (globalUsers > MAX_COMMUNITY_USERS) continue;

    const spamText = isSpamLikeCoordText(key);
    if (!spamText && key.length < minKeyLen) continue;

    const ts = m.timestamp;
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;

    const bucket = Math.floor(ts / windowMs);
    const slotKey = `${bucket}|${key}`;
    if (!byBucket.has(slotKey)) {
      byBucket.set(slotKey, { users: new Map(), text: key.slice(0, 48), ts, spamText });
    }
    const slot = byBucket.get(slotKey);
    const uKey = m.username.toLowerCase();
    if (!slot.users.has(uKey)) slot.users.set(uKey, m.username);
  }

  const perUser = new Map();

  for (const slot of byBucket.values()) {
    const minUsers = 3;
    if (slot.users.size < minUsers) continue;

    const names = [...slot.users.values()];
    for (const [uKey, display] of slot.users) {
      if (!perUser.has(uKey)) {
        perUser.set(uKey, {
          coordinatedHits: 0,
          strongHits: 0,
          partners: new Set(),
          sampleTexts: []
        });
      }
      const st = perUser.get(uKey);
      st.coordinatedHits++;
      if (slot.spamText || slot.users.size >= 3) st.strongHits++;
      for (const p of names) {
        if (p.toLowerCase() !== uKey) st.partners.add(p);
      }
      if (st.sampleTexts.length < 3) st.sampleTexts.push(slot.text);
    }
  }

  const out = new Map();
  for (const [uKey, st] of perUser) {
    out.set(uKey, {
      coordinatedHits: st.coordinatedHits,
      strongHits: st.strongHits,
      partnerCount: st.partners.size,
      partners: [...st.partners].slice(0, 8),
      sampleTexts: st.sampleTexts
    });
  }
  return out;
}

function coordinatedRiskBonus(coord) {
  if (!coord || !coord.strongHits) return 0;
  let bonus = 0;
  if (coord.strongHits >= 3) bonus += 18;
  else if (coord.strongHits >= 2) bonus += 12;
  else bonus += 6;
  if (coord.partnerCount >= 3) bonus += 8;
  return Math.min(25, bonus);
}

function isCoordinatedSpam(coord, profile = {}) {
  if (!coord || coord.strongHits < 2) return false;
  if (coord.partnerCount < 2) return false;
  const spammy =
    (profile.gzBustRatio || 0) >= 0.15 ||
    (profile.lowQualityRatio || 0) >= 0.4 ||
    (profile.oneWordRatio || 0) >= 0.5;
  return spammy && coord.coordinatedHits >= 2;
}

module.exports = {
  detectCoordinatedSpam,
  coordinatedRiskBonus,
  isCoordinatedSpam,
  isSpamLikeCoordText
};
