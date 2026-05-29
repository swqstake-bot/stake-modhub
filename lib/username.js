/** Stake username without leading @ (display + API). */
function normalizeUsername(raw) {
  return String(raw || '').trim().replace(/^@+/, '');
}

module.exports = { normalizeUsername };
