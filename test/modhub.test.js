const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractBetIds, isPlausibleBetId, normalizeBetIdForLookup } = require('../lib/bet-id-parse');
const { loadBetsLog, listBetsLogFiles, flushAll } = require('../lib/file-logs');

describe('bet-id-parse', () => {
  it('erkennt UUID-Bet-IDs', () => {
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    assert.equal(isPlausibleBetId(id), true);
    assert.equal(normalizeBetIdForLookup(id), `casino:${id}`);
  });

  it('extrahiert house:-IDs aus Chat', () => {
    const ids = extractBetIds('schau mal house:123456789012');
    assert.ok(ids.some((x) => x.includes('123456789012')));
  });
});

describe('file-logs loadBetsLog', () => {
  it('lädt und merged mehrere Tages-CSVs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-bets-'));
    const header =
      'Timestamp;BetId;User;Game;Multiplier;Amount;Currency;Payout;Status;ChatMessage';
  const day1 = `01.01.2026, 10:00:00;old-bet-111111111111;UserA;Dice;2;1;btc;2;ok;hi`;
  const day2 = `02.01.2026, 11:00:00;new-bet-222222222222;UserB;Plinko;5;2;eth;10;ok;yo`;
  const dup = `02.01.2026, 12:00:00;old-bet-111111111111;UserA;Dice;2;1;btc;2;ok;again`;

    fs.writeFileSync(path.join(dir, '112026Bets_de.csv'), `${header}\n${day1}\n`, 'utf8');
    fs.writeFileSync(path.join(dir, '212026Bets_de.csv'), `${header}\n${day2}\n${dup}\n`, 'utf8');

    const files = listBetsLogFiles(dir);
    assert.equal(files.length, 2);

    const bets = loadBetsLog(dir, 100);
    assert.equal(bets.length, 2);
    const old = bets.find((b) => b.betId === 'old-bet-111111111111');
    const neu = bets.find((b) => b.betId === 'new-bet-222222222222');
    assert.ok(old);
    assert.ok(neu);
    assert.equal(old.seenCount, 2);

    flushAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('gz-spam ratio', () => {
  const { scoreGzSpamComponent } = require('../lib/analyse/low-quality-spam');

  it('ignoriert hohes gz× bei niedrigem GZ-Anteil', () => {
    const casual = scoreGzSpamComponent({ gzBustRatio: 0.013, maxGzSame: 9, gzLines: 10 });
    const spammer = scoreGzSpamComponent({ gzBustRatio: 0.28, maxGzSame: 8, gzLines: 40 });
    assert.equal(casual, 0);
    assert.ok(spammer >= 14);
  });
});

describe('sample-messages', () => {
  const { pickSampleMessages } = require('../lib/analyse/sample-messages');

  it('priorisiert auffällige Nachrichten vor Kontext', () => {
    const msgs = [
      { timestamp: 1000, message: 'hallo wie gehts' },
      { timestamp: 2000, message: 'gz' },
      { timestamp: 3000, message: 'du hurensohn' },
      { timestamp: 4000, message: 'normaler chat' }
    ];
    const out = pickSampleMessages(msgs, { enforcementTier: 'toxic' });
    const toxic = out.find((m) => m.message.includes('hurensohn'));
    assert.ok(toxic);
    assert.equal(toxic.reason, 'Toxic');
  });
});
