const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { normalizeForAutomute } = require('../lib/automute-normalize');
const { migrateAutoMuteRules } = require('../lib/automute-defaults');
const { pickMutePeriod, formatChatNotifyText } = require('../lib/automute-periods');
const { ruleMatches, previewAutomute } = require('../lib/automute-engine');
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
    assert.equal(rule.matchAll, true);
    assert.deepEqual(rule.patterns, ['buying stake', 'discord']);
    assert.deepEqual(rule.mutePeriods, ['10 minutes', '1 hour', '1 day', '1 week']);
    assert.equal(rule.notifyEnabled, true);
    assert.equal(rule.notifySound, '5');
  });

  it('matcht typischen Verkaufs-Spam (wenn Regel aktiv)', () => {
    const active = { ...rule, enabled: true };
    const msg =
      '𝗛𝗘𝗬 𝗚𝗨𝗬𝗦, 𝗕𝗨𝗬𝗜𝗡𝗚 𝗦𝗧𝗔𝗞𝗘 𝗔𝗖𝗖𝗢𝗨𝗡𝗧𝗦 𝗪𝗧𝗛 𝗚𝗢𝗢𝗗 𝗪𝗔𝗚𝗘𝗥 𝗔𝗡𝗗 𝗖𝗟𝗢𝗦𝗘 𝗧𝗢 𝗡𝗘𝗫𝗧 𝗩𝗜𝗣, 𝗔𝗗𝗗 𝗢𝗡 𝗗𝗜𝗦𝗖𝗢𝗥𝗗 amibo121';
    assert.equal(ruleMatches(active, msg), true);
  });

  it('matchAll: discord-Name nach discord ist erlaubt', () => {
    const active = {
      enabled: true,
      matchAll: true,
      patterns: ['buying stake', 'discord'],
      minLength: 20
    };
    const msg =
      '𝗕𝗨𝗬𝗜𝗡𝗚 𝗦𝗧𝗔𝗞𝗘 𝗔𝗖𝗖𝗢𝗨𝗡𝗧𝗦 add on discord scammername123';
    assert.equal(ruleMatches(active, msg), true);
  });

  it('matchAll: nur discord ohne buying stake matcht nicht', () => {
    const active = {
      enabled: true,
      matchAll: true,
      patterns: ['buying stake', 'discord'],
      minLength: 20
    };
    assert.equal(ruleMatches(active, 'hey guys join my discord server please'), false);
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

describe('automute periods', () => {
  const rule = migrateAutoMuteRules({})[0];

  it('nutzt Stake-Mute-Zeiten pro Strike', () => {
    assert.equal(pickMutePeriod(rule, 1), '10 minutes');
    assert.equal(pickMutePeriod(rule, 2), '1 hour');
    assert.equal(pickMutePeriod(rule, 4), '1 week');
  });

  it('ersetzt @user im Chat-Text', () => {
    assert.equal(
      formatChatNotifyText('@user Muted - Spam', 'spammer123'),
      '@spammer123 Muted - Spam'
    );
  });

  it('kennt 3 months als Stake-Option', () => {
    const { MUTE_PERIODS } = require('../lib/automute-periods');
    assert.ok(MUTE_PERIODS.includes('3 months'));
    assert.ok(MUTE_PERIODS.includes('2 months'));
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

describe('automute log merge', () => {
  it('dedupliziert RAM- und CSV-Eintrag derselben Aktion', () => {
    const preview = 'HEY GUYS, BUYING STAKE ACCOUNTS';
    const at = new Date(2026, 6, 13, 15, 55, 42).getTime();
    const mem = [
      {
        at,
        username: 'Roshan0809',
        ruleLabel: 'Account-Verkauf / Discord Spam',
        strike: 1,
        preview,
        ok: true
      }
    ];
    const disk = [
      {
        at: new Date(2026, 6, 13, 15, 55, 0).getTime(),
        username: 'Roshan0809',
        ruleLabel: 'Account-Verkauf / Discord Spam',
        strike: 1,
        preview,
        ok: true
      }
    ];
    const merged = dataFiles.mergeAutomuteLogEntries(mem, disk, 25);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].username, 'Roshan0809');
  });
});

describe('automute preview', () => {
  it('berechnet Strike-Vorschau (aktive Regel)', () => {
    const rules = migrateAutoMuteRules({}).map((r) => ({ ...r, enabled: true }));
    const msg =
      '𝗕𝗨𝗬𝗜𝗡𝗚 𝗦𝗧𝗔𝗞𝗘 𝗔𝗖𝗖𝗢𝗨𝗡𝗧𝗦 add on discord amibo121 extra text here';
    const r = previewAutomute(msg, rules, { username: 'spammer', strikes: {} });
    assert.equal(r.match, true);
    assert.equal(r.strike, 1);
    assert.equal(r.expire, '10 minutes');
  });
});
