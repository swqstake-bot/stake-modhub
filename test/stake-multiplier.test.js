const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStakeMultiplier, formatStakeMultiplier } = require('../lib/stake-multiplier');

describe('stake multiplier', () => {
  it('schneidet wie Stake ab statt kaufmännisch zu runden', () => {
    assert.equal(normalizeStakeMultiplier(7.335), 7.33);
    assert.equal(formatStakeMultiplier(7.335), '7.33');
    assert.equal(formatStakeMultiplier(7.33), '7.33');
    assert.equal(formatStakeMultiplier(7.339), '7.33');
  });
});
