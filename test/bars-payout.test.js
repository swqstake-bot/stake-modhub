const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const tables = require('../lib/rh-payout-tables.json');

const EXPECTED = {
  Easy: [9, 4.5, 3, 2.25, 1.8],
  Medium: [33, 16.5, 11, 8.25, 6.6],
  Hard: [705, 352.5, 235, 176.25, 141],
  Expert: [3000, 1500, 1000, 750, 600]
};

describe('bars payout table', () => {
  it('enthält 4 Schwierigkeiten mit je 5 Bars', () => {
    const bars = tables.games.Bars;
    assert.ok(bars);
    assert.equal(bars.type, 'variants');
    assert.equal(bars.variants.length, 4);
    for (const v of bars.variants) {
      assert.equal(v.options.length, 5, v.label);
    }
  });

  it('stimmt mit offizieller Tabelle überein', () => {
    for (const v of tables.games.Bars.variants) {
      const expected = EXPECTED[v.label];
      assert.ok(expected, v.label);
      v.options.forEach((o, i) => {
        assert.equal(o.multi, expected[i], `${v.label} Bar ${i + 1}`);
        assert.equal(o.bars, i + 1);
      });
    }
  });
});
