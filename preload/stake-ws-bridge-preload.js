/**
 * Preload for Chromium-backed Stake chat WebSocket.
 * Page runs real Chrome TLS + session cookies (avoids Node ws 403 from Cloudflare).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__MODHUB_WS_BRIDGE', {
  send(type, payload) {
    ipcRenderer.send('modhub-chromium-ws', { type, payload });
  },
  onCommand(handler) {
    ipcRenderer.on('modhub-chromium-ws-cmd', (_e, msg) => {
      try {
        handler(msg || {});
      } catch (_) {
        /* ignore */
      }
    });
  }
});
