/** Shared live-chat message parsing (main WS + inject). */

const { normalizeUsername } = require('./username');

function chatUsername(name) {
  const n = String(name || '').trim();
  if (!n || n === 'Trivia' || n === 'Race') return n;
  return normalizeUsername(n) || n;
}

function toUsd(amount, currency, convRates) {
  if (amount == null || !currency || !convRates) return null;
  const rate = convRates[String(currency).toLowerCase()]?.usd;
  if (!rate) return null;
  return Math.round(Number(amount) * rate * 100) / 100;
}

function formatRainAmountLabel(amount, currency, convRates) {
  if (amount == null || Number.isNaN(Number(amount))) return '?';
  const usd = toUsd(amount, currency, convRates);
  if (usd != null) return `${usd.toFixed(2)} USD`;
  const n = Number(amount);
  const cur = String(currency || '').toUpperCase();
  return cur ? `${n} ${cur}` : String(n);
}

function buildRainRecipientList(rain, convRates) {
  const amount = rain.amount != null ? Number(rain.amount) : null;
  const cur = rain.currency || '';
  const names = Array.isArray(rain.rainUsers)
    ? rain.rainUsers.map((ru) => chatUsername(ru?.user?.name)).filter(Boolean)
    : [];
  if (!names.length) return [];
  const perUser = amount != null ? amount / names.length : null;
  return names.map((username) => ({
    username,
    amount: perUser,
    currency: cur,
    amountLabel: formatRainAmountLabel(perUser, cur, convRates)
  }));
}

function formatRain(cm, convRates) {
  const rain = cm?.data?.rain;
  if (!rain) return { summary: '', rain: null };
  const giver = cm?.user?.name || rain?.giver?.name || rain?.user?.name || '?';
  const amount = rain.amount != null ? rain.amount : '';
  const cur = rain.currency || '';
  const recipientList = buildRainRecipientList(rain, convRates);
  const names = recipientList.map((r) => r.username);
  const recipients = names.join(', ');
  const amtLabel = formatRainAmountLabel(amount, cur, convRates);
  const perHint =
    recipientList.length > 0 ? ` · je @user ${recipientList[0].amountLabel}` : '';
  const summary = `${giver} (${amtLabel}) — ${names.length} Empfänger${perHint}`;
  return {
    summary,
    rain: {
      giver,
      amount,
      currency: cur,
      recipientCount: names.length,
      recipients,
      recipientList
    }
  };
}

function formatTip(cm, convRates) {
  const tip = cm?.data?.tip;
  if (!tip) return '';
  const from = tip.sendBy?.name || tip.sender?.name || '?';
  const to = tip.user?.name || tip.receiver?.name || '?';
  const usd = toUsd(tip.amount, tip.currency, convRates);
  const amt = usd != null ? `${usd} USD` : `${tip.amount || ''} ${tip.currency || ''}`.trim();
  return `has sent ${amt} to user ${to}`;
}

function formatTrivia(cm, convRates) {
  const t = cm?.data;
  if (!t) return '';
  const status = t.status || '';
  const q = t.question || '';
  const ans = t.answer ? `Answer: ${t.answer}` : '';
  const usd = toUsd(t.amount, t.currency, convRates);
  const prize = usd != null ? `${usd} USD` : `${t.amount || ''} ${t.currency || ''}`.trim();
  const winner = t.winner?.name ? ` Winner: @${t.winner.name}` : '';
  return `[TRIVIA] ${status} ${q} (${prize})${ans ? ` — ${ans}` : ''}${winner}`.trim();
}

function formatRace(cm) {
  const race = cm?.data?.race;
  if (!race) return '';
  const name = race.name || 'Race';
  const status = race.status || '';
  const n = race.leaderboard?.length ?? 0;
  return `[RACE] ${name} (${status})${n ? ` — Top ${n}` : ''}`;
}

/**
 * @param {object} cm - GraphQL ChatMessage
 * @param {object} convRates - currency → { usd }
 * @returns {{ username, message, kind, timestamp, rain? }|null}
 */
function parseChatMessage(cm, convRates = {}) {
  if (!cm) return null;
  const username = chatUsername(cm?.user?.name || '');
  const ts = cm.createdAt ? Date.parse(cm.createdAt) : Date.now();
  const typename = cm?.data?.__typename || '';

  if (typename.includes('Rain') || cm?.data?.rain) {
    const rainFmt = formatRain(cm, convRates);
    return {
      username: rainFmt.rain?.giver || username,
      message: rainFmt.summary,
      kind: 'rain',
      timestamp: ts,
      rain: rainFmt.rain
    };
  }
  if (typename.includes('Tip') || cm?.data?.tip) {
    const tipUser = chatUsername(cm?.data?.tip?.sendBy?.name || cm?.data?.tip?.sender?.name || username);
    return {
      username: tipUser,
      message: formatTip(cm, convRates),
      kind: 'tip',
      timestamp: ts
    };
  }
  if (
    typename.includes('Trivia') ||
    (cm?.data?.question != null && !cm?.data?.tip && !cm?.data?.rain && !cm?.data?.race)
  ) {
    return {
      username: username || 'Trivia',
      message: formatTrivia(cm, convRates),
      kind: 'trivia',
      timestamp: ts
    };
  }
  if (typename.includes('Race') || cm?.data?.race) {
    return {
      username: username || 'Race',
      message: formatRace(cm),
      kind: 'race',
      timestamp: ts
    };
  }

  const botMsg = cm?.data?.bot?.message;
  const text = cm?.data?.message || botMsg || '';
  if (!username || !text) return null;
  return {
    username,
    message: String(text),
    kind: botMsg ? 'bot' : 'text',
    timestamp: ts
  };
}

function extractMessagesFromPayload(obj, convRates) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.user && node.data && (node.data.__typename || node.data.message != null || node.data.rain || node.data.tip)) {
      const parsed = parseChatMessage(node, convRates);
      if (parsed) out.push(parsed);
      return;
    }
    if (node.chatMessages && typeof node.chatMessages === 'object') {
      const parsed = parseChatMessage(node.chatMessages, convRates);
      if (parsed) out.push(parsed);
    }
    for (const key of Object.keys(node)) {
      if (key === 'user' && node.data) continue;
      walk(node[key]);
    }
  };

  walk(obj);
  return out;
}

function parseWsFrame(raw, convRates) {
  const messages = [];
  const tryParse = (text) => {
    try {
      const obj = JSON.parse(text);
      messages.push(...extractMessagesFromPayload(obj, convRates));
      if (obj?.payload?.data) messages.push(...extractMessagesFromPayload(obj.payload.data, convRates));
      if (obj?.payload) messages.push(...extractMessagesFromPayload(obj.payload, convRates));
    } catch (_) {
      /* ignore */
    }
  };

  if (typeof raw === 'string') {
    tryParse(raw);
    const idx = raw.indexOf('{"');
    if (idx > 0) tryParse(raw.slice(idx));
  } else if (Buffer.isBuffer(raw)) {
    tryParse(raw.toString('utf8'));
  }

  const seen = new Set();
  return messages.filter((m) => {
    const key = `${m.kind}|${m.username}|${m.message}|${m.timestamp}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  parseChatMessage,
  extractMessagesFromPayload,
  parseWsFrame,
  toUsd
};
