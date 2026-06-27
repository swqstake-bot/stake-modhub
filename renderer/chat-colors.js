/**
 * Stable per-username colours + gold highlight for own messages.
 */
(function (global) {
  function hashString(value) {
    const s = String(value || '').toLowerCase();
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function usernameColor(username) {
    const h = hashString(username);
    const hue = h % 360;
    const sat = 58 + (h % 18);
    const light = 62 + (h % 12);
    return `hsl(${hue} ${sat}% ${light}%)`;
  }

  function formatUserHtml(username, { isSelf = false, esc, colorEnabled = true } = {}) {
    const escFn =
      esc ||
      ((s) =>
        String(s ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;'));
    const name = String(username || '').trim();
    const cls = ['user'];
    if (isSelf) cls.push('user-self');
    else if (colorEnabled) cls.push('user-colored');

    const style =
      !isSelf && colorEnabled ? ` style="color:${usernameColor(name)}"` : isSelf ? ' style="color:#ffd76a"' : '';

    return `<span class="${cls.join(' ')}" data-username="${escFn(name)}"${style}>${escFn(name)}</span>`;
  }

  global.ChatColors = {
    hashString,
    usernameColor,
    formatUserHtml
  };
})(window);
