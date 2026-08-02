const { app, BrowserWindow, ipcMain, session, dialog, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { StakeGraphQL } = require('./lib/stake-graphql');
const { loadSettings, saveSettings, normalizeHostname, getHubSettings } = require('./lib/stake-session');
const fileLogs = require('./lib/file-logs');
const {
  seedBlueprintDefaults,
  readBundledBlueprints,
  bundledAvailable
} = require('./lib/blueprint-defaults');
const { ensureDataPath, getDatengrubePath } = require('./lib/data-path');
const dataFiles = require('./lib/data-files');
const analyseEngine = require('./lib/analyse');
const { scoreLiveMessage } = require('./lib/analyse/live-flag');
const { StakeChatWebSocket } = require('./lib/stake-chat-ws');
const { AutoHashQueue } = require('./lib/auto-hash-queue');
const { AutoMuteEngine } = require('./lib/automute-engine');
const { AutomuteRelayClient } = require('./lib/automute-relay-client');
const notifySoundsStore = require('./lib/notify-sounds-store');
const { CHATROOMS, LOCKDOWN_TOKEN, DEFAULT_WS_HOST, DEFAULT_WS_EU_HOST, resolveChatId, CHAT_SUBSCRIPTION_KEY, CHAT_SUBSCRIPTION_KEY_EU, DEFAULT_EU_CHAT_ID } = require('./lib/stake-constants');
const { createBetRegistry } = require('./lib/bet-registry');
const { extractBetIds } = require('./lib/bet-id-parse');
const {
  initAutoUpdate,
  disposeAutoUpdate,
  checkForUpdatesManual,
  startUpdateDownload,
  quitAndInstallUpdate
} = require('./lib/auto-update');
const { closeBridgeWindow } = require('./lib/stake-http');
const { registerAnalyseIpc } = require('./main/ipc-analyse');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

process.on('uncaughtException', (err) => {
  const msg = String(err?.message || err);
  if (/WebSocket was closed before the connection was established/i.test(msg)) {
    console.error('[modhub] WS teardown (ignored):', msg);
    return;
  }
  console.error('[modhub] uncaughtException:', err);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWin = null;
let tray = null;
let isQuitting = false;
let stakeLoginWin = null;
let stakeChatCaptureWin = null;
let cachedCookieHeader = '';
let convRates = {};
let loggedInModUser = null;
const liveDedup = new Map();
const LIVE_DEDUP_MS = 15000;
let captureOpenedForFallback = false;
let liveHealthTimer = null;
let wsStartChain = Promise.resolve();

async function syncSessionFromElectron() {
  await refreshCookies();
  const s = loadSettings();
  const host = normalizeHostname(s.stakeDomain);
  const url = `https://${host}/`;
  const cookies = await session.defaultSession.cookies.get({ url });
  const cfClear = cookies.find((c) => c.name === 'cf_clearance');
  const cfBm = cookies.find((c) => c.name === '__cf_bm');
  const ua = session.defaultSession.getUserAgent() || s.userAgent;
  const patch = { userAgent: ua };
  if (cfClear?.value) patch.clearance = cfClear.value;
  if (cfBm?.value && !cfClear?.value) patch.clearance = cfBm.value;
  if (cfClear?.value) patch.cookieMethod = 'Permanent';
  else if (cfBm?.value) patch.cookieMethod = 'Non Permanent';
  saveSettings(patch);
}

/** Settings overlay for a site: hub slice (RH/automsg/automute/chatroom) + EU credentials. */
function settingsForSite(site) {
  const s = loadSettings();
  const hub = getHubSettings(s, site);
  const merged = { ...s, ...hub };
  if (site === 'eu') {
    const euHost = normalizeHostname(s.wsEuHost || DEFAULT_WS_EU_HOST);
    return {
      ...merged,
      stakeDomain: euHost,
      apiKey: String(s.apiKeyEu || '').trim(),
      clearance: String(s.clearanceEu || s.clearance || '').trim()
    };
  }
  return merged;
}

function gqlClientForSite(site) {
  return site === 'eu' ? gqlEu : gql;
}

const gql = new StakeGraphQL(
  () => settingsForSite('com'),
  () => cachedCookieHeader,
  () => syncSessionFromElectron()
);

const gqlEu = new StakeGraphQL(
  () => settingsForSite('eu'),
  () => cachedCookieHeader,
  () => syncSessionFromElectron()
);

const autoHashQueue = new AutoHashQueue({
  getSettings: () => loadSettings(),
  fetchUserHash: (name) => gql.getUserHash(name)
});

function getModNamesForAutomute() {
  const s = loadSettings();
  const names = [];
  if (loggedInModUser) names.push(loggedInModUser);
  for (const a of s.mentionAliases || []) {
    const n = String(a || '').trim();
    if (n) names.push(n);
  }
  return names;
}

async function resolveUserIdForAutomute(name, site = 'com') {
  const { normalizeUsername } = require('./lib/username');
  const queryName = normalizeUsername(name);
  if (!queryName) return null;
  const client = gqlClientForSite(site);
  let data = await client.getUserDetails(queryName);
  if (!data?.user?.id) {
    const fallback = await client.getUserHash(queryName);
    if (fallback?.user?.id) data = fallback;
  }
  return data?.user?.id || null;
}

const automuteRelay = new AutomuteRelayClient({
  getSettings: () => loadSettings(),
  getModUser: () => loggedInModUser
});

const autoMuteEngine = new AutoMuteEngine({
  getSettings: () => loadSettings(),
  getSettingsForSite: (site) => settingsForSite(site),
  getDataDir: () => dataDir(),
  resolveUserId: (name, ctx) => resolveUserIdForAutomute(name, ctx?.site || 'com'),
  muteUser: async ({ userId, expire, message, site }) => {
    const client = gqlClientForSite(site || 'com');
    const data = await client.muteUser(userId, expire, message);
    if (data?.muteUser?.name) {
      fileLogs.appendMuted(dataDir(), data.muteUser.name, message || '', expire || '');
    }
    return data;
  },
  sendChatAnnounce: async (text, ctx) => {
    const site = ctx?.site || 'com';
    const client = gqlClientForSite(site);
    const s = settingsForSite(site);
    const room = s.prefChatroom || 'German';
    const chatId = resolveChatId(room, site);
    const msg = String(text || '').trim();
    if (!msg) return { ok: false, error: 'empty' };
    await client.sendMessage(chatId, msg);
    return { ok: true };
  },
  getModNames: getModNamesForAutomute,
  getRelay: () => automuteRelay,
  onAction: (entry) => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('modhub-automute-action', entry);
    }
    const label = entry.dryRun ? '[dry-run]' : entry.ok ? '[muted]' : '[fail]';
    console.log(`[automute] ${label} @${entry.username} · ${entry.ruleLabel} · Strike ${entry.strike} · ${entry.expire || entry.skipped || entry.error || ''}`);
  }
});

function syncAutomuteRelay() {
  if (!loggedInModUser) {
    automuteRelay.disconnect();
    return;
  }
  automuteRelay.connect();
  automuteRelay.updatePresence();
}

function processAutomuteBatch(batch, site = 'com') {
  const s = settingsForSite(site);
  if (!s.automuteEnabled) return;
  for (const m of batch) {
    if (m.kind === 'text' && m.username) {
      autoMuteEngine.processMessage({ ...m, site });
    }
  }
}

function dataDir() {
  return ensureDataPath();
}

function initDataStorage() {
  const dataPath = dataDir();
  saveSettings({ dataPath });
  seedBlueprintDefaults(dataPath);
  return dataPath;
}

function sendBetRecord(record) {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('modhub-bet-record', record);
  }
}

