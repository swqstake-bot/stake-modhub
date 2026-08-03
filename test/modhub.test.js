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

  it('schreibt Chat/Rain/Bets getrennt für com und eu', () => {
    const {
      chatLogFilename,
      rainLogFilename,
      betsLogFilename,
      logLiveMessage,
      appendBetLog,
      listBetsLogFiles
    } = require('../lib/file-logs');
    const { parseFilenameDayKey, listChatLogFiles } = require('../lib/analyse/load-chat-logs');

    assert.match(chatLogFilename('com'), /Chat_de\.csv$/);
    assert.match(chatLogFilename('eu'), /Chat_eu\.csv$/);
    assert.match(rainLogFilename('com'), /Rain_de\.csv$/);
    assert.match(rainLogFilename('eu'), /Rain_eu\.csv$/);
    assert.match(betsLogFilename('com'), /Bets_de\.csv$/);
    assert.match(betsLogFilename('eu'), /Bets_eu\.csv$/);

    const de = parseFilenameDayKey('382026Chat_de.csv');
    const eu = parseFilenameDayKey('382026Chat_eu.csv');
    assert.equal(de?.site, 'com');
    assert.equal(eu?.site, 'eu');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-site-logs-'));
    logLiveMessage(dir, { username: 'alice', message: 'hi com', kind: 'text' }, 'com');
    logLiveMessage(dir, { username: 'bob', message: 'hi eu', kind: 'text' }, 'eu');
    logLiveMessage(dir, { username: 'rain', kind: 'rain', rain: { giver: 'rain', amount: 1 } }, 'eu');
    appendBetLog(dir, {
      betId: 'eu-bet-1',
      username: 'bob',
      game: 'Dice',
      multiplier: 2,
      lookupOk: true,
      site: 'eu',
      firstSeenAt: Date.now()
    });
    flushAll();

    const chats = listChatLogFiles(dir);
    assert.ok(chats.some((f) => f.site === 'com'));
    assert.ok(chats.some((f) => f.site === 'eu'));
    assert.ok(fs.existsSync(path.join(dir, chatLogFilename('com'))));
    assert.ok(fs.existsSync(path.join(dir, chatLogFilename('eu'))));
    assert.ok(fs.existsSync(path.join(dir, rainLogFilename('eu'))));
    assert.ok(listBetsLogFiles(dir).some((f) => /Bets_eu\.csv$/i.test(f)));

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

describe('live-flag', () => {
  const { scoreLiveMessage } = require('../lib/analyse/live-flag');

  it('erkennt Toxic und Bettel live', () => {
    const toxic = scoreLiveMessage({ username: 'baduser', message: 'du hurensohn', kind: 'text' });
    assert.ok(toxic);
    assert.equal(toxic.primary, 'Toxic');

    const beg = scoreLiveMessage({ username: 'beggar', message: 'bitte rain jemand tip', kind: 'text' });
    assert.ok(beg);
    assert.equal(beg.primary, 'Bettel');
  });

  it('ignoriert rain-bot und Mod-User', () => {
    assert.equal(scoreLiveMessage({ username: 'rain-bot', message: 'test', kind: 'text' }), null);
    assert.equal(
      scoreLiveMessage({ username: 'mod', message: 'du idiot', kind: 'text', isModUser: true }),
      null
    );
  });

  it('markiert Wiederholung bei lokal gemuteten Usern', () => {
    const hit = scoreLiveMessage({
      username: 'repeat',
      message: 'hallo wieder',
      kind: 'text',
      mutedLocal: true
    });
    assert.ok(hit);
    assert.ok(hit.tags.includes('Repeat'));
  });

  it('erkennt GZ-Spam über rolling window', () => {
    const hit = scoreLiveMessage({
      username: 'gzspammer',
      message: 'gz',
      kind: 'text',
      recentTexts: ['gz', 'gg', 'gz', 'gz', 'gz']
    });
    assert.ok(hit);
    assert.ok(hit.tags.includes('GZ-Spam'));
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
