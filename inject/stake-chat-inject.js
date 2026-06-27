(function () {
  if (window.__MODHUB_WS_HOOKED__) return;
  window.__MODHUB_WS_HOOKED__ = true;

  const seen = new Set();
  const wsTracked = new WeakSet();
  let debugTimer = null;
  const debug = { framesSeen: 0, matched: 0, parseErrors: 0, lastEventTs: Date.now() };

  function emitDebug() {
    if (window.__MODHUB_BRIDGE && typeof window.__MODHUB_BRIDGE.pushDebug === 'function') {
      window.__MODHUB_BRIDGE.pushDebug({ ...debug });
    }
  }

  function touchDebug() {
    debug.lastEventTs = Date.now();
    if (!debugTimer) debugTimer = setInterval(emitDebug, 1000);
  }

  function stripAt(name) {
    const n = String(name || '').trim();
    if (!n || n === 'Trivia' || n === 'Race') return n;
    return n.replace(/^@+/, '') || n;
  }

  function push(payload) {
    if (!payload || !payload.username) return;
    payload.username = stripAt(payload.username);
    const key = `${payload.kind}|${payload.username}|${payload.message}|${payload.timestamp || 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 8000) {
      const first = seen.values().next();
      if (!first.done) seen.delete(first.value);
    }
    if (window.__MODHUB_BRIDGE && typeof window.__MODHUB_BRIDGE.pushMessage === 'function') {
      window.__MODHUB_BRIDGE.pushMessage(payload);
    }
    debug.matched += 1;
    touchDebug();
  }

  function formatRain(cm) {
    const rain = cm?.data?.rain;
    if (!rain) return { summary: '', rain: null };
    const giver = cm?.user?.name || rain?.user?.name || '?';
    const amount = rain.amount != null ? rain.amount : '';
    const cur = rain.currency || '';
    const names = Array.isArray(rain.rainUsers)
      ? rain.rainUsers.map((ru) => ru?.user?.name).filter(Boolean)
      : [];
    const total = amount !== '' && amount != null ? Number(amount) : null;
    const perUser = total != null && names.length ? total / names.length : null;
    const perLabel = perUser != null ? `${perUser} ${cur}`.trim() : '?';
    const recipientList = names.map((username) => ({
      username,
      amount: perUser,
      currency: cur,
      amountLabel: perLabel
    }));
    const recipients = names.join(', ');
    const summary = `${giver} (${amount} ${cur}) — ${names.length} Empfänger · je @user ${perLabel}`;
    return {
      summary,
      rain: { giver, amount, currency: cur, recipientCount: names.length, recipients, recipientList }
    };
  }

  function formatTip(cm) {
    const tip = cm?.data?.tip;
    if (!tip) return '';
    const from = tip.sendBy?.name || tip.sender?.name || '?';
    const to = tip.user?.name || tip.receiver?.name || '?';
    return `has sent ${tip.amount || ''} ${tip.currency || ''} to user ${to}`.replace(/\s+/g, ' ').trim();
  }

  function formatTrivia(cm) {
    const t = cm?.data;
    if (!t) return '';
    const winner = t.winner?.name ? ` Winner: @${t.winner.name}` : '';
    return `[TRIVIA] ${t.status || ''} ${t.question || ''} (${t.amount || ''} ${t.currency || ''})${winner}`.trim();
  }

  function formatRace(cm) {
    const race = cm?.data?.race;
    if (!race) return '';
    return `[RACE] ${race.name || 'Race'} (${race.status || ''})`;
  }

  function pickFlags(cm) {
    return (cm?.user?.flags || []).map((f) => f?.flag).filter(Boolean);
  }

  function pickRoles(cm) {
    return (cm?.user?.roles || []).map((r) => r?.name).filter(Boolean);
  }

  function tryExtractGraphqlMessage(obj) {
    if (!obj || typeof obj !== 'object') return;
    const cm = obj?.payload?.data?.chatMessages || obj?.data?.chatMessages || obj?.payload?.chatMessages;
    if (!cm) return;

    const username = stripAt(cm?.user?.name || '');
    const ts = cm?.createdAt ? Date.parse(cm.createdAt) : Date.now();
    const typename = cm?.data?.__typename || '';

    const flags = pickFlags(cm);
    const roles = pickRoles(cm);

    if (typename.includes('Rain') || cm?.data?.rain) {
      const rainFmt = formatRain(cm);
      push({
        username: rainFmt.rain?.giver || username,
        message: rainFmt.summary,
        kind: 'rain',
        timestamp: ts,
        rain: rainFmt.rain,
        flags,
        roles
      });
      return;
    }
    if (typename.includes('Tip') || cm?.data?.tip) {
      const tipUser = stripAt(cm?.data?.tip?.sendBy?.name || cm?.data?.tip?.sender?.name || username);
      push({ username: tipUser, message: formatTip(cm), kind: 'tip', timestamp: ts, flags, roles });
      return;
    }
    if (
      typename.includes('Trivia') ||
      (cm?.data?.question != null && !cm?.data?.tip && !cm?.data?.rain && !cm?.data?.race)
    ) {
      push({ username: username || 'Trivia', message: formatTrivia(cm), kind: 'trivia', timestamp: ts, flags, roles });
      return;
    }
    if (typename.includes('Race') || cm?.data?.race) {
      push({ username: username || 'Race', message: formatRace(cm), kind: 'race', timestamp: ts, flags, roles });
      return;
    }

    const botMsg = cm?.data?.bot?.message;
    const text = cm?.data?.message || botMsg || '';
    if (username && text) {
      push({
        username,
        message: String(text),
        kind: botMsg ? 'bot' : 'text',
        timestamp: ts,
        flags,
        roles
      });
    }
  }

  function parseWsPayload(raw) {
    try {
      debug.framesSeen += 1;
      if (typeof raw === 'string') {
        tryExtractGraphqlMessage(JSON.parse(raw));
      } else if (raw && typeof raw.text === 'function') {
        raw.text().then((txt) => {
          try {
            tryExtractGraphqlMessage(JSON.parse(txt));
          } catch (_) {
            debug.parseErrors += 1;
          }
        });
      }
    } catch (_) {
      debug.parseErrors += 1;
    }
  }

  const OrigWS = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const ws = new OrigWS(url, protocols);
    const u = String(url || '');
    if (u.includes('/_api/websockets') || u.includes('graphql-transport')) {
      if (!wsTracked.has(ws)) {
        wsTracked.add(ws);
        ws.addEventListener('message', (ev) => parseWsPayload(ev.data));
      }
    }
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;
  window.WebSocket.CONNECTING = OrigWS.CONNECTING;
  window.WebSocket.OPEN = OrigWS.OPEN;
  window.WebSocket.CLOSING = OrigWS.CLOSING;
  window.WebSocket.CLOSED = OrigWS.CLOSED;
})();
