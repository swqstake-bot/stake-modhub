const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/history-format.js'), 'utf8'), context);
const format = context.window.HistoryFormat.formatLastRain;

test('last Rain displays the API timestamp in local German date and time', () => {
  const value = '2026-10-20T13:45:12Z';
  assert.equal(format(value), new Date(value).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }));
});

test('last Rain distinguishes no recorded Rain from missing or invalid data', () => {
  assert.equal(format(null), 'Kein Rain verzeichnet');
  for (const value of [undefined, '', ' ', 'invalid', {}, 0, false]) {
    assert.equal(format(value), 'Nicht verfügbar');
  }
});
