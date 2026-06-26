/**
 * Analyse-IPC — synchron im Main-Prozess mit Fortschritts-Events (zuverlässiger als Worker in Electron).
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ getDataDir: () => string, analyseEngine: { runAnalyse: Function, listChatLogFiles: Function } }} deps
 */
function registerAnalyseIpc(ipcMain, { getDataDir, analyseEngine }) {
  let runSeq = 0;

  ipcMain.handle('modhub-analyse-run', async (event, options = {}) => {
    const sender = event.sender;
    const dir = getDataDir();
    const mySeq = ++runSeq;

    const sendProgress = (payload) => {
      if (mySeq !== runSeq) return;
      if (!sender.isDestroyed()) {
        sender.send('modhub-analyse-progress', payload);
      }
    };

    sendProgress({ phase: 'init', percent: 2, detail: 'Start…' });

    return new Promise((resolve) => {
      setImmediate(() => {
        if (mySeq !== runSeq) {
          resolve({ ok: false, aborted: true, error: 'aborted' });
          return;
        }
        try {
          const result = analyseEngine.runAnalyse(dir, {
            ...(options || {}),
            onProgress: (p) => sendProgress(p)
          });
          resolve(result);
        } catch (err) {
          resolve({ ok: false, error: err.message || String(err) });
        }
      });
    });
  });

  ipcMain.handle('modhub-analyse-list-files', async () => {
    try {
      const files = analyseEngine.listChatLogFiles(getDataDir());
      return { ok: true, files: files.map((f) => ({ basename: f.basename, dateKey: f.dateKey })) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

module.exports = { registerAnalyseIpc };
