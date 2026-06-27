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
  normalizeModName,
  isAllowedModChatUser
} = require('./config');

const PORT = Number(process.env.MODCHAT_PORT) || MOD_CHAT_PORT;

/** @type {{ id: string, user: string, text: string, ts: number }[]} */
const history = [];

/** @type {Map<import('ws').WebSocket, { user: string, id: string }>} */
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

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  const names = onlineUsers().join(', ') || '—';
  res.end(`ModChat relay OK · ${clients.size} verbunden (${names}) · ${history.length} History\n`);
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
      clients.set(ws, { user, id });
      send(ws, { type: 'auth_ok', user, history: [...history], online: onlineUsers() });
      broadcast({ type: 'presence', user, online: true, onlineList: onlineUsers(), ts: Date.now() }, ws);
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
      console.log(`[modchat] - ${meta.user} (${clients.size} online: ${list.join(', ') || '—'})`);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[modchat] listening on ws://0.0.0.0:${PORT}`);
});
