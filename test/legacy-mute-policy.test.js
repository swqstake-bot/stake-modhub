const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/mod-policy.js'), 'utf8'), context);
const P = context.window.StakeModPolicy;
const ids = (reason) => Array.from(P.detectedReasonsToCategories(reason)).sort();
const mute = (message, minutes) => ({ message, createdAt: '2026-06-01T12:00:00Z',
  expireAt: minutes === 0 ? null : new Date(Date.parse('2026-06-01T12:00:00Z') + minutes * 60000).toISOString() });

// Anonymized reason wording from the existing local notes and bundled templates.
// No account names, record dates or moderation evidence are included here.
const aliases = {
  begging: ['begging', 'Begging', 'Betteln nach Regen', 'Fragen nach Regen', 'Fragen nach RH',
    'Raintalk', 'rain talk', 'missed raintalk', 'miissed raintalk', 'Missed Rain', 'verpasster Regen Kommentar',
    'Passives Betteln im Chat', 'Passive begging', 'Passiver Slotcall im Chat', 'Loan Talk',
    'Spenden-Kommentar', 'commenting tips', 'Asking for rain', 'Nonsense Taggs', 'Nonsens Tags',
    'Tag Spamming', 'Taggspamm', 'Mention spam', 'sinnlose Tags'],
  minor_spam_caps: ['Spam', 'Spaming', 'Spamm', 'Gz Spam Warning', 'Spam Aufruf', 'Flooding',
    'Caps', 'Caps Lock', 'CAPSLOCK', 'Großschreibung', 'Chat Abuse', 'Chatabuse', 'Chat-Missbrauch'],
  low_quality: ['low Qualität Chat', 'Low Qualli Chat', 'Low Quallity', 'Lowquality Chat',
    'low quality', 'chat quality', 'Sehr schlechte Chat Qualität', 'Sehr schlechte Chat-Qualität',
    'Low Qualitaet Chat', 'poor chat quality', 'bad quality chat', 'Nonsense Chat-Talk', 'Nonsens im Chat',
    'Muted 1 month ! Chat quality -> 📜Deutsche Chatregeln📜 https://example.test/rules'],
  wrong_language: ['Falsche Sprache', 'Wrong Language', 'wronglanguage', 'Wrong chat language', 'Fremdsprache'],
  scam_social: ['Scam', 'Scamming', 'Scam links', 'Social Spam', 'Spamming social media',
    'Telegram', 'Posting phone number', 'Telefonnummer', 'Phishing', 'Betrug'],
  telegram_connect: ['Kontaktversuch', 'Kontaktaufnahme', 'sharing sozial plattform /personal contact',
    'sharing socials/codes/wallet (normal use)', 'Drop-Code', 'Wallet teilen', 'Twitter', 'Instagram',
    'Telegram (connect)', 'Telegram nur zum Vernetzen'],
  selling_accounts: ['Account Trading', 'Account Selling', 'Selling accounts', 'Trading account',
    'Account-Verkauf', 'Acc Verkauf', 'Account transfer', 'Selling acccounts', 'Konto Verkauf'],
  racism_hate: ['Toxic', 'Toxische Verhalten', 'Toxisches Verhalten / Beleidigung', 'Beleidgungen',
    'Unangemessenes Verhalten', 'inappropriate behavior', 'Rassismus', 'rassistisch', 'Racism',
    'racial slur', 'Hate', 'Hate speech', 'Hatespeech', 'Hassrede', 'Rightist extremist', 'Rechtsextremismus'],
  chat_jumping: ['Chat Jumping', 'Chatjumping', 'Chat-Jumping'],
  suicidal_addiction: ['Suicidal', 'Addiction', 'Suizid', 'Spielsucht', 'Sucht', 'Selbstmord'],
  advertising_streamers: ['Streamer Gespräch/Diskussion', 'Streamer Talk', 'Advertising streamers', 'Streamer-Werbung'],
  politics_religion: ['Politics', 'Politik', 'Politischer Talk', 'Religion'],
  other_casinos: ['Promoting other casinos', 'Mentioning another casino', 'Nennen von anderen Casinos', 'Werbung für ein anderes Casino'],
  chat_bot: ['Chat Bot', 'Chat-Bot Using', 'Chatbot', 'Bot usage', 'Chat-Bot-Nutzung']
};
const nextAfterFirst = {
  begging: [1440, 2880], minor_spam_caps: [1440, 2880], low_quality: [1440, 2880], wrong_language: [1440, 2880],
  scam_social: [1440, 259200], telegram_connect: [1440, 10080], selling_accounts: [43200, 129600],
  racism_hate: [1440, 43200], chat_jumping: [1440, 10080], suicidal_addiction: [43200, 43200],
  advertising_streamers: [1440, 10080], politics_religion: [1440, 10080], other_casinos: [1440, 10080], chat_bot: [1440, 259200]
};
for (const [category, reasons] of Object.entries(aliases)) {
  test(`legacy ${category}: aliases and the next actual timer`, () => {
    const [previous, expected] = nextAfterFirst[category];
    for (const reason of reasons) {
      assert.deepEqual(ids(reason), [category], reason);
      const suggestion = P.getCategorySuggestion([mute(reason, previous)], category);
      assert.equal(suggestion.strikes, 1, reason);
      assert.equal(suggestion.minutes, expected, reason);
    }
  });
}