const betRegistry = createBetRegistry({
  lookupBet: (id) => gql.getBetLookup(id),
  appendLog: (record) => {
    fileLogs.appendBetLog(dataDir(), record);
  }
});

function trackBetsInMessages(batch) {
  if (!loggedInModUser) return;
  for (const m of batch) {
    if (!m?.message) continue;
    const ids = extractBetIds(m.message);
    for (const id of ids) {
      betRegistry
        .track(
          {
            betId: id,
            username: m.username,
            message: m.message,
            timestamp: m.timestamp
          },
          sendBetRecord
        )
        .catch(() => {});
    }
  }
}

const chatWs = new StakeChatWebSocket({
  onMessages(batch) {
    const s = loadSettings();
    if (s.logHash) {
      for (const m of batch) {
        if (m.kind === 'text' && m.username) autoHashQueue.enqueue(m.username);
      }
    }
    processAutomuteBatch(batch, 'com');
    broadcastLiveBatch(batch, 'ws');
  },
  onStatus(status) {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('modhub-ws-status', status);
    }
  }
});

const chatWsEu = new StakeChatWebSocket({
  onMessages(batch) {
    const s = loadSettings();
    if (s.logHash) {
      for (const m of batch) {
        if (m.kind === 'text' && m.username) autoHashQueue.enqueue(m.username);
      }
    }
    processAutomuteBatch(batch, 'eu');
    broadcastLiveBatch(batch, 'ws-eu');
  },
  onStatus(status) {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('modhub-ws-status', { ...status, stream: 'eu' });
    }
  }
});

async function refreshCookies() {
  const cookies = await session.defaultSession.cookies.get({});
  cachedCookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const m = cachedCookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  const sessionToken = m && m[1] ? String(m[1]) : '';
  return { cookieHeader: cachedCookieHeader, accessToken: sessionToken };
}

async function extractCfForHost(hostname) {
  const s = loadSettings();
  const host = normalizeHostname(hostname);
  if (!host) return '';
  const url = `https://${host}/`;
  const cookies = await session.defaultSession.cookies.get({ url });
  const name = s.cookieMethod === 'Permanent' ? 'cf_clearance' : '__cf_bm';
  const hit = cookies.find((c) => c.name === name);
  return hit?.value || '';
}

