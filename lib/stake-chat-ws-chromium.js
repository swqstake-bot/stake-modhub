/**
 * Chromium WebSocket transport for Stake chat (session cookies + Chrome TLS).
 * Used when Node `ws` gets Cloudflare 403 on the upgrade.
 */
const { randomUUID } = require('crypto');
const { LOCKDOWN_TOKEN, DEFAULT_WS_HOST, CHAT_SUBSCRIPTION_KEY } = require('./stake-constants');
const { CHAT_SUBSCRIPTION_EXE } = require('./chat-ws-subscription');

function buildPageClientScript() {
  return `(() => {
    if (window.__modhubWsClientStarted) return;
    window.__modhubWsClientStarted = true;
    const bridge = window.__MODHUB_WS_BRIDGE;
    if (!bridge) return;

    let ws = null;
    let pingTimer = null;
    let subscribeSent = false;
    let cfg = null;

    function sendStatus(phase, extra) {
      bridge.send('status', Object.assign({ phase }, extra || {}));
    }

    function teardown() {
      subscribeSent = false;
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      if (ws) {
        try { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; } catch (_) {}
        try { ws.close(); } catch (_) {}
      }
      ws = null;
    }

    function subscribe() {
      if (!ws || ws.readyState !== 1 || !cfg || subscribeSent) return;
      subscribeSent = true;
      ws.send(JSON.stringify({
        id: cfg.subId || Math.random().toString(36).slice(2),
        type: 'subscribe',
        payload: {
          key: cfg.subscriptionKey,
          query: cfg.query,
          variables: { chatId: cfg.chatId },
          operationName: 'ChatMessages',
          context: {
            url: '/_api/graphql',
            preferGetMethod: false,
            suspense: false,
            requestPolicy: 'cache-first'
          }
        }
      }));
      sendStatus('subscribed', { chatId: cfg.chatId });
    }

    function connect(nextCfg) {
      teardown();
      cfg = nextCfg;
      if (!cfg || !cfg.wsHost || !cfg.apiKey || !cfg.chatId) {
        sendStatus('error', { error: 'missing_config' });
        return;
      }
      sendStatus('connecting', { wsHost: cfg.wsHost });
      try {
        ws = new WebSocket('wss://' + cfg.wsHost + '/_api/websockets', 'graphql-transport-ws');
      } catch (e) {
        sendStatus('error', { error: String(e && e.message || e) });
        return;
      }
      ws.onopen = function () {
        sendStatus('open', { wsHost: cfg.wsHost });
        ws.send(JSON.stringify({
          type: 'connection_init',
          payload: {
            accessToken: cfg.apiKey,
            language: cfg.language || 'en',
            lockdownToken: cfg.lockdownToken
          }
        }));
        pingTimer = setInterval(function () {
          if (ws && ws.readyState === 1) {
            try { ws.send(JSON.stringify({ type: 'ping' })); } catch (_) {}
          }
        }, 25000);
      };
      ws.onmessage = function (ev) {
        let msg;
        try { msg = JSON.parse(String(ev.data || '')); } catch (_) { return; }
        const type = msg.type || '';
        if (type === 'connection_ack') {
          subscribe();
          return;
        }
        if (type === 'ping') {
          try { ws.send(JSON.stringify({ type: 'pong' })); } catch (_) {}
          return;
        }
        if (type === 'error') {
          bridge.send('graphql_error', msg.payload || msg);
          return;
        }
        if (type === 'next') {
          bridge.send('frame', msg);
        }
      };
      ws.onerror = function () {
        sendStatus('error', { error: 'chromium_ws_error' });
      };
      ws.onclose = function (ev) {
        sendStatus('closed', { code: ev.code, reason: String(ev.reason || '') });
      };
    }

    bridge.onCommand(function (cmd) {
      if (!cmd || !cmd.action) return;
      if (cmd.action === 'start') connect(cmd.config || null);
      if (cmd.action === 'stop') teardown();
    });

    bridge.send('ready', {});
  })();`;
}

class StakeChatWsChromium {
  /**
   * @param {{ BrowserWindow: Function, getSession: () => Electron.Session, preloadPath: string }} deps
   * @param {{ onFrame: Function, onStatus: Function }} handlers
   */
  constructor(deps, handlers = {}) {
    this.BrowserWindow = deps.BrowserWindow;
    this.getSession = deps.getSession;
    this.preloadPath = deps.preloadPath;
    this.onFrame = handlers.onFrame || (() => {});
    this.onStatus = handlers.onStatus || (() => {});
    this.win = null;
    this.config = null;
    this.ready = false;
    this._ipcBound = false;
    this._stream = handlers.stream || 'com';
  }

  _bindIpc(ipcMain) {
    if (this._ipcBound) return;
    this._ipcBound = true;
    ipcMain.on('modhub-chromium-ws', (event, msg) => {
      try {
        if (!this.win || event.sender !== this.win.webContents) return;
      } catch (_) {
        return;
      }
      const type = msg?.type;
      const payload = msg?.payload;
      if (type === 'ready') {
        this.ready = true;
        if (this.config) this._sendCmd({ action: 'start', config: this.config });
        return;
      }
      if (type === 'status') {
        this.onStatus(payload || {});
        return;
      }
      if (type === 'graphql_error') {
        this.onStatus({ phase: 'graphql_error', error: JSON.stringify(payload || {}).slice(0, 300) });
        return;
      }
      if (type === 'frame') {
        this.onFrame(payload);
      }
    });
  }

  _sendCmd(cmd) {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      this.win.webContents.send('modhub-chromium-ws-cmd', cmd);
    } catch (_) {
      /* ignore */
    }
  }

  async ensureWindow(wsHost) {
    const host = wsHost || DEFAULT_WS_HOST;
    if (this.win && !this.win.isDestroyed()) {
      const url = this.win.webContents.getURL();
      if (url.startsWith(`https://${host}`)) return this.win;
    }
    if (this.win && !this.win.isDestroyed()) {
      try {
        this.win.destroy();
      } catch (_) {
        /* ignore */
      }
    }
    this.ready = false;
    this.win = new this.BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      skipTaskbar: true,
      webPreferences: {
        session: this.getSession(),
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    this.win.on('closed', () => {
      this.win = null;
      this.ready = false;
    });
    await this.win.loadURL(`https://${host}/`);
    await this.win.webContents.executeJavaScript(buildPageClientScript(), true);
    return this.win;
  }

  async start(config, ipcMain) {
    this._bindIpc(ipcMain);
    const wsHost = config.wsHost || DEFAULT_WS_HOST;
    this.config = {
      wsHost,
      apiKey: config.apiKey,
      chatId: config.chatId,
      language: config.language || 'en',
      lockdownToken: config.lockdownToken || LOCKDOWN_TOKEN,
      subscriptionKey: config.subscriptionKey || CHAT_SUBSCRIPTION_KEY,
      query: config.subscriptionQuery || CHAT_SUBSCRIPTION_EXE,
      subId: randomUUID()
    };
    await this.ensureWindow(wsHost);
    if (this.ready) this._sendCmd({ action: 'start', config: this.config });
  }

  stop() {
    this.config = null;
    this._sendCmd({ action: 'stop' });
  }

  destroy() {
    this.stop();
    if (this.win && !this.win.isDestroyed()) {
      try {
        this.win.destroy();
      } catch (_) {
        /* ignore */
      }
    }
    this.win = null;
  }
}

module.exports = { StakeChatWsChromium };
