const { parentPort } = require('worker_threads');
const { runAnalyse } = require('./index');

parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'run') return;
  try {
    const result = runAnalyse(msg.dir, {
      ...(msg.options || {}),
      onProgress: (payload) => parentPort.postMessage({ type: 'progress', ...payload })
    });
    parentPort.postMessage({ type: 'done', result });
  } catch (err) {
    parentPort.postMessage({ type: 'error', error: err.message || String(err) });
  }
});