async function extractCfToSettings() {
  const s = loadSettings();
  const hit = await extractCfForHost(s.stakeDomain);
  if (hit) {
    saveSettings({ clearance: hit });
    return hit;
  }
  return '';
}

async function prepareWsConnection() {
  await refreshCookies();
  const s = loadSettings();
  const wsHost = normalizeHostname(s.wsHost || DEFAULT_WS_HOST);
  const mirror = normalizeHostname(s.stakeDomain);
  const euHost = s.wsEuEnabled ? normalizeHostname(s.wsEuHost || DEFAULT_WS_EU_HOST) : '';
  const hosts = [...new Set([wsHost, mirror, euHost].filter(Boolean))];
  const patch = {};
  for (const h of hosts) {
    const c = await extractCfForHost(h);
    if (!c) continue;
    const isEu = euHost && h === euHost;
    if (isEu) patch.clearanceEu = c;
    else if (!patch.clearance) patch.clearance = c;
  }
  if (Object.keys(patch).length) saveSettings(patch);
  const next = loadSettings();
  return next.clearance || '';
}

function injectStakeChatObserver(win) {
  if (!win || win.isDestroyed()) return Promise.resolve();
  const injectPath = path.join(__dirname, 'inject', 'stake-chat-inject.js');
  if (!fs.existsSync(injectPath)) return Promise.resolve();
  return win.webContents.executeJavaScript(fs.readFileSync(injectPath, 'utf8'), false).catch(() => {});
}

async function sendChatMessageDom(message) {
  if (!stakeChatCaptureWin || stakeChatCaptureWin.isDestroyed()) {
    throw new Error('capture_not_running');
  }
  const text = String(message || '').trim();
  if (!text) throw new Error('empty_message');
  const js = `(function(){
    var msg = ${JSON.stringify(text)};
    var input = document.querySelector('textarea[placeholder*="Nachricht"]') ||
      document.querySelector('textarea[placeholder*="message"]') || document.querySelector('textarea');
    if (!input) return { ok:false, error:'input_not_found' };
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value');
    if (!setter || !setter.set) return { ok:false, error:'value_setter_missing' };
    setter.set.call(input, msg);
    input.dispatchEvent(new Event('input', { bubbles:true }));
    var btn = document.querySelector('button[type="submit"]') ||
      Array.from(document.querySelectorAll('button')).find(function(b){
        return /senden|send/i.test(b.textContent||'');
      });
    if (!btn) return { ok:false, error:'send_button_not_found' };
    btn.click();
    return { ok:true };
  })();`;
  const result = await stakeChatCaptureWin.webContents.executeJavaScript(js, true);
  if (!result || !result.ok) throw new Error((result && result.error) || 'send_failed');
  return { ok: true };
}

const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray-icon.png');

function loadAppIcon() {
  if (!fs.existsSync(APP_ICON_PATH)) return null;
  const img = nativeImage.createFromPath(APP_ICON_PATH);
  return img.isEmpty() ? null : img;
}

function getTrayIcon() {
  const iconPath = fs.existsSync(TRAY_ICON_PATH) ? TRAY_ICON_PATH : APP_ICON_PATH;
  if (fs.existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) {
      const size = process.platform === 'win32' ? 32 : 22;
      return img.resize({ width: size, height: size, quality: 'best' });
    }
  }
  return nativeImage.createFromPath(process.execPath).resize({ width: 16, height: 16 });
}

function showMainWindow() {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function teardownBackground() {
  stopLiveHealthMonitor();
  stopNativeChatWs();
  autoHashQueue.dispose();
  disposeAutoUpdate();
  closeBridgeWindow();
  for (const win of [stakeChatCaptureWin, stakeLoginWin]) {
    if (win && !win.isDestroyed()) win.destroy();
  }
  stakeChatCaptureWin = null;
  stakeLoginWin = null;
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

function quitApplication() {
  if (isQuitting) return;
  isQuitting = true;
  teardownBackground();
  destroyTray();
  app.quit();
}

function ensureTray() {
  if (tray) return;
  tray = new Tray(getTrayIcon());
  tray.setToolTip('Stake Mod Hub');
  const menu = Menu.buildFromTemplate([
    { label: 'Öffnen', click: showMainWindow },
    { type: 'separator' },
    { label: 'Beenden', click: quitApplication }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', showMainWindow);
}

function hideMainWindowToTray() {
  if (!mainWin || mainWin.isDestroyed()) return;
  ensureTray();
  mainWin.hide();
}

function createMainWindow() {
  const appIcon = loadAppIcon();
  const frameless = process.platform === 'win32' || process.platform === 'linux';
  mainWin = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: 'Stake Mod Hub',
    icon: appIcon || undefined,
    show: false,
    frame: !frameless,
    backgroundColor: '#0f212e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWin.once('ready-to-show', () => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.show();
  });
  mainWin.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    quitApplication();
  });
  mainWin.loadFile(path.join(__dirname, 'index.html'));
}

