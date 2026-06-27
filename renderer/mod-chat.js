/**
 * Collapsible Mod-team chat (WebSocket relay, not Stake public chat).
 */
(function (global) {
  const ALLOWED = (global.MODHUB_CONST?.MOD_CHAT_ALLOWED || [
    'swaqline',
    'droz',
    'wheelyboy321',
    'kartenstapel'
  ]).map((n) => String(n).toLowerCase());

  const ERROR_LABELS = {
    bad_token: 'Falsches Mod-Chat-Token (Settings).',
    not_allowed: 'Name nicht auf der Mod-Whitelist (Server config.js prüfen).',
    auth_required: 'Auth fehlgeschlagen.',
    auth_timeout: 'Auth-Timeout — Relay antwortet nicht.',
    invalid_json: 'Ungültige Server-Antwort.',
    message_too_long: 'Nachricht zu lang (max. 500).'
  };

  /** @type {object | null} */
  let ctx = null;
  /** @type {WebSocket | null} */
  let ws = null;
  /** @type {{ id: string, user: string, text: string, ts: number }[]} */
  let lines = [];
  let expanded = false;
  let unread = 0;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let pingTimer = null;
  let authTimer = null;
  let haltReconnect = false;
  let lastError = '';
  let status = 'off'; // off | connecting | online | error

  function normalizeName(name) {
    return String(name || '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
  }

  function isAllowedMod(name) {
    return ALLOWED.includes(normalizeName(name));
  }

  function $(id) {
    return ctx?.$ ? ctx.$(id) : document.getElementById(id);
  }

  function esc(s) {
    return ctx?.esc
      ? ctx.esc(s)
      : String(s ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
  }

  function formatTime(ts) {
    if (ctx?.formatChatTime) return ctx.formatChatTime(ts);
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function getToken() {
    return String(ctx?.state?.settings?.modChatToken || '').trim();
  }

  function getUrl() {
    const fromSettings = String(ctx?.state?.settings?.modChatUrl || '').trim();
    return fromSettings || global.MODHUB_CONST?.MOD_CHAT_DEFAULT_URL || 'ws://192.168.178.177:3847';
  }

  function setStatusText(text) {
    lastError = text || '';
    const el = $('modChatStatus');
    if (el) el.textContent = text || '';
  }

  function setStatus(next) {
    status = next;
    const dot = $('modChatDot');
    const panel = $('modChatPanel');
    if (dot) {
      dot.className = 'mod-chat-dot';
      if (next === 'online') dot.classList.add('is-online');
      else if (next === 'connecting') dot.classList.add('is-connecting');
      else if (next === 'error') dot.classList.add('is-error');
    }
    if (panel) panel.dataset.status = next;

    if (next === 'online') {
      setStatusText('Verbunden');
    } else if (next === 'connecting') {
      setStatusText(`Verbinde… ${getUrl()}`);
    } else if (next === 'off') {
      setStatusText('');
    }
  }

  function failFatal(message) {
    haltReconnect = true;
    clearTimers();
    setStatus('error');
    setStatusText(message);
    try {
      ws?.close();
    } catch (_) {
      /* ignore */
    }
    ws = null;
  }

  function networkHint() {
    return 'Server nicht erreichbar. 192.168.x nur im gleichen WLAN/VPN (z. B. Tailscale). Relay läuft? Firewall Port 3847?';
  }

  function updateUnreadUi() {
    const badge = $('modChatUnread');
    if (!badge) return;
    if (unread > 0 && !expanded) {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function renderLog() {
    const el = $('modChatLog');
    if (!el) return;
    const self = normalizeName(ctx?.state?.modUser);
    if (!lines.length) {
      el.innerHTML = `<p class="mod-chat-empty">${esc(status === 'online' ? 'Noch keine Nachrichten.' : lastError || 'Warte auf Verbindung…')}</p>`;
      return;
    }
    const html = lines
      .map((m) => {
        const isSelf = normalizeName(m.user) === self;
        const userHtml = global.ChatColors?.formatUserHtml
          ? global.ChatColors.formatUserHtml(m.user, { isSelf, esc, colorEnabled: true })
          : `<span class="user">${esc(m.user)}</span>`;
        return `<div class="mod-chat-line${isSelf ? ' is-self' : ''}"><span class="mod-chat-time">${esc(formatTime(m.ts))}</span>${userHtml}: ${esc(m.text)}</div>`;
      })
      .join('');
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }

  function setPanelVisible(show) {
    const panel = $('modChatPanel');
    if (!panel) return;
    panel.classList.toggle('hidden', !show);
  }

  function scheduleReconnect() {
    if (haltReconnect) return;
    if (reconnectTimer) return;
    if (!ctx?.state?.loggedIn || !isAllowedMod(ctx.state.modUser)) return;
    if (ctx.state.settings?.modChatEnabled === false) return;
    const delay = Math.min(30000, 1500 * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    if (reconnectAttempt >= 2) {
      setStatus('error');
      setStatusText(networkHint());
      renderLog();
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function clearTimers() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (authTimer) {
      clearTimeout(authTimer);
      authTimer = null;
    }
  }

  function disconnect() {
    clearTimers();
    if (ws) {
      try {
        ws.close();
      } catch (_) {
        /* ignore */
      }
      ws = null;
    }
    if (!haltReconnect) setStatus('off');
  }

  function connect() {
    if (!ctx?.state?.loggedIn || !isAllowedMod(ctx.state.modUser)) return;
    if (ctx.state.settings?.modChatEnabled === false) return;
    if (haltReconnect) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    clearTimers();
    if (ws) {
      try {
        ws.close();
      } catch (_) {
        /* ignore */
      }
      ws = null;
    }

    setStatus('connecting');
    renderLog();

    const url = getUrl();
    let socket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      setStatus('error');
      setStatusText(networkHint());
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.addEventListener('open', () => {
      reconnectAttempt = 0;
      socket.send(JSON.stringify({ type: 'auth', name: ctx.state.modUser, token: getToken() || undefined }));
      authTimer = setTimeout(() => {
        if (ws !== socket || socket.readyState !== WebSocket.OPEN) return;
        failFatal('Auth-Timeout — Relay antwortet nicht.');
      }, 12000);
      pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);
    });

    socket.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }

      if (msg.type === 'error') {
        const label = ERROR_LABELS[msg.message] || msg.message || 'Relay-Fehler';
        if (msg.message === 'not_allowed') {
          failFatal(`${label} (Login: ${ctx.state.modUser})`);
        } else if (msg.message === 'bad_token') {
          failFatal(label);
        } else if (msg.message === 'auth_timeout' || msg.message === 'auth_required') {
          failFatal(label);
        } else {
          setStatus('error');
          setStatusText(label);
        }
        return;
      }

      if (msg.type === 'auth_ok') {
        if (authTimer) {
          clearTimeout(authTimer);
          authTimer = null;
        }
        haltReconnect = false;
        setStatus('online');
        if (Array.isArray(msg.history)) {
          lines = msg.history.slice(-200);
        }
        renderLog();
        return;
      }

      if (msg.type === 'msg' && msg.id && msg.user && msg.text) {
        if (lines.some((l) => l.id === msg.id)) return;
        lines.push({ id: msg.id, user: msg.user, text: msg.text, ts: msg.ts || Date.now() });
        if (lines.length > 200) lines = lines.slice(-200);
        renderLog();
        const fromSelf = normalizeName(msg.user) === normalizeName(ctx.state.modUser);
        if (!expanded && !fromSelf) {
          unread += 1;
          updateUnreadUi();
        }
      }
    });

    socket.addEventListener('close', (ev) => {
      if (ws === socket) ws = null;
      clearTimers();
      if (haltReconnect) return;
      if (ev.code === 4003) {
        failFatal(ERROR_LABELS.not_allowed + ` (Login: ${ctx.state.modUser})`);
        return;
      }
      if (ctx?.state?.loggedIn && isAllowedMod(ctx.state.modUser)) {
        setStatus('error');
        if (!lastError || lastError === 'Verbunden') setStatusText(networkHint());
        renderLog();
        scheduleReconnect();
      } else {
        setStatus('off');
      }
    });

    socket.addEventListener('error', () => {
      if (haltReconnect) return;
      setStatus('error');
      setStatusText(networkHint());
      renderLog();
    });
  }

  function send(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return false;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setStatusText('Nicht verbunden — Nachricht nicht gesendet.');
      renderLog();
      return false;
    }
    ws.send(JSON.stringify({ type: 'msg', text: trimmed }));
    return true;
  }

  function toggleExpanded() {
    expanded = !expanded;
    const panel = $('modChatPanel');
    const body = $('modChatBody');
    const chev = $('modChatChevron');
    if (panel) panel.classList.toggle('is-expanded', expanded);
    if (body) body.classList.toggle('hidden', !expanded);
    if (chev) chev.textContent = expanded ? '▲' : '▼';
    if (expanded) {
      unread = 0;
      updateUnreadUi();
      renderLog();
      $('modChatInput')?.focus();
    }
  }

  function onLogin(modUser) {
    haltReconnect = false;
    reconnectAttempt = 0;
    if (!isAllowedMod(modUser)) {
      setPanelVisible(false);
      disconnect();
      return;
    }
    setPanelVisible(true);
    lines = [];
    unread = 0;
    updateUnreadUi();
    renderLog();
    connect();
  }

  function onLogout() {
    haltReconnect = true;
    disconnect();
    lines = [];
    unread = 0;
    lastError = '';
    updateUnreadUi();
    renderLog();
    setPanelVisible(false);
    haltReconnect = false;
  }

  function init(context) {
    ctx = context;

    global.MODHUB_CONST = global.MODHUB_CONST || {};
    global.MODHUB_CONST.MOD_CHAT_ALLOWED = ALLOWED;
    global.MODHUB_CONST.MOD_CHAT_DEFAULT_URL =
      global.MODHUB_CONST.MOD_CHAT_DEFAULT_URL || 'ws://192.168.178.177:3847';

    $('modChatToggle')?.addEventListener('click', toggleExpanded);

    $('modChatReconnect')?.addEventListener('click', (e) => {
      e.stopPropagation();
      haltReconnect = false;
      reconnectAttempt = 0;
      connect();
    });

    $('modChatSend')?.addEventListener('click', () => {
      const input = $('modChatInput');
      if (!input) return;
      if (send(input.value)) input.value = '';
    });

    $('modChatInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const input = $('modChatInput');
        if (input && send(input.value)) input.value = '';
      }
    });

    setPanelVisible(false);
    setStatus('off');
  }

  global.ModChat = {
    init,
    connect,
    disconnect,
    onLogin,
    onLogout,
    isAllowedMod,
    reconnect: () => {
      haltReconnect = false;
      reconnectAttempt = 0;
      connect();
    }
  };
})(window);
