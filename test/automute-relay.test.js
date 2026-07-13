const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeAutomuteExecutor, automutePresenceFromSettings } = require('../modchat-relay/automute-coord');

describe('automute relay hierarchy', () => {
  const hierarchy = ['swaqline', 'kartenstapel', 'droz', 'wheelyboy321'];

  it('wählt höchsten Online-Mod mit Live-Automute', () => {
    const mods = new Map([
      ['droz', { automuteEnabled: true, automuteLive: true }],
      ['swaqline', { automuteEnabled: true, automuteLive: true }]
    ]);
    assert.equal(computeAutomuteExecutor(hierarchy, mods), 'swaqline');
  });

  it('überspringt Dry-Run und deaktivierte Mods', () => {
    const mods = new Map([
      ['swaqline', { automuteEnabled: true, automuteLive: false }],
      ['kartenstapel', { automuteEnabled: false, automuteLive: false }],
      ['droz', { automuteEnabled: true, automuteLive: true }]
    ]);
    assert.equal(computeAutomuteExecutor(hierarchy, mods), 'droz');
  });

  it('liefert null wenn niemand Live-Automute hat', () => {
    const mods = new Map([['swaqline', { automuteEnabled: true, automuteLive: false }]]);
    assert.equal(computeAutomuteExecutor(hierarchy, mods), null);
  });

  it('leitet Presence aus Settings ab', () => {
    assert.deepEqual(automutePresenceFromSettings({ automuteEnabled: true, automuteDryRun: true }), {
      automuteEnabled: true,
      automuteLive: false
    });
    assert.deepEqual(automutePresenceFromSettings({ automuteEnabled: true, automuteDryRun: false }), {
      automuteEnabled: true,
      automuteLive: true
    });
  });
});
