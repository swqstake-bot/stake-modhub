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

  const MAX_EMOTE_SUGGESTIONS = 10;
  /** @type {HTMLTextAreaElement | null} */
  let autocompleteTextarea = null;
  /** @type {HTMLElement | null} */
  let autocompletePanel = null;
  let autocompleteEsc = defaultEsc;
  let autocompleteActiveIdx = 0;
  /** @type {Array<{ name: string, file: string, token: string }>} */
  let autocompleteSuggestions = [];
  let emoteCtx = null;
  let autocompleteDocListener = null;

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

  function filterCatalog(query) {
    const q = String(query || '').toLowerCase();
    if (!q) return catalog.slice(0, MAX_EMOTE_SUGGESTIONS);
    const starts = [];
    const contains = [];
    for (const em of catalog) {
      const n = String(em.name).toLowerCase();
      if (n.startsWith(q)) starts.push(em);
      else if (n.includes(q)) contains.push(em);
    }
    return [...starts, ...contains].slice(0, MAX_EMOTE_SUGGESTIONS);
  }

  function getEmoteContext(ta) {
    if (!ta) return null;
    const value = ta.value;
    const cursor = ta.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const match = before.match(/:([a-z0-9_-]*)$/i);
    if (!match) return null;
    return {
      query: match[1],
      atIndex: cursor - match[0].length
    };
  }

  function isAutocompleteOpen() {
    return (
      !!autocompletePanel &&
      !autocompletePanel.classList.contains('hidden') &&
      autocompleteSuggestions.length > 0
    );
  }

  function closeAutocomplete() {
    if (!autocompletePanel) return;
    autocompletePanel.classList.add('hidden');
    autocompletePanel.innerHTML = '';
    autocompleteSuggestions = [];
    emoteCtx = null;
    autocompleteActiveIdx = 0;
    if (autocompleteDocListener) {
      document.removeEventListener('mousedown', autocompleteDocListener, true);
      autocompleteDocListener = null;
    }
  }

  function renderAutocomplete() {
    if (!autocompletePanel || !emoteCtx) return;
    if (!autocompleteSuggestions.length) {
      closeAutocomplete();
      return;
    }
    if (autocompleteActiveIdx >= autocompleteSuggestions.length) {
      autocompleteActiveIdx = autocompleteSuggestions.length - 1;
    }
    if (autocompleteActiveIdx < 0) autocompleteActiveIdx = 0;

    const esc = autocompleteEsc;
    autocompletePanel.innerHTML = autocompleteSuggestions
      .map((em, i) => {
        const cls =
          i === autocompleteActiveIdx ? 'emote-autocomplete-item active' : 'emote-autocomplete-item';
        return `<button type="button" class="${cls}" data-token="${esc(em.token)}" role="option" aria-selected="${i === autocompleteActiveIdx}">
          <img src="./assets/emotes/${esc(em.file)}" alt="${esc(em.name)}" loading="lazy" decoding="async">
          <span>${esc(em.token)}</span>
        </button>`;
      })
      .join('');
    autocompletePanel.classList.remove('hidden');
    autocompletePanel.querySelector('.emote-autocomplete-item.active')?.scrollIntoView({ block: 'nearest' });
  }

  function refreshAutocomplete() {
    if (!autocompleteTextarea) return;
    emoteCtx = getEmoteContext(autocompleteTextarea);
    if (!emoteCtx) {
      closeAutocomplete();
      return;
    }
    autocompleteSuggestions = filterCatalog(emoteCtx.query);
    autocompleteActiveIdx = 0;
    renderAutocomplete();

    if (autocompleteSuggestions.length && !autocompleteDocListener) {
      autocompleteDocListener = (e) => {
        if (autocompletePanel?.contains(e.target) || autocompleteTextarea?.contains(e.target)) return;
        closeAutocomplete();
      };
      document.addEventListener('mousedown', autocompleteDocListener, true);
    }
  }

  function applyEmoteToken(token) {
    if (!autocompleteTextarea || !emoteCtx || !token) return;
    const value = autocompleteTextarea.value;
    const cursor = autocompleteTextarea.selectionStart ?? value.length;
    const before = value.slice(0, emoteCtx.atIndex);
    const after = value.slice(cursor);
    const insert = String(token);
    const max = autocompleteTextarea.maxLength > 0 ? autocompleteTextarea.maxLength : Infinity;
    const room = max - before.length - after.length;
    if (room <= 0) {
      closeAutocomplete();
      return;
    }
    const emoteToken = insert.length > room ? insert.slice(0, room) : insert;
    autocompleteTextarea.value = before + emoteToken + after;
    const pos = before.length + emoteToken.length;
    autocompleteTextarea.selectionStart = autocompleteTextarea.selectionEnd = pos;
    autocompleteTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    closeAutocomplete();
    autocompleteTextarea.focus();
  }

  function selectActiveEmote() {
    const em = autocompleteSuggestions[autocompleteActiveIdx];
    if (em?.token) applyEmoteToken(em.token);
  }

  function wireAutocomplete(textarea, panel, escFn) {
    if (!textarea || !panel) return;
    autocompleteTextarea = textarea;
    autocompletePanel = panel;
    if (typeof escFn === 'function') autocompleteEsc = escFn;

    textarea.addEventListener('input', () => refreshAutocomplete());
    textarea.addEventListener('keydown', (e) => {
      if (!isAutocompleteOpen()) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        autocompleteActiveIdx = (autocompleteActiveIdx + 1) % autocompleteSuggestions.length;
        renderAutocomplete();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        autocompleteActiveIdx =
          (autocompleteActiveIdx - 1 + autocompleteSuggestions.length) % autocompleteSuggestions.length;
        renderAutocomplete();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        selectActiveEmote();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeAutocomplete();
      }
    }, true);
    textarea.addEventListener('blur', () => {
      setTimeout(() => {
        if (!autocompletePanel?.matches(':hover') && !autocompletePanel?.contains(document.activeElement)) {
          closeAutocomplete();
        }
      }, 120);
    });
    panel.addEventListener('mousedown', (e) => e.preventDefault());
    panel.addEventListener('click', (e) => {
      const item = e.target.closest('.emote-autocomplete-item');
      if (!item) return;
      e.preventDefault();
      applyEmoteToken(item.getAttribute('data-token') || '');
    });
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
    if (opts.autocompletePanel && opts.textarea) {
      wireAutocomplete(opts.textarea, opts.autocompletePanel, opts.esc);
    }
    return catalog;
  }

  global.Emotes = {
    load,
    init,
    formatMessageHtml,
    getCatalog: () => catalog,
    isAutocompleteOpen,
    closeAutocomplete
  };
})(window);
