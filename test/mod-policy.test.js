const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/mod-policy.js'), 'utf8'), context);
const P = context.window.StakeModPolicy;
const ids = (text) => Array.from(P.detectedReasonsToCategories(text));
function mute(message, minutes, createdAt = '2026-10-01T12:00:00Z') {
  return { message, createdAt, expireAt: minutes === 0 ? null : new Date(Date.parse(createdAt) + minutes * 60000).toISOString() };
}

test('all four standard groups use the confirmed ladder and repeat 7 days', () => {
  for (const category of ['begging', 'minor_spam_caps', 'low_quality', 'wrong_language']) {
    assert.deepEqual(Array.from(P.POLICY_CATEGORIES[category].minutes), [10, 60, 240, 1440, 2880, 4320, 7200, 10080]);
    assert.equal(P.getSuggestedMinutes(category, 100), 10080);
  }
});

test('Mladen example: one 1-day passive begging mute advances begging and tag spam to 2 days', () => {
  const history = [mute('Muted! Passives Betteln im Chat', 1440)];
  assert.equal(P.getMuteSuggestion(history, ids('Begging')).minutes, 2880);
  assert.equal(P.getMuteSuggestion(history, ids('Tag Spamming')).minutes, 2880);
});

test('several violations of the same color count as one strike per historical mute', () => {
  const history = [mute('Caps & Spam & Chat Abuse', 10), mute('Begging & Tag Spamming', 10)];
  assert.equal(P.countStrikesInCategory(history, 'minor_spam_caps'), 1);
  assert.equal(P.countStrikesInCategory(history, 'begging'), 1);
  assert.equal(P.getMuteSuggestion(history, ids('Chat Abuse')).minutes, 60);
});

test('Low Quality and Wrong Language retain independent history', () => {
  assert.equal(P.getMuteSuggestion([mute('Low Quality Chat', 1440)], ids('Wrong Language')).minutes, 10);
  assert.deepEqual(ids('Falsche Sprache im Chat'), ['wrong_language']);
  assert.deepEqual(ids('Nonsense Taggs'), ['begging']);
});

test('screenshot regression: old mixed-language Low Quality / Spam mutes advance from 1 day to 2 days', () => {
  const history = [
    mute('low Qualität Chat / Spam', 1440, '2026-10-02T20:41:00Z'),
    mute('low Qualität Chat / Spam', 10, '2026-09-30T20:22:00Z')
  ];
  const suggestion = P.getCategorySuggestion(history, 'low_quality');
  assert.equal(suggestion.strikes, 2);
  assert.equal(suggestion.minutes, 2880);
  assert.equal(P.getCategorySuggestion(history, 'minor_spam_caps').strikes, 2);
});

test('legacy German, English and mixed-language low-quality reasons use the same category', () => {
  for (const reason of ['Low Quality Chat', 'low Qualität Chat', 'LOW QUALITÄT CHAT', 'Sehr schlechte Chat-Qualität', 'low Qualität Chat / Spam']) {
    assert.ok(ids(reason).includes('low_quality'), reason);
  }
  assert.equal(P.countStrikesInCategory([{ message: 'low Qualität Chat / Spam' }], 'low_quality'), 1);
  assert.equal(P.getMuteSuggestion([mute('low Qualität Chat / Spam', 10080)], ['low_quality']).minutes, 10080);
});

test('both multi-rule examples use the longest applicable duration', () => {
  assert.equal(P.getMuteSuggestion([], ids('Chat jumping & Begging')).minutes, 1440);
  assert.equal(P.getMuteSuggestion([mute('Passive begging', 7200)], ids('Chat jumping & Begging')).minutes, 10080);
  const history = [mute('Chat jumping & Begging', 1440)];
  assert.equal(P.countStrikesInCategory(history, 'chat_jumping'), 1);
  assert.equal(P.countStrikesInCategory(history, 'begging'), 1);
});

test('latest chronological mute drives escalation even when history order differs', () => {
  const history = [mute('Begging', 10, '2026-09-01T00:00:00Z'), mute('Tag Spamming', 4320, '2026-10-01T00:00:00Z')];
  assert.equal(P.getMuteSuggestion(history, ['begging']).minutes, 7200);
});

