const { contextBridge, ipcRenderer } = require('electron');

let queue = [];
let timer = null;

function flush() {
  timer = null;
  if (!queue.length) return;
  const batch = queue.splice(0, queue.length);
  ipcRenderer.send('modhub-stake-captured-messages', batch);
}

contextBridge.exposeInMainWorld('__MODHUB_BRIDGE', {
  pushMessage(payload) {
    if (!payload || !payload.username) return;
    const msg = payload.message != null ? String(payload.message) : '';
    if (!msg.trim() && payload.kind !== 'rain') return;
    const item = {
      username: String(payload.username).trim().replace(/^@+/, ''),
      message: msg,
      kind: payload.kind || 'text',
      timestamp:
        typeof payload.timestamp === 'number' && isFinite(payload.timestamp)
          ? payload.timestamp
          : Date.now()
    };
    if (payload.rain && typeof payload.rain === 'object') item.rain = payload.rain;
    queue.push(item);
    if (!timer) timer = setTimeout(flush, 350);
  },
  pushDebug(payload) {
    if (payload && typeof payload === 'object') {
      ipcRenderer.send('modhub-stake-debug', payload);
    }
  }
});
