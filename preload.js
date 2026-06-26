const { contextBridge, ipcRenderer } = require('electron');

let version = '0.4.28';
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
  betLookup: (betId) => ipcRenderer.invoke('modhub-bet-lookup', { betId }),
  loadBets: () => ipcRenderer.invoke('modhub-load-bets'),
  trackBet: (payload) => ipcRenderer.invoke('modhub-track-bet', payload || {}),
  refreshBet: (betId) => ipcRenderer.invoke('modhub-refresh-bet', { betId }),
  clearBets: () => ipcRenderer.invoke('modhub-clear-bets'),
  validateUser: (name) => ipcRenderer.invoke('modhub-user-validate', { name }),
  muteUser: (payload) => ipcRenderer.invoke('modhub-mute', payload || {}),
  unmuteUser: (payload) => ipcRenderer.invoke('modhub-unmute', payload || {}),
  warnUser: (payload) => ipcRenderer.invoke('modhub-warn-user', payload || {}),
  userHash: (name) => ipcRenderer.invoke('modhub-user-hash', { name }),
  tipHistory: (name) => ipcRenderer.invoke('modhub-tip-history', { name }),
  chatHistory: (name) => ipcRenderer.invoke('modhub-chat-history', { name }),
  muteHistory: (name) => ipcRenderer.invoke('modhub-mute-history', { name }),
  appendLog: (line) => ipcRenderer.invoke('modhub-append-log', { line }),
  loadBlueprints: () => ipcRenderer.invoke('modhub-load-blueprints'),
  seedBlueprints: (opts) => ipcRenderer.invoke('modhub-seed-blueprints', opts || {}),
  appendBlueprint: (payload) => ipcRenderer.invoke('modhub-append-blueprint', payload || {}),
  loadVeri2: () => ipcRenderer.invoke('modhub-load-veri2'),
  addVeri2: (username) => ipcRenderer.invoke('modhub-add-veri2', { username }),
  loadMutedWarned: () => ipcRenderer.invoke('modhub-load-muted-warned'),
  duplicateIps: () => ipcRenderer.invoke('modhub-duplicate-ips'),
  analyseRun: (opts) => ipcRenderer.invoke('modhub-analyse-run', opts || {}),
  analyseListFiles: () => ipcRenderer.invoke('modhub-analyse-list-files'),
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
  hideToTray: () => ipcRenderer.invoke('modhub-hide-to-tray'),
  checkForUpdates: () => ipcRenderer.invoke('modhub-check-updates'),
  startUpdateDownload: () => ipcRenderer.invoke('modhub-start-download'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('modhub-quit-and-install'),
  onUpdateStatus: (handler) => {
    const w = (_e, p) => handler(p);
    ipcRenderer.on('modhub-update-status', w);
    return () => ipcRenderer.removeListener('modhub-update-status', w);
  }
});
