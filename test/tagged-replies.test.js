const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  const state = { modUser: 'swaqline', settings: { mentionAliases: ['ModAlias'] },
    chatMessageById: new Map(), chatLines: [], tagged: [], rains: [], flagged: [] };
  let notifications = 0;
  const context = { state, Map, Date,
    $: () => null, stripAt: s => String(s || '').replace(/^@+/, ''),
    parseBetFromText: () => '', normMulti: Number,
    pushChatLine: line => { line.uid = state.chatLines.length + 1; state.chatLines.push(line); },
    playMentionNotifySound: () => notifications++, isWatchedUser: () => false,
    scoreIncomingFlag: () => null, processRhTriviaHit: () => {} };
  vm.createContext(context);
  for (const name of ['formatChatTime', 'rememberChatMessageById', 'resolveChatReply', 'parseChatLine',
    'buildTaggedIndexEntry', 'retagModMentions', 'parseMentionAliases', 'getMentionAliasesEffective',
    'mentionRegexAt', 'mentionRegexBare', 'getMentionWatchTerms', 'isMentionOfMod',
    'isOwnModChatUser', 'isTaggedForMod', 'ingestLiveMessageSync']) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\n}', start) + 2;
    assert.ok(start >= 0 && end > start, name);
    vm.runInContext(source.slice(start, end), context);
  }
  return { context, state, notifications: () => notifications };
}

test('replies to the moderator enter TAGGED without an explicit mention and notify once', () => {
  const f = fixture();
  const ingest = f.context.ingestLiveMessageSync;
  ingest({ username: 'Swaqline', message: 'Original message', messageId: 'parent' });
  const reply = ingest({ username: 'OtherUser', message: 'ist ja auch ich warte noch. :)',
    messageId: 'reply', replyChatMessageId: 'parent' });
  assert.equal(reply.modMention, true);
  assert.equal(f.state.tagged.length, 1);
  assert.equal(f.state.tagged[0].uid, reply.uid);
  assert.equal(f.state.tagged[0].text, reply.message);
  assert.equal(f.notifications(), 1);
  ingest({ username: 'OtherUser', message: '@swaqline reply with mention', replyChatMessageId: 'parent' });
  assert.equal(f.state.tagged.length, 2);
  assert.equal(f.notifications(), 2);
  ingest({ username: 'swaqline', message: 'self reply', replyChatMessageId: 'parent' });
  assert.equal(f.notifications(), 2);
});

test('reply targets match exact moderator or configured alias; other and unknown targets stay out', () => {
  const f = fixture();
  const ingest = f.context.ingestLiveMessageSync;
  for (const [id, username] of [['alias', 'MODALIAS'], ['other', 'swaqlineExtra']]) {
    ingest({ username, message: 'parent', messageId: id });
  }
  ingest({ username: 'User', message: 'reply alias', replyChatMessageId: 'alias' }, { chatSource: 'eu' });
  ingest({ username: 'User', message: 'reply other', replyChatMessageId: 'other' });
  ingest({ username: 'User', message: 'unknown parent', replyChatMessageId: 'unknown' });
  assert.equal(f.state.tagged.length, 1);
  assert.equal(f.state.tagged[0].chatSource, 'eu');
  f.context.retagModMentions();
  assert.equal(f.state.tagged.length, 1);
  f.state.settings.mentionAliases = [];
  f.context.retagModMentions();
  assert.equal(f.state.tagged.length, 0);
});
