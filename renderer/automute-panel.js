(function (global) {
  'use strict';

  let ctx = null;
  let editId = null;

  function $(id) {
    return ctx?.$?.(id);
  }

  function esc(s) {
    return ctx?.esc ? ctx.esc(s) : String(s ?? '');
  }

  function getRules() {
    const raw = ctx?.state?.settings?.autoMuteRules;
    if (Array.isArray(raw) && raw.length) return raw;
    return null;
  }

  function ensureRulesLoaded() {
    if (!Array.isArray(ctx.state.settings.autoMuteRules) || !ctx.state.settings.autoMuteRules.length) {
      ctx.state.settings.autoMuteRules = global.AutomuteDefaults?.DEFAULT_AUTOMUTE_RULES?.map((r) => ({
        ...r,
        patterns: [...r.patterns]
      })) || [];
    }
    return ctx.state.settings.autoMuteRules;
  }

  function mutePeriodOptions() {
    return ctx?.C?.MUTE_PERIODS || [];
  }

  function defaultStrikePeriods() {
    return global.AutomuteDefaults?.DEFAULT_STRIKE_PERIODS || ['10 minutes', '1 hour', '1 day', '1 week'];
  }

  function ruleMutePeriods(rule) {
    if (Array.isArray(rule?.mutePeriods) && rule.mutePeriods.length) return rule.mutePeriods;
    return defaultStrikePeriods();
  }

  function fillPeriodSelect(id, value) {
    const el = $(id);
    if (!el) return;
    const periods = mutePeriodOptions();
    el.innerHTML = periods.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    const v = String(value || periods[0] || '10 minutes');
    el.value = periods.includes(v) ? v : periods[0] || '10 minutes';
  }

  function ruleMeta(rule) {
    const d = ruleMutePeriods(rule).join(' → ');
    const pCount = (rule.patterns || []).length;
    const snd = rule.notifyEnabled === false ? ' · kein Sound' : ' · Sound';
    const chat = rule.chatNotifyEnabled ? ' · Chat' : '';
    return `${pCount} Pattern · ${d || '—'}${snd}${chat}`;
  }

  function fillNotifySoundSelect(el, selected) {
    const custom = ctx?.state?.settings?.customNotifySounds || [];
    global.NotifySounds?.fillSoundSelect?.(el, custom, selected);
  }

  async function persistRules(rules) {
    ctx.state.settings = await ctx.modHub.saveSettings({ autoMuteRules: rules });
    renderRuleList();
    refreshStatus();
  }

  async function persistToggles() {
    ctx.state.settings = await ctx.modHub.saveSettings({
      automuteEnabled: $('automuteTabEnabled')?.checked !== false,
      automuteDryRun: $('automuteTabDryRun')?.checked !== false
    });
    refreshStatus();
  }

  function setStatus(text) {
    const el = $('automuteTabStatus');
    if (el) el.textContent = text || '—';
  }

  async function refreshStatus() {
    const el = $('automuteTabStatus');
    if (!el || !ctx?.modHub?.automuteStatus) return;
    try {
      const res = await ctx.modHub.automuteStatus();
      if (!res?.ok) {
        el.textContent = '—';
        return;
      }
      const mode = res.dryRun ? 'Dry-Run' : 'Live-Mute';
      const on = $('automuteTabEnabled')?.checked !== false ? 'an' : 'aus';
      el.textContent = `${mode} · ${on} · ${res.rules} Regel(n) · ${res.todayCount} Treffer heute`;
    } catch (_) {
      el.textContent = '—';
    }
  }

  function renderRuleList() {
    const list = $('automuteRuleList');
    if (!list) return;
    const rules = ensureRulesLoaded();
    if (!rules.length) {
      list.innerHTML = '<p class="hint automute-empty">Noch keine Regeln.</p>';
      return;
    }
    list.innerHTML = rules
      .map((r) => {
        const off = r.enabled === false ? ' is-off' : '';
        return `<div class="automute-row${off}" data-id="${esc(r.id)}">
          <div class="automute-row-body">
            <span class="automute-row-title">${esc(r.label || 'Regel')}${r.enabled === false ? ' <span class="hint">(aus)</span>' : ''}</span>
            <span class="automute-row-preview">${esc((r.patterns || []).slice(0, 3).join(' · '))}</span>
            <span class="automute-row-meta">${esc(ruleMeta(r))}</span>
          </div>
          <label class="check automute-row-toggle" title="Regel aktiv"><input type="checkbox" data-action="toggle" ${r.enabled !== false ? 'checked' : ''} /></label>
        </div>`;
      })
      .join('');
  }

  async function refreshRecentMutes() {
    const el = $('automuteRecentList');
    if (!el || !ctx?.modHub?.automuteLog) return;
    try {
      const res = await ctx.modHub.automuteLog(25);
      const log = (res?.log || []).filter((e) => (e.ok || e.dryRun) && (e.preview || e.username));
      if (!log.length) {
        el.innerHTML = '<p class="hint">Noch keine Automutes.</p>';
        return;
      }
      el.innerHTML = log
        .map((e) => {
          const ts = new Date(e.at || Date.now()).toLocaleString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
          const mode = e.dryRun ? 'dry' : 'live';
          const modeLabel = e.dryRun ? 'Dry-Run' : 'Gemuted';
          const duration = e.expire || '—';
          const strike = e.strike != null ? `Strike ${e.strike}` : '';
          const msg = e.preview || '—';
          return `<div class="automute-recent-item automute-recent-item--${mode}">
            <div class="automute-recent-top">
              <span class="automute-recent-user">@${esc(e.username)}</span>
              <span class="automute-recent-badge">${esc(modeLabel)}</span>
            </div>
            <div class="automute-recent-meta">${esc(strike)}${strike && duration ? ' · ' : ''}${esc(duration)}</div>
            <div class="automute-recent-msg">${esc(msg)}</div>
            <div class="automute-recent-foot">
              <span class="automute-recent-rule">${esc(e.ruleLabel || e.ruleId)}</span>
              <span class="automute-recent-time">${esc(ts)}</span>
            </div>
          </div>`;
        })
        .join('');
    } catch (_) {
      el.innerHTML = '<p class="hint">Feed nicht ladbar.</p>';
    }
  }

  async function refreshLog() {
    await refreshRecentMutes();
  }

  function readEditorRule() {
    const parseLines = (ta) =>
      String(ta?.value || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    const periods = defaultStrikePeriods();
    return {
      label: ($('automuteEditLabel')?.value || '').trim() || 'Regel',
      enabled: $('automuteEditEnabled')?.checked !== false,
      matchAll: !!$('automuteEditMatchAll')?.checked,
      patterns: parseLines($('automuteEditPatterns')),
      minLength: Math.max(0, Number($('automuteEditMinLength')?.value) || 0),
      muteReason: ($('automuteEditReason')?.value || '').trim() || 'low quality chat / spam',
      mutePeriods: [
        $('automuteEditDur1')?.value || periods[0],
        $('automuteEditDur2')?.value || periods[1],
        $('automuteEditDur3')?.value || periods[2],
        $('automuteEditDur4')?.value || periods[3]
      ],
      chatNotifyEnabled: !!$('automuteEditChatNotifyEnabled')?.checked,
      chatNotifyText: ($('automuteEditChatNotifyText')?.value || '').trim(),
      notifyEnabled: $('automuteEditNotifyEnabled')?.checked !== false,
      notifySound: $('automuteEditNotifySound')?.value || '5'
    };
  }

  function fillEditor(rule) {
    $('automuteEditLabel').value = rule?.label || '';
    $('automuteEditEnabled').checked = rule?.enabled !== false;
    $('automuteEditMatchAll').checked = !!rule?.matchAll;
    $('automuteEditPatterns').value = (rule?.patterns || []).join('\n');
    $('automuteEditMinLength').value = String(rule?.minLength ?? 0);
    $('automuteEditReason').value = rule?.muteReason || 'low quality chat / spam';
    const d = ruleMutePeriods(rule);
    fillPeriodSelect('automuteEditDur1', d[0]);
    fillPeriodSelect('automuteEditDur2', d[1]);
    fillPeriodSelect('automuteEditDur3', d[2]);
    fillPeriodSelect('automuteEditDur4', d[3]);
    if ($('automuteEditChatNotifyEnabled')) {
      $('automuteEditChatNotifyEnabled').checked = !!rule?.chatNotifyEnabled;
    }
    if ($('automuteEditChatNotifyText')) {
      $('automuteEditChatNotifyText').value =
        rule?.chatNotifyText || '@user Muted - Account Trading - Deutsche Chatregeln';
    }
    if ($('automuteEditNotifyEnabled')) {
      $('automuteEditNotifyEnabled').checked = rule?.notifyEnabled !== false;
    }
    fillNotifySoundSelect($('automuteEditNotifySound'), rule?.notifySound || '5');
    updateTestPreview();
  }

  async function updateTestPreview() {
    const out = $('automuteTestResult');
    if (!out) return;
    const sample = ($('automuteTestText')?.value || '').trim();
    if (!sample) {
      out.textContent = 'Beispieltext eingeben und Test klicken.';
      return;
    }
    const draft = readEditorRule();
    const username = ($('automuteTestUser')?.value || '').trim();
    const rules = editId
      ? [{ ...draft, id: editId, matchMode: 'contains' }]
      : ensureRulesLoaded();
    try {
      const res = await ctx.modHub.automuteTest({
        message: sample,
        username,
        rules
      });
      const r = res?.result;
      if (!r?.match) {
        out.textContent = 'Kein Treffer.';
        return;
      }
      out.textContent = `Treffer: „${r.ruleLabel}“ · Strike ${r.strike} → ${r.expire} (${r.muteReason})${r.chatNotifyText ? ` · Chat: ${r.chatNotifyText}` : ''}`;
    } catch (e) {
      out.textContent = `Fehler: ${e.message || e}`;
    }
  }

  function openEditor(id) {
    editId = id || null;
    const rules = ensureRulesLoaded();
    const existing = id ? rules.find((r) => r.id === id) : null;
    $('automuteEditTitle').textContent = existing ? 'Regel bearbeiten' : 'Neue Regel';
    $('btnAutomuteEditDelete')?.classList.toggle('hidden', !existing);
    fillEditor(
      existing || {
        label: '',
        enabled: false,
        patterns: [],
        minLength: 20,
        muteReason: 'low quality chat / spam',
        mutePeriods: defaultStrikePeriods(),
        chatNotifyEnabled: false,
        chatNotifyText: '@user Muted - Account Trading - Deutsche Chatregeln',
        notifyEnabled: true,
        notifySound: '5'
      }
    );
    $('automuteEditModal')?.classList.remove('hidden');
  }

  function closeEditor() {
    editId = null;
    $('automuteEditModal')?.classList.add('hidden');
  }

  function loadFromSettings() {
    const s = ctx.state.settings || {};
    if ($('automuteTabEnabled')) $('automuteTabEnabled').checked = s.automuteEnabled !== false;
    if ($('automuteTabDryRun')) $('automuteTabDryRun').checked = s.automuteDryRun !== false;
    ensureRulesLoaded();
    renderRuleList();
    refreshStatus();
    refreshLog();
  }

  function wire() {
    $('btnAddAutomuteRule')?.addEventListener('click', () => openEditor(null));
    $('btnAutomuteRefreshRecent')?.addEventListener('click', () => refreshRecentMutes());
    $('btnAutomuteRefreshLog')?.addEventListener('click', () => refreshRecentMutes());
    $('btnAutomuteTest')?.addEventListener('click', () => updateTestPreview());
    $('automuteTestText')?.addEventListener('input', () => {
      if (($('automuteTestText')?.value || '').length > 20) updateTestPreview();
    });

    $('automuteTabEnabled')?.addEventListener('change', () => persistToggles());
    $('automuteTabDryRun')?.addEventListener('change', () => persistToggles());

    $('automuteRuleList')?.addEventListener('click', async (e) => {
      const row = e.target.closest('.automute-row');
      if (!row) return;
      const id = row.getAttribute('data-id');
      if (e.target.matches('input[data-action="toggle"]')) {
        const rules = ensureRulesLoaded().map((r) =>
          r.id === id ? { ...r, enabled: e.target.checked } : r
        );
        await persistRules(rules);
        return;
      }
      if (!e.target.closest('label')) openEditor(id);
    });

    $('automuteRuleList')?.addEventListener('dblclick', (e) => {
      const row = e.target.closest('.automute-row');
      if (!row || e.target.closest('input')) return;
      openEditor(row.getAttribute('data-id'));
    });

    $('btnAutomuteEditCancel')?.addEventListener('click', () => closeEditor());
    $('automuteEditModal')?.addEventListener('click', (e) => {
      if (e.target === $('automuteEditModal')) closeEditor();
    });

    $('btnAutomuteEditSave')?.addEventListener('click', async () => {
      const draft = readEditorRule();
      if (!draft.patterns.length) {
        setStatus('Mindestens ein Pattern angeben.');
        return;
      }
      const rules = ensureRulesLoaded().slice();
      if (editId) {
        const idx = rules.findIndex((r) => r.id === editId);
        if (idx >= 0) rules[idx] = { ...rules[idx], ...draft, matchMode: 'contains' };
      } else {
        rules.push({
          id: global.AutomuteDefaults?.newAutoMuteRuleId?.() || `am-${Date.now()}`,
          ...draft,
          matchMode: 'contains'
        });
      }
      await persistRules(rules);
      closeEditor();
      setStatus(`„${draft.label}“ gespeichert.`);
    });

    $('btnAutomuteEditDelete')?.addEventListener('click', async () => {
      if (!editId) return;
      const rules = ensureRulesLoaded().filter((r) => r.id !== editId);
      await persistRules(rules);
      closeEditor();
      setStatus('Regel gelöscht.');
    });

    $('btnAutomuteResetDefaults')?.addEventListener('click', async () => {
      const defs = global.AutomuteDefaults?.DEFAULT_AUTOMUTE_RULES?.map((r) => ({
        ...r,
        patterns: [...r.patterns]
      }));
      if (!defs?.length) return;
      await persistRules(defs);
      setStatus('Standard-Regeln wiederhergestellt.');
    });

    $('btnAutomuteTestNotifySound')?.addEventListener('click', () => {
      const sound = $('automuteEditNotifySound')?.value || '5';
      global.NotifySounds?.playNotifySound?.(sound, ctx.modHub);
    });
  }

  function onTabShow() {
    loadFromSettings();
  }

  function onAutomuteAction(entry) {
    refreshStatus();
    refreshLog();
    if (entry?.notifyEnabled !== false && entry?.ok) {
      global.NotifySounds?.playNotifySound?.(entry.notifySound || '5', ctx?.modHub);
    }
  }

  function refreshSoundSelects() {
    fillNotifySoundSelect($('automuteEditNotifySound'), $('automuteEditNotifySound')?.value);
  }

  function init(context) {
    ctx = context;
    wire();
    loadFromSettings();
  }

  global.AutomutePanel = { init, onTabShow, onAutomuteAction, refreshStatus, refreshSoundSelects };
})(typeof window !== 'undefined' ? window : global);
