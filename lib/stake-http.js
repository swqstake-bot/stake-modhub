/**
 * Stake HTTP — Chromium-Session (VPN/CF-tauglich) + Browser-Fallback bei 403.
 * Entspricht StakeSportsElectron stakeNetPostJson / stakeBrowserPostJson.
 */

const { net, BrowserWindow } = require('electron');

class StakeHttpError extends Error {
  constructor(status, body, message) {
    super(message || `HTTP ${status}`);
    this.name = 'StakeHttpError';
    this.status = status;
    this.body = body;
  }
}

let bridgeWin = null;
let last403LogAt = 0;
const LOG_403_DEBOUNCE_MS = 15000;

function parseJsonBody(status, body) {
  try {
    return JSON.parse(body);
  } catch {
    throw new StakeHttpError(status, body, `API antwortete nicht mit JSON (HTTP ${status}).`);
  }
}

function rejectHttpStatus(status, body) {
  if (status === 401 || status === 403) {
    throw new StakeHttpError(status, body, `Session abgelehnt (HTTP ${status}). Cookies aktualisieren (Stake im Browser öffnen).`);
  }
  if (status === 429) {
    throw new StakeHttpError(status, body, 'Rate limit (429). Kurz warten.');
  }
  if (status >= 400) {
    let msg = `HTTP ${status}`;
    try {
      const p = JSON.parse(body);
      if (p?.errors?.[0]?.message) msg = p.errors[0].message;
    } catch (_) {}
    throw new StakeHttpError(status, body, msg);
  }
}

async function ensureBridgeWindow(origin) {
  if (bridgeWin && !bridgeWin.isDestroyed()) {
    try {
      const cur = bridgeWin.webContents.getURL();
      if (cur.startsWith(origin)) return bridgeWin;
    } catch (_) {}
    bridgeWin.destroy();
    bridgeWin = null;
  }
  bridgeWin = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  await bridgeWin.loadURL(`${origin}/`);
  return bridgeWin;
}

function stakeNetPostJson(url, headers, payload) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'POST', url, useSessionCookies: true });
    for (const [name, value] of Object.entries(headers || {})) {
      if (value != null && value !== '') request.setHeader(name, String(value));
    }
    const chunks = [];
    request.on('response', (response) => {
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const status = response.statusCode || 0;
        try {
          rejectHttpStatus(status, body);
          resolve({ status, body, parsed: parseJsonBody(status, body) });
        } catch (e) {
          reject(e);
        }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.write(JSON.stringify(payload));
    request.end();
  });
}

async function stakeBrowserPostJson(url, headers, payload) {
  const u = new URL(url);
  const origin = `${u.protocol}//${u.host}`;
  const w = await ensureBridgeWindow(origin);
  const script = `
    (async () => {
      const res = await fetch(${JSON.stringify(url)}, {
        method: 'POST',
        credentials: 'include',
        headers: ${JSON.stringify(headers)},
        body: ${JSON.stringify(JSON.stringify(payload))}
      });
      const text = await res.text();
      return { status: res.status, body: text };
    })();
  `;
  const result = await w.webContents.executeJavaScript(script, true);
  const status = Number(result?.status || 0);
  const body = String(result?.body || '');
  rejectHttpStatus(status, body);
  return { status, body, parsed: parseJsonBody(status, body) };
}

/**
 * POST JSON — zuerst Electron net (Session-Cookies), bei 403 Browser-Kontext.
 */
async function stakePostJson(url, headers, payload) {
  try {
    return await stakeNetPostJson(url, headers, payload);
  } catch (err) {
    if (err instanceof StakeHttpError && err.status === 403) {
      const now = Date.now();
      if (now - last403LogAt >= LOG_403_DEBOUNCE_MS) {
        console.warn('[StakeHTTP] net 403 → Browser-Fallback (VPN/CF)');
        last403LogAt = now;
      }
      return stakeBrowserPostJson(url, headers, payload);
    }
    throw err;
  }
}

function closeBridgeWindow() {
  if (bridgeWin && !bridgeWin.isDestroyed()) {
    bridgeWin.destroy();
  }
  bridgeWin = null;
}

module.exports = {
  StakeHttpError,
  stakePostJson,
  stakeNetPostJson,
  stakeBrowserPostJson,
  ensureBridgeWindow,
  closeBridgeWindow
};
