/**
 * Analyse-IPC — synchron im Main-Prozess mit Fortschritts-Events (zuverlässiger als Worker in Electron).
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ getDataDir: (site?: string) => string, analyseEngine: { runAnalyse: Function, listChatLogFiles: Function } }} deps
 */
function registerAnalyseIpc(ipcMain, { getDataDir, analyseEngine }) {
  let runSeq = 0;

  function resolveSite(options = {}) {
    return options.site === 'eu' ? 'eu' : 'com';
  }

  ipcMain.handle('modhub-analyse-run', async (event, options = {}) => {
    const sender = event.sender;
    const site = resolveSite(options);
    const dir = getDataDir(site);
    const mySeq = ++runSeq;

    const sendProgress = (payload) => {
      if (mySeq !== runSeq) return;
      if (!sender.isDestroyed()) {
        sender.send('modhub-analyse-progress', payload);
      }
    };

    sendProgress({ phase: 'init', percent: 2, detail: `Start (${site === 'eu' ? 'stake.eu' : 'stake.com'})…` });

    return new Promise((resolve) => {
      setImmediate(() => {
        if (mySeq !== runSeq) {
          resolve({ ok: false, aborted: true, error: 'aborted' });
          return;
        }
        try {
          const result = analyseEngine.runAnalyse(dir, {
            ...(options || {}),
            site,
            onProgress: (p) => sendProgress(p)
          });
          if (result && typeof result === 'object') result.site = site;
          resolve(result);
        } catch (err) {
          resolve({ ok: false, error: err.message || String(err), site });
        }
      });
    });
  });

  ipcMain.handle('modhub-analyse-list-files', async (_e, options = {}) => {
    try {
      const site = resolveSite(options);
      const files = analyseEngine.listChatLogFiles(getDataDir(site));
      return {
        ok: true,
        site,
        files: files.map((f) => ({ basename: f.basename, dateKey: f.dateKey, site: f.site }))
      };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

module.exports = { registerAnalyseIpc };
