#!/usr/bin/env node
/**
 * Minimal WebSocket relay for ModHub team chat (LAN / Cloudflare Tunnel).
 * Auth: username must be in MOD_CHAT_ALLOWED.
 */
const http = require('http');
const { WebSocketServer } = require('ws');
const {
  MOD_CHAT_PORT,
  MOD_CHAT_HISTORY_MAX,
  AUTOMUTE_EXECUTOR_HIERARCHY,
  normalizeModName,
  isAllowedModChatUser
} = require('./config');
const { computeAutomuteExecutor } = require('./automute-coord');
const strikeStore = require('./automute-strikes-store');

const PORT = Number(process.env.MODCHAT_PORT) || MOD_CHAT_PORT;

/** @type {{ id: string, user: string, text: string, ts: number }[]} */
const history = [];

/** @type {Map<import('ws').WebSocket, { user: string, id: string, automuteEnabled: boolean, automuteLive: boolean }>} */
const clients = new Map();

let msgSeq = 0;

function nextId() {
  msgSeq += 1;
  return `m${Date.now()}-${msgSeq}`;
}

function onlineUsers() {
  return [...new Set([...clients.values()].map((c) => c.user))].sort();
}

function pushHistory(entry) {
  history.push(entry);
  if (history.length > MOD_CHAT_HISTORY_MAX) history.shift();
  return entry;
}

function broadcast(obj, except) {
  const raw = JSON.stringify(obj);
  for (const [ws] of clients) {
    if (ws !== except && ws.readyState === 1) ws.send(raw);
  }
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function automuteModsMap() {
  const mods = new Map();
  for (const meta of clients.values()) {
    mods.set(meta.user, {
      automuteEnabled: !!meta.automuteEnabled,
      automuteLive: !!meta.automuteLive
    });
  }
  return mods;
}

function buildAutomuteExecutorPayload() {
  const mods = automuteModsMap();
  const executor = computeAutomuteExecutor(AUTOMUTE_EXECUTOR_HIERARCHY, mods);
  return {
    type: 'automute_executor',
    executor,
    hierarchy: [...AUTOMUTE_EXECUTOR_HIERARCHY],
    mods: [...mods.entries()].map(([user, st]) => ({ user, ...st })),
    ts: Date.now()
  };
}

function broadcastAutomuteExecutor(except) {
  const payload = buildAutomuteExecutorPayload();
  broadcast(payload, except);
  return payload;
}

function isAutomuteExecutor(user) {
  const payload = buildAutomuteExecutorPayload();
  return payload.executor && normalizeModName(payload.executor) === normalizeModName(user);
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  const names = onlineUsers().join(', ') || '—';
  const exec = buildAutomuteExecutorPayload().executor || '—';
  res.end(`ModChat relay OK · ${clients.size} verbunden (${names}) · Automute-Executor: ${exec}\n`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let authed = false;
  const authTimer = setTimeout(() => {
    if (!authed) {
      send(ws, { type: 'error', message: 'auth_timeout' });
      ws.close(4001, 'auth_timeout');
    }
  }, 10000);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      send(ws, { type: 'error', message: 'invalid_json' });
      return;
    }

    if (!authed) {
      if (msg?.type !== 'auth' || !msg.name) {
        send(ws, { type: 'error', message: 'auth_required' });
        ws.close(4003, 'auth_required');
        return;
      }
      const user = normalizeModName(msg.name);
      if (!isAllowedModChatUser(user)) {
        console.log(`[modchat] REJECTED name=${JSON.stringify(msg.name)} -> ${user}`);
        send(ws, { type: 'error', message: 'not_allowed' });
        ws.close(4003, 'not_allowed');
        return;
      }
      authed = true;
      clearTimeout(authTimer);
      const id = nextId();
      clients.set(ws, { user, id, automuteEnabled: false, automuteLive: false });
      const automuteState = buildAutomuteExecutorPayload();
      send(ws, {
        type: 'auth_ok',
        user,
        history: [...history],
        online: onlineUsers(),
        automute: automuteState
      });
      broadcast({ type: 'presence', user, online: true, onlineList: onlineUsers(), ts: Date.now() }, ws);
      broadcastAutomuteExecutor(ws);
      console.log(`[modchat] + ${user} (${clients.size} online: ${onlineUsers().join(', ')})`);
      return;
    }

    if (msg?.type === 'auth') {
      send(ws, { type: 'error', message: 'auth_required' });
      ws.close(4003, 'auth_required');
      return;
    }

    if (msg?.type === 'ping') {
      send(ws, { type: 'pong', ts: Date.now() });
      return;
    }

    if (msg?.type === 'msg') {
      const text = String(msg.text || '').trim();
      if (!text) return;
      if (text.length > 500) {
        send(ws, { type: 'error', message: 'message_too_long' });
        return;
      }
      const meta = clients.get(ws);
      if (!meta) return;
      const entry = pushHistory({
        id: nextId(),
        user: meta.user,
        text,
        ts: Date.now()
      });
      const payload = { type: 'msg', ...entry };
      send(ws, payload);
      broadcast(payload, ws);
      return;
    }

    if (msg?.type === 'automute_presence') {
      const meta = clients.get(ws);
      if (!meta) return;
      meta.automuteEnabled = !!msg.automuteEnabled;
      meta.automuteLive = !!msg.automuteLive;
      const state = broadcastAutomuteExecutor();
      console.log(
        `[automute] presence ${meta.user} enabled=${meta.automuteEnabled} live=${meta.automuteLive} → executor=${state.executor || '—'}`
      );
      return;
    }

    if (msg?.type === 'automute_strike_inc') {
      const meta = clients.get(ws);
      if (!meta) return;
      const key = String(msg.key || '').trim();
      const reqId = msg.reqId || null;
      if (!key) {
        send(ws, { type: 'automute_strike_denied', reason: 'empty_key', reqId });
        return;
      }
      if (!isAutomuteExecutor(meta.user)) {
        send(ws, { type: 'automute_strike_denied', key, reason: 'not_executor', reqId });
        return;
      }
      const row = strikeStore.incrementStrike(key);
      send(ws, { type: 'automute_strike_ok', key, ...row, reqId });
      broadcast({ type: 'automute_strike_sync', key, ...row, by: meta.user, ts: Date.now() }, ws);
      return;
    }

    if (msg?.type === 'automute_strike_get') {
      const key = String(msg.key || '').trim();
      if (!key) return;
      const row = strikeStore.getStrike(key);
      send(ws, { type: 'automute_strike_ok', key, ...row, readOnly: true, reqId: msg.reqId || null });
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    const meta = clients.get(ws);
    if (meta) {
      clients.delete(ws);
      const list = onlineUsers();
      broadcast({
        type: 'presence',
        user: meta.user,
        online: false,
        onlineList: list,
        ts: Date.now()
      });
      broadcastAutomuteExecutor();
      console.log(`[modchat] - ${meta.user} (${clients.size} online: ${list.join(', ') || '—'})`);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[modchat] listening on ws://0.0.0.0:${PORT}`);
});
