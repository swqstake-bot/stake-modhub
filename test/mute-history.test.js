const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const moduleStub = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/stake-graphql.js'), 'utf8'), {
  module: moduleStub,
  require: (id) => {
    if (id === './stake-session') return { normalizeHostname: (s) => s };
    if (id === './stake-http') return { stakePostJson: () => { throw new Error('Unexpected live HTTP request'); }, StakeHttpError: Error };
    return require(path.join(__dirname, '../lib', id));
  },
  setTimeout
});
const { StakeGraphQL } = moduleStub.exports;

test('policy history includes older pages beyond unrelated recent mutes', async () => {
  const api = new StakeGraphQL(() => ({}));
  const offsets = [];
  api.getCommunityUser = async (name, limit, offset) => {
    offsets.push(offset);
    return { user: { community: { muteList: offset === 0
      ? Array.from({ length: 50 }, (_, i) => ({ message: 'Other ' + i }))
      : [{ message: 'Passive begging', createdAt: '2026-01-01', expireAt: '2026-01-02' }] } } };
  };
  const result = await api.getMuteHistory('TestUser');
  assert.deepEqual(offsets, [0, 50]);
  assert.equal(result.user.community.muteList.length, 51);
});

test('an empty valid history is different from an unavailable history', async () => {
  const api = new StakeGraphQL(() => ({}));
  api.getCommunityUser = async () => ({ user: { community: { muteList: [] } } });
  assert.equal((await api.getMuteHistory('Test')).user.community.muteList.length, 0);
  api.getCommunityUser = async () => ({ user: null });
  await assert.rejects(api.getMuteHistory('Test'), /nicht verfügbar/);
});

test('failed later pages and ignored offsets do not return partial history as complete', async () => {
  const api = new StakeGraphQL(() => ({}));
  const page = { user: { community: { muteList: Array.from({ length: 50 }, (_, i) => ({ message: String(i) })) } } };
  api.getCommunityUser = async () => page;
  await assert.rejects(api.getMuteHistory('Test'), /vollständig/);
  api.getCommunityUser = async (_name, _limit, offset) => {
    if (offset) throw new Error('network failed');
    return page;
  };
  await assert.rejects(api.getMuteHistory('Test'), /network failed/);
});
