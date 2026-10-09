/**
 * Layout shell: tab behavior that is purely visual, splitters, command palette,
 * keyboard, settings pages, watch toast. Persists in localStorage (modhub-ui).
 */
(function () {
  const STORE = 'modhub-ui';
  const INDEX_TABS = ['watch', 'flagged', 'tagged', 'rains'];
  const SETTINGS_PAGES = [
    ['connect', 'Verbindung'],
    ['eu', 'stake.eu'],
    ['chat', 'Chat'],
    ['logs', 'Logs'],
    ['sounds', 'Töne'],
    ['updates', 'Updates']
  ];
  const APP_TABS = [
    ['hub', 'Hub'],
    ['watchlist', 'Watchlist'],
    ['analyse', 'Analyse'],
    ['rh', 'Rollhunt'],
    ['automsg', 'Automsg'],
    ['automute', 'Automute'],
    ['wetten', 'Wetten'],
    ['settings', 'Einstellungen']
  ];

  let ui = {};
  let cmdkIndex = 0;
  let cmdkItems = [];
  let watchToastTimer = null;

  function load() {
    try {
      ui = JSON.parse(localStorage.getItem(STORE) || '{}') || {};
    } catch (_) {
      ui = {};
    }
  }

  function save(partial) {
    ui = { ...ui, ...partial };
    try {
      localStorage.setItem(STORE, JSON.stringify(ui));
    } catch (_) {
      /* ignore */
    }
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setIndexTab(name) {
    if (!INDEX_TABS.includes(name)) name = 'watch';
    document.querySelectorAll('.hub-index-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.index === name);
    });
    document.querySelectorAll('.hub-index-pane').forEach((pane) => {
      pane.classList.toggle('active', pane.dataset.indexPane === name);
    });
    save({ indexTab: name });
  }

  function setRhTab(name) {
    const layout = $('rhLayout');
    if (!layout) return;
    if (!['scanner', 'chat', 'trivia'].includes(name)) name = 'scanner';
    layout.dataset.rhTab = name;
    document.querySelectorAll('.rh-subtab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.rhTab === name);
    });
    save({ rhTab: name });
  }

  function setModMode(mode) {
    const grid = document.querySelector('.hub-mod-grid');
    if (!grid) return;
    const current = grid.dataset.modMode || 'none';
    const next = !mode || current === mode ? 'none' : mode;
    grid.dataset.modMode = next;
    document.querySelectorAll('.mod-mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.modMode === next);
    });
  }

  function applyDensity(compact) {
    document.body.classList.toggle('density-compact', !!compact);
    const box = $('densityCompact');
    if (box) box.checked = !!compact;
  }

  function applyLayout() {
    const hub = $('panel-hub');
    if (!hub) return;
    if (ui.hubRight) hub.style.setProperty('--hub-right-w', `${ui.hubRight}px`);
    if (ui.hubIndex) hub.style.setProperty('--hub-index-h', `${ui.hubIndex}px`);
    document.body.classList.toggle('hub-right-collapsed', ui.hubRightCollapsed === true);
    const collapse = $('btnCollapseMod');
    if (collapse) collapse.textContent = ui.hubRightCollapsed ? 'Mod' : 'Einklappen';
  }

  function bindSplitter(handle, { horizontal, cssVar, min, max, invert, storeKey }) {
    if (!handle) return;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (horizontal && document.body.classList.contains('hub-right-collapsed')) {
        save({ hubRightCollapsed: false });
        applyLayout();
        return;
      }
      e.preventDefault();
      const hub = $('panel-hub');
      const start = horizontal ? e.clientX : e.clientY;
      const current = parseInt(getComputedStyle(hub).getPropertyValue(cssVar), 10) || (horizontal ? 400 : 210);
      const move = (ev) => {
        const delta = (horizontal ? ev.clientX : ev.clientY) - start;
        let next = current + (invert ? -delta : delta);
        next = Math.max(min, Math.min(max, Math.round(next)));
        hub.style.setProperty(cssVar, `${next}px`);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        const value = parseInt(getComputedStyle(hub).getPropertyValue(cssVar), 10);
        if (value) save({ [storeKey]: value });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
    });
  }

  function shellSettings() {
    const panel = document.querySelector('#panel-settings > .settings-panel');
    if (!panel || panel.dataset.shelled) return;
    panel.dataset.shelled = '1';
    panel.classList.add('settings-shell');
    const nav = document.createElement('nav');
    nav.className = 'settings-nav';
    nav.setAttribute('aria-label', 'Einstellungsbereiche');
    const pagesWrap = document.createElement('div');
    pagesWrap.className = 'settings-pages';
    const buckets = {};
    for (const [id, label] of SETTINGS_PAGES) {
      const page = document.createElement('div');
      page.className = 'settings-page';
      page.dataset.settingsPage = id;
      page.hidden = id !== 'connect';
      buckets[id] = page;
      pagesWrap.appendChild(page);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-nav-btn' + (id === 'connect' ? ' active' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        nav.querySelectorAll('.settings-nav-btn').forEach((b) => b.classList.toggle('active', b === btn));
        Object.entries(buckets).forEach(([key, node]) => {
          node.hidden = key !== id;
        });
        save({ settingsPage: id });
      });
      nav.appendChild(btn);
    }
    const tagged = [...panel.querySelectorAll('[data-settings-page]')];
    for (const el of tagged) {
      const bucket = buckets[el.dataset.settingsPage];
      if (bucket) bucket.appendChild(el);
    }
    const h2 = panel.querySelector('h2');
    if (h2) h2.insertAdjacentElement('afterend', nav);
    else panel.prepend(nav);
    panel.appendChild(pagesWrap);
    const saved = ui.settingsPage;
    if (saved && buckets[saved]) {
      nav.querySelectorAll('.settings-nav-btn').forEach((btn, i) => {
        const on = SETTINGS_PAGES[i][0] === saved;
        btn.classList.toggle('active', on);
      });
      Object.entries(buckets).forEach(([key, node]) => {
        node.hidden = key !== saved;
      });
    }
  }

  function refreshMarkLegend() {
    const box = $('liveChat');
    const el = $('chatMarkLegend');
    if (!box || !el) return;
    const marks = [
      ['mark-watch', 'Beobachtet'],
      ['mark-tagged', 'Erwähnt'],
      ['veri2', 'Veri2'],
      ['mark-mod', 'Markiert'],
      ['rh-hit', 'RH']
    ];
    const active = document.body.dataset.markFilter || '';
    const present = marks.filter(([cls]) => box.querySelector(`.chat-line.${cls}`));
    el.innerHTML = present
      .map(([cls, label]) => {
        const on = active === cls ? ' is-on' : '';
        return `<button type="button" class="mark-leg mark-leg-${cls}${on}" data-mark="${cls}">${label}</button>`;
      })
      .join('');
  }

  function setMarkFilter(cls) {
    const cur = document.body.dataset.markFilter || '';
    if (!cls || cur === cls) delete document.body.dataset.markFilter;
    else document.body.dataset.markFilter = cls;
    refreshMarkLegend();
  }

  function syncConn() {
    const euTab = $('siteTabEu');
    const euOn = !!(euTab && !euTab.disabled);
    $('connDotEu')?.classList.toggle('hidden', !euOn);
    const live = $('liveStatus');
    const text = live?.textContent || '';
    const off = /aus/i.test(text);
    $('connDotCom')?.classList.toggle('is-on', !off);
    $('connDotCom')?.classList.toggle('is-off', off);
    $('connDotEu')?.classList.toggle('is-on', euOn && !off);
    $('connDotEu')?.classList.toggle('is-off', euOn && off);
  }

  function syncTopModChat() {
    const panel = $('modChatPanel');
    const btn = $('topModChatBtn');
    const src = $('modChatUnread');
    const badge = $('topModChatUnread');
    if (!btn) return;
    const enabled = panel && !panel.classList.contains('hidden');
    btn.classList.toggle('hidden', !enabled);
    if (!badge || !src) return;
    badge.textContent = src.textContent || '0';
    badge.classList.toggle('hidden', src.classList.contains('hidden') || !src.textContent || src.textContent === '0');
  }

  function onWatchLine(line) {
    const toastOn = $('watchToastEnabled');
    if (toastOn && !toastOn.checked) return;
    if ($('panel-hub')?.classList.contains('active')) return;
    const toast = $('watchToast');
    if (!toast || !line) return;
    toast.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = String(line.username || '');
    toast.appendChild(strong);
    const msg = document.createTextNode(`  ${String(line.message || '').slice(0, 90)}`);
    toast.appendChild(msg);
    toast.dataset.uid = line.uid != null ? String(line.uid) : '';
    toast.classList.remove('hidden');
    clearTimeout(watchToastTimer);
    watchToastTimer = setTimeout(() => toast.classList.add('hidden'), 7000);
  }

  function closeCmdk() {
    $('cmdk')?.classList.add('hidden');
  }

  function cmdkActions(query) {
    const q = String(query || '').trim();
    const items = [];
    const low = q.toLowerCase();
    for (const [id, label] of APP_TABS) {
      if (!low || label.toLowerCase().includes(low) || id.includes(low)) {
        items.push({ kind: 'tab', id, label: `Tab · ${label}` });
      }
    }
    const user = q.replace(/^@/, '');
    if (user && !/\s/.test(user)) {
      items.push({ kind: 'validate', user, label: `Prüfen · ${user}` });
      items.push({ kind: 'watch', user, label: `Beobachten · ${user}` });
      items.push({ kind: 'history', user, label: `Verlauf · ${user}` });
      items.push({ kind: 'bets', user, label: `Wetten · ${user}` });
      items.push({ kind: 'analyse', user, label: `Analyse · ${user}` });
    }
    return items.slice(0, 12);
  }

  function paintCmdk() {
    const list = $('cmdkList');
    const input = $('cmdkInput');
    if (!list || !input) return;
    cmdkItems = cmdkActions(input.value);
    if (cmdkIndex >= cmdkItems.length) cmdkIndex = 0;
    list.innerHTML = cmdkItems
      .map((item, i) => `<button type="button" class="cmdk-item${i === cmdkIndex ? ' is-on' : ''}" data-i="${i}">${item.label}</button>`)
      .join('');
  }

  function runCmdk(item) {
    if (!item) return;
    closeCmdk();
    if (item.kind === 'tab') {
      document.querySelector(`.tab[data-tab="${item.id}"]`)?.click();
      return;
    }
    if (item.kind === 'validate') {
      document.querySelector('.tab[data-tab="hub"]')?.click();
      const field = $('validateUsername');
      if (field) field.value = item.user;
      $('btnValidate')?.click();
      return;
    }
    if (item.kind === 'watch' && typeof window.toggleWatchUser === 'function') {
      void window.toggleWatchUser(item.user, { source: 'hub' });
      return;
    }
    if (item.kind === 'history' && typeof window.validateAndOpenModAction === 'function') {
      void window.validateAndOpenModAction(item.user, 'chat');
      return;
    }
    if (item.kind === 'bets') {
      document.querySelector('.tab[data-tab="wetten"]')?.click();
      const field = $('betsFilterUser');
      if (field) {
        field.value = item.user;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }
    if (item.kind === 'analyse') {
      document.querySelector('.tab[data-tab="analyse"]')?.click();
      window.AnalysePanel?.focusUser?.(item.user);
    }
  }

  function openCmdk() {
    const root = $('cmdk');
    const input = $('cmdkInput');
    if (!root || !input) return;
    root.classList.remove('hidden');
    input.value = '';
    cmdkIndex = 0;
    paintCmdk();
    input.focus();
  }

  function wire() {
    load();
    applyLayout();
    applyDensity(ui.density === 'compact');
    setIndexTab(ui.indexTab || 'watch');
    setRhTab(ui.rhTab || 'scanner');
    shellSettings();
    if ($('watchToastEnabled')) $('watchToastEnabled').checked = ui.watchToast !== false;

    document.querySelectorAll('.hub-index-tab').forEach((btn) => {
      btn.addEventListener('click', () => setIndexTab(btn.dataset.index));
    });
    document.querySelectorAll('.rh-subtab').forEach((btn) => {
      btn.addEventListener('click', () => setRhTab(btn.dataset.rhTab));
    });
    document.querySelectorAll('.mod-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => setModMode(btn.dataset.modMode || 'none'));
    });

    $('btnChatGear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      $('chatGearPop')?.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest?.('.hub-gear')) $('chatGearPop')?.classList.add('hidden');
    });

    $('densityCompact')?.addEventListener('change', () => {
      const on = $('densityCompact').checked;
      applyDensity(on);
      save({ density: on ? 'compact' : 'comfort' });
    });
    $('watchToastEnabled')?.addEventListener('change', () => {
      save({ watchToast: $('watchToastEnabled').checked });
    });

    bindSplitter($('hubColSplit'), {
      horizontal: true,
      cssVar: '--hub-right-w',
      min: 300,
      max: 560,
      invert: true,
      storeKey: 'hubRight'
    });
    bindSplitter($('hubIndexSplit'), {
      horizontal: false,
      cssVar: '--hub-index-h',
      min: 120,
      max: 420,
      invert: true,
      storeKey: 'hubIndex'
    });

    $('btnCollapseMod')?.addEventListener('click', () => {
      save({ hubRightCollapsed: !document.body.classList.contains('hub-right-collapsed') });
      applyLayout();
    });
    $('btnOpenWatchlistFromMod')?.addEventListener('click', () => {
      document.querySelector('.tab[data-tab="watchlist"]')?.click();
    });

    $('chatMarkLegend')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mark]');
      if (!btn) return;
      setMarkFilter(btn.dataset.mark);
    });

    $('watchToast')?.addEventListener('click', () => {
      const uid = $('watchToast')?.dataset.uid;
      $('watchToast')?.classList.add('hidden');
      document.querySelector('.tab[data-tab="hub"]')?.click();
      if (uid && typeof window.scrollToLiveChatUid === 'function') window.scrollToLiveChatUid(uid);
    });

    const unread = $('modChatUnread');
    const panel = $('modChatPanel');
    if (unread || panel) {
      const obs = new MutationObserver(() => syncTopModChat());
      if (unread) obs.observe(unread, { attributes: true, childList: true, characterData: true, subtree: true });
      if (panel) obs.observe(panel, { attributes: true, attributeFilter: ['class'] });
    }
    $('topModChatBtn')?.addEventListener('click', () => $('modChatToggle')?.click());
    syncTopModChat();

    const cmdk = $('cmdk');
    $('cmdkInput')?.addEventListener('input', () => {
      cmdkIndex = 0;
      paintCmdk();
    });
    $('cmdkInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        cmdkIndex = Math.min(cmdkItems.length - 1, cmdkIndex + 1);
        paintCmdk();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        cmdkIndex = Math.max(0, cmdkIndex - 1);
        paintCmdk();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        runCmdk(cmdkItems[cmdkIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeCmdk();
      }
    });
    $('cmdkList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-i]');
      if (!btn) return;
      runCmdk(cmdkItems[Number(btn.dataset.i)]);
    });
    cmdk?.addEventListener('click', (e) => {
      if (e.target === cmdk) closeCmdk();
    });

    document.addEventListener('keydown', (e) => {
      const typing = e.target?.closest?.('input, textarea, select, [contenteditable]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if ($('cmdk')?.classList.contains('hidden')) openCmdk();
        else closeCmdk();
        return;
      }
      if (e.key === 'Escape' && !$('cmdk')?.classList.contains('hidden')) {
        closeCmdk();
        return;
      }
      if (typing) return;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        document.querySelector('.tab[data-tab="hub"]')?.click();
        $('liveChatFilter')?.focus();
        return;
      }
      if ((e.key === 'w' || e.key === 'W') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!$('btnWatchUser')?.disabled) $('btnWatchUser')?.click();
        return;
      }
      if (e.altKey && e.key >= '1' && e.key <= '4') {
        setIndexTab(INDEX_TABS[Number(e.key) - 1]);
      }
    });

    syncConn();
  }

  window.UiShell = {
    refreshMarkLegend,
    syncConn,
    onWatchLine,
    openCmdk
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
