const { contextBridge, ipcRenderer } = require('electron');

let version = '0.4.78';
try {
  version = ipcRenderer.sendSync('modhub-get-version') || version;
} catch (_) {}

contextBridge.exposeInMainWorld('modHub', {
  version,
  getSettings: () => ipcRenderer.invoke('modhub-settings-get'),
  saveSettings: (s) => ipcRenderer.invoke('modhub-settings-set', s || {}),
  pickDataPath: () => ipcRenderer.invoke('modhub-pick-data-path'),
  login: (payload) => ipcRenderer.invoke('modhub-login', payload || {}),
  stakeLogin: (payload) => ipcRenderer.invoke('modhub-stake-login', payload || {}),
  graphqlLogin: (payload) => ipcRenderer.invoke('modhub-graphql-login', payload || {}),
  startCapture: () => ipcRenderer.invoke('modhub-start-capture'),
  toggleBrowser: (visible) => ipcRenderer.invoke('modhub-toggle-browser', { visible }),
  getConvRates: () => ipcRenderer.invoke('modhub-get-conv-rates'),
  sendChat: (payload) => ipcRenderer.invoke('modhub-send-chat', payload || {}),
  betLookup: (betId, opts) => ipcRenderer.invoke('modhub-bet-lookup', { betId, ...(opts || {}) }),
  loadBets: (opts) => ipcRenderer.invoke('modhub-load-bets', opts || {}),
  trackBet: (payload) => ipcRenderer.invoke('modhub-track-bet', payload || {}),
  refreshBet: (betId, opts) => ipcRenderer.invoke('modhub-refresh-bet', { betId, ...(opts || {}) }),
  clearBets: (opts) => ipcRenderer.invoke('modhub-clear-bets', opts || {}),
  validateUser: (name, opts) => ipcRenderer.invoke('modhub-user-validate', { name, ...(opts || {}) }),
  muteUser: (payload) => ipcRenderer.invoke('modhub-mute', payload || {}),
  unmuteUser: (payload) => ipcRenderer.invoke('modhub-unmute', payload || {}),
  warnUser: (payload) => ipcRenderer.invoke('modhub-warn-user', payload || {}),
  userHash: (name, opts) => ipcRenderer.invoke('modhub-user-hash', { name, ...(opts || {}) }),
  tipHistory: (name, opts) => ipcRenderer.invoke('modhub-tip-history', { name, ...(opts || {}) }),
  chatHistory: (name, opts) => ipcRenderer.invoke('modhub-chat-history', { name, ...(opts || {}) }),
  muteHistory: (name, opts) => ipcRenderer.invoke('modhub-mute-history', { name, ...(opts || {}) }),
  appendLog: (line, opts) => ipcRenderer.invoke('modhub-append-log', { line, ...(opts || {}) }),
  loadBlueprints: (opts) => ipcRenderer.invoke('modhub-load-blueprints', opts || {}),
  seedBlueprints: (opts) => ipcRenderer.invoke('modhub-seed-blueprints', opts || {}),
  appendBlueprint: (payload) => ipcRenderer.invoke('modhub-append-blueprint', payload || {}),
  loadVeri2: (opts) => ipcRenderer.invoke('modhub-load-veri2', opts || {}),
  addVeri2: (username, opts) => ipcRenderer.invoke('modhub-add-veri2', { username, ...(opts || {}) }),
  loadMutedWarned: (opts) => ipcRenderer.invoke('modhub-load-muted-warned', opts || {}),
  duplicateIps: (opts) => ipcRenderer.invoke('modhub-duplicate-ips', opts || {}),
  automuteStatus: () => ipcRenderer.invoke('modhub-automute-status'),
  automuteLog: (limit, opts) => ipcRenderer.invoke('modhub-automute-log', { limit, ...(opts || {}) }),
  automuteTest: (payload) => ipcRenderer.invoke('modhub-automute-test', payload || {}),
  notifySoundsList: () => ipcRenderer.invoke('modhub-notify-sounds-list'),
  notifySoundImport: () => ipcRenderer.invoke('modhub-notify-sound-import'),
  notifySoundDelete: (id) => ipcRenderer.invoke('modhub-notify-sound-delete', { id }),
  notifySoundData: (id) => ipcRenderer.invoke('modhub-notify-sound-data', { id }),
  scoreLiveMessage: (input) => ipcRenderer.sendSync('modhub-live-flag', input || {}),
  analyseRun: (opts) => ipcRenderer.invoke('modhub-analyse-run', opts || {}),
  analyseListFiles: (opts) => ipcRenderer.invoke('modhub-analyse-list-files', opts || {}),
  onAnalyseProgress: (handler) => {
    const w = (_e, p) => handler(p);
    ipcRenderer.on('modhub-analyse-progress', w);
    return () => ipcRenderer.removeListener('modhub-analyse-progress', w);
  },
  onSessionUpdated: (handler) => {
    const w = (_e, p) => handler(p);
    ipcRenderer.on('modhub-session-updated', w);
    return () => ipcRenderer.removeListener('modhub-session-updated', w);
  },
  onLiveMessages: (handler) => {
    const w = (_e, p) => handler(p);
    ipcRenderer.on('modhub-live-messages', w);
    return () => ipcRenderer.removeListener('modhub-live-messages', w);
  },
  onLiveDebug: (handler) => {
    const w = (_e, p) => handler(p);
    ipcRenderer.on('modhub-live-debug', w);
    return () => ipcRenderer.removeListener('modhub-live-debug', w);
  },
  onWsStatus: (handler) => {
    const w = (_e, p) => handler(p);
    ipcRenderer.on('modhub-ws-status', w);
    return () => ipcRenderer.removeListener('modhub-ws-status', w);
  },
  onBetRecord: (handler) => {
    const w = (_e, p) => handler(p);
    ipcRenderer.on('modhub-bet-record', w);
    return () => ipcRenderer.removeListener('modhub-bet-record', w);
  },
  onBetsLoaded: (handler) => {
    const w = (_e, p) => handler(p);
    ipcRenderer.on('modhub-bets-loaded', w);
    return () => ipcRenderer.removeListener('modhub-bets-loaded', w);
  },
  onAutomuteAction: (handler) => {
    const w = (_e, p) => handler(p);
    ipcRenderer.on('modhub-automute-action', w);
    return () => ipcRenderer.removeListener('modhub-automute-action', w);
  },
  hideToTray: () => ipcRenderer.invoke('modhub-hide-to-tray'),
  isFrameless: process.platform === 'win32' || process.platform === 'linux',
  windowMinimize: () => ipcRenderer.invoke('modhub-window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('modhub-window-maximize'),
  windowClose: () => ipcRenderer.invoke('modhub-window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('modhub-window-is-maximized'),
  checkForUpdates: () => ipcRenderer.invoke('modhub-check-updates'),
  startUpdateDownload: () => ipcRenderer.invoke('modhub-start-download'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('modhub-quit-and-install'),
  onUpdateStatus: (handler) => {
    const w = (_e, p) => handler(p);
    ipcRenderer.on('modhub-update-status', w);
    return () => ipcRenderer.removeListener('modhub-update-status', w);
  }
});