test('history without dates falls back to shared strike count', () => {
  assert.equal(P.getMuteSuggestion([{ message: 'Passive begging' }, { message: 'Tag Spamming' }], ['begging']).minutes, 240);
});

test('old repeated mutes cannot skip steps beyond the most recent actual timer', () => {
  const history = Array.from({ length: 12 }, (_, i) => mute('Passive begging', 10, `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`));
  history.push(mute('Tag Spamming', 1440));
  assert.equal(P.getMuteSuggestion(history, ['begging']).minutes, 2880);
});

test('new categories follow the source timers, including permanent final steps', () => {
  const expected = {
    scam_social: [1440, 259200, 0], telegram_connect: [1440, 10080],
    selling_accounts: [43200, 129600, 259200, 0], racism_hate: [1440, 43200, 129600, 259200, 0],
    chat_jumping: [1440, 10080, 43200], suicidal_addiction: [43200],
    advertising_streamers: [1440, 10080], politics_religion: [1440, 10080],
    other_casinos: [1440, 10080, 20160, 43200, 86400, 129600, 259200], chat_bot: [1440, 259200, 0]
  };
  for (const [id, steps] of Object.entries(expected)) {
    assert.deepEqual(Array.from(P.POLICY_CATEGORIES[id].minutes), steps, id);
    assert.equal(P.getSuggestedMinutes(id, 99), steps.at(-1));
  }
  assert.equal(P.getMuteSuggestion([mute('Scam links', 259200)], ['scam_social']).minutes, 0);
  assert.equal(P.getMuteSuggestion([mute('Scam links', 0)], ['scam_social']).minutes, 0);
  assert.equal(P.getMuteSuggestion([mute('Scam links', 259200)], ['begging', 'scam_social']).minutes, 0);
});

test('toxic is in the racism group; ordinary sharing is distinct from spam', () => {
  assert.deepEqual(ids('Toxisches Verhalten'), ['racism_hate']);
  assert.deepEqual(ids('sharing socials/codes/wallet (normal use)'), ['telegram_connect']);
  assert.deepEqual(ids('Spamming social media'), ['scam_social']);
  assert.deepEqual(ids('Telegram'), ['scam_social']);
  assert.deepEqual(ids('Muted! Betteln -> https://stakecommunity.com/topic/119796-spam/'), ['begging']);
});

test('every suggested timer maps exactly to an available select option', () => {
  for (const c of Object.values(P.POLICY_CATEGORIES)) {
    for (const m of c.minutes) assert.ok(P.DURATION_OPTIONS.includes(P.minutesToDurationString(m)), `${c.id}: ${m}`);
  }
  assert.equal(P.minutesToDurationString(60), '1 hour');
  assert.equal(P.minutesToDurationString(1440), '1 day');
  assert.equal(P.minutesToDurationString(0), 'indefinite');
});

test('selected violations are saved together and corrected checkboxes control later history', () => {
  const message = P.buildMuteMessage('Muted 1 month ! Chat jumping & Begging', ['begging', 'tag_spamming']);
  assert.match(message, /Regeln: Begging; Tag Spamming/);
  assert.doesNotMatch(message, /1 month/);
  assert.deepEqual(ids(message), ['begging']);
  const corrected = P.buildMuteMessage(message, ['caps']);
  assert.deepEqual(ids(corrected), ['minor_spam_caps']);
  assert.equal((corrected.match(/Regeln:/g) || []).length, 1);
});

test('outgoing mute blueprint contains the user, all selected reasons and German chat rules', () => {
  const text = P.buildMuteChatText('@Tester', ['begging', 'chat_jumping', 'begging'], 'Private evidence', 'https://example.test/rules');
  assert.equal(text, '@Tester Muted! Betteln im Chat; Chat Jumping -> 📜Deutsche Chatregeln📜 https://example.test/rules');
  assert.doesNotMatch(text, /Private evidence/);
  assert.equal((text.match(/@Tester/g) || []).length, 1);
});

test('manual mute reason remains available when no violation was checked', () => {
  const text = P.buildMuteChatText('Tester', [], 'Eigener Mute-Grund');
  assert.match(text, /^@Tester Muted! Eigener Mute-Grund -> 📜Deutsche Chatregeln📜 https:/);
});
