const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

let mainWindow = null;

function sendStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('modhub-update-status', payload);
  }
}

function initAutoUpdate(win) {
  if (!app.isPackaged) return null;
  mainWindow = win;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendStatus({ state: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    sendStatus({ state: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', (info) => {
    sendStatus({ state: 'none', version: info?.version });
  });
  autoUpdater.on('download-progress', (p) => {
    sendStatus({
      state: 'downloading',
      percent: Math.round(p.percent || 0)
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({ state: 'ready', version: info.version });
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update bereit',
        message: `Stake Mod Hub ${info.version} wurde heruntergeladen.`,
        detail: 'Die App wird beim nächsten Start aktualisiert — oder jetzt neu starten.',
        buttons: ['Jetzt neu starten', 'Später'],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall(false, true);
      });
  });
  autoUpdater.on('error', (err) => {
    sendStatus({ state: 'error', message: String(err?.message || err) });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }, 8000);

  return autoUpdater;
}

async function checkForUpdatesManual() {
  if (!app.isPackaged) {
    return { ok: false, error: 'dev_mode' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, updateInfo: result?.updateInfo || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { initAutoUpdate, checkForUpdatesManual };
