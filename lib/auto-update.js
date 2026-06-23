const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

const UPDATER_GITHUB = { owner: 'swqstake-bot', repo: 'stake-modhub' };

let mainWindow = null;
let updateCheckTimer = null;
const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;

function sendStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('modhub-update-status', payload);
  }
}

function configureGithubAutoUpdater() {
  if (!app.isPackaged) return;
  try {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: UPDATER_GITHUB.owner,
      repo: UPDATER_GITHUB.repo,
      releaseType: 'release'
    });
  } catch (_) {
    /* feed from package.json publish config */
  }
}

function wireAutoUpdaterEvents() {
  autoUpdater.on('checking-for-update', () => {
    sendStatus({ state: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    sendStatus({ state: 'available', version: info?.version, info });
  });
  autoUpdater.on('update-not-available', (info) => {
    sendStatus({ state: 'none', version: info?.version });
  });
  autoUpdater.on('download-progress', (p) => {
    sendStatus({
      state: 'downloading',
      percent: Math.round(p?.percent || 0),
      transferred: p?.transferred,
      total: p?.total
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({ state: 'ready', version: info?.version, info });
    if (!mainWindow || mainWindow.isDestroyed()) return;
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update bereit',
        message: `Stake Mod Hub ${info?.version || ''} wurde heruntergeladen.`,
        detail: 'Jetzt neu starten, um die neue Version zu installieren.',
        buttons: ['Jetzt neu starten', 'Später'],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall(false, true);
      })
      .catch(() => {});
  });
  autoUpdater.on('error', (err) => {
    sendStatus({ state: 'error', message: String(err?.message || err) });
  });
}

function scheduleUpdateChecks() {
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  if (!app.isPackaged) return;
  const run = () => {
    checkForUpdatesManual().catch(() => {});
  };
  setTimeout(run, 8000);
  updateCheckTimer = setInterval(run, UPDATE_CHECK_MS);
}

function initAutoUpdate(win) {
  if (!app.isPackaged) return null;
  mainWindow = win;
  configureGithubAutoUpdater();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  wireAutoUpdaterEvents();
  scheduleUpdateChecks();
  return autoUpdater;
}

function disposeAutoUpdate() {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
}

async function checkForUpdatesManual() {
  if (!app.isPackaged) {
    return { ok: false, error: 'dev_mode' };
  }
  configureGithubAutoUpdater();
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, updateInfo: result?.updateInfo || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function startUpdateDownload() {
  if (!app.isPackaged) return { ok: false, error: 'dev_mode' };
  configureGithubAutoUpdater();
  try {
    autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function quitAndInstallUpdate() {
  if (!app.isPackaged) return { ok: false, error: 'dev_mode' };
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
}

module.exports = {
  initAutoUpdate,
  disposeAutoUpdate,
  checkForUpdatesManual,
  startUpdateDownload,
  quitAndInstallUpdate
};
