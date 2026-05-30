/** Stake username without leading @ (display + API). */
function normalizeUsername(raw) {
  return String(raw || '').trim().replace(/^@+/, '');
}

/** Chat/Mute/Warn: @user voranstellen, wenn noch nicht vorhanden. */
function prependUserMention(message, username) {
  const msg = String(message || '').trim();
  const name = normalizeUsername(username);
  if (!name || !msg) return msg;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`@${esc}\\b`, 'i').test(msg)) return msg;
  return `@${name} ${msg}`;
}

module.exports = { normalizeUsername, prependUserMention };
