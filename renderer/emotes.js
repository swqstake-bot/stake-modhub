/**
 * Stake-Chat-Emotes — laden, Picker, :name:-Rendering im Live-Chat.
 */
(function (global) {
  const EMOTE_TOKEN_RE = /:([a-z0-9_-]+):/gi;

  /** @type {Map<string, { name: string, file: string, token: string }>} */
  let byName = new Map();
  /** @type {Array<{ name: string, file: string, token: string }>} */
  let catalog = [];
  let loadPromise = null;
  let pickerDocListener = null;

  function defaultEsc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch('./assets/emotes/index.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((items) => {
        catalog = Array.isArray(items) ? items : [];
        byName = new Map(catalog.map((e) => [String(e.name).toLowerCase(), e]));
        return catalog;
      })
      .catch(() => {
        catalog = [];
        byName = new Map();
        return [];
      });
    return loadPromise;
  }

  function formatMessageHtml(text, escFn) {
    const esc = escFn || defaultEsc;
    const s = String(text ?? '');
    if (!byName.size || !s.includes(':')) return esc(s);

    const parts = [];
    let last = 0;
    const re = new RegExp(EMOTE_TOKEN_RE.source, 'gi');
    let match;
    while ((match = re.exec(s)) !== null) {
      if (match.index > last) parts.push(esc(s.slice(last, match.index)));
      const em = byName.get(match[1].toLowerCase());
      if (em) {
        parts.push(
          `<img class="chat-emote" src="./assets/emotes/${esc(em.file)}" alt="${esc(match[0])}" title="${esc(match[0])}" loading="lazy" decoding="async">`
        );
      } else {
        parts.push(esc(match[0]));
      }
      last = match.index + match[0].length;
    }
    if (last < s.length) parts.push(esc(s.slice(last)));
    return parts.join('');
  }

  function insertAtCursor(textarea, text) {
    if (!textarea) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const max = textarea.maxLength > 0 ? textarea.maxLength : Infinity;
    const room = max - before.length - after.length;
    if (room <= 0) return;
    const insert = text.length > room ? text.slice(0, room) : text;
    textarea.value = before + insert + after;
    const pos = start + insert.length;
    textarea.selectionStart = textarea.selectionEnd = pos;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  }

  function closePicker(panel) {
    if (!panel) return;
    panel.classList.add('hidden');
    if (pickerDocListener) {
      document.removeEventListener('mousedown', pickerDocListener, true);
      pickerDocListener = null;
    }
  }

  function openPicker(panel, anchor) {
    if (!panel || !anchor) return;
    panel.classList.remove('hidden');
    if (pickerDocListener) document.removeEventListener('mousedown', pickerDocListener, true);
    pickerDocListener = (e) => {
      if (panel.contains(e.target) || anchor.contains(e.target)) return;
      closePicker(panel);
    };
    document.addEventListener('mousedown', pickerDocListener, true);
  }

  function renderPickerGrid(panel) {
    if (!panel) return;
    panel.innerHTML = catalog
      .map(
        (e) =>
          `<button type="button" class="emote-picker-item" data-token="${defaultEsc(e.token)}" title="${defaultEsc(e.token)}"><img src="./assets/emotes/${defaultEsc(e.file)}" alt="${defaultEsc(e.name)}" loading="lazy" decoding="async"></button>`
      )
      .join('');
  }

  function wirePicker(button, panel, textarea) {
    if (!button || !panel || !textarea) return;

    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (panel.classList.contains('hidden')) {
        renderPickerGrid(panel);
        openPicker(panel, button);
      } else {
        closePicker(panel);
      }
    });

    panel.addEventListener('click', (e) => {
      const item = e.target.closest('.emote-picker-item');
      if (!item) return;
      e.preventDefault();
      const token = item.getAttribute('data-token') || '';
      if (token) insertAtCursor(textarea, token);
      closePicker(panel);
    });
  }

  async function init(opts = {}) {
    await load();
    if (opts.button && opts.panel && opts.textarea) {
      wirePicker(opts.button, opts.panel, opts.textarea);
    }
    return catalog;
  }

  global.Emotes = {
    load,
    init,
    formatMessageHtml,
    getCatalog: () => catalog
  };
})(window);
