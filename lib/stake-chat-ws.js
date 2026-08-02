const WebSocket = require('ws');
const { randomUUID } = require('crypto');
const { parseChatMessage, parseWsFrame } = require('./chat-message-parse');
const { LOCKDOWN_TOKEN, DEFAULT_WS_HOST, CHAT_SUBSCRIPTION_KEY } = require('./stake-constants');
const { CHAT_SUBSCRIPTION_EXE } = require('./chat-ws-subscription');

class StakeChatWebSocket {
  constructor(handlers = {}) {
    this.onMessages = handlers.onMessages || (() => {});
    this.onStatus = handlers.onStatus || (() => {});
    this.ws = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.subscribeFallbackTimer = null;
    this.connected = false;
    this.subscribed = false;
    this.convRates = {};
    this.config = null;
    this.shouldRun = false;
    this.msgCount = 0;
    this.lastError = '';
    this.lastGraphqlError = '';
    this.lastMessageAt = 0;
    this._subscribeSent = false;
  }

  isConnected() {
    return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /** True only if WS is delivering chat (not just TCP open). */
  isHealthy() {
    if (!this.isConnected() || !this.subscribed) return false;
    if (this.msgCount > 0 && Date.now() - (this.lastMessageAt || 0) < 30000) return true;
    return false;
  }

  getStats() {
    return {
      connected: this.connected,
      subscribed: this.subscribed,
      msgCount: this.msgCount,
      lastMessageAt: this.lastMessageAt,
      subscribedAt: this._subscribedAt || 0
    };
  }

  setConvRates(rates) {
    this.convRates = rates || {};
  }

  emitStatus(extra = {}) {
    this.onStatus({
      connected: this.connected,
      subscribed: this.subscribed,
      msgCount: this.msgCount,
      lastError: this.lastError,
      healthy: this.isHealthy(),
      ...extra
    });
  }

  stop() {
    this.shouldRun = false;
    this._teardownSocket();
    this.msgCount = 0;
    this.lastMessageAt = 0;
    this.emitStatus({ phase: 'stopped' });
  }

  start(config) {
    const prevMsgCount = this.msgCount;
    const prevLastAt = this.lastMessageAt;
    this._teardownSocket();
    this.config = config;
    this.shouldRun = true;
    this.msgCount = prevMsgCount;
    this.lastMessageAt = prevLastAt;
    this._connect();
  }

  _destroySocket(ws) {
    if (!ws) return;
    try {
      ws.removeAllListeners();
    } catch (_) {
      /* ignore */
    }
    try {
      const rs = ws.readyState;
      if (rs === WebSocket.CONNECTING || rs === WebSocket.OPEN) {
        ws.terminate();
      }
    } catch (_) {
      /* ignore — never close() here; throws while CONNECTING */
    }
  }

  _teardownSocket() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.subscribeFallbackTimer) clearTimeout(this.subscribeFallbackTimer);
    this.subscribeFallbackTimer = null;
    this.connected = false;
    this.subscribed = false;
    this._subscribeSent = false;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      this._destroySocket(ws);
    }
  }

  _connect() {
    if (!this.shouldRun || !this.config) return;
    this.lastError = '';
    this.lastGraphqlError = '';
    const { apiKey, chatId, clearance, cookieMethod, cookieHeader, userAgent, language } = this.config;
    const host = this.config.wsHost || DEFAULT_WS_HOST;
    if (!host || !apiKey || !chatId) {
      this.lastError = 'missing_config';
      this.emitStatus({ phase: 'error', error: this.lastError });
      return;
    }

    const url = `wss://${host}/_api/websockets`;
    const cfName = cookieMethod === 'Permanent' ? 'cf_clearance' : '__cf_bm';
    const cookieParts = [];
    if (cookieHeader) cookieParts.push(cookieHeader);
    if (clearance) cookieParts.push(`${cfName}=${clearance}`);

    const headers = {
      Origin: `https://${host}`,
      'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (cookieParts.length) headers.Cookie = cookieParts.join('; ');

    this.emitStatus({ phase: 'connecting', url, wsHost: host });

    try {
      this.ws = new WebSocket(url, 'graphql-transport-ws', { headers });
    } catch (e) {
      this.lastError = e.message;
      this.emitStatus({ phase: 'error', error: e.message });
      this._scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.connected = true;
      this.emitStatus({ phase: 'open', wsHost: host });
      const init = {
        type: 'connection_init',
        payload: {
          accessToken: apiKey,
          language: language || 'en',
          lockdownToken: this.config.lockdownToken || LOCKDOWN_TOKEN
        }
      };
      this.ws.send(JSON.stringify(init));

      this.subscribeFallbackTimer = setTimeout(() => {
        if (this.shouldRun && this.isConnected() && !this._subscribeSent) {
          this._subscribe();
        }
      }, 2500);

      this.pingTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          try {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          } catch (_) {
            /* ignore */
          }
        }
      }, 25000);
    });

    this.ws.on('message', (data) => this._onMessage(data));

    this.ws.on('close', (code, reason) => {
      this.connected = false;
      this.subscribed = false;
      this._subscribeSent = false;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      const reasonStr = reason?.toString() || '';
      if (!this.lastError) this.lastError = `closed ${code} ${reasonStr}`.trim();
      this.emitStatus({ phase: 'closed', code, reason: reasonStr });
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      this.lastError = err.message;
      this.emitStatus({ phase: 'error', error: err.message });
    });
  }

  _scheduleReconnect() {
    if (!this.shouldRun) return;
    if (this.reconnectTimer) return;
    this.emitStatus({ phase: 'reconnecting', lastError: this.lastError });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldRun) this._connect();
    }, 5000);
  }

  _subscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.config?.chatId) return;
    if (this._subscribeSent) return;
    this._subscribeSent = true;
    const id = randomUUID();
    const msg = {
      id,
      type: 'subscribe',
      payload: {
        key: this.config.subscriptionKey || CHAT_SUBSCRIPTION_KEY,
        query: this.config.subscriptionQuery || CHAT_SUBSCRIPTION_EXE,
        variables: { chatId: this.config.chatId },
        operationName: 'ChatMessages',
        context: {
          url: '/_api/graphql',
          preferGetMethod: false,
          suspense: false,
          requestPolicy: 'cache-first'
        }
      }
    };
    this.ws.send(JSON.stringify(msg));
    this.subscribed = true;
    this._subscribedAt = Date.now();
    this.lastError = '';
    this.emitStatus({
      phase: 'subscribed',
      chatId: this.config.chatId,
      wsHost: this.config.wsHost || DEFAULT_WS_HOST
    });
  }

  _emitBatch(batch) {
    if (!batch.length) return;
    this.msgCount += batch.length;
    this.lastMessageAt = Date.now();
    this.lastError = '';
    this.onMessages(batch);
    this.emitStatus({
      phase: 'message',
      count: batch.length,
      msgCount: this.msgCount,
      wsHost: this.config?.wsHost || DEFAULT_WS_HOST
    });
  }

  _onMessage(data) {
    const raw = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    try {
      const obj = JSON.parse(raw);
      const type = obj.type || '';

      if (type === 'connection_ack') {
        if (this.subscribeFallbackTimer) clearTimeout(this.subscribeFallbackTimer);
        this._subscribe();
        return;
      }
      if (type === 'ping') {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          try {
            this.ws.send(JSON.stringify({ type: 'pong' }));
          } catch (_) {
            /* ignore */
          }
        }
        return;
      }
      if (type === 'error') {
        const errMsg = JSON.stringify(obj.payload || obj).slice(0, 300);
        this.lastGraphqlError = errMsg;
        this.emitStatus({ phase: 'graphql_error', error: errMsg, fatal: false });
        return;
      }
      if (type === 'complete') {
        return;
      }
      if (type === 'next' && obj.payload) {
        const cm = obj.payload?.data?.chatMessages;
        if (cm) {
          const one = parseChatMessage(cm, this.convRates);
          if (one) {
            this._emitBatch([one]);
            return;
          }
        }
        const batch = parseWsFrame(JSON.stringify(obj.payload), this.convRates);
        if (batch.length) {
          this._emitBatch(batch);
          return;
        }
      }
    } catch (_) {
      /* fall through */
    }

    const batch = parseWsFrame(raw, this.convRates);
    if (batch.length) this._emitBatch(batch);
  }
}

module.exports = { StakeChatWebSocket };
