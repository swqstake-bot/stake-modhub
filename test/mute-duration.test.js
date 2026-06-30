const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatMuteDuration } = require('../renderer/mute-duration.js');

describe('mute duration format', () => {
  it('formatiert Tage, Stunden und Minuten', () => {
    const start = '2026-06-16T01:08:00.000Z';
    const end = '2026-06-17T13:38:00.000Z';
    assert.equal(formatMuteDuration(start, end), '1 Tag 12 Stunden 30 Minuten');
  });

  it('zeigt nur relevante Einheiten', () => {
    const start = '2026-06-24T18:33:00.000Z';
    const end = '2026-06-24T19:03:00.000Z';
    assert.equal(formatMuteDuration(start, end), '30 Minuten');
  });

  it('behandelt unbegrenzte Mutes', () => {
    assert.equal(formatMuteDuration('2026-01-01T00:00:00.000Z', null), 'unbegrenzt');
  });
});
