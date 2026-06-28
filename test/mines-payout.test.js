const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const tables = require('../lib/rh-payout-tables.json');

function minesMult(mines, diamonds, rtp = 0.99) {
  let prod = 1;
  for (let i = 0; i < diamonds; i += 1) {
    prod *= (25 - i) / (25 - mines - i);
  }
  return Math.round(rtp * prod * 100) / 100;
}

describe('mines payout table', () => {
  it('enthält 24 Minen-Settings mit 300 Multis', () => {
    const mines = tables.games.Mines;
    assert.equal(mines.type, 'variants');
    assert.equal(mines.variants.length, 24);
    const total = mines.variants.reduce((n, v) => n + v.options.length, 0);
    assert.equal(total, 300);
  });

  it('stimmt mit Stake-Payment-Tabelle überein (Stichproben)', () => {
    const byMines = Object.fromEntries(tables.games.Mines.variants.map((v) => [v.mines, v]));
    const samples = [
      [1, 1, 1.01],
      [1, 2, 1.08],
      [2, 2, 1.17],
      [3, 3, 1.48],
      [5, 5, 3.39],
      [10, 10, 1077],
      [1, 24, 24.75],
      [3, 22, 2277],
      [15, 10, 3236072]
    ];
    for (const [m, d, exp] of samples) {
      const opt = byMines[m].options.find((o) => o.diamonds === d);
      assert.ok(opt, `${m} Minen / ${d} Diamanten fehlt`);
      assert.ok(Math.abs(opt.multi - exp) <= 1, `${m}/${d}: ${opt.multi} vs ${exp}`);
    }
  });
});