function openStakeLogin(stakeDomain, { site } = {}) {
  return new Promise((resolve) => {
    const host = normalizeHostname(stakeDomain);
    if (stakeLoginWin && !stakeLoginWin.isDestroyed()) {
      stakeLoginWin.focus();
      return resolve({ ok: true, reused: true });
    }
    stakeLoginWin = new BrowserWindow({
      width: 1100,
      height: 800,
      parent: mainWin || undefined,
      modal: !!mainWin,
      title: `Stake Login — ${host}`,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    stakeLoginWin.loadURL(`https://${host}/`);
    stakeLoginWin.on('closed', async () => {
      stakeLoginWin = null;
      await syncSessionFromElectron();
      const cf = await extractCfForHost(host);
      const patch = {};
      if (site === 'eu') {
        if (cf) patch.clearanceEu = cf;
      } else if (cf) {
        patch.clearance = cf;
      }
      if (Object.keys(patch).length) saveSettings(patch);
      const settings = loadSettings();
      const clearance = site === 'eu' ? settings.clearanceEu : settings.clearance;
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('modhub-session-updated', {
          ...settings,
          clearanceUpdated: !!clearance,
          site: site || 'com'
        });
      }
      resolve({ ok: true, clearance });
    });
  });
}

function buildWsConfig(wsHostOverride, { site } = {}) {
  const isEu = site === 'eu';
  const siteKey = isEu ? 'eu' : 'com';
  const s = settingsForSite(siteKey);
  const raw = loadSettings();
  const host = normalizeHostname(isEu ? s.stakeDomain : raw.stakeDomain);
  const room = s.prefChatroom || 'German';
  const wsHost = normalizeHostname(
    wsHostOverride ||
      (isEu ? raw.wsEuHost || DEFAULT_WS_EU_HOST : raw.wsHost || DEFAULT_WS_HOST)
  );
  return {
    host,
    wsHost,
    apiKey: s.apiKey,
    chatId: resolveChatId(room, isEu ? 'eu' : 'com'),
    clearance: s.clearance,
    cookieMethod: s.cookieMethod,
    cookieHeader: cachedCookieHeader,
    userAgent: s.userAgent,
    language: isEu ? 'de' : 'en',
    lockdownToken: LOCKDOWN_TOKEN,
    subscriptionKey: isEu ? CHAT_SUBSCRIPTION_KEY_EU : CHAT_SUBSCRIPTION_KEY
  };
}

function dedupLiveBatch(batch, source) {
  const now = Date.now();
  const out = [];
  for (const m of batch) {
    if (!m || !m.username) continue;
    const key = `${m.kind}|${m.username}|${m.message}|${m.timestamp || 0}`;
    const prev = liveDedup.get(key);
    if (prev && now - prev.at < LIVE_DEDUP_MS) {
      if ((source === 'ws' || source === 'ws-eu') && prev.source !== 'ws' && prev.source !== 'ws-eu') {
        prev.source = source;
      }
      continue;
    }
    liveDedup.set(key, { at: now, source: source || 'unknown' });
    out.push(m);
  }
  if (liveDedup.size > 5000) {
    for (const [k, v] of liveDedup) {
      if (now - v.at > LIVE_DEDUP_MS) liveDedup.delete(k);
    }
  }
  return out;
}

function shouldUseInjectFallback() {
  const s = loadSettings();
  if (s.useNativeWs === false) return true;
  if (chatWs.isHealthy()) return false;
  if (s.wsEuEnabled && chatWsEu.isHealthy()) return false;
  return true;
}

async function ensureCaptureFallback() {
  if (!shouldUseInjectFallback()) return;
  if (!stakeChatCaptureWin || stakeChatCaptureWin.isDestroyed()) {
    captureOpenedForFallback = true;
    await openStakeChatCapture(false);
  } else {
    await injectStakeChatObserver(stakeChatCaptureWin);
  }
}

function stopLiveHealthMonitor() {
  if (liveHealthTimer) clearInterval(liveHealthTimer);
  liveHealthTimer = null;
}

function startLiveHealthMonitor() {
  stopLiveHealthMonitor();
  liveHealthTimer = setInterval(() => {
    if (!loggedInModUser) return;
    ensureCaptureFallback().catch(() => {});
  }, 15000);
}

async function startNativeChatWs() {
  wsStartChain = wsStartChain
    .catch(() => {})
    .then(async () => {
      const s = loadSettings();
      if (!s.useNativeWs || !s.apiKey) return;
      await prepareWsConnection();
      chatWs.setConvRates(convRates);
      chatWsEu.setConvRates(convRates);
      autoHashQueue.reloadCheckedToday();
      try {
        chatWs.start(buildWsConfig());
      } catch (e) {
        console.error('[modhub] chatWs.start failed:', e?.message || e);
      }
      const euKey = String(s.apiKeyEu || '').trim();
      if (s.wsEuEnabled && euKey) {
        try {
          let euCfg = buildWsConfig(s.wsEuHost || DEFAULT_WS_EU_HOST, { site: 'eu' });
          try {
            const pubs = await gqlEu.getPublicChats();
            const list = pubs?.publicChats || [];
            const prefer =
              list.find((c) => /^de$/i.test(c?.name)) ||
              list.find((c) => /german|deutsch/i.test(c?.name || '')) ||
              list[0];
            if (prefer?.id) {
              euCfg = { ...euCfg, chatId: prefer.id };
              console.log('[modhub] EU chatId from PublicChats:', prefer.name, prefer.id);
            }
          } catch (e) {
            console.warn('[modhub] PublicChats EU failed, using default:', e?.message || e);
            if (!euCfg.chatId) euCfg.chatId = DEFAULT_EU_CHAT_ID;
          }
          chatWsEu.start(euCfg);
        } catch (e) {
          console.error('[modhub] chatWsEu.start failed:', e?.message || e);
        }
      } else {
        chatWsEu.stop();
      }
    });
  return wsStartChain;
}

function stopNativeChatWs() {
  chatWs.stop();
  chatWsEu.stop();
}

function broadcastLiveBatch(batch, source) {
  if (!Array.isArray(batch) || !batch.length) return;
  batch = dedupLiveBatch(batch, source);
  if (!batch.length) return;
  trackBetsInMessages(batch);
  const s = loadSettings();
  if (s.logChat) {
    const dir = dataDir();
    for (const m of batch) {
      if (!m || !m.username) continue;
      fileLogs.logLiveMessage(dir, m);
    }
    fileLogs.flushAll();
  }
  if (!mainWin || mainWin.isDestroyed()) return;
  mainWin.webContents.send('modhub-live-messages', { messages: batch, source });
}

async function openStakeChatCapture(showWindow = false) {
  const s = loadSettings();
  const host = normalizeHostname(s.stakeDomain);
  if (stakeChatCaptureWin && !stakeChatCaptureWin.isDestroyed()) {
    if (showWindow) {
      stakeChatCaptureWin.show();
      stakeChatCaptureWin.setSkipTaskbar(false);
    }
    return { ok: true, reopened: true };
  }
  stakeChatCaptureWin = new BrowserWindow({
    width: 1280,
    height: 800,
    show: !!showWindow,
    skipTaskbar: !showWindow,
    title: 'Stake Chat Capture',
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'stake-chat-capture-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const scheduleInject = () => setTimeout(() => injectStakeChatObserver(stakeChatCaptureWin), 600);
  stakeChatCaptureWin.webContents.on('did-finish-load', scheduleInject);
  stakeChatCaptureWin.webContents.on('did-navigate', scheduleInject);
  await stakeChatCaptureWin.loadURL(`https://${host}/`);
  return { ok: true, reopened: false };
}

function registerIpc() {
  ipcMain.on('modhub-get-version', (event) => {
    event.returnValue = app.getVersion();
  });
  ipcMain.on('modhub-live-flag', (event, input) => {
    try {
      event.returnValue = scoreLiveMessage(input || {});
    } catch (_) {
      event.returnValue = null;
    }
  });
  ipcMain.handle('modhub-settings-get', async () => loadSettings());
  ipcMain.handle('modhub-settings-set', async (_e, partial) => {
    const next = saveSettings(partial || {});
    if (loggedInModUser && next.apiKey) {
      startNativeChatWs().catch(() => {});
    }
    syncAutomuteRelay();
    return next;
  });

  ipcMain.handle('modhub-automute-status', async () => ({
    ok: true,
    ...autoMuteEngine.getStatus()
  }));

  ipcMain.handle('modhub-automute-log', async (_e, { limit } = {}) => {
    const cap = limit || 50;
    const mem = autoMuteEngine.getRecentLog(cap);
    const disk = dataFiles.loadAutomuteLog(dataDir(), cap * 2);
    const log = dataFiles.mergeAutomuteLogEntries(mem, disk, cap);
    return { ok: true, log };
  });

  ipcMain.handle('modhub-automute-test', async (_e, { message, username, rules } = {}) => {
    const { migrateAutoMuteRules } = require('./lib/automute-defaults');
    const { previewAutomute } = require('./lib/automute-engine');
    const s = loadSettings();
    const list = Array.isArray(rules) && rules.length ? rules.map((r) => require('./lib/automute-defaults').normalizeRule(r)) : migrateAutoMuteRules(s);
    const strikes = dataFiles.loadAutomuteStrikes(dataDir());
    return {
      ok: true,
      result: previewAutomute(String(message || ''), list, { username, strikes })
    };
  });

  ipcMain.handle('modhub-notify-sounds-list', async () => {
    const s = loadSettings();
    return { ok: true, sounds: notifySoundsStore.listCustomSounds(s) };
  });

  ipcMain.handle('modhub-notify-sound-import', async () => {
    const win = mainWin && !mainWin.isDestroyed() ? mainWin : BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Benachrichtigungston importieren',
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'webm'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths?.[0]) return { ok: false, canceled: true };
    try {
      const src = result.filePaths[0];
      const label = path.basename(src, path.extname(src));
      const s = loadSettings();
      const { entry, customNotifySounds } = notifySoundsStore.importCustomSound(dataDir(), s, src, label);
      saveSettings({ customNotifySounds });
      return { ok: true, entry, sounds: customNotifySounds };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('modhub-notify-sound-delete', async (_e, { id } = {}) => {
    const s = loadSettings();
    const customNotifySounds = notifySoundsStore.deleteCustomSound(dataDir(), s, id);
    saveSettings({ customNotifySounds });
    return { ok: true, sounds: customNotifySounds };
  });

  ipcMain.handle('modhub-notify-sound-data', async (_e, { id } = {}) => {
    const s = loadSettings();
    const dataUrl = notifySoundsStore.readCustomSoundDataUrl(dataDir(), s, id);
    if (!dataUrl) return { ok: false, error: 'not_found' };
    return { ok: true, dataUrl };
  });

  ipcMain.handle('modhub-pick-data-path', async () => {
    const dataPath = initDataStorage();
    const bundled = readBundledBlueprints();
    const bp = dataFiles.loadBlueprints(dataPath, bundled);
    await shell.openPath(dataPath);
    return { ok: true, dataPath, opened: true, ...bp };
  });

  ipcMain.handle('modhub-seed-blueprints', async (_e, { force } = {}) => {
    const dataPath = dataDir();
    const seeded = seedBlueprintDefaults(dataPath, { force: !!force });
    const bundled = readBundledBlueprints();
    const bp = dataFiles.loadBlueprints(dataPath, bundled);
    return {
      ok: true,
      dataPath,
      seeded,
      bundledOk: bundledAvailable(),
      ...bp
    };
  });

  /** Optional: open Stake in browser to refresh Cloudflare cookies only */
  ipcMain.handle('modhub-stake-login', async (_e, { stakeDomain, site } = {}) => {
    try {
      const s = loadSettings();
      const isEu = site === 'eu';
      const host = normalizeHostname(
        stakeDomain || (isEu ? s.wsEuHost || DEFAULT_WS_EU_HOST : s.stakeDomain)
      );
      if (!isEu && stakeDomain) saveSettings({ stakeDomain: host });
      const r = await openStakeLogin(host, { site: isEu ? 'eu' : 'com' });
      if (loggedInModUser && loadSettings().apiKey) {
        await startNativeChatWs();
        await ensureCaptureFallback();
      }
      const next = loadSettings();
      return {
        ok: true,
        clearance: r.clearance || (isEu ? next.clearanceEu : next.clearance) || '',
        site: isEu ? 'eu' : 'com'
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  async function performApiLogin(apiKey, { retried403 } = {}) {
    if (apiKey) saveSettings({ apiKey });
    const key = loadSettings().apiKey;
    if (!key) return { ok: false, error: 'api_key_required' };
    await syncSessionFromElectron();
    let data;
    try {
      data = await gql.initialUserRequest();
    } catch (e) {
      const msg = String(e.message || e);
      const is403 = e.status === 403 || /403|Session abgelehnt/i.test(msg);
      if (is403 && !retried403) {
        await openStakeLogin(loadSettings().stakeDomain);
        await syncSessionFromElectron();
        return performApiLogin(apiKey, { retried403: true });
      }
      return { ok: false, error: msg };
    }
    const name = data?.user?.name;
    if (!name) return { ok: false, error: 'no_user' };
    const s = loadSettings();
    const allowed = Array.isArray(s.allowedUsers) ? s.allowedUsers.filter(Boolean) : [];
    if (allowed.length && !allowed.includes(name)) {
      return { ok: false, error: 'not_allowed', user: name };
    }
    try {
      convRates = await gql.getCurrencyConversionRates();
    } catch (_) {
      convRates = {};
    }
    loggedInModUser = name;
    captureOpenedForFallback = false;
    syncAutomuteRelay();
    await startNativeChatWs();
    openStakeChatCapture(false).catch(() => {});
    startLiveHealthMonitor();
    const dataPath = dataDir();
    betRegistry.hydrate(fileLogs.loadBetsLog(dataPath));
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('modhub-bets-loaded', { bets: betRegistry.list() });
    }
    return { ok: true, user: name, data, convRates };
  }

  /** Primary login: API key → GraphQL verify → start live capture */
  ipcMain.handle('modhub-login', async (_e, { apiKey } = {}) => {
    try {
      return await performApiLogin(apiKey);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modhub-graphql-login', async (_e, { apiKey } = {}) => {
    try {
      return await performApiLogin(apiKey);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modhub-start-capture', async () => {
    try {
      await openStakeChatCapture(false);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modhub-send-chat', async (_e, { message, useGraphql, chatId, site } = {}) => {
    try {
      const text = String(message || '').trim();
      if (!text) throw new Error('empty');
      if (useGraphql && chatId) {
        const client = gqlClientForSite(site === 'eu' ? 'eu' : 'com');
        await client.sendMessage(chatId, text);
        return { ok: true, via: 'graphql' };
      }
      await sendChatMessageDom(text);
      return { ok: true, via: 'dom' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modhub-bet-lookup', async (_e, { betId } = {}) => {
    try {
      const data = await gql.getBetLookup(betId);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modhub-load-bets', async () => {
    try {
      const dataPath = dataDir();
      const disk = fileLogs.loadBetsLog(dataPath);
      betRegistry.hydrate(disk);
      return { ok: true, bets: betRegistry.list() };
    } catch (e) {
      return { ok: false, error: e.message, bets: [] };
    }
  });

  ipcMain.handle('modhub-track-bet', async (_e, payload = {}) => {
    try {
      return await betRegistry.track(payload, sendBetRecord);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modhub-refresh-bet', async (_e, { betId } = {}) => {
    try {
      return await betRegistry.refresh(betId, sendBetRecord);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modhub-clear-bets', async () => {
    betRegistry.clear();
    return { ok: true };
  });

  ipcMain.handle('modhub-user-validate', async (_e, { name, site } = {}) => {
    try {
      const { normalizeUsername } = require('./lib/username');
      const queryName = normalizeUsername(name);
      if (!queryName) return { ok: false, error: 'username_required' };
      const client = gqlClientForSite(site === 'eu' ? 'eu' : 'com');
      let data = await client.getUserDetails(queryName);
      if (!data?.user?.id) {
        const fallback = await client.getUserHash(queryName);
        if (fallback?.user?.id) data = fallback;
      }
      if (!data?.user?.id) {
        return { ok: false, error: 'user_not_found', data: data || null };
      }
      return { ok: true, data, site: site === 'eu' ? 'eu' : 'com' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modhub-mute', async (_e, { userId, expire, message, site } = {}) => {
    try {
      const client = gqlClientForSite(site === 'eu' ? 'eu' : 'com');
      const data = await client.muteUser(userId, expire, message);
      if (data?.muteUser?.name) {
        fileLogs.appendMuted(dataDir(), data.muteUser.name, message || '', expire || '');
      }
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modhub-unmute', async (_e, { userId, site } = {}) => {
    try {
      const client = gqlClientForSite(site === 'eu' ? 'eu' : 'com');
      const data = await client.unmuteUser(userId);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modhub-user-hash', async (_e, { name, site } = {}) => {
    try {
      const client = gqlClientForSite(site === 'eu' ? 'eu' : 'com');
      const data = await client.getUserHash(name);
      const u = data?.user;
      if (u?.name && u?.hashedIp) {
        const dir = dataDir();
        fileLogs.appendHashIp(dir, u.name, u.hashedIp);
        dataFiles.appendCheckedUserToday(dir, u.name);
        autoHashQueue.reloadCheckedToday();
      }
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modhub-tip-history', async (_e, { name, site } = {}) => {
    try {
      const client = gqlClientForSite(site === 'eu' ? 'eu' : 'com');
      return { ok: true, data: await client.getUserTipHistory(name) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modhub-chat-history', async (_e, { name, maxItems, site } = {}) => {
    try {
      const client = gqlClientForSite(site === 'eu' ? 'eu' : 'com');
      const data = await client.getUserChatHistoryAll(name, { maxItems: maxItems || 200 });
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modhub-mute-history', async (_e, { name, site } = {}) => {
    try {
      const client = gqlClientForSite(site === 'eu' ? 'eu' : 'com');
      return { ok: true, data: await client.getCommunityUser(name) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modhub-append-log', async (_e, { line } = {}) => {
    const s = loadSettings();
    fileLogs.appendSessionTxt(dataDir(), line);
    return { ok: true };
  });

  ipcMain.handle('modhub-get-conv-rates', async () => {
    try {
      if (!loggedInModUser) return { ok: false, error: 'not_logged_in', rates: convRates };
      convRates = await gql.getCurrencyConversionRates();
      chatWs.setConvRates(convRates);
      return { ok: true, rates: convRates };
    } catch (e) {
      return { ok: false, error: e.message, rates: convRates };
    }
  });

  ipcMain.handle('modhub-toggle-browser', async (_e, { visible } = {}) => {
    try {
      if (!stakeChatCaptureWin || stakeChatCaptureWin.isDestroyed()) {
        await openStakeChatCapture(!!visible);
      } else if (visible) {
        stakeChatCaptureWin.show();
        stakeChatCaptureWin.setSkipTaskbar(false);
        stakeChatCaptureWin.focus();
      } else {
        stakeChatCaptureWin.hide();
        stakeChatCaptureWin.setSkipTaskbar(true);
      }
      return { ok: true, visible: !!(visible && stakeChatCaptureWin && !stakeChatCaptureWin.isDestroyed()) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modhub-load-blueprints', async () => {
    const s = loadSettings();
    const bundled = readBundledBlueprints();
    const dataPath = dataDir();
    seedBlueprintDefaults(dataPath);
    const bp = dataFiles.loadBlueprints(dataPath, bundled);
    return { ok: true, dataPath, bundledOk: bundledAvailable(), ...bp };
  });

  ipcMain.handle('modhub-append-blueprint', async (_e, { type, line } = {}) => {
    const text = String(line || '').trim();
    if (!text) return { ok: false, error: 'empty_line' };
    const dataPath = dataDir();
    const bundled = readBundledBlueprints();
    const fn =
      type === 'mute'
        ? 'MuteBlueprints.txt'
        : type === 'warn'
          ? 'WarnBlueprints.txt'
          : type === 'rh'
            ? 'RhBlueprints.txt'
            : 'ChatBlueprints.txt';
    const key = type === 'mute' ? 'mute' : type === 'warn' ? 'warn' : type === 'rh' ? 'rh' : 'chat';
    dataFiles.seedBlueprintFileIfEmpty(dataPath, fn, bundled[key]);
    const existing = dataFiles.readLinesFile(dataPath, fn);
    if (!existing.includes(text)) {
      dataFiles.appendLineFile(dataPath, fn, text);
    }
    return { ok: true, ...dataFiles.loadBlueprints(dataPath, bundled) };
  });

  ipcMain.handle('modhub-load-veri2', async () => {
    return { ok: true, users: dataFiles.loadVeri2(dataDir()) };
  });

  ipcMain.handle('modhub-add-veri2', async (_e, { username } = {}) => {
    const dir = dataDir();
    dataFiles.addVeri2User(dir, username);
    return { ok: true, users: dataFiles.loadVeri2(dir) };
  });

  ipcMain.handle('modhub-load-muted-warned', async () => {
    return { ok: true, ...dataFiles.loadMutedWarned(dataDir()) };
  });

  ipcMain.handle('modhub-duplicate-ips', async () => {
    const dir = dataDir();
    const veri2 = new Set(dataFiles.loadVeri2(dir));
    const groups = dataFiles.findDuplicateIps(dir).map((g) => ({
      ...g,
      users: g.users.map((u) => ({ name: u, veri2: veri2.has(u.toLowerCase()) }))
    }));
    return { ok: true, groups };
  });

  registerAnalyseIpc(ipcMain, {
    getDataDir: dataDir,
    analyseEngine
  });

  ipcMain.handle('modhub-warn-user', async (_e, { username, message, site } = {}) => {
    try {
      const siteKey = site === 'eu' ? 'eu' : 'com';
      const s = settingsForSite(siteKey);
      const client = gqlClientForSite(siteKey);
      const { prependUserMention, normalizeUsername } = require('./lib/username');
      const user = normalizeUsername(username);
      const msg = String(message || '').trim();
      if (!user) return { ok: false, error: 'username_required' };
      if (!msg) return { ok: false, error: 'message_required' };
      const room = s.prefChatroom || 'German';
      const chatId = resolveChatId(room, siteKey);
      const text = prependUserMention(msg, user);
      await client.sendMessage(chatId, text);
      fileLogs.appendWarned(dataDir(), user, text);
      fileLogs.flushAll();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.on('modhub-stake-captured-messages', (_event, batch) => {
    if (!shouldUseInjectFallback()) return;
    const s = loadSettings();
    if (s.logHash) {
      for (const m of batch) {
        if (m.kind === 'text' && m.username) autoHashQueue.enqueue(m.username);
      }
    }
    processAutomuteBatch(batch, 'com');
    broadcastLiveBatch(batch, 'browser');
  });

  ipcMain.on('modhub-stake-debug', (_event, payload) => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('modhub-live-debug', payload || {});
    }
  });

  ipcMain.handle('modhub-check-updates', () => checkForUpdatesManual());
  ipcMain.handle('modhub-start-download', () => startUpdateDownload());
  ipcMain.handle('modhub-quit-and-install', () => quitAndInstallUpdate());
  ipcMain.handle('modhub-hide-to-tray', () => {
    hideMainWindowToTray();
    return { ok: true };
  });

  ipcMain.handle('modhub-window-minimize', () => {
    const win = BrowserWindow.getFocusedWindow() || mainWin;
    win?.minimize();
    return { ok: true };
  });
  ipcMain.handle('modhub-window-maximize', () => {
    const win = BrowserWindow.getFocusedWindow() || mainWin;
    if (!win || win.isDestroyed()) return { ok: false, maximized: false };
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return { ok: true, maximized: win.isMaximized() };
  });
  ipcMain.handle('modhub-window-close', () => {
    const win = BrowserWindow.getFocusedWindow() || mainWin;
    win?.close();
    return { ok: true };
  });
  ipcMain.handle('modhub-window-is-maximized', () => {
    const win = BrowserWindow.getFocusedWindow() || mainWin;
    return { ok: true, maximized: !!(win && !win.isDestroyed() && win.isMaximized()) };
  });
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.stake.modhub');
    Menu.setApplicationMenu(null);
  } else if (process.platform === 'linux') {
    Menu.setApplicationMenu(null);
  }
  const appIcon = loadAppIcon();
  if (appIcon && process.platform === 'darwin') {
    app.dock.setIcon(appIcon);
  }
  registerIpc();
  initDataStorage();
  await refreshCookies();
  createMainWindow();
  if (mainWin) initAutoUpdate(mainWin);
});

app.on('second-instance', () => {
  showMainWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  fileLogs.flushAll();
  teardownBackground();
  destroyTray();
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  app.quit();
});
