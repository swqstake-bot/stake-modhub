/* global modHub, StakeModPolicy */
(function () {
  'use strict';

  const MAX_PICKS = 2;

  const state = {
    data: null,
    detailUser: null,
    picks: [],
    picksMonth: '',
    blueprints: { mute: [] },
    loading: false,
    enforcementBucket: 'spam',
    sort: {
      friendlist: { col: 'friendMatchScore', dir: 'desc' },
      enforcement: {
        spam: { col: 'spamMatch', dir: 'desc' },
        toxic: { col: 'toxicMatch', dir: 'desc' },
        bot: { col: 'muteMatchScore', dir: 'desc' },
        begging: { col: 'beggingMatch', dir: 'desc' },
        other: { col: 'muteMatchScore', dir: 'desc' }
      }
    }
  };

  const STAT_HELP = {
    rank: 'Position nach aktueller Sortierung.',
    user: 'Stake-Username im gewählten Zeitraum.',
    pick: 'Max. 2 Kandidaten für die Friendlist markieren.',
    activeDays: 'Kalendertage mit mindestens einer Nachricht — zeigt Regelmäßigkeit.',
    totalMessages: 'Anzahl ausgewerteter Chat-Nachrichten im Zeitraum.',
    friendMatchScore:
      '0–100: Nähe zu aktiven Stammchattern laut Mod-Studie. Höher = besserer Friendlist-Kandidat.',
    qualityScore:
      '0–100: Engagement-Score aus Regelmäßigkeit, Wortlänge, Vielfalt und @-Replies; sinkt bei Spam-Mustern.',
    avgWordsPerMessage: 'Durchschnittliche Wörter pro Nachricht — Unterhaltung vs. Ein-Wort-Spam.',
    lowQualityRatio:
      'Anteil Low-Quality-Nachrichten: gz, bust, Kurztext, Emoji-Flut, Community-Kürzel.',
    replyRatio: 'Anteil Nachrichten mit @-Erwähnung — echtes Gespräch statt Ein-Weg-Spam.',
    spamMatch:
      '0–100: Ähnlichkeit mit echten Spam-Mutes (LQ, GZ-Anteil am Chat, Kurztext). Kalibriert an 45 Fälle.',
    toxicMatch: '0–100: Ähnlichkeit mit echten Toxic-Mutes (Beleidigungen, Hass). Kalibriert an 14 Fälle.',
    muteMatchScore: '0–100: Höchster kalibrierter Match-Score der zugeordneten Kategorie.',
    beggingMatch:
      '0–100: Bettel-/Rain-/Tip-Muster — Rain-Bitten, Spendenfragen, @-Tip-Druck.',
    beggingRatio: 'Anteil Nachrichten mit Bettel-Heuristik (Rain, Tip, Spende, Borgen).',
    toxicRatio: 'Anteil Nachrichten mit Toxic-Heuristik (Beleidigung, Aggression, Hass).',
    gzBustRatio:
      'Anteil gz/bust an allen Nachrichten — relativ zur Chat-Aktivität. Wichtiger als gz× absolut.',
    enforcementTier:
      'Zuordnung: Spam, Toxic, Bot, Bettel, Multi, Flood oder Grenzfall (unscharfe Signale, manuell prüfen).',
    flags: 'Kurzsignale (Chips) — vor allem bei Grenzfällen. User anklicken für Beispiel-Nachrichten.',
    action: 'Hub öffnet den User im Mod-Hub; Mute startet Validierung + Mute mit passendem Blueprint.'
  };

  const FRIENDLIST_COLS = [
    { key: 'pick', label: '☑', helpKey: 'pick' },
    { key: 'rank', label: '#', helpKey: 'rank' },
    { key: 'user', label: 'User', sortKey: 'username', helpKey: 'user' },
    { key: 'activeDays', label: 'Tage', sortKey: 'activeDays', num: true, helpKey: 'activeDays' },
    { key: 'totalMessages', label: 'Msgs', sortKey: 'totalMessages', num: true, helpKey: 'totalMessages' },
    {
      key: 'friendMatchScore',
      label: 'Match',
      sortKey: 'friendMatchScore',
      num: true,
      helpKey: 'friendMatchScore'
    },
    { key: 'qualityScore', label: 'Qualität', sortKey: 'qualityScore', num: true, helpKey: 'qualityScore' },
    {
      key: 'avgWordsPerMessage',
      label: 'Ø Wörter',
      sortKey: 'avgWordsPerMessage',
      num: true,
      helpKey: 'avgWordsPerMessage'
    },
    { key: 'lowQualityRatio', label: 'LQ', sortKey: 'lowQualityRatio', num: true, helpKey: 'lowQualityRatio' },
    { key: 'replyRatio', label: '@Reply', sortKey: 'replyRatio', num: true, helpKey: 'replyRatio' },
    { key: 'action', label: 'Aktion', helpKey: 'action' }
  ];

  const TIER_SORT = { bot: 0, spam: 1, toxic: 2, begging: 3, coord: 4, flood: 5, review: 6 };

  function enforcementCols(bucket) {
    const meta = ENF_BUCKET_META[bucket] || ENF_BUCKET_META.spam;
    const matchKey =
      bucket === 'spam'
        ? 'spamMatch'
        : bucket === 'toxic'
          ? 'toxicMatch'
          : bucket === 'begging'
            ? 'beggingMatch'
            : 'muteMatchScore';
    const matchHelp =
      bucket === 'spam'
        ? 'spamMatch'
        : bucket === 'toxic'
          ? 'toxicMatch'
          : bucket === 'begging'
            ? 'beggingMatch'
            : 'muteMatchScore';
    const base = [
      { key: 'rank', label: '#', helpKey: 'rank' },
      { key: 'user', label: 'User', sortKey: 'username', helpKey: 'user' }
    ];
    if (bucket === 'other') {
      return [
        ...base,
        {
          key: 'enforcementTier',
          label: 'Stufe',
          sortKey: 'enforcementTier',
          helpKey: 'enforcementTier'
        },
        { key: 'match', label: meta.matchLabel, sortKey: matchKey, num: true, helpKey: matchHelp },
        { key: 'totalMessages', label: 'Msgs', sortKey: 'totalMessages', num: true, helpKey: 'totalMessages' },
        { key: 'flags', label: 'Flags', sortKey: 'flags', helpKey: 'flags' },
        { key: 'action', label: 'Aktion', helpKey: 'action' }
      ];
    }
    if (bucket === 'toxic') {
      return [
        ...base,
        { key: 'match', label: meta.matchLabel, sortKey: matchKey, num: true, helpKey: matchHelp },
        { key: 'totalMessages', label: 'Msgs', sortKey: 'totalMessages', num: true, helpKey: 'totalMessages' },
        { key: 'toxicRatio', label: 'Toxic', sortKey: 'toxicRatio', num: true, helpKey: 'toxicRatio' },
        { key: 'lowQualityRatio', label: 'LQ', sortKey: 'lowQualityRatio', num: true, helpKey: 'lowQualityRatio' },
        { key: 'action', label: 'Aktion', helpKey: 'action' }
      ];
    }
    if (bucket === 'begging') {
      return [
        ...base,
        { key: 'match', label: meta.matchLabel, sortKey: matchKey, num: true, helpKey: matchHelp },
        { key: 'totalMessages', label: 'Msgs', sortKey: 'totalMessages', num: true, helpKey: 'totalMessages' },
        { key: 'beggingRatio', label: 'Bettel', sortKey: 'beggingRatio', num: true, helpKey: 'beggingRatio' },
        { key: 'replyRatio', label: '@Reply', sortKey: 'replyRatio', num: true, helpKey: 'replyRatio' },
        { key: 'action', label: 'Aktion', helpKey: 'action' }
      ];
    }
    const cols = [
      ...base,
      { key: 'match', label: meta.matchLabel, sortKey: matchKey, num: true, helpKey: matchHelp },
      { key: 'totalMessages', label: 'Msgs', sortKey: 'totalMessages', num: true, helpKey: 'totalMessages' },
      { key: 'lowQualityRatio', label: 'LQ', sortKey: 'lowQualityRatio', num: true, helpKey: 'lowQualityRatio' },
      { key: 'gzBustRatio', label: 'GZ %', sortKey: 'gzBustRatio', num: true, helpKey: 'gzBustRatio' }
    ];
    if (bucket === 'spam') {
      cols.push({
        key: 'toxicRatio',
        label: 'Toxic',
        sortKey: 'toxicRatio',
        num: true,
        helpKey: 'toxicRatio'
      });
    }
    cols.push({ key: 'action', label: 'Aktion', helpKey: 'action' });
    return cols;
  }

  const ENF_BUCKET_META = {
    spam: {
      label: 'Spam / LQ',
      hint: 'gz-Wiederholer, Kurztext, hoher LQ-Anteil — kalibriert an Spam-Mutes.',
      matchLabel: 'Spam-Match',
      cols: 8
    },
    toxic: {
      label: 'Toxic',
      hint: 'Beleidigungen, Hass, Eskalation — kalibriert an Toxic-Mutes.',
      matchLabel: 'Toxic-Match',
      cols: 7
    },
    bot: {
      label: 'Bot-Verdacht',
      hint: 'Rhythmus, Flood-Muster, Bot-Signale.',
      matchLabel: 'Match',
      cols: 7
    },
    begging: {
      label: 'Bettler',
      hint: 'Rain-/Tip-Bitten, Spendenfragen, @-Druck — Bettel-Match.',
      matchLabel: 'Bettel-Match',
      cols: 7
    },
    other: {
      label: 'Weitere',
      hint: 'Multi-Account, Grenzfälle — unscharfe Signale manuell prüfen.',
      matchLabel: 'Match',
      cols: 7
    }
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function attrEsc(s) {
    return String(s ?? '').replace(/"/g, '&quot;');
  }

  function pct(v) {
    return `${Math.round((Number(v) || 0) * 100)}%`;
  }

  function flagsSortKey(row) {
    const chips = row.chips || [];
    const labels = chips.map((c) => c.label).join(' ');
    return `${String(chips.length).padStart(2, '0')}|${labels.toLowerCase()}`;
  }

  function sortValue(row, col, bucket) {
    if (col === 'username') return (row.username || '').toLowerCase();
    if (col === 'flags') return flagsSortKey(row);
    if (col === 'enforcementTier') return TIER_SORT[row.enforcementTier] ?? 9;
    if (col === 'spamMatch' || col === 'toxicMatch' || col === 'beggingMatch' || col === 'muteMatchScore') {
      return Number(row[col]) || 0;
    }
    if (col === 'match') return bucketMatchValue(row, bucket);
    const v = row[col];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    return Number(v) || 0;
  }

  function sortRows(rows, col, dir, bucket) {
    const list = [...rows];
    const mult = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const av = sortValue(a, col, bucket);
      const bv = sortValue(b, col, bucket);
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv, 'de') * mult;
      }
      return (av - bv) * mult;
    });
    return list;
  }

  function renderTableHead(theadId, cols, sortState, tableId) {
    const head = $(theadId);
    if (!head) return;
    head.innerHTML = `<tr>${cols
      .map((c) => {
        if (!c.sortKey) {
          return `<th${c.num ? ' class="num"' : ''} title="${esc(STAT_HELP[c.helpKey] || '')}">${esc(c.label)}</th>`;
        }
        const active = sortState.col === c.sortKey;
        const arrow = active ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : '';
        const cls = ['analyse-sort', c.num ? 'num' : '', active ? 'analyse-sort-active' : '']
          .filter(Boolean)
          .join(' ');
        return `<th class="${cls}" data-sort="${esc(c.sortKey)}" data-table="${esc(tableId)}" title="${esc(STAT_HELP[c.helpKey] || '')} — Klicken zum Sortieren">${esc(c.label)}${arrow}</th>`;
      })
      .join('')}</tr>`;
  }

  function renderStatLegend(cols, bodyId) {
    const el = $(bodyId);
    if (!el) return;
    el.innerHTML = cols
      .filter((c) => c.helpKey && STAT_HELP[c.helpKey])
      .map(
        (c) =>
          `<dt>${esc(c.label)}</dt><dd>${esc(STAT_HELP[c.helpKey])}</dd>`
      )
      .join('');
  }

  function colSpanFor(cols) {
    return cols.length;
  }

  function handleSortClick(tableId, sortKey) {
    if (!sortKey) return;
    if (tableId === 'friendlist') {
      const s = state.sort.friendlist;
      if (s.col === sortKey) s.dir = s.dir === 'asc' ? 'desc' : 'asc';
      else {
        s.col = sortKey;
        s.dir = sortKey === 'username' ? 'asc' : 'desc';
      }
      renderFriendlist();
      return;
    }
    const bucket = state.enforcementBucket || 'spam';
    const s = state.sort.enforcement[bucket];
    if (!s) return;
    if (s.col === sortKey) s.dir = s.dir === 'asc' ? 'desc' : 'asc';
    else {
      s.col = sortKey;
      s.dir = sortKey === 'username' || sortKey === 'enforcementTier' || sortKey === 'flags' ? 'asc' : 'desc';
    }
    renderEnforcement();
  }

  function picksStorageKey(monthKey) {
    return `modhub-friendlist-picks-${monthKey || 'default'}`;
  }

  function currentMonthKey() {
    const r = state.data?.range;
    if (r?.fromMs) {
      const d = new Date(r.fromMs);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  }

  function loadPicks(monthKey) {
    try {
      const raw = localStorage.getItem(picksStorageKey(monthKey));
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(0, MAX_PICKS) : [];
    } catch (_) {
      return [];
    }
  }

  function savePicks() {
    localStorage.setItem(picksStorageKey(state.picksMonth), JSON.stringify(state.picks));
    renderPicksBar();
  }

  function renderPicksBar() {
    const el = $('analysePicksLabel');
    if (!el) return;
    if (!state.picks.length) {
      el.textContent = 'Auswahl: noch niemand (0/2)';
      return;
    }
    el.innerHTML = `Auswahl <strong>${state.picks.length}/${MAX_PICKS}</strong>: ${state.picks.map((u) => esc(u)).join(', ')}`;
  }

  function findBlueprint(substr) {
    const list = state.blueprints.mute || [];
    const low = substr.toLowerCase();
    const hit = list.find((b) => b.toLowerCase().includes(low));
    return hit || '';
  }

  function suggestMuteExpire(categoryId) {
    const Policy = window.StakeModPolicy || {};
    const mins = Policy.getSuggestedMinutes?.(categoryId, 0);
    if (mins == null) return '1 day';
    return Policy.minutesToDurationString?.(mins) || '1 day';
  }

  function validateUser(name) {
    const field = $('validateUsername');
    if (!field || !name) return;
    field.value = name.replace(/^@/, '');
    field.focus();
    $('btnValidate')?.click();
    document.querySelector('.tab[data-tab="hub"]')?.click();
  }

  function findRow(username) {
    if (!username || !state.data?.userIndex) return null;
    return state.data.userIndex[username.toLowerCase()] || null;
  }

  function showDetail(row) {
    state.detailUser = row;
    const box = $('analyseDetail');
    if (!box) return;
    box.classList.remove('hidden');
    $('analyseDetailTitle').textContent = row.username;
    const chips = $('analyseDetailChips');
    chips.innerHTML = (row.chips || [])
      .map((c) => `<span class="analyse-chip analyse-chip-${c.severity || 'med'}">${esc(c.label)}</span>`)
      .join('');
    if (row.mutedLocal) chips.innerHTML += '<span class="analyse-chip analyse-chip-muted">Gemutet (lokal)</span>';
    if (row.warnedLocal) chips.innerHTML += '<span class="analyse-chip analyse-chip-muted">Gewarnt (lokal)</span>';
    if (row.veri2) chips.innerHTML += '<span class="analyse-chip">Veri2</span>';
    if (row.duplicateIpWith?.length) {
      chips.innerHTML += `<span class="analyse-chip analyse-chip-med">IP-Dup: ${esc(row.duplicateIpWith.join(', '))}</span>`;
    }
    if (row.topRepeatText) {
      chips.innerHTML += `<span class="analyse-chip">Top-Wdh: ${esc(row.topRepeatText.slice(0, 40))}</span>`;
    }
    if (row.coordPartners?.length) {
      chips.innerHTML += `<span class="analyse-chip analyse-chip-med">Multi mit: ${esc(row.coordPartners.join(', '))}</span>`;
    }
    if (row.friendMatchScore != null) {
      chips.innerHTML += `<span class="analyse-chip analyse-chip-good">Friend-Match ${row.friendMatchScore}</span>`;
      chips.innerHTML += `<span class="analyse-chip">LQ ${pct(row.lowQualityRatio || 0)} · @ ${pct(row.replyRatio || 0)} · Ø ${row.avgWordsPerMessage ?? '—'} Wörter</span>`;
    }
    if (row.firstDaySuspicious) {
      chips.innerHTML += `<span class="analyse-chip analyse-chip-med">Ersttag: ${row.firstDayMessages} Msgs, LQ ${Math.round((row.firstDayLowQualityRatio || 0) * 100)}%</span>`;
    }
    const ul = $('analyseDetailMsgs');
    const samples = row.sampleMessages || [];
    const flagged = samples.filter((m) => m.reason).length;
    const hintEl = $('analyseDetailMsgsHint');
    if (hintEl) {
      if (!samples.length) {
        hintEl.textContent = 'Keine Nachrichten im Zeitraum.';
      } else if (flagged) {
        hintEl.textContent = `${flagged} auffällige Beispiele (markiert) — Rest = Kontext, neueste zuerst.`;
      } else {
        hintEl.textContent = 'Keine klaren Treffer isoliert — zeigt die neuesten Nachrichten als Kontext.';
      }
    }
    ul.innerHTML = samples
      .map((m) => {
        const gap = m.gapSec != null ? ` <span class="analyse-gap">+${m.gapSec}s</span>` : '';
        const tag = m.reason
          ? ` <span class="analyse-msg-tag" title="Warum diese Nachricht gewählt wurde">${esc(m.reason)}</span>`
          : '';
        return `<li><time>${esc(m.time)}</time>${gap}${tag}<span>${esc(m.message)}</span></li>`;
      })
      .join('');
    $('btnAnalyseMuteBot').style.display = row.enforcementTier === 'bot' || row.botLevel ? '' : 'none';
  }

  function hideDetail() {
    state.detailUser = null;
    $('analyseDetail')?.classList.add('hidden');
  }

  function setPick(username, checked) {
    const key = username.toLowerCase();
    const idx = state.picks.findIndex((p) => p.toLowerCase() === key);
    if (checked && idx < 0 && state.picks.length < MAX_PICKS) {
      state.picks.push(username);
    } else if (!checked && idx >= 0) {
      state.picks.splice(idx, 1);
    }
    savePicks();
    renderFriendlist();
  }

  function tierLabel(tier) {
    return (
      {
        bot: 'Bot',
        coord: 'Multi',
        begging: 'Bettel',
        flood: 'Flood',
        toxic: 'Toxic',
        spam: 'Spam',
        review: 'Grenzfall'
      }[tier] || tier
    );
  }

  function resolvePreset() {
    return $('analysePreset')?.value || 'month';
  }

  function syncPresetUi() {
    const mode = $('analyseMode')?.value || 'friendlist';
    const presetEl = $('analysePreset');
    const labelEl = $('analysePresetLabel');
    if (!presetEl) return;
    if (mode === 'friendlist') {
      presetEl.value = 'month';
      presetEl.disabled = true;
      if (labelEl) labelEl.title = 'Friendlist nutzt immer den Kalendermonat';
    } else {
      presetEl.disabled = false;
      if (labelEl) labelEl.title = '';
    }
  }

  function syncLoadButton() {
    const btn = $('btnAnalyseReload');
    if (!btn) return;
    btn.textContent = state.data?.ok ? 'Neu laden' : 'Laden';
  }

  function renderFriendlist() {
    const tbody = $('analyseFriendlistBody');
    const cols = FRIENDLIST_COLS;
    const colSpan = colSpanFor(cols);
    renderTableHead('analyseFriendlistHead', cols, state.sort.friendlist, 'friendlist');
    renderStatLegend(cols, 'analyseFriendlistLegendBody');
    if (!tbody) return;
    if (!state.data?.ok) {
      tbody.innerHTML = `<tr><td colspan="${colSpan}" class="hint">Auf „Laden“ klicken…</td></tr>`;
      return;
    }
    const raw = state.data?.friendlist || [];
    if (!raw.length) {
      tbody.innerHTML = `<tr><td colspan="${colSpan}" class="hint">Keine Kandidaten — Filter lockern oder mehr Chat-Tage loggen.</td></tr>`;
      return;
    }
    const rows = sortRows(raw, state.sort.friendlist.col, state.sort.friendlist.dir, null);
    tbody.innerHTML = rows
      .map((r, i) => {
        const picked = state.picks.some((p) => p.toLowerCase() === r.username.toLowerCase());
        const disabled = !picked && state.picks.length >= MAX_PICKS;
        const muteCls = r.mutedLocal || r.warnedLocal ? ' analyse-row-muted' : '';
        const u = attrEsc(r.username);
        return `<tr class="analyse-row${muteCls}">
          <td><input type="checkbox" class="analyse-pick" data-user="${u}" ${picked ? 'checked' : ''} ${disabled ? 'disabled' : ''} /></td>
          <td class="num">${i + 1}</td>
          <td><button type="button" class="linklike analyse-user-btn" data-user="${u}">${esc(r.username)}</button></td>
          <td class="num">${r.activeDays}</td>
          <td class="num">${r.totalMessages}</td>
          <td class="num analyse-good">${r.friendMatchScore ?? '—'}</td>
          <td class="num">${r.qualityScore}</td>
          <td class="num">${r.avgWordsPerMessage ?? '—'}</td>
          <td class="num">${pct(r.lowQualityRatio || 0)}</td>
          <td class="num">${pct(r.replyRatio || 0)}</td>
          <td><button type="button" class="sm analyse-validate" data-user="${u}">Hub</button></td>
        </tr>`;
      })
      .join('');
    renderPicksBar();
  }

  function bucketRows(bucket) {
    const buckets = state.data?.enforcementBuckets;
    if (buckets?.[bucket]?.length) return buckets[bucket];
    if (!bucket || bucket === 'spam') return state.data?.enforcement || [];
    return [];
  }

  function bucketMatchValue(row, bucket) {
    if (bucket === 'spam') return row.spamMatch ?? row.muteMatchScore ?? row.riskScore;
    if (bucket === 'toxic') return row.toxicMatch ?? row.muteMatchScore ?? row.riskScore;
    if (bucket === 'begging') return row.beggingMatch ?? row.muteMatchScore ?? row.riskScore;
    return row.muteMatchScore ?? row.riskScore;
  }

  function renderEnforcementHead(bucket) {
    const cols = enforcementCols(bucket);
    const sortState = state.sort.enforcement[bucket] || state.sort.enforcement.spam;
    renderTableHead('analyseEnforcementHead', cols, sortState, 'enforcement');
    renderStatLegend(cols, 'analyseEnforcementLegendBody');
    return cols;
  }

  function renderEnforcementRow(r, i, bucket) {
    const muteCls = r.mutedLocal ? ' analyse-row-muted' : '';
    const u = attrEsc(r.username);
    const muteDisabled = r.mutedLocal ? ' disabled title="Bereits gemutet (lokal)"' : '';
    const match = bucketMatchValue(r, bucket);
    const act = `<td class="analyse-act">
            <button type="button" class="sm analyse-validate" data-user="${u}">Hub</button>
            <button type="button" class="sm danger analyse-mute-spam" data-user="${u}"${muteDisabled}>Mute</button>
          </td>`;
    if (bucket === 'toxic') {
      return `<tr class="analyse-row${muteCls}">
          <td class="num">${i + 1}</td>
          <td><button type="button" class="linklike analyse-user-btn" data-user="${u}">${esc(r.username)}</button></td>
          <td class="num analyse-bad">${match}</td>
          <td class="num">${r.totalMessages}</td>
          <td class="num">${pct(r.toxicRatio || 0)}</td>
          <td class="num">${pct(r.lowQualityRatio || 0)}</td>
          ${act}
        </tr>`;
    }
    if (bucket === 'bot') {
      return `<tr class="analyse-row${muteCls}">
          <td class="num">${i + 1}</td>
          <td><button type="button" class="linklike analyse-user-btn" data-user="${u}">${esc(r.username)}</button></td>
          <td class="num analyse-bad">${match}</td>
          <td class="num">${r.totalMessages}</td>
          <td class="num">${pct(r.lowQualityRatio || 0)}</td>
          <td class="num">${pct(r.gzBustRatio || 0)}</td>
          ${act}
        </tr>`;
    }
    if (bucket === 'begging') {
      return `<tr class="analyse-row${muteCls}">
          <td class="num">${i + 1}</td>
          <td><button type="button" class="linklike analyse-user-btn" data-user="${u}">${esc(r.username)}</button></td>
          <td class="num analyse-bad">${match}</td>
          <td class="num">${r.totalMessages}</td>
          <td class="num">${pct(r.beggingRatio || 0)}</td>
          <td class="num">${pct(r.replyRatio || 0)}</td>
          ${act}
        </tr>`;
    }
    if (bucket === 'other') {
      const chips = (r.chips || []).map((c) => esc(c.label)).join(' · ');
      return `<tr class="analyse-row${muteCls}">
          <td class="num">${i + 1}</td>
          <td><button type="button" class="linklike analyse-user-btn" data-user="${u}">${esc(r.username)}</button></td>
          <td><span class="analyse-tier analyse-tier-${esc(r.enforcementTier)}" title="${esc(r.primarySignal || '')}">${tierLabel(r.enforcementTier)}</span></td>
          <td class="num analyse-bad">${match}</td>
          <td class="num">${r.totalMessages}</td>
          <td class="analyse-flags">${chips || '—'}</td>
          ${act}
        </tr>`;
    }
    return `<tr class="analyse-row${muteCls}">
          <td class="num">${i + 1}</td>
          <td><button type="button" class="linklike analyse-user-btn" data-user="${u}">${esc(r.username)}</button></td>
          <td class="num analyse-bad">${match}</td>
          <td class="num">${r.totalMessages}</td>
          <td class="num">${pct(r.lowQualityRatio || 0)}</td>
          <td class="num">${pct(r.gzBustRatio || 0)}</td>
          <td class="num">${pct(r.toxicRatio || 0)}</td>
          ${act}
        </tr>`;
  }

  function updateEnforcementTabs() {
    const buckets = state.data?.enforcementBuckets;
    for (const key of ['spam', 'toxic', 'bot', 'begging', 'other']) {
      const el = $(`analyseEnfCount${key.charAt(0).toUpperCase()}${key.slice(1)}`);
      if (el) el.textContent = String(buckets?.[key]?.length ?? 0);
    }
    document.querySelectorAll('.analyse-enf-tab').forEach((btn) => {
      const active = btn.dataset.bucket === state.enforcementBucket;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const hint = $('analyseEnfHint');
    if (hint) hint.textContent = ENF_BUCKET_META[state.enforcementBucket]?.hint || '';
  }

  function setEnforcementBucket(bucket) {
    if (!ENF_BUCKET_META[bucket]) return;
    state.enforcementBucket = bucket;
    updateEnforcementTabs();
    renderEnforcement();
  }

  function renderEnforcement() {
    const tbody = $('analyseEnforcementBody');
    const bucket = state.enforcementBucket || 'spam';
    const cols = renderEnforcementHead(bucket) || enforcementCols(bucket);
    const colSpan = colSpanFor(cols);
    if (!tbody) return;
    if (!state.data?.ok) {
      tbody.innerHTML = `<tr><td colspan="${colSpan}" class="hint">Auf „Laden“ klicken…</td></tr>`;
      updateEnforcementTabs();
      return;
    }
    updateEnforcementTabs();
    const sortState = state.sort.enforcement[bucket] || state.sort.enforcement.spam;
    const raw = bucketRows(bucket);
    if (!raw.length) {
      tbody.innerHTML = `<tr><td colspan="${colSpan}" class="hint">Keine Kandidaten in dieser Kategorie.</td></tr>`;
      return;
    }
    const rows = sortRows(raw, sortState.col, sortState.dir, bucket);
    tbody.innerHTML = rows.map((r, i) => renderEnforcementRow(r, i, bucket)).join('');
  }

  function updateModeUi() {
    const mode = $('analyseMode')?.value || 'friendlist';
    $('analyseFriendlistBlock')?.classList.toggle('hidden', mode !== 'friendlist');
    $('analyseEnforcementBlock')?.classList.toggle('hidden', mode !== 'enforcement');
    $('analysePicksBar')?.classList.toggle('hidden', mode !== 'friendlist');
    syncPresetUi();
  }

  function setStatus(text, isError) {
    const el = $('analyseStatus');
    if (!el) return;
    el.innerHTML = text;
    el.classList.toggle('warn', !!isError);
  }

  function setProgress(percent, detail) {
    const wrap = $('analyseProgress');
    const bar = $('analyseProgressBar');
    const pct = $('analyseProgressPct');
    const label = $('analyseProgressLabel');
    if (!wrap || !bar) return;
    wrap.classList.remove('hidden');
    const p = Math.max(0, Math.min(100, percent || 0));
    bar.style.width = `${p}%`;
    if (pct) pct.textContent = `${p}%`;
    if (label) label.textContent = detail || '';
  }

  function hideProgress() {
    $('analyseProgress')?.classList.add('hidden');
    const bar = $('analyseProgressBar');
    if (bar) bar.style.width = '0%';
    $('analyseProgressPct') && ($('analyseProgressPct').textContent = '0%');
    $('analyseProgressLabel') && ($('analyseProgressLabel').textContent = '');
  }

  function setLoadingUi(active) {
    $('panel-analyse')?.querySelector('.analyse-panel')?.classList.toggle('is-loading', !!active);
  }

  function setMeta() {
    const el = $('analyseMeta');
    if (!el || !state.data?.ok) {
      if (el) el.textContent = '';
      return;
    }
    const d = state.data;
    if (d.empty) {
      el.textContent = '';
      return;
    }
    el.innerHTML = [
      `<span><strong>${d.messagesUsed}</strong> ausgewertet</span>`,
      `<span>${d.messagesRaw} roh</span>`,
      `<span><strong>${d.users}</strong> User</span>`,
      `<span>${esc(d.rangeLabel || '')}: ${esc(d.range?.from || '')} – ${esc(d.range?.to || '')}</span>`,
      `<span>${(d.files || []).length} CSV</span>`
    ].join(' · ');
    const cal = $('analyseCalibHint');
    if (cal && d.calibration) {
      const c = d.calibration;
      const when = c.generatedAt ? new Date(c.generatedAt).toLocaleDateString('de-DE') : '—';
      cal.textContent = `${c.spamCases || 0} Spam- + ${c.toxicCases || 0} Toxic-Mutes, ${when}`;
    }
  }

  function flushUi() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  async function runAnalyse() {
    if (state.loading) {
      setStatus('Analyse läuft bereits…', false);
      return;
    }
    if (!modHub?.analyseRun) {
      setStatus('Analyse-API nicht verfügbar — App neu starten.', true);
      return;
    }
    const mode = $('analyseMode')?.value || 'friendlist';
    const preset = resolvePreset();
    state.loading = true;
    const btn = $('btnAnalyseReload');
    if (btn) btn.disabled = true;
    setLoadingUi(true);
    setStatus(preset === 'month' ? 'Monatsdaten werden geladen…' : 'Chat-Logs werden geladen…');
    setProgress(3, 'Start…');
    hideDetail();
    await flushUi();
    const offProgress = modHub.onAnalyseProgress?.((p) => {
      setProgress(p.percent, p.detail || p.phase);
    });
    try {
      const res = await modHub.analyseRun({ preset });
      state.data = res;
      if (!res || typeof res !== 'object') {
        setStatus('Fehler: Leere Antwort vom Analyse-Backend.', true);
        return;
      }
      if (!res.ok) {
        if (res.aborted) return;
        setStatus(`Fehler: ${esc(res.error || 'unbekannt')}`, true);
        return;
      }
      if (res.empty) {
        setStatus(esc(res.message || 'Keine Daten.'), true);
        $('analyseFriendlistBody').innerHTML = '<tr><td colspan="11" class="hint">—</td></tr>';
        $('analyseEnforcementBody').innerHTML = '<tr><td colspan="9" class="hint">—</td></tr>';
        setMeta();
        return;
      }
      state.picksMonth = currentMonthKey();
      state.picks = loadPicks(state.picksMonth);
      let status = `Analyse fertig — <strong>${esc(res.rangeLabel || mode)}</strong>`;
      setStatus(status);
      setMeta();
      renderFriendlist();
      renderEnforcement();
      syncLoadButton();
      setProgress(100, 'Fertig');
      await flushUi();
    } catch (err) {
      setStatus(`Fehler: ${esc(err?.message || err)}`, true);
    } finally {
      offProgress?.();
      setLoadingUi(false);
      state.loading = false;
      if (btn) btn.disabled = false;
      if (state.data?.ok) {
        setTimeout(() => hideProgress(), 800);
      } else {
        hideProgress();
      }
    }
  }

  async function muteUser(username, blueprintHint, categoryId) {
    const msg = findBlueprint(blueprintHint);
    if (!msg) {
      setStatus('Kein passender Mute-Blueprint gefunden.', true);
      return;
    }
    setStatus(`Validiere ${esc(username)}…`);
    const v = await modHub.validateUser(username.replace(/^@/, ''));
    if (!v?.ok || !v?.data?.user?.id) {
      setStatus(`User nicht gefunden: ${esc(username)}`, true);
      return;
    }
    const expire = suggestMuteExpire(categoryId || 'minor_spam_caps');
    const res = await modHub.muteUser({
      userId: v.data.user.id,
      message: msg,
      expire
    });
    if (res.ok) {
      setStatus(`Gemutet: ${esc(username)} (${esc(expire)})`);
      await runAnalyse();
    } else {
      setStatus(`Mute-Fehler: ${esc(res.error)}`, true);
    }
  }

  let wired = false;

  function wire() {
    if (wired) return;
    wired = true;
    $('btnAnalyseReload')?.addEventListener('click', () => runAnalyse());
    $('analyseMode')?.addEventListener('change', () => {
      updateModeUi();
      if (state.data?.ok) {
        renderFriendlist();
        renderEnforcement();
      }
    });
    document.querySelectorAll('.analyse-enf-tab').forEach((btn) => {
      btn.addEventListener('click', () => setEnforcementBucket(btn.dataset.bucket));
    });
    $('analysePreset')?.addEventListener('change', () => {
      if (state.data?.ok) {
        setStatus('Zeitraum geändert — bitte erneut <strong>Laden</strong>.', true);
        state.data = null;
        $('analyseMeta').textContent = '';
        renderFriendlist();
        renderEnforcement();
        syncLoadButton();
      }
    });
    $('btnAnalyseDetailClose')?.addEventListener('click', hideDetail);
    $('btnAnalyseClearPicks')?.addEventListener('click', () => {
      state.picks = [];
      savePicks();
      renderFriendlist();
    });

    $('btnAnalyseMuteSpam')?.addEventListener('click', () => {
      if (state.detailUser) {
        muteUser(state.detailUser.username, 'nonsense chat-talk/spam', 'minor_spam_caps');
      }
    });
    $('btnAnalyseMuteBot')?.addEventListener('click', () => {
      if (state.detailUser) muteUser(state.detailUser.username, 'chat-bot using', 'custom');
    });
    $('btnAnalyseModAction')?.addEventListener('click', () => {
      if (state.detailUser) {
        validateUser(state.detailUser.username);
        setTimeout(() => {
          if (typeof window.openModAction === 'function') window.openModAction('mute');
        }, 500);
      }
    });

    const panel = $('panel-analyse');
    panel?.addEventListener('change', (e) => {
      const pick = e.target.closest('.analyse-pick');
      if (pick) setPick(pick.dataset.user, pick.checked);
    });
    panel?.addEventListener('click', (e) => {
      const sortTh = e.target.closest('.analyse-sort');
      if (sortTh) {
        handleSortClick(sortTh.dataset.table, sortTh.dataset.sort);
        return;
      }
      const userBtn = e.target.closest('.analyse-user-btn');
      if (userBtn) {
        const row = findRow(userBtn.dataset.user);
        if (row) showDetail(row);
        return;
      }
      const val = e.target.closest('.analyse-validate');
      if (val) {
        validateUser(val.dataset.user);
        return;
      }
      const mute = e.target.closest('.analyse-mute-spam');
      if (mute && !mute.disabled) {
        const row = findRow(mute.dataset.user);
        const cat =
          row?.enforcementTier === 'begging'
            ? 'begging'
            : row?.enforcementTier === 'bot'
              ? 'custom'
              : row?.enforcementTier === 'toxic'
                ? 'toxic_behavior'
                : 'minor_spam_caps';
        const hint =
          row?.enforcementTier === 'bot'
            ? 'chat-bot using'
            : row?.enforcementTier === 'begging'
              ? 'begging'
              : row?.enforcementTier === 'toxic'
                ? 'toxic'
                : 'nonsense chat-talk/spam';
        muteUser(mute.dataset.user, hint, cat);
      }
    });
  }

  async function init() {
    wire();
    updateModeUi();
    syncLoadButton();
    renderTableHead('analyseFriendlistHead', FRIENDLIST_COLS, state.sort.friendlist, 'friendlist');
    renderStatLegend(FRIENDLIST_COLS, 'analyseFriendlistLegendBody');
    const bucket = state.enforcementBucket || 'spam';
    renderTableHead(
      'analyseEnforcementHead',
      enforcementCols(bucket),
      state.sort.enforcement[bucket],
      'enforcement'
    );
    renderStatLegend(enforcementCols(bucket), 'analyseEnforcementLegendBody');
    if (!modHub?.analyseRun) {
      setStatus('Analyse-API nicht verfügbar — App neu starten.', true);
      return;
    }
    try {
      const bp = await modHub.loadBlueprints();
      if (bp?.mute) state.blueprints.mute = bp.mute;
    } catch (_) {
      /* ignore */
    }
  }

  window.AnalysePanel = {
    init,
    refresh: runAnalyse,
    onTabShow() {
      updateModeUi();
      if (state.data?.ok) {
        renderFriendlist();
        renderEnforcement();
        setMeta();
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
