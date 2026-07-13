const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { normalizeForAutomute } = require('../lib/automute-normalize');
const { migrateAutoMuteRules } = require('../lib/automute-defaults');
const { ruleMatches, minutesToExpireString } = require('../lib/automute-engine');
const dataFiles = require('../lib/data-files');

describe('automute normalize', () => {
  it('foldet Unicode-Bold zu ASCII', () => {
    const norm = normalizeForAutomute('𝗕𝗨𝗬𝗜𝗡𝗚 𝗦𝗧𝗔𝗞𝗘 𝗔𝗖𝗖𝗢𝗨𝗡𝗧𝗦');
    assert.ok(norm.includes('buying'));
    assert.ok(norm.includes('stake'));
    assert.ok(norm.includes('accounts'));
  });
});

describe('automute rules', () => {
  const rules = migrateAutoMuteRules({});
  const rule = rules[0];

  it('liefert Default-Regel für Account-Spam', () => {
    assert.equal(rule.id, 'account-spam-default');
    assert.ok(rule.patterns.includes('amibo121'));
    assert.equal(rule.enabled, false);
    assert.equal(rule.notifyEnabled, true);
    assert.equal(rule.notifySound, '5');
  });

  it('matcht typischen Verkaufs-Spam (wenn Regel aktiv)', () => {
    const active = { ...rule, enabled: true };
    const msg =
      '𝗛𝗘𝗬 𝗚𝗨𝗬𝗦, 𝗕𝗨𝗬𝗜𝗡𝗚 𝗦𝗧𝗔𝗞𝗘 𝗔𝗖𝗖𝗢𝗨𝗡𝗧𝗦 𝗪𝗧𝗛 𝗚𝗢𝗢𝗗 𝗪𝗔𝗚𝗘𝗥 𝗔𝗡𝗗 𝗖𝗟𝗢𝗦𝗘 𝗧𝗢 𝗡𝗘𝗫𝗧 𝗩𝗜𝗣, 𝗔𝗗𝗗 𝗢𝗡 𝗗𝗜𝗦𝗖𝗢𝗥𝗗 amibo121';
    assert.equal(ruleMatches(active, msg), true);
  });

  it('matcht nicht wenn Regel deaktiviert', () => {
    const msg =
      '𝗕𝗨𝗬𝗜𝗡𝗚 𝗦𝗧𝗔𝗞𝗘 𝗔𝗖𝗖𝗢𝗨𝗡𝗧𝗦 add on discord amibo121 extra text here';
    assert.equal(ruleMatches(rule, msg), false);
  });

  it('matcht nicht kurze harmlose Nachrichten', () => {
    assert.equal(ruleMatches(rule, 'hey discord'), false);
  });
});

describe('automute duration', () => {
  it('formatiert Minuten für Mute-API', () => {
    assert.equal(minutesToExpireString(10), '10 minutes');
    assert.equal(minutesToExpireString(60), '1 hour');
    assert.equal(minutesToExpireString(1440), '1 day');
  });
});

describe('automute strikes', () => {
  it('zählt Strikes pro Regel+User', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automute-'));
    const key = 'account-spam-default|spammer123';
    assert.equal(dataFiles.incrementAutomuteStrike(dir, key), 1);
    assert.equal(dataFiles.incrementAutomuteStrike(dir, key), 2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('automute preview', () => {
  it('berechnet Strike-Vorschau (aktive Regel)', () => {
    const rules = migrateAutoMuteRules({}).map((r) => ({ ...r, enabled: true }));
    const msg =
      '𝗕𝗨𝗬𝗜𝗡𝗚 𝗦𝗧𝗔𝗞𝗘 𝗔𝗖𝗖𝗢𝗨𝗡𝗧𝗦 add on discord amibo121 extra text here';
    const { previewAutomute } = require('../lib/automute-engine');
    const r = previewAutomute(msg, rules, { username: 'spammer', strikes: {} });
    assert.equal(r.match, true);
    assert.equal(r.strike, 1);
    assert.equal(r.durationMinutes, 10);
  });
});
