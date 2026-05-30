const { normalizeBetIdForLookup } = require('./bet-id-parse');

function registryKey(betId) {
  return normalizeBetIdForLookup(betId).toLowerCase();
}

function createBetRegistry({ lookupBet, appendLog, maxEntries = 800 }) {
  const map = new Map();
  const inFlight = new Set();

  function broadcast(send, record) {
    if (typeof send === 'function') send(record);
  }

  async function track({ betId, username, message, timestamp }, send) {
    const raw = String(betId || '').trim();
    if (!raw) return { ok: false, error: 'empty_bet_id' };
    const key = registryKey(raw);
    if (!key) return { ok: false, error: 'invalid_bet_id' };

    if (map.has(key)) {
      const existing = map.get(key);
      existing.lastSeenAt = timestamp || Date.now();
      if (username) {
        existing.lastUsername = username;
        if (!existing.username) existing.username = username;
      }
      existing.seenCount = (existing.seenCount || 1) + 1;
      if (message) existing.message = String(message).slice(0, 240);
      broadcast(send, existing);
      return { ok: true, record: existing, duplicate: true };
    }

    if (inFlight.has(key)) return { ok: true, pending: true };

    inFlight.add(key);
    const now = timestamp || Date.now();
    const record = {
      key,
      betId: raw,
      username: username || '',
      lastUsername: username || '',
      message: String(message || '').slice(0, 240),
      firstSeenAt: now,
      lastSeenAt: now,
      seenCount: 1,
      lookupOk: false,
      game: '',
      multiplier: 0,
      amount: null,
      payout: null,
      currency: '',
      betUser: '',
      lookupError: ''
    };

    try {
      const data = await lookupBet(raw);
      record.lookupOk = true;
      record.game = data?.game || '';
      record.multiplier = Number(data?.multiplier) || 0;
      record.amount = data?.amount != null ? data.amount : null;
      record.payout = data?.payout != null ? data.payout : null;
      record.currency = data?.currency || '';
      record.betUser = data?.user || '';
      record.updatedAt = data?.updatedAt || data?.createdAt || null;
    } catch (e) {
      record.lookupError = e.message || 'lookup_failed';
    }

    inFlight.delete(key);
    map.set(key, record);
    if (map.size > maxEntries) {
      const oldest = [...map.values()].sort((a, b) => a.firstSeenAt - b.firstSeenAt)[0];
      if (oldest) map.delete(oldest.key);
    }
    if (appendLog) appendLog(record);
    broadcast(send, record);
    return { ok: true, record };
  }

  async function refresh(betId, send) {
    const raw = String(betId || '').trim();
    const key = registryKey(raw);
    const prev = key ? map.get(key) : null;
    if (key) map.delete(key);
    return track(
      {
        betId: raw,
        username: prev?.username || prev?.lastUsername || '',
        message: prev?.message || ''
      },
      send
    );
  }

  function list() {
    return [...map.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  function hydrate(records) {
    for (const r of records || []) {
      if (!r?.key) continue;
      map.set(r.key, r);
    }
  }

  function clear() {
    map.clear();
    inFlight.clear();
  }

  return { track, refresh, list, hydrate, clear, get: (k) => map.get(k) };
}

module.exports = { createBetRegistry, registryKey };