test('all bundled old blueprints have an explicit reviewed classification', () => {
  const lines = fs.readFileSync(path.join(__dirname, '../defaults/MuteBlueprints.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
  const expected = [
    ['chat_bot'], [], ['scam_social'], [], [], [],
    ['begging'], ['begging'], ['racism_hate'], ['begging'], ['advertising_streamers'], ['low_quality', 'minor_spam_caps'], [], [],
    [], ['telegram_connect'], ['begging'], ['begging'], ['begging'], ['begging'], ['begging'], ['begging'],
    ['advertising_streamers'], ['racism_hate'], ['low_quality'], ['racism_hate'], ['begging'], ['low_quality'],
    ['low_quality', 'minor_spam_caps'], ['racism_hate'], ['begging'], ['advertising_streamers'], ['telegram_connect'], ['begging'],
    ['other_casinos'], ['wrong_language'], [], [], [], ['begging', 'chat_jumping'], ['begging', 'chat_jumping'],
    ['chat_jumping'], ['begging', 'chat_jumping'], ['chat_jumping', 'wrong_language'], ['begging'], ['begging'],
    ['begging', 'chat_jumping'], ['racism_hate'], ['low_quality', 'minor_spam_caps'], ['racism_hate'], ['selling_accounts'], ['begging'], ['telegram_connect']
  ];
  assert.equal(lines.length, expected.length, 'New templates require an explicit classification review');
  for (let i = 0; i < lines.length; i++) assert.deepEqual(ids(lines[i]), expected[i].slice().sort(), `Blueprint ${i + 1}: ${lines[i]}`);
});

test('combined old reasons count once per matching category without suppressing another rule', () => {
  for (const reason of ['low Qualität Chat / Spam', 'Low Qualli Chat / Spam', 'Low Quallity / Spam', 'Spaming / low quality in the chat']) {
    assert.deepEqual(ids(reason), ['low_quality', 'minor_spam_caps']);
    for (const id of ['low_quality', 'minor_spam_caps']) assert.equal(P.countStrikesInCategory([mute(reason, 1440)], id), 1);
  }
  assert.deepEqual(ids('Account Trading / Scam'), ['scam_social', 'selling_accounts']);
  assert.deepEqual(ids('chatjumping/begging'), ['begging', 'chat_jumping']);
  assert.deepEqual(ids('Missed Raintalk + Low Quality Spamm + Begging'), ['begging', 'low_quality', 'minor_spam_caps']);
  assert.deepEqual(ids('Scam & sharing wallet'), ['scam_social', 'telegram_connect']);
  assert.deepEqual(ids('Tag Spamming & Spam'), ['begging', 'minor_spam_caps']);
});

test('every pair of saved checkbox reasons is recognized again without private-note interference', () => {
  for (const a of P.VIOLATIONS) for (const b of P.VIOLATIONS) {
    const message = P.buildMuteMessage('Private note mentioning scam and a different rule', [a.id, b.id]);
    assert.deepEqual(ids(message), [...new Set([a.categoryId, b.categoryId])].sort(), `${a.id} + ${b.id}`);
  }
  assert.deepEqual(ids('Some note | REGELN: Begging; Low Quality Chat'), ['begging', 'low_quality']);
});

test('old calendar month durations advance to the next month step, including February and month ends', () => {
  for (const [createdAt, expireAt, previous, next] of [
    ['2026-02-01T12:00:00Z', '2026-03-01T12:00:00Z', 43200, 86400],
    ['2024-02-01T12:00:00Z', '2024-03-01T12:00:00Z', 43200, 86400],
    ['2026-01-31T12:00:00Z', '2026-02-28T12:00:00Z', 43200, 86400],
    ['2026-02-01T12:00:00Z', '2026-04-01T12:00:00Z', 86400, 129600],
    ['2026-02-01T12:00:00Z', '2026-05-01T12:00:00Z', 129600, 259200]
  ]) {
    const history = { message: 'Promoting other casinos', createdAt, expireAt };
    assert.equal(P.historyDurationMinutes(history), previous);
    assert.equal(P.getCategorySuggestion([history], 'other_casinos').minutes, next);
  }
});

test('historical next steps and repeat caps are correct across every policy ladder', () => {
  const ladders = {
    begging: [10, 60, 240, 1440, 2880, 4320, 7200, 10080, 10080],
    minor_spam_caps: [10, 60, 240, 1440, 2880, 4320, 7200, 10080, 10080],
    low_quality: [10, 60, 240, 1440, 2880, 4320, 7200, 10080, 10080],
    wrong_language: [10, 60, 240, 1440, 2880, 4320, 7200, 10080, 10080],
    scam_social: [1440, 259200, 0, 0], telegram_connect: [1440, 10080, 10080],
    selling_accounts: [43200, 129600, 259200, 0, 0], racism_hate: [1440, 43200, 129600, 259200, 0, 0],
    chat_jumping: [1440, 10080, 43200, 43200], suicidal_addiction: [43200, 43200],
    advertising_streamers: [1440, 10080, 10080], politics_religion: [1440, 10080, 10080],
    other_casinos: [1440, 10080, 20160, 43200, 86400, 129600, 259200, 259200], chat_bot: [1440, 259200, 0, 0]
  };
  for (const [category, steps] of Object.entries(ladders)) {
    for (let i = 0; i < steps.length - 1; i++) {
      const previous = mute(aliases[category][0], steps[i]);
      assert.equal(P.getCategorySuggestion([previous], category).minutes, steps[i + 1], `${category}: after ${steps[i]}`);
    }
  }
  assert.equal(P.getCategorySuggestion([{ message: 'Scam', expireAt: null }], 'scam_social').minutes, 0);
});

test('voluntary mutes are excluded; old rules with no known timer stay manual and visible', () => {
  for (const text of ['Userwish', 'Userwunsch-Perma-Mute', 'Mute auf eigenen Wunsch']) {
    assert.equal(P.classifyHistoricalReason(text).status, 'voluntary');
    assert.equal(P.countStrikesInCategory([mute(text, 0)], 'begging'), 0);
  }
  for (const text of ['Cool-Down-Mute', 'Alt account detected', 'Posten von Fremdwetten', 'Handelversuch', 'Account-Daten Weitergabe', 'Nennen von Umfrageseite']) {
    assert.deepEqual(ids(text), [], text);
    assert.equal(P.classifyHistoricalReason(text).status, 'manual');
    assert.equal(P.getMuteSuggestion([mute(text, 1440)], ['begging']).unclassifiedCount, 1);
  }
  assert.equal(P.getMuteSuggestion([mute('Userwish', 0)], ['begging']).unclassifiedCount, 0);
});

test('usernames, rule URLs and unrelated words do not introduce extra categories', () => {
  assert.deepEqual(ids('@scam_user Muted! Begging -> 📜Deutsche Chatregeln📜 https://example.test/toxic?spam=1&telegram=1'), ['begging']);
  assert.deepEqual(ids('Kontaktversuch'), ['telegram_connect']);
  assert.deepEqual(ids('Hat es versucht'), []);
});
