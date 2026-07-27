/**
 * @-Erwähnungen im Hub-Chat — Vorschläge aus aktiven Live-Chat-Usern (wie Stake).
 */
(function (global) {
  const MAX_USERS = 120;
  const MAX_SUGGESTIONS = 10;

  /** @type {object | null} */
  let stateRef = null;
  /** @type {HTMLTextAreaElement | null} */
  let textarea = null;
  /** @type {HTMLElement | null} */
  let panel = null;
  let escFn = (s) => String(s ?? '');
  let stripAtFn = (s) => String(s || '').trim().replace(/^@+/, '');

  let activeIdx = 0;
  let suggestions = [];
  let mentionCtx = null;
  let docListener = null;

  function stripAt(name) {
    return stripAtFn(name);
  }

  function collectActiveChatUsers() {
    if (!stateRef?.chatLines?.length) return [];
    const seen = new Set();
    const users = [];
    const lines = stateRef.chatLines;
    for (let i = lines.length - 1; i >= 0 && users.length < MAX_USERS; i--) {
      const name = stripAt(lines[i].username);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      users.push(name);
    }
    return users;
  }

  function filterUsers(users, query) {
    const q = String(query || '').toLowerCase();
    if (!q) return users.slice(0, MAX_SUGGESTIONS);
    const starts = [];
    const contains = [];
    for (const u of users) {
      const l = u.toLowerCase();
      if (l.startsWith(q)) starts.push(u);
      else if (l.includes(q)) contains.push(u);
    }
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
  }

  function getMentionContext(ta) {
    if (!ta) return null;
    const value = ta.value;
    const cursor = ta.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const match = before.match(/@([\w.-]*)$/);
    if (!match) return null;
    return {
      query: match[1],
      atIndex: cursor - match[0].length,
      replaceLen: match[0].length
    };
  }

  function isOpen() {
    return !!panel && !panel.classList.contains('hidden') && suggestions.length > 0;
  }

  function closePanel() {
    if (!panel) return;
    panel.classList.add('hidden');
    panel.innerHTML = '';
    suggestions = [];
    mentionCtx = null;
    activeIdx = 0;
    if (docListener) {
      document.removeEventListener('mousedown', docListener, true);
      docListener = null;
    }
  }

  function renderPanel() {
    if (!panel || !mentionCtx) return;
    if (!suggestions.length) {
      closePanel();
      return;
    }
    if (activeIdx >= suggestions.length) activeIdx = suggestions.length - 1;
    if (activeIdx < 0) activeIdx = 0;

    panel.innerHTML = suggestions
      .map((name, i) => {
        const cls = i === activeIdx ? 'mention-autocomplete-item active' : 'mention-autocomplete-item';
        return `<button type="button" class="${cls}" data-user="${escFn(name)}" role="option" aria-selected="${i === activeIdx}">@${escFn(name)}</button>`;
      })
      .join('');
    panel.classList.remove('hidden');

    const activeEl = panel.querySelector('.mention-autocomplete-item.active');
    activeEl?.scrollIntoView({ block: 'nearest' });
  }

  function refreshSuggestions() {
    if (!textarea) return;
    mentionCtx = getMentionContext(textarea);
    if (!mentionCtx) {
      closePanel();
      return;
    }
    suggestions = filterUsers(collectActiveChatUsers(), mentionCtx.query);
    activeIdx = 0;
    renderPanel();

    if (suggestions.length && !docListener) {
      docListener = (e) => {
        if (panel?.contains(e.target) || textarea?.contains(e.target)) return;
        closePanel();
      };
      document.addEventListener('mousedown', docListener, true);
    }
  }

  function applyMention(username) {
    if (!textarea || !mentionCtx || !username) return;
    const value = textarea.value;
    const cursor = textarea.selectionStart ?? value.length;
    const before = value.slice(0, mentionCtx.atIndex);
    const after = value.slice(cursor);
    const insert = `@${username} `;
    const max = textarea.maxLength > 0 ? textarea.maxLength : Infinity;
    const room = max - before.length - after.length;
    if (room <= 0) {
      closePanel();
      return;
    }
    const mention = insert.length > room ? `@${username}`.slice(0, room) : insert;
    textarea.value = before + mention + after;
    const pos = before.length + mention.length;
    textarea.selectionStart = textarea.selectionEnd = pos;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    closePanel();
    textarea.focus();
  }

  function selectActive() {
    const name = suggestions[activeIdx];
    if (name) applyMention(name);
  }

  function onInput() {
    refreshSuggestions();
  }

  function onKeyDown(e) {
    if (!isOpen()) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      activeIdx = (activeIdx + 1) % suggestions.length;
      renderPanel();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      activeIdx = (activeIdx - 1 + suggestions.length) % suggestions.length;
      renderPanel();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      selectActive();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePanel();
    }
  }

  function onPanelClick(e) {
    const item = e.target.closest('.mention-autocomplete-item');
    if (!item) return;
    e.preventDefault();
    applyMention(item.getAttribute('data-user') || '');
  }

  function init(opts = {}) {
    stateRef = opts.state || null;
    textarea = opts.textarea || null;
    panel = opts.panel || null;
    if (typeof opts.esc === 'function') escFn = opts.esc;
    if (typeof opts.stripAt === 'function') stripAtFn = opts.stripAt;
    if (!textarea || !panel) return;

    textarea.addEventListener('input', onInput);
    textarea.addEventListener('keydown', onKeyDown, true);
    textarea.addEventListener('blur', () => {
      setTimeout(() => {
        if (!panel?.matches(':hover') && !panel?.contains(document.activeElement)) closePanel();
      }, 120);
    });
    panel.addEventListener('mousedown', (e) => e.preventDefault());
    panel.addEventListener('click', onPanelClick);
  }

  global.MentionAutocomplete = { init, isOpen, close: closePanel };
})(window);
