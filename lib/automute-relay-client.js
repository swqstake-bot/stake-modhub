const WebSocket = require('ws');
const {
  MOD_CHAT_DEFAULT_URL,
  normalizeModName,
  isAllowedModChatUser,
  AUTOMUTE_EXECUTOR_HIERARCHY
} = require('./modchat-config');
const { automutePresenceFromSettings } = require('../modchat-relay/automute-coord');

const PING_MS = 25000;
const AUTH_TIMEOUT_MS = 12000;
const STRIKE_RPC_TIMEOUT_MS = 4000;

class AutomuteRelayClient {
  constructor({ getSettings, getModUser }) {
    this.getSettings = getSettings;
    this.getModUser = getModUser;
    this.ws = null;
    this.connected = false;
    this.halt = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.authTimer = null;
    this.currentExecutor = null;
    this.hierarchy = [...AUTOMUTE_EXECUTOR_HIERARCHY];
    this.pending = new Map();
    this.strikeCache = new Map();
  }

  _url() {
    const s = this.getSettings?.() || {};
    return String(s.modChatUrl || MOD_CHAT_DEFAULT_URL).trim() || MOD_CHAT_DEFAULT_URL;
  }

  _modUser() {
    return normalizeModName(this.getModUser?.());
  }

  isCoordinationEnabled() {
    const s = this.getSettings?.() || {};
    if (s.automuteRelayCoordination === false) return false;
    if (s.modChatEnabled === false) return false;
    return isAllowedModChatUser(this._modUser());
  }

  isCoordinationActive() {
    return this.isCoordinationEnabled() && this.connected;
  }

  isLocalExecutor() {
    if (!this.isCoordinationActive()) return true;
    const me = this._modUser();
    const exec = normalizeModName(this.currentExecutor);
    return !!me && !!exec && me === exec;
  }

  getStatus() {
    const me = this._modUser();
    const exec = this.currentExecutor ? normalizeModName(this.currentExecutor) : null;
    return {
      enabled: this.isCoordinationEnabled(),
      connected: this.connected,
      active: this.isCoordinationActive(),
      localExecutor: this.isLocalExecutor(),
      executor: exec,
      hierarchy: [...this.hierarchy],
      modUser: me || null
    };
  }

  _clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }
  }

  disconnect() {
    this._clearTimers();
    this.halt = true;
    this.connected = false;
    this.currentExecutor = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {
        /* ignore */
      }
      this.ws = null;
    }
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('relay_disconnected'));
    }
    this.pending.clear();
  }

  _applyAutomuteState(msg) {
    if (!msg) return;
    if (Array.isArray(msg.hierarchy) && msg.hierarchy.length) {
      this.hierarchy = msg.hierarchy.map((n) => normalizeModName(n));
    }
    this.currentExecutor = msg.executor ? normalizeModName(msg.executor) : null;
  }

  _send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  _rpc(type, payload, { expectType, timeoutMs = STRIKE_RPC_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('relay_timeout'));
      }, timeoutMs);
      this.pending.set(id, {
        expectType,
        resolve,
        reject,
        timer
      });
      if (!this._send({ ...payload, type, reqId: id })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('relay_not_connected'));
      }
    });
  }

  _handleRpcReply(msg) {
    const id = msg.reqId;
    if (!id || !this.pending.has(id)) return false;
    const pending = this.pending.get(id);
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(msg);
    return true;
  }

  updatePresence() {
    if (!this.connected) return;
    const s = this.getSettings?.() || {};
    const presence = automutePresenceFromSettings(s);
    this._send({ type: 'automute_presence', ...presence });
  }

  async incrementStrike(key) {
    if (!this.isCoordinationActive()) return null;
    if (!this.isLocalExecutor()) {
      return { ok: false, reason: 'not_executor' };
    }
    try {
      const res = await this._rpc('automute_strike_inc', { key }, { expectType: 'automute_strike_ok' });
      if (res?.type === 'automute_strike_denied') {
        return { ok: false, reason: res.reason || 'denied' };
      }
      if (res?.count != null) {
        this.strikeCache.set(key, { count: res.count, lastAt: res.lastAt || Date.now() });
      }
      return { ok: true, count: res.count, lastAt: res.lastAt };
    } catch (e) {
      if (String(e.message) === 'relay_not_connected') {
        return { ok: false, reason: 'relay_offline' };
      }
      return { ok: false, reason: e.message || 'relay_error' };
    }
  }

  _scheduleReconnect() {
    if (this.halt || !this.isCoordinationEnabled()) return;
    if (this.reconnectTimer) return;
    const delay = Math.min(30000, 1500 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  connect() {
    if (!this.isCoordinationEnabled()) return;
    const modUser = this.getModUser?.();
    if (!modUser || !isAllowedModChatUser(modUser)) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.updatePresence();
      return;
    }

    this.halt = false;
    this._clearTimers();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {
        /* ignore */
      }
      this.ws = null;
    }

    const url = this._url();
    let socket;
    try {
      socket = new WebSocket(url);
    } catch (_) {
      this._scheduleReconnect();
      return;
    }
    this.ws = socket;
    this.connected = false;

    socket.on('open', () => {
      this.reconnectAttempt = 0;
      socket.send(JSON.stringify({ type: 'auth', name: modUser }));
      this.authTimer = setTimeout(() => {
        if (this.ws === socket) {
          try {
            socket.close();
          } catch (_) {
            /* ignore */
          }
        }
      }, AUTH_TIMEOUT_MS);
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_MS);
    });

    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (this._handleRpcReply(msg)) return;

      if (msg.type === 'auth_ok') {
        if (this.authTimer) {
          clearTimeout(this.authTimer);
          this.authTimer = null;
        }
        this.connected = true;
        this._applyAutomuteState(msg.automute);
        this.updatePresence();
        return;
      }

      if (msg.type === 'automute_executor') {
        this._applyAutomuteState(msg);
        return;
      }

      if (msg.type === 'automute_strike_sync' && msg.key) {
        this.strikeCache.set(msg.key, { count: msg.count, lastAt: msg.lastAt || Date.now() });
        return;
      }

      if (msg.type === 'automute_strike_denied' && msg.reqId) {
        const pending = this.pending.get(msg.reqId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(msg.reqId);
          pending.resolve(msg);
        }
      }
    });

    socket.on('close', () => {
      if (this.ws === socket) this.ws = null;
      this.connected = false;
      this.currentExecutor = null;
      this._clearTimers();
      if (!this.halt) this._scheduleReconnect();
    });

    socket.on('error', () => {
      /* close handler reconnects */
    });
  }
}

module.exports = { AutomuteRelayClient };
