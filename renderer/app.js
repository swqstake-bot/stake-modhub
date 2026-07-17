/* global MODHUB_CONST, modHub, StakeModPolicy */

const C = window.MODHUB_CONST || {};
const Policy = window.StakeModPolicy || {};

const state = {
  settings: {},
  loggedIn: false,
  modUser: '',
  validatedUser: '',
  validatedUserId: '',
  validatedUserHashedIp: '',
  chatLines: [],
  rhSessions: [],
  rhActiveId: null,
  rhNextId: 1,
  chatLineUid: 0,
  rhTrivia: {
    active: false,
    solution: '',
    solutionNorm: '',
    hits: []
  },
  betCache: {},
  hitKeys: new Set(),
  convRates: {},
  convRatesAt: 0,
  hubClockTimer: null,
  autoMsgTimers: {},
  autoMsgLastSent: {},
  autoMsgInflight: new Set(),
  autoMsgEditId: null,
  autoMsgSettingsId: null,
  veri2: new Set(),
  blueprints: { chat: [], mute: [], warn: [], rh: [] },
  tagged: [],
  rains: [],
  flagged: [],
  liveFlagRoll: new Map(),
  mutedLocalSet: new Set(),
  warnedLocalSet: new Set(),
  allmsgUser: '',
  modMarkUser: '',
  chatFilterKeyword: '',
  browserVisible: false,
  rhStatusTimer: null,
  policyPending: null,
  chatHistoryLimit: 200,
  chatHistoryHighlight: '',
  muteHistoryCache: [],
  bets: [],
  betByKey: {},
  selectedBetKey: null,
  betsView: {
    filterUser: '',
    filterGame: '',
    filterDateFrom: '',
    filterDateTo: '',
    filterMinMulti: '',
    filterMaxMulti: '',
    sortCol: 'time',
    sortDir: 'desc'
  },
  liveStats: {
    wsCount: 0,
    browserCount: 0,
    lastWsAt: 0,
    lastBrowserAt: 0,
    wsSubscribed: false,
    wsHost: 'stake.bet'
  }
};

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function setHistoryOut(html, title = 'Historie') {
  if (!html) return;
  showOverlay(title, html, { html: true });
}

function chatId() {
  const room = state.settings.prefChatroom || 'German';
  return (C.CHATROOMS && C.CHATROOMS[room]) || C.CHATROOMS?.German || '';
}

function parseBetFromText(text) {
  if (window.BetIdParse?.extractPrimaryBetId) {
    return window.BetIdParse.extractPrimaryBetId(text);
  }
  const full = String(text || '');
  const betMatch = full.match(/(?:#|casino:|house:|bet[\s_-]*id[:\s]*)\s*([0-9][0-9.]*|[a-f0-9-]{36})/i);
  return betMatch ? betMatch[1].replace(/\s+/g, '') : '';
}

function stripAt(name) {
  return String(name || '').trim().replace(/^@+/, '');
}

const MOD_MENTION_FIELDS = ['muteMessage', 'warnMessage', 'chatMessage'];

/** Entfernt alle führenden @-Erwähnungen (auch mehrere hintereinander, z. B. @user1 @user2). */
function stripLeadingUserMention(message) {
  let msg = String(message || '').trim();
  const mentionRe = /^@+[\w][\w.-]*\s*/i;
  while (mentionRe.test(msg)) {
    const next = msg.replace(mentionRe, '').trim();
    if (next === msg) break;
    msg = next;
  }
  return msg;
}

function prependUserMentionForChat(message, username) {
  const name = stripAt(username);
  const body = stripLeadingUserMention(message);
  if (!name) return body;
  if (!body) return `@${name}`;
  return `@${name} ${body}`;
}

function syncModMessageMentions(username) {
  const name = stripAt(username);
  for (const id of MOD_MENTION_FIELDS) {
    const field = $(id);
    if (!field) continue;
    const body = stripLeadingUserMention(field.value);
    field.value = name ? (body ? `@${name} ${body}` : `@${name}`) : body;
  }
}

function copyBetId(text, statusEl) {
  const t = String(text || '').trim();
  if (!t) return;
  const done = () => {
    if (statusEl) {
      const prev = statusEl.textContent;
      statusEl.textContent = `Kopiert: ${t.length > 48 ? `${t.slice(0, 48)}…` : t}`;
      setTimeout(() => {
        if (statusEl.textContent.startsWith('Kopiert:')) statusEl.textContent = prev;
      }, 1600);
    }
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(t).then(done).catch(() => {});
  }
}

function formatBetPosterCell(b) {
  const first = esc(stripAt(b.username || '') || '—');
  const last = stripAt(b.lastUsername || '');
  const firstRaw = stripAt(b.username || '');
  if (last && last !== firstRaw) {
    return `${first} <span class="bet-seen" title="Zuletzt im Chat gepostet">→ ${esc(last)}</span>`;
  }
  return first;
}

function formatChatTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const tenth = Math.floor(d.getMilliseconds() / 100);
  return `${hh}:${mm}:${ss},${tenth}`;
}

function parseChatLine(username, message, kind, ts) {
  const multiMatch = String(message).match(/(\d+(?:[.,]\d+)?)\s*x/i);
  return {
    username: stripAt(username),
    message,
    kind: kind || 'text',
    ts: ts || Date.now(),
    betId: parseBetFromText(message),
    multiplier: multiMatch ? Number(multiMatch[1].replace(',', '.')) : 0,
    rhHit: false,
    modMention: false,
    idx: 0
  };
}

function buildTaggedIndexEntry(line) {
  const displayTs = line.receivedAt ?? line.ts;
  return {
    username: line.username,
    time: formatChatTime(displayTs),
    text: line.message,
    preview: line.message.slice(0, 120),
    idx: line.idx,
    uid: line.uid
  };
}

function buildFlaggedIndexEntry(line, flag) {
  const displayTs = line.receivedAt ?? line.ts;
  return {
    username: line.username,
    time: formatChatTime(displayTs),
    text: line.message,
    preview: line.message.slice(0, 120),
    idx: line.idx,
    flagLabel: flag.label,
    flagPrimary: flag.primary,
    tags: flag.tags
  };
}

function trackLiveFlagRoll(userKey, message) {
  if (!state.liveFlagRoll.has(userKey)) state.liveFlagRoll.set(userKey, []);
  const roll = state.liveFlagRoll.get(userKey);
  roll.push(message);
  if (roll.length > 30) roll.shift();
  return roll;
}

function scoreIncomingFlag(line) {
  if (!modHub?.scoreLiveMessage) return null;
  const userKey = String(line.username || '').toLowerCase();
  const recentTexts = trackLiveFlagRoll(userKey, line.message);
  return modHub.scoreLiveMessage({
    username: line.username,
    message: line.message,
    kind: line.kind,
    recentTexts,
    mutedLocal: state.mutedLocalSet.has(userKey),
    warnedLocal: state.warnedLocalSet.has(userKey),
    veri2: isVeri2(line.username),
    isModUser: isOwnModChatUser(line.username)
  });
}

async function refreshMutedWarnedSets() {
  try {
    const res = await modHub.loadMutedWarned();
    if (!res?.ok) return;
    state.mutedLocalSet = new Set((res.muted || []).map((r) => String(r.user || '').toLowerCase()).filter(Boolean));
    state.warnedLocalSet = new Set((res.warned || []).map((r) => String(r.user || '').toLowerCase()).filter(Boolean));
  } catch (_) {
    /* optional */
  }
}

function retagModMentions() {
  for (const line of state.chatLines) {
    line.modMention = isMentionOfMod(line.message);
  }
  state.tagged = state.chatLines
    .filter((l) => l.modMention)
    .slice(-50)
    .reverse()
    .map((line) => buildTaggedIndexEntry(line));
}

let mentionAliasPersistTimer = null;

function syncMentionAliasesFromUi({ persist = false } = {}) {
  const aliases = parseMentionAliases($('mentionAliases')?.value ?? '');
  state.settings.mentionAliases = aliases;
  retagModMentions();
  renderHubIndexes();
  LiveChat.invalidateChatDom();
  renderChats({ forceFull: true });
  if (!persist) return;
  clearTimeout(mentionAliasPersistTimer);
  mentionAliasPersistTimer = setTimeout(() => {
    persistAutoMsgSettings({ mentionAliases: aliases });
  }, 350);
}

function normalizeGameName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isHighestMultiRhGame(game) {
  return (C.HIGHEST_MULTI_RH_GAMES || []).includes(game);
}

function formatRhCountdown(ms) {
  const totalSec = Math.max(0, Math.ceil(Number(ms) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function readRhTimerDurationMs() {
  const min = Math.max(0, Number($('rhTimerMinutes')?.value) || 0);
  const sec = Math.max(0, Math.min(59, Number($('rhTimerSeconds')?.value) || 0));
  const totalMs = (min * 60 + sec) * 1000;
  return totalMs > 0 ? totalMs : null;
}

function rhTimerLabelFromMs(ms) {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  if (min > 0 && sec > 0) return `${min} min ${sec} sek`;
  if (min > 0) return `${min} min`;
  return `${sec} sek`;
}

function clearRhStatusTimer() {
  if (state.rhStatusTimer) {
    clearInterval(state.rhStatusTimer);
    state.rhStatusTimer = null;
  }
}

function clearSessionDeadlineTimer(session) {
  if (session?.deadlineTimer) {
    clearTimeout(session.deadlineTimer);
    session.deadlineTimer = null;
  }
}

function nextRhId() {
  const id = `rh-${state.rhNextId}`;
  state.rhNextId += 1;
  return id;
}

function getRhSession(id = state.rhActiveId) {
  if (!id) return null;
  return state.rhSessions.find((s) => s.id === id) || null;
}

function getSelectedRhSession() {
  return getRhSession(state.rhActiveId);
}

function findActiveRhForGame(game) {
  return state.rhSessions.find((s) => s.active && s.game === game) || null;
}

function getActiveRhSessions() {
  return state.rhSessions.filter((s) => s.active);
}

function getRhLeaderBets(session) {
  if (!session?.bets?.length) return [];
  return session.bets.filter((b) => !b.hidden);
}

const RH_CHAT_MAX_LEN = 160;

function getRhRankedBets(session) {
  return getRhLeaderBets(session).sort((a, b) => {
    const diff = (b.multiplier || 0) - (a.multiplier || 0);
    if (diff !== 0) return diff;
    return (a.ts || 0) - (b.ts || 0);
  });
}

function getRhPlaceBet(session, place) {
  const ranked = getRhRankedBets(session);
  return ranked[Math.max(1, place) - 1] || null;
}

function getRhLeader(session) {
  return getRhPlaceBet(session, 1);
}

function formatRhSessionMeta(session) {
  if (!session) return '';
  if (session.mode === 'highestMulti') {
    const leader = getRhLeader(session);
    const lead = leader ? formatRhLeaderLine(leader) : 'noch kein Treffer';
    if (!session.active) return `beendet · ${lead} · ${session.bets.length} Wetten`;
    if (session.overtime) {
      const extra = formatRhCountdown(Math.max(0, Date.now() - (session.overtimeSince || Date.now())));
      return `Verlängerung +${extra} · ${lead} · ${session.bets.length} Wetten`;
    }
    const left = session.deadlineTs ? Math.max(0, session.deadlineTs - Date.now()) : 0;
    return `${formatRhCountdown(left)} · ${lead} · ${session.bets.length} Wetten`;
  }
  const leader = getRhLeader(session);
  const lead = leader ? formatRhLeaderLine(leader) : 'noch kein Treffer';
  return `ab ${session.minMulti}x · ${lead} · ${session.bets.length} Wetten`;
}

async function enterRhOvertime(sessionId) {
  const session = getRhSession(sessionId);
  if (!session?.active || session.overtime) return;
  clearSessionDeadlineTimer(session);
  session.overtime = true;
  session.overtimeSince = Date.now();
  await modHub.appendLog(`--- RH ${session.game} | Timer abgelaufen → Verlängerung bis Stop ---`);
  renderRhSessionsList();
  if (sessionId === state.rhActiveId) refreshRhStatusLine();
}

function updateRhGameSelectOptions() {
  const sel = $('rhGame');
  if (!sel) return;
  const activeGames = new Set(getActiveRhSessions().map((s) => s.game));
  [...sel.options].forEach((opt) => {
    opt.disabled = activeGames.has(opt.value);
  });
  const cur = sel.value;
  if (cur && activeGames.has(cur)) {
    const free = [...sel.options].find((o) => !o.disabled);
    if (free) sel.value = free.value;
  }
  updateRhGameModeUi();
}

function selectRhSession(id) {
  state.rhActiveId = id;
  renderRhSessionsList();
  renderRhBets();
  refreshRhStatusLine();
  syncRhBlueprintUi(getRhSession(id));
  setRhStopButtonsEnabled(!!getRhSession(id)?.active);
}

function removeRhSession(id) {
  const session = getRhSession(id);
  if (!session) return;
  if (session.active) return;
  clearSessionDeadlineTimer(session);
  state.rhSessions = state.rhSessions.filter((s) => s.id !== id);
  if (state.rhActiveId === id) {
    const next = state.rhSessions.find((s) => s.active) || state.rhSessions[0];
    state.rhActiveId = next?.id || null;
  }
  updateRhGameSelectOptions();
  renderRhSessionsList();
  renderRhBets();
  refreshRhStatusLine();
  syncRhBlueprintUi(getSelectedRhSession());
  setRhStopButtonsEnabled(!!getSelectedRhSession()?.active);
}

function renderRhSessionsList() {
  const box = $('rhSessionsList');
  const countEl = $('rhSessionCount');
  if (!box) return;
  const activeCount = getActiveRhSessions().length;
  if (countEl) countEl.textContent = `${activeCount} aktiv`;

  if (!state.rhSessions.length) {
    box.innerHTML = '<p class="hint rh-sessions-empty">Noch keine RH — Spiel wählen und Start.</p>';
    return;
  }

  box.innerHTML = state.rhSessions
    .map((s) => {
      const selected = s.id === state.rhActiveId;
      const rowCls = ['rh-session-row', s.active ? 'active' : 'ended', s.overtime ? 'overtime' : '', selected ? 'selected' : '']
        .filter(Boolean)
        .join(' ');
      const dismiss = s.active
        ? ''
        : `<button type="button" class="rh-session-dismiss sm" data-rh-dismiss="${esc(s.id)}" title="Aus Liste entfernen">×</button>`;
      return `<div class="${rowCls}">
        <button type="button" class="rh-session-item" data-rh-id="${esc(s.id)}">
          <span class="rh-session-game">${esc(s.game)}</span>
          <span class="rh-session-meta">${esc(formatRhSessionMeta(s))}</span>
        </button>
        ${dismiss}
      </div>`;
    })
    .join('');
}

function syncRhStatusTimer() {
  const needsTick = getActiveRhSessions().some((s) => s.mode === 'highestMulti');
  if (!needsTick) {
    clearRhStatusTimer();
    return;
  }
  if (state.rhStatusTimer) return;
  state.rhStatusTimer = setInterval(() => {
    renderRhSessionsList();
    refreshRhStatusLine();
  }, 1000);
}

function formatRhLeaderLine(leader) {
  if (!leader) return 'noch kein Treffer';
  return `@${leader.username} mit ${(leader.multiplier || 0).toFixed(2)}x`;
}

function normalizeRhCasinoTag(raw) {
  const id = String(raw || '')
    .replace(/^casino:/i, '')
    .replace(/^house:/i, '')
    .replace(/\./g, '')
    .trim();
  if (/^[a-f0-9-]{36}$/i.test(id)) return `casino:${id}`;
  const digits = id.replace(/\D/g, '');
  if (!digits) return 'casino:—';
  return `casino:${digits}`;
}

function formatRhCasinoTag(bet) {
  if (bet?.casinoId) return normalizeRhCasinoTag(bet.casinoId);
  return normalizeRhCasinoTag(bet?.betId);
}

function buildRhPlaceMessage(bet, session, place) {
  const user = stripAt(bet.username);
  const multi = (bet.multiplier || 0).toFixed(2);
  const game = String(bet.game || session?.game || '').trim();
  const casino = formatRhCasinoTag(bet);
  const gameShort = game.length > 12 ? game.slice(0, 12) : game;
  const gameLabel = game.toLowerCase();

  if (isHighestMultiRhGame(session?.game || game) && place === 1) {
    const variants = [
      `@${user} ist auf Platz 1 und hält den 🥇🥇höchsten Multi🥇🥇 mit ${multi}x — ${gameLabel} — ${casino}`,
      `@${user} ist auf Platz 1 und hält den 🥇🥇höchsten Multi🥇🥇 mit ${multi}x — ${gameShort.toLowerCase()} — ${casino}`,
      `@${user} ist auf Platz 1 und hält den 🥇🥇höchsten Multi🥇🥇 mit ${multi}x — ${casino}`,
      `@${user} ist auf Platz 1 und hält den 🥇🥇höchsten Multi🥇🥇 mit ${multi}x`
    ];
    for (const msg of variants) {
      if (msg.length <= RH_CHAT_MAX_LEN) return msg;
    }
    const shortUser = user.length > 10 ? `${user.slice(0, 10)}…` : user;
    return `@${shortUser} ist auf Platz 1 mit ${multi}x`.slice(0, RH_CHAT_MAX_LEN);
  }

  const medal = { 1: '🥇', 2: '🥈', 3: '🥉' }[place] || '🏆';
  const variants = [
    `${medal} @${user} ${multi}x — ${game} — ${casino}`,
    `${medal} @${user} ${multi}x — ${gameShort} — ${casino}`,
    `${medal} @${user} ${multi}x ${casino}`,
    `${medal} @${user} ${multi}x`
  ];
  for (const msg of variants) {
    if (msg.length <= RH_CHAT_MAX_LEN) return msg;
  }
  const shortUser = user.length > 10 ? `${user.slice(0, 10)}…` : user;
  return `${medal} @${shortUser} ${multi}x`.slice(0, RH_CHAT_MAX_LEN);
}

async function postRhPlaceAnnounce(bet, session, place) {
  if (!bet || !session) return { ok: false, error: 'Kein Treffer' };
  if (!state.loggedIn) {
    $('rhModeHint').textContent = 'Zuerst einloggen.';
    return { ok: false, error: 'Nicht eingeloggt' };
  }
  const msg = buildRhPlaceMessage(bet, session, place);
  if (msg.length > RH_CHAT_MAX_LEN) {
    $('rhModeHint').textContent = `Zu lang (${msg.length}/${RH_CHAT_MAX_LEN} Zeichen).`;
    return { ok: false, error: 'Nachricht zu lang' };
  }
  $('rhChatMessage').value = msg;
  const res = await modHub.sendChat({ message: msg, useGraphql: true, chatId: chatId() });
  const label = session.game ? `${session.game} RH — ` : '';
  $('rhModeHint').textContent = res.ok
    ? `${label}Platz ${place} gepostet (${msg.length}/${RH_CHAT_MAX_LEN})`
    : `${label}Fehler: ${res.error}`;
  return res;
}

async function postCurrentRhPlace() {
  const session = getSelectedRhSession();
  if (!session?.active) {
    $('rhRecordStatus').textContent = 'Keine aktive RH ausgewählt.';
    return;
  }
  const place = Number($('rhPlaceSelect')?.value) || 1;
  const bet = getRhPlaceBet(session, place);
  if (!bet) {
    $('rhRecordStatus').textContent = `${session.game}: Platz ${place} — keine zählbare Wette (hidden zählt nicht).`;
    return;
  }
  const res = await postRhPlaceAnnounce(bet, session, place);
  if (res.ok) {
    $('rhRecordStatus').textContent = `${session.game} RH | Platz ${place} gepostet: ${formatRhLeaderLine(bet)}`;
  }
}

/** STOP-Zeile aus ChatBlueprints (🛑 bevorzugt, sonst 🔴). */
function getRhStopBlueprintMessage() {
  const lines = state.blueprints.chat || [];
  const stopSign = lines.find((l) => /🛑.*STOP/i.test(l));
  if (stopSign) return stopSign;
  const redStop = lines.find((l) => /🔴.*STOP/i.test(l));
  if (redStop) return redStop;
  const anyStop = lines.find((l) => /\bSTOP\b/i.test(l));
  return anyStop || '🛑🛑 STOP! 🛑🛑';
}

function setRhStopButtonsEnabled(on) {
  ['btnRhStop', 'btnRhStopAnnounce'].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !on;
  });
  updateRhLeaderPostUi();
}

function updateRhLeaderPostUi() {
  const wrap = $('rhPostLeaderWrap');
  const btn = $('btnRhPostLeader');
  const preview = $('rhPlacePreview');
  if (!btn) return;
  const session = getSelectedRhSession();
  const show = !!session?.active;
  wrap?.classList.toggle('hidden', !show);
  const place = Number($('rhPlaceSelect')?.value) || 1;
  const bet = show ? getRhPlaceBet(session, place) : null;
  btn.disabled = !state.loggedIn || !bet;
  if (preview) {
    if (!show) {
      preview.textContent = '';
    } else if (!bet) {
      preview.textContent = `Platz ${place}: — (hidden zählt nicht)`;
    } else {
      const msg = buildRhPlaceMessage(bet, session, place);
      preview.textContent = `${msg} (${msg.length}/${RH_CHAT_MAX_LEN})`;
    }
  }
}

async function sendRhStopBlueprintToChat() {
  const msg = getRhStopBlueprintMessage();
  $('rhChatMessage').value = msg;
  const sel = $('cbRhBlueprints');
  if (sel) {
    const opt = [...sel.options].find((o) => o.value === msg);
    if (opt) sel.value = msg;
  }
  if (!state.loggedIn) {
    return { ok: false, error: 'Nicht eingeloggt' };
  }
  return modHub.sendChat({ message: msg, useGraphql: true, chatId: chatId() });
}

function updateRhGameModeUi() {
  const game = $('rhGame')?.value || '';
  const crashMode = isHighestMultiRhGame(game);
  $('rhMinMultiWrap')?.classList.toggle('hidden', crashMode);
  $('rhCrashDeadlineWrap')?.classList.toggle('hidden', !crashMode);
  if (crashMode) {
    $('rhPayoutWrap')?.classList.add('hidden');
  } else {
    RhPayoutTables?.refresh?.(game, rhPayoutElements());
  }
  const hint = $('rhModeHint');
  if (hint) {
    const payoutHint = !crashMode && RhPayoutTables?.hasGame?.(game) ? ' Payout-Tabelle unten.' : '';
    hint.textContent = crashMode
      ? 'Crash/Slide: Timer → Verlängerung bis Stop. Platz 1–3 posten (max. 160 Zeichen). ● = hidden.'
      : `Klassisch: Wetten ab Min-Multi. Platz 1–3 posten (max. 160 Zeichen). Max. 1 RH/Spiel. ● = hidden.${payoutHint}`;
  }
  updateRhLeaderPostUi();
}

function rhPayoutElements() {
  return {
    wrap: $('rhPayoutWrap'),
    variantEl: $('rhPayoutVariant'),
    multiEl: $('rhPayoutMulti'),
    minMultiEl: $('rhMinMulti'),
    getGame: () => $('rhGame')?.value || ''
  };
}

function refreshRhStatusLine() {
  const el = $('rhRecordStatus');
  if (!el) return;
  const s = getSelectedRhSession();
  if (!s) {
    el.textContent = getActiveRhSessions().length
      ? 'Rollhunt in der Liste auswählen.'
      : 'Session inaktiv';
    return;
  }
  if (!s.active) {
    const leader = getRhLeader(s);
    el.textContent = `${s.game} beendet · Platz 1: ${leader ? formatRhLeaderLine(leader) : '—'} · ${s.bets.length} Wetten`;
    return;
  }
  if (s.mode === 'highestMulti') {
    if (s.overtime) {
      const extra = formatRhCountdown(Math.max(0, Date.now() - (s.overtimeSince || Date.now())));
      el.textContent = `${s.game} RH | Verlängerung +${extra} (bis Stop) | Führung: ${formatRhLeaderLine(getRhLeader(s))}`;
    } else {
      const left = s.deadlineTs ? Math.max(0, s.deadlineTs - Date.now()) : 0;
      el.textContent = `${s.game} RH | Timer ${formatRhCountdown(left)} | Führung: ${formatRhLeaderLine(getRhLeader(s))}`;
    }
  } else {
    el.textContent = `Aktiv: ${s.game} ab ${s.minMulti}x · Führung: ${formatRhLeaderLine(getRhLeader(s))} · ${s.bets.length} Wetten`;
  }
}

function gameMatches(betGame, rhGame) {
  if (!betGame || !rhGame) return false;
  const bet = normalizeGameName(betGame);
  const patterns = [
    normalizeGameName(rhGame),
    ...((C.GAME_ALIASES && C.GAME_ALIASES[rhGame]) || []).map((a) => normalizeGameName(a))
  ].filter(Boolean);

  if (rhGame === 'Dice' && bet.includes('prime')) return false;

  for (const p of patterns) {
    if (bet === p) return true;
    if (p.length >= 5 && bet.startsWith(p)) return true;
    if (p.length >= 5 && bet.includes(p)) return true;
  }
  return false;
}

function rhGameSearchPatterns(game) {
  return [
    normalizeGameName(game),
    ...((C.GAME_ALIASES && C.GAME_ALIASES[game]) || []).map((a) => normalizeGameName(a))
  ].filter(Boolean);
}

function rhBlueprintMatchesGame(line, game) {
  if (!line || !game) return false;
  const text = normalizeGameName(line);
  for (const p of rhGameSearchPatterns(game)) {
    if (!p || p.length < 3) continue;
    if (game === 'Dice' && p === 'dice' && text.includes('prime')) continue;
    if (text.includes(p)) return true;
  }
  return false;
}

function findRhBlueprintForGame(game) {
  const lines = state.blueprints.rh || [];
  const candidates = lines.filter((l) => rhBlueprintMatchesGame(l, game));
  const rhAnnounce = candidates.filter((l) => /llhunt|:coin:/i.test(l));
  return rhAnnounce[0] || candidates[0] || null;
}

function applyRhBlueprintToUi(line) {
  const sel = $('cbRhBlueprints');
  const ta = $('rhChatMessage');
  if (!line) {
    if (sel) sel.value = '';
    if (ta) ta.value = '';
    return;
  }
  if (sel) {
    const opt = [...sel.options].find((o) => o.value === line);
    sel.value = opt ? line : '';
  }
  if (ta) ta.value = line;
}

function syncRhBlueprintUi(session) {
  if (!session) {
    applyRhBlueprintToUi('');
    return;
  }
  let line = session.bpLine;
  if (!line) {
    line = findRhBlueprintForGame(session.game);
    if (line) session.bpLine = line;
  }
  applyRhBlueprintToUi(line);
}

function saveRhBlueprintToSession(line) {
  const session = getSelectedRhSession();
  if (session && line) session.bpLine = line;
}

function isVeri2(name) {
  return state.veri2.has(String(name || '').toLowerCase());
}

function parseMentionAliases(raw) {
  if (Array.isArray(raw)) {
    return raw.map((s) => stripAt(String(s || '').trim())).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,;\n]+/)
      .map((s) => stripAt(s.trim()))
      .filter(Boolean);
  }
  return [];
}

function formatMentionAliases(aliases) {
  return parseMentionAliases(aliases).join(', ');
}

function getMentionAliasesEffective() {
  const field = $('mentionAliases');
  if (field && String(field.value ?? '').trim()) {
    return parseMentionAliases(field.value);
  }
  return parseMentionAliases(state.settings?.mentionAliases);
}

function mentionRegexAt(term) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`@${esc}(?![\\w.-])`, 'i');
}

function mentionRegexBare(term) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![@\\w.-])${esc}(?![\\w.-])`, 'i');
}

function getMentionWatchTerms() {
  const terms = [];
  const seen = new Set();
  const add = (name) => {
    const t = stripAt(String(name || '').trim());
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(t);
  };
  add(state.modUser);
  for (const alias of getMentionAliasesEffective()) add(alias);
  return terms;
}

function isMentionOfMod(message) {
  const msg = String(message || '');
  if (!msg) return false;

  const modTerm = stripAt(state.modUser);
  if (modTerm && mentionRegexAt(modTerm).test(msg)) return true;

  const aliasKeys = new Set(getMentionAliasesEffective().map((a) => a.toLowerCase()));
  for (const term of getMentionWatchTerms()) {
    if (modTerm && term.toLowerCase() === modTerm.toLowerCase()) continue;
    if (!aliasKeys.has(term.toLowerCase())) continue;
    if (mentionRegexAt(term).test(msg) || mentionRegexBare(term).test(msg)) return true;
  }
  return false;
}

function isOwnModChatUser(username) {
  const mod = stripAt(state.modUser);
  const u = stripAt(username);
  return Boolean(mod && u && mod.toLowerCase() === u.toLowerCase());
}

function toUsd(amount, currency) {
  if (amount == null || !currency) return null;
  const rate = state.convRates[String(currency).toLowerCase()];
  if (!rate || !rate.usd) return null;
  return Number(amount) * rate.usd;
}

function fmtUsd(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return `$${n.toFixed(2)}`;
}

function fmtCrypto(amount, currency) {
  if (amount == null) return '—';
  return `${Number(amount).toFixed(8)} ${currency || ''}`.trim();
}

function fmtCryptoShort(amount, currency) {
  if (amount == null) return '—';
  const n = Number(amount);
  if (Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const dec = abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  const cur = String(currency || '').toUpperCase();
  return cur ? `${n.toFixed(dec)} ${cur}` : n.toFixed(dec);
}

function fmtMoney(amount, currency) {
  if (amount == null) return '—';
  const crypto = esc(fmtCryptoShort(amount, currency));
  const usd = toUsd(amount, currency);
  if (usd != null) {
    return `${crypto}<span class="bet-usd"> · ${esc(fmtUsd(usd))}</span>`;
  }
  return crypto;
}

function isChatAutoscrollEnabled() {
  const el = $('autoscroll');
  return el ? el.checked : true;
}

function pushChatLine(line) {
  return LiveChat.pushChatLine(line);
}

function renderChats(opts) {
  LiveChat.renderChats(opts);
}

function renderRhBets() {
  const box = $('rhBetLog');
  const title = $('rhBetLogTitle');
  const session = getSelectedRhSession();
  if (title) {
    title.textContent = session ? `Wetten — ${session.game}` : 'Wetten (aufsteigend)';
  }
  if (!box) return;
  if (!session) {
    box.innerHTML = '<div class="hint">Rollhunt auswählen oder neue RH starten.</div>';
    return;
  }
  const highestMode = session.mode === 'highestMulti';
  const leader = getRhLeader(session);
  const rows = [...session.bets].sort((a, b) => {
    const diff = (a.multiplier || 0) - (b.multiplier || 0);
    return highestMode ? -diff : diff;
  });
  box.innerHTML =
    rows
      .map((b) => {
        const multi = b.multiplier > 0 ? `${b.multiplier.toFixed(2)}x` : '?x';
        const isLeader = leader && leader.betId === b.betId && leader.username === b.username;
        const leaderCls = isLeader ? ' bet-leader' : '';
        const hiddenCls = b.hidden ? ' bet-hidden' : '';
        const hiddenMark = b.hidden ? '<span class="bet-hidden-mark" title="Versteckte Wette (Hidden)">●</span> ' : '';
        const titleAttr = b.hidden
          ? 'Versteckte Wette (zählt nicht für Führung) — Klick = Bet-ID kopieren'
          : isLeader
            ? 'Aktuelle Führung — Klick = Bet-ID kopieren'
            : 'Klick = Bet-ID kopieren';
        return `<div class="bet-row${leaderCls}${hiddenCls}" data-bet-id="${esc(b.betId || '')}" data-copy="${esc(b.betId || '')}" title="${esc(titleAttr)}">${hiddenMark}${multi} — ${esc(b.game)} — <span class="bet-id-label">${esc(b.betId || b.casinoId || '')}</span> — @${esc(b.username)}</div>`;
      })
      .join('') || '<div class="hint">Keine Wetten in dieser Session.</div>';
  updateRhLeaderPostUi();
}

function isRhTriviaSolutionMatch(message, solutionNorm) {
  const msg = stripLeadingUserMention(message).trim().toLowerCase();
  return !!solutionNorm && msg === solutionNorm;
}

function processRhTriviaHit(line) {
  const t = state.rhTrivia;
  if (!t.active || !t.solutionNorm) return;
  if (line.kind !== 'text') return;
  if (isOwnModChatUser(line.username)) return;
  if (!isRhTriviaSolutionMatch(line.message, t.solutionNorm)) return;
  const userKey = stripAt(line.username).toLowerCase();
  if (t.hits.some((h) => h.username.toLowerCase() === userKey)) return;

  t.hits.push({
    username: stripAt(line.username),
    message: stripLeadingUserMention(line.message).trim(),
    ts: line.ts,
    receivedAt: line.receivedAt ?? line.ts
  });
  renderRhTriviaLog();
  updateRhTriviaUi();
}

function renderRhTriviaLog() {
  const box = $('rhTriviaLog');
  const title = $('rhTriviaLogTitle');
  const t = state.rhTrivia;
  if (title) {
    title.textContent = t.active ? `Lösungen — «${t.solution}»` : 'Lösungen';
  }
  if (!box) return;
  const rows = [...t.hits].sort((a, b) => (a.receivedAt || a.ts) - (b.receivedAt || b.ts));
  box.innerHTML =
    rows
      .map((h) => {
        const timeLabel = formatChatTime(h.receivedAt ?? h.ts);
        return `<div class="trivia-hit-row" title="${esc(timeLabel)}"><span class="chat-time">${esc(timeLabel)}</span> <span class="user">@${esc(h.username)}</span> — ${esc(h.message)}</div>`;
      })
      .join('') || '<div class="hint">Noch keine Treffer — Trivia starten und auf Chat-Antworten warten.</div>';
  box.scrollTop = box.scrollHeight;
}

function updateRhTriviaUi() {
  const t = state.rhTrivia;
  const startBtn = $('btnRhTriviaStart');
  const stopBtn = $('btnRhTriviaStop');
  const input = $('rhTriviaSolution');
  if (startBtn) startBtn.disabled = !!t.active;
  if (stopBtn) stopBtn.disabled = !t.active;
  if (input) input.disabled = !!t.active;
  const status = $('rhTriviaStatus');
  if (status) {
    if (t.active) {
      status.textContent = `Aktiv — Lösung: «${t.solution}» · ${t.hits.length} Treffer`;
    } else if (t.hits.length) {
      status.textContent = `Beendet · ${t.hits.length} Treffer`;
    } else {
      status.textContent = 'Inaktiv';
    }
  }
}

function startRhTrivia() {
  const solution = $('rhTriviaSolution')?.value?.trim();
  if (!solution) {
    $('rhTriviaStatus').textContent = 'Lösungswort eingeben.';
    return;
  }
  state.rhTrivia = {
    active: true,
    solution,
    solutionNorm: solution.toLowerCase(),
    hits: []
  };
  renderRhTriviaLog();
  updateRhTriviaUi();
}

function stopRhTrivia() {
  if (!state.rhTrivia.active) return;
  state.rhTrivia.active = false;
  updateRhTriviaUi();
}

function clearRhTrivia() {
  if (state.rhTrivia.active) return;
  state.rhTrivia.hits = [];
  state.rhTrivia.solution = '';
  state.rhTrivia.solutionNorm = '';
  if ($('rhTriviaSolution')) $('rhTriviaSolution').value = '';
  renderRhTriviaLog();
  updateRhTriviaUi();
}

function formatRainShareLabel(amount, currency) {
  if (amount == null || Number.isNaN(Number(amount))) return '?';
  const usd = toUsd(amount, currency);
  if (usd != null) return fmtUsd(usd);
  return fmtCryptoShort(amount, currency);
}

function buildRainRecipientDisplay(rain, fallbackNames) {
  if (Array.isArray(rain.recipientList) && rain.recipientList.length) {
    return rain.recipientList.map((r) => ({
      name: stripAt(r.username),
      label: formatRainShareLabel(r.amount, r.currency || rain.currency)
    }));
  }
  const names = fallbackNames || [];
  const total = rain.amount != null ? Number(rain.amount) : null;
  const cur = rain.currency || '';
  const per = total != null && names.length ? total / names.length : null;
  const label = formatRainShareLabel(per, cur);
  return names.map((name) => ({ name, label }));
}

function buildRainIndexEntry(m, line) {
  const rain = m.rain && typeof m.rain === 'object' ? m.rain : {};
  const giver = stripAt(rain.giver || line.username || '');
  let recipients = [];
  if (Array.isArray(rain.recipients)) {
    recipients = rain.recipients.map((n) => stripAt(n)).filter(Boolean);
  } else if (typeof rain.recipients === 'string' && rain.recipients.trim()) {
    recipients = rain.recipients
      .split(',')
      .map((n) => stripAt(n.trim()))
      .filter(Boolean);
  }
  const time = new Date(line.ts).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const shares = buildRainRecipientDisplay(rain, recipients);
  const recipientText = shares.length
    ? shares.map((s) => `${s.name}: ${s.label}`).join(' · ')
    : String(line.message || '').trim();
  const totalLabel =
    rain.amount != null
      ? `Gesamt: ${formatRainShareLabel(Number(rain.amount), rain.currency)} · ${shares.length || recipients.length} Empfänger`
      : '';
  return {
    kind: 'rain',
    username: giver,
    time,
    text: recipientText,
    preview: recipientText,
    totalLabel,
    shares,
    idx: line.idx
  };
}

function isModRainRecipient(name) {
  const mod = stripAt(state.modUser).toLowerCase();
  return !!mod && stripAt(name).toLowerCase() === mod;
}

function formatRainSharesHtml(shares) {
  if (!shares?.length) return '';
  return shares
    .map((s) => {
      const modHit = isModRainRecipient(s.name);
      const cls = modHit ? 'rain-share index-rain-mod' : 'rain-share';
      return `<span class="${cls}">${esc(s.name)}: ${esc(s.label)}</span>`;
    })
    .join('<span class="rain-share-sep"> · </span>');
}

function buildRulePostMessage(extra) {
  const link = C.RULE_POST_LINK || 'https://stakecommunity.com/topic/119796-📜deutsche-chatregeln📜/';
  const linkPart = `📜 Chatregeln: ${link}`;
  const extraTrim = String(extra ?? '').trim();
  if (!extraTrim) return linkPart.slice(0, RH_CHAT_MAX_LEN);
  const sep = ' — ';
  const combined = `${extraTrim}${sep}${linkPart}`;
  if (combined.length <= RH_CHAT_MAX_LEN) return combined;
  const maxExtra = RH_CHAT_MAX_LEN - sep.length - linkPart.length;
  if (maxExtra > 4) return `${extraTrim.slice(0, maxExtra - 1)}…${sep}${linkPart}`;
  return linkPart.slice(0, RH_CHAT_MAX_LEN);
}

function newAutoMsgId() {
  return `am-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function migrateAutoMessages(settings) {
  if (Array.isArray(settings.autoMessages) && settings.autoMessages.length) {
    return settings.autoMessages.map((m) => ({
      id: m.id || newAutoMsgId(),
      label: String(m.label || 'Automsg').trim() || 'Automsg',
      text: String(m.text || ''),
      appendRulesLink: !!m.appendRulesLink,
      autoEnabled: !!m.autoEnabled,
      autoIntervalMinutes: Math.max(0, Number(m.autoIntervalMinutes) || 0)
    }));
  }
  const msgs = JSON.parse(JSON.stringify([
    {
      id: 'regelpost',
      label: 'Regelpost',
      text: '',
      appendRulesLink: true,
      autoEnabled: false,
      autoIntervalMinutes: 60
    }
  ]));
  const rules = msgs.find((m) => m.appendRulesLink) || msgs[0];
  if (rules) {
    rules.autoEnabled = !!settings.rulePostEnabled;
    rules.autoIntervalMinutes = Math.max(0, Number(settings.rulePostIntervalMinutes) || 60);
    rules.text = String(settings.rulePostExtra || '');
  }
  return msgs;
}

function getAutoMessages() {
  return Array.isArray(state.settings.autoMessages) ? state.settings.autoMessages : [];
}

function findAutoMessage(id) {
  return getAutoMessages().find((m) => m.id === id) || null;
}

function buildAutoMsgMessage(entry) {
  if (!entry) return '';
  if (entry.appendRulesLink) return buildRulePostMessage(entry.text);
  return String(entry.text || '').trim().slice(0, RH_CHAT_MAX_LEN);
}

function autoMsgPreview(entry) {
  const msg = buildAutoMsgMessage(entry);
  if (!msg) return '—';
  return msg.length > 120 ? `${msg.slice(0, 119)}…` : msg;
}

function autoMsgMetaLabel(entry) {
  if (!entry?.autoEnabled) return 'Nur manuell';
  const min = Math.max(0, Number(entry.autoIntervalMinutes) || 0);
  if (min < 1) return 'Nur manuell';
  return `Autopost alle ${min} min`;
}

async function persistAutoMsgSettings(partial = {}) {
  const autoMessages = partial.autoMessages ?? getAutoMessages();
  state.settings = await modHub.saveSettings({
    autoMessages,
    mentionNotifyEnabled:
      partial.mentionNotifyEnabled ?? !!$('mentionNotifyEnabled')?.checked,
    mentionNotifySound:
      partial.mentionNotifySound ??
      $('mentionNotifySound')?.value ??
      String(state.settings.mentionNotifySound ?? '1'),
    mentionAliases:
      partial.mentionAliases ?? parseMentionAliases($('mentionAliases')?.value ?? '')
  });
  renderAutoMsgList();
  syncAutoMsgTimers();
}

function renderAutoMsgList() {
  const list = $('automsgList');
  if (!list) return;
  const msgs = getAutoMessages();
  if (!msgs.length) {
    list.innerHTML = '<p class="hint automsg-empty">Noch keine Automsg — blauen Button nutzen.</p>';
    return;
  }
  list.innerHTML = msgs
    .map((m) => {
      const activeCls = m.autoEnabled && (Number(m.autoIntervalMinutes) || 0) > 0 ? ' is-active' : '';
      return `<div class="automsg-row" data-id="${esc(m.id)}">
        <div class="automsg-row-body">
          <span class="automsg-row-title">${esc(m.label || 'Automsg')}${m.appendRulesLink ? ' <span class="hint">(Regeln)</span>' : ''}</span>
          <span class="automsg-row-preview">${esc(autoMsgPreview(m))}</span>
          <span class="automsg-row-meta">${esc(autoMsgMetaLabel(m))}</span>
        </div>
        <button type="button" class="automsg-btn-send sm" data-action="send" title="Jetzt senden">▶</button>
        <button type="button" class="automsg-btn-settings sm${activeCls}" data-action="settings" title="Autopost-Einstellungen">⚙</button>
      </div>`;
    })
    .join('');
}

function setAutomsgStatus(text) {
  const el = $('automsgStatus');
  if (el) el.textContent = text || '—';
}

function clearAutoMsgTimers() {
  if (state.autoMsgTimers) {
    for (const t of Object.values(state.autoMsgTimers)) {
      clearTimeout(t);
    }
  }
  state.autoMsgTimers = {};
}

function scheduleAutoMsg(entry) {
  if (!entry?.id || !state.loggedIn) return;
  const id = entry.id;
  if (state.autoMsgTimers[id]) {
    clearTimeout(state.autoMsgTimers[id]);
    delete state.autoMsgTimers[id];
  }
  if (!entry.autoEnabled) return;
  const min = Math.max(0, Number(entry.autoIntervalMinutes) || 0);
  if (min < 1) return;

  const ms = min * 60 * 1000;
  const last = state.autoMsgLastSent[id] || 0;
  const elapsed = last > 0 ? Date.now() - last : 0;
  const delay = last > 0 ? Math.max(1000, ms - elapsed) : ms;

  state.autoMsgTimers[id] = setTimeout(async () => {
    delete state.autoMsgTimers[id];
    const current = findAutoMessage(id);
    if (!current?.autoEnabled || !state.loggedIn) return;
    if (state.autoMsgInflight.has(id)) {
      scheduleAutoMsg(current);
      return;
    }
    state.autoMsgInflight.add(id);
    try {
      await postAutoMessage(id, { auto: true });
    } finally {
      state.autoMsgInflight.delete(id);
    }
  }, delay);
}

function syncAutoMsgTimers() {
  clearAutoMsgTimers();
  if (!state.loggedIn) return;
  state.autoMsgLastSent = state.autoMsgLastSent || {};
  state.autoMsgInflight = state.autoMsgInflight || new Set();
  for (const m of getAutoMessages()) {
    scheduleAutoMsg(m);
  }
}

async function postAutoMessage(id, { auto = false } = {}) {
  const entry = findAutoMessage(id);
  if (!entry) {
    setAutomsgStatus('Automsg nicht gefunden.');
    return { ok: false };
  }
  if (!state.loggedIn) {
    setAutomsgStatus('Zuerst einloggen.');
    return { ok: false };
  }
  const msg = buildAutoMsgMessage(entry);
  if (!msg) {
    setAutomsgStatus(`${entry.label || 'Automsg'} ist leer.`);
    return { ok: false };
  }
  const res = await modHub.sendChat({ message: msg, useGraphql: true, chatId: chatId() });
  if (res.ok) {
    state.autoMsgLastSent[id] = Date.now();
    const current = findAutoMessage(id) || entry;
    if (current?.autoEnabled && (Number(current.autoIntervalMinutes) || 0) > 0) {
      scheduleAutoMsg(current);
    }
    setAutomsgStatus(
      auto
        ? `Auto: „${entry.label}“ gesendet (${msg.length} Zeichen).`
        : `„${entry.label}“ gesendet (${msg.length} Zeichen).`
    );
  } else {
    setAutomsgStatus(`Fehler bei „${entry.label}“: ${res.error}`);
    if (auto && entry.autoEnabled) {
      state.autoMsgTimers[id] = setTimeout(() => scheduleAutoMsg(findAutoMessage(id) || entry), 60000);
    }
  }
  return res;
}

function updateAutoMsgEditPreview() {
  const preview = $('autoMsgEditPreview');
  if (!preview) return;
  const entry = {
    text: $('autoMsgEditText')?.value ?? '',
    appendRulesLink: !!$('autoMsgEditRulesLink')?.checked
  };
  const msg = buildAutoMsgMessage(entry);
  preview.textContent = msg
    ? `Vorschau (${msg.length}/${RH_CHAT_MAX_LEN}): ${msg}`
    : 'Vorschau leer';
}

function openAutoMsgEditor(id = null) {
  state.autoMsgEditId = id;
  const existing = id ? findAutoMessage(id) : null;
  $('autoMsgEditTitle').textContent = existing ? 'Automsg bearbeiten' : 'Neue Automsg';
  $('autoMsgEditLabel').value = existing?.label || '';
  $('autoMsgEditText').value = existing?.text || '';
  if ($('autoMsgEditRulesLink')) $('autoMsgEditRulesLink').checked = !!existing?.appendRulesLink;
  if ($('autoMsgRulesLinkPreview')) {
    $('autoMsgRulesLinkPreview').textContent = C.RULE_POST_LINK || '';
  }
  $('btnAutoMsgEditDelete')?.classList.toggle('hidden', !existing);
  updateAutoMsgEditPreview();
  $('autoMsgEditModal')?.classList.remove('hidden');
}

function closeAutoMsgEditor() {
  state.autoMsgEditId = null;
  $('autoMsgEditModal')?.classList.add('hidden');
}

function openAutoMsgSettings(id) {
  const entry = findAutoMessage(id);
  if (!entry) return;
  state.autoMsgSettingsId = id;
  $('autoMsgSettingsName').textContent = entry.label || 'Automsg';
  if ($('autoMsgSettingsEnabled')) $('autoMsgSettingsEnabled').checked = !!entry.autoEnabled;
  if ($('autoMsgSettingsInterval')) {
    $('autoMsgSettingsInterval').value = String(entry.autoIntervalMinutes ?? 60);
  }
  const preview = $('autoMsgSettingsPreview');
  if (preview) preview.textContent = autoMsgPreview(entry);
  $('autoMsgSettingsModal')?.classList.remove('hidden');
}

function closeAutoMsgSettings() {
  state.autoMsgSettingsId = null;
  $('autoMsgSettingsModal')?.classList.add('hidden');
}


function getCustomNotifySounds() {
  return Array.isArray(state.settings?.customNotifySounds) ? state.settings.customNotifySounds : [];
}

function fillMentionNotifySoundSelect() {
  NotifySounds?.fillSoundSelect?.($('mentionNotifySound'), getCustomNotifySounds(), state.settings.mentionNotifySound);
}

async function playMentionNotifySound(soundId) {
  if (!state.settings.mentionNotifyEnabled) return;
  const id = soundId ?? state.settings.mentionNotifySound ?? '1';
  await NotifySounds?.playNotifySound?.(id, modHub);
}

function renderCustomNotifySoundsList() {
  const list = $('customNotifySoundsList');
  if (!list) return;
  const sounds = getCustomNotifySounds();
  if (!sounds.length) {
    list.innerHTML = '<p class="hint">Noch keine eigenen Sounds.</p>';
    return;
  }
  list.innerHTML = sounds
    .map(
      (s) => `<div class="notify-sound-row" data-id="${esc(s.id)}">
        <span class="notify-sound-label">${esc(s.label || s.filename || s.id)}</span>
        <button type="button" class="sm" data-action="test">Test</button>
        <button type="button" class="sm" data-action="delete">Löschen</button>
      </div>`
    )
    .join('');
}

async function refreshNotifySoundUi() {
  fillMentionNotifySoundSelect();
  renderCustomNotifySoundsList();
  AutomutePanel?.refreshSoundSelects?.();
}

async function importCustomNotifySound() {
  const status = $('notifySoundsStatus');
  if (!modHub.notifySoundImport) return;
  try {
    if (status) status.textContent = 'Datei wählen…';
    const res = await modHub.notifySoundImport();
    if (res?.canceled) {
      if (status) status.textContent = '—';
      return;
    }
    if (!res?.ok) {
      if (status) status.textContent = res?.error === 'unsupported_format' ? 'Format nicht unterstützt' : 'Import fehlgeschlagen';
      return;
    }
    state.settings = await modHub.getSettings();
    NotifySounds?.invalidateCustomCache?.();
    await refreshNotifySoundUi();
    if (status) status.textContent = `„${res.entry?.label || 'Sound'}“ importiert`;
  } catch (e) {
    if (status) status.textContent = `Fehler: ${e.message || e}`;
  }
}

async function deleteCustomNotifySound(id) {
  if (!id || !modHub.notifySoundDelete) return;
  const entry = getCustomNotifySounds().find((s) => s.id === id);
  const label = entry?.label || id;
  if (!confirm(`Sound „${label}“ wirklich löschen?`)) return;
  const res = await modHub.notifySoundDelete(id);
  if (!res?.ok) return;
  state.settings.customNotifySounds = res.sounds || [];
  NotifySounds?.invalidateCustomCache?.(id);
  await refreshNotifySoundUi();
  const status = $('notifySoundsStatus');
  if (status) status.textContent = 'Sound gelöscht';
}

function loadAutoMsgUiFromSettings() {
  const s = state.settings;
  if ($('mentionNotifyEnabled')) $('mentionNotifyEnabled').checked = s.mentionNotifyEnabled !== false;
  fillMentionNotifySoundSelect();
  if ($('mentionAliases')) {
    $('mentionAliases').value = formatMentionAliases(s.mentionAliases);
  }
  renderAutoMsgList();
  syncAutoMsgTimers();
}

function setValidateButtonState(validated) {
  const btn = $('btnValidate');
  if (!btn) return;
  if (validated) btn.classList.add('validated');
  else btn.classList.remove('validated');
}

function formatIndexItemHtml(it, i) {
  const user = stripAt(it.username || it.user || '');
  const time = it.time || '';
  const msg = String(it.text || it.preview || '').trim();
  const fullTitle = [user, time, it.text || it.preview].filter(Boolean).join(' · ');

  if (user || time) {
    const modRainHit = it.kind === 'rain' && it.shares?.some((s) => isModRainRecipient(s.name));
    const flagKey = String(it.flagPrimary || '').toLowerCase();
    const flagCls =
      flagKey === 'toxic'
        ? 'index-item-flag-toxic'
        : flagKey === 'bettel'
          ? 'index-item-flag-bettel'
          : flagKey === 'repeat'
            ? 'index-item-flag-repeat'
            : flagKey === 'spam'
              ? 'index-item-flag-spam'
              : '';
    const itemCls = ['index-item', modRainHit ? 'index-item-mod-rain' : '', flagCls].filter(Boolean).join(' ');
    const sharesHtml = it.kind === 'rain' && it.shares?.length ? formatRainSharesHtml(it.shares) : '';
    const bodyHtml = sharesHtml || (msg ? esc(msg) : '');
    const subHtml = it.flagLabel
      ? `<div class="index-item-sub index-item-flag">${esc(it.flagLabel)}</div>`
      : it.totalLabel
        ? `<div class="index-item-sub">${esc(it.totalLabel)}</div>`
        : '';
    return `<div class="${itemCls}" data-i="${i}" title="${esc(fullTitle)}">
      <div class="index-item-meta">
        ${user ? `<span class="index-item-user">${esc(user)}</span>` : '<span></span>'}
        ${time ? `<span class="index-item-time">${esc(time)}</span>` : ''}
      </div>
      ${subHtml}
      ${bodyHtml ? `<div class="index-item-msg">${bodyHtml}</div>` : ''}
    </div>`;
  }

  const head = it.time || it.label || '';
  const body = msg || '';
  if (body && body !== head) {
    return `<div class="index-item" data-i="${i}" title="${esc(body)}">
      <div class="index-item-time">${esc(head)}</div>
      <div class="index-item-msg">${esc(body)}</div>
    </div>`;
  }
  return `<div class="index-item" data-i="${i}" title="${esc(it.preview || '')}">${esc(head || body || '—')}</div>`;
}

function renderIndexList(el, items, onDbl) {
  if (!el) return;
  el.innerHTML = items.length
    ? items.map((it, i) => formatIndexItemHtml(it, i)).join('')
    : '<div class="hint index-empty">Noch keine Einträge</div>';
  el.querySelectorAll('.index-item').forEach((node) => {
    node.addEventListener('dblclick', () => {
      const i = Number(node.getAttribute('data-i'));
      if (items[i] && onDbl) onDbl(items[i]);
    });
  });
}

function renderHubIndexes() {
  renderIndexList($('tagIndex'), state.tagged, (it) => openTaggedItem(it));
  renderIndexList($('rainIndex'), state.rains, (it) => scrollToLine(it.idx));
  renderIndexList($('flaggedIndex'), state.flagged, (it) => openFlaggedChatHistory(it));
}

function scrollToLiveChatUid(uid) {
  if (uid == null) return false;
  const el = $('liveChat')?.querySelector(`[data-uid="${uid}"]`);
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.style.outline = '2px solid #0072ff';
  setTimeout(() => {
    el.style.outline = '';
  }, 1500);
  return true;
}

function resolveTaggedLineUid(item) {
  if (item?.uid != null) return item.uid;
  const line = state.chatLines.find(
    (l) => l.modMention && l.username === item.username && l.message === item.text
  );
  return line?.uid ?? null;
}

async function openTaggedItem(item) {
  if (!item) return;
  const uid = resolveTaggedLineUid(item);
  if (uid != null && scrollToLiveChatUid(uid)) return;
  await openIndexChatHistory(item);
}

async function openIndexChatHistory(item) {
  if (!item?.username) return;
  state.chatHistoryHighlight = item.text || item.preview || '';
  const ok = await validateAndOpenModAction(item.username, 'chat');
  if (!ok) state.chatHistoryHighlight = '';
}

function scrollToLine(idx) {
  const el = $('liveChat')?.querySelector(`[data-idx="${idx}"]`);
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.style.outline = '2px solid #0072ff';
    setTimeout(() => {
      el.style.outline = '';
    }, 1500);
  }
}

function showOverlay(title, body, { html = false } = {}) {
  $('overlayTitle').textContent = title;
  const el = $('overlayBody');
  if (!el) return;
  if (html) el.innerHTML = body || '';
  else el.textContent = body || '';
  $('overlayBackdrop').classList.remove('hidden');
}

function hideOverlay() {
  $('overlayBackdrop').classList.add('hidden');
}

function setModActionsEnabled(on) {
  const ids = [
    'btnModAction',
    'btnWarn',
    'btnUserHash',
    'btnSendChat',
    'btnSendMute',
    'btnSendWarn',
    'btnAddVeri2',
    'btnMutedList',
    'btnWarnedList',
    'btnAddMuteBp',
    'btnAddWarnBp',
    'btnAddChatBp',
    'btnRhSendChat',
    'btnAddRhBp',
    'btnShowBrowser',
    'btnAllMsg',
    'btnUndoMark',
    'btnAltCheck'
  ];
  ids.forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !on;
  });
}

function setUserActionsEnabled(on) {
  ['btnModAction', 'btnWarn', 'btnUserHash', 'btnAddVeri2', 'btnChatHistory'].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !on || !state.loggedIn;
  });
}

function updateLiveStatusUi() {
  const st = state.liveStats;
  const badge = $('wsModeBadge');
  const live = $('liveStatus');
  const debug = $('wsDebug');
  if (!badge || !live || !debug) return;

  const now = Date.now();
  const wsRecent = st.wsCount > 0 && now - st.lastWsAt < 120000;
  const browserRecent = st.browserCount > 0 && now - st.lastBrowserAt < 120000;

  badge.classList.remove('warn', 'ok');
  live.classList.remove('warn');
  badge.style.display = '';

  if (wsRecent) {
    badge.textContent = 'WS';
    badge.classList.add('ok');
    live.textContent = 'Live';
    debug.textContent = `Native WS · ${st.wsHost}`;
  } else if (browserRecent) {
    badge.style.display = 'none';
    live.textContent = 'Live';
    debug.textContent = 'Chat-Capture im Hintergrund';
  } else if (st.wsSubscribed) {
    badge.textContent = 'WS';
    badge.classList.add('warn');
    live.textContent = 'Live';
    debug.textContent = `Native WS · ${st.wsHost} · warte auf Chat…`;
  } else {
    badge.textContent = 'WS';
    live.textContent = state.loggedIn ? 'Live' : 'Live: aus';
    debug.textContent = state.loggedIn ? 'Starte Chat…' : '—';
  }
}

function updateLoginUi() {
  const badge = $('modUserBadge');
  const live = $('liveStatus');
  if (state.loggedIn && state.modUser) {
    badge.textContent = state.modUser;
    badge.classList.remove('muted');
    live.textContent = 'Live';
  } else {
    badge.textContent = 'Nicht eingeloggt';
    badge.classList.add('muted');
    live.textContent = 'Live: aus';
  }
  setModActionsEnabled(state.loggedIn);
  syncAutoMsgTimers();
  renderHubIndexes();
}

async function refreshVeri2() {
  const res = await modHub.loadVeri2();
  if (res.ok) state.veri2 = new Set((res.users || []).map((u) => u.toLowerCase()));
}

async function refreshBlueprints() {
  const res = await modHub.loadBlueprints();
  if (!res.ok) return;
  state.blueprints.chat = res.chat || [];
  state.blueprints.mute = res.mute || [];
  state.blueprints.warn = res.warn || [];
  state.blueprints.rh = res.rh || [];
  if (res.dataPath && !state.settings.dataPath) {
    state.settings.dataPath = res.dataPath;
    $('dataPathLabel').textContent = res.dataPath;
  }
  const fill = (sel, lines) => {
    const el = $(sel);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = '<option value="">—</option>' + lines.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
    if (lines.includes(cur)) el.value = cur;
  };
  fill('cbChatBlueprints', state.blueprints.chat);
  fill('cbMuteBlueprints', state.blueprints.mute);
  fill('cbWarnBlueprints', state.blueprints.warn);
  fill('cbRhBlueprints', state.blueprints.rh);
}

async function refreshConvRates() {
  const res = await modHub.getConvRates();
  if (res.ok && res.rates) {
    state.convRates = res.rates;
    state.convRatesAt = Date.now();
    return true;
  }
  return false;
}

async function ensureConvRates(force = false) {
  const stale = Date.now() - (state.convRatesAt || 0) > 5 * 60 * 1000;
  const empty = !state.convRates || !Object.keys(state.convRates).length;
  if (!force && !empty && !stale) return;
  if (!state.loggedIn) return;
  await refreshConvRates();
}

function clearValidatedUser() {
  state.validatedUser = '';
  state.validatedUserId = '';
  setValidateButtonState(false);
  setUserActionsEnabled(false);
  syncModMessageMentions('');
}

function fillBlueprint(selId, targetId) {
  const v = $(selId)?.value;
  if (!v) return;
  const field = $(targetId);
  if (!field) return;
  const withMention =
    (targetId === 'muteMessage' || targetId === 'warnMessage' || targetId === 'chatMessage') &&
    state.validatedUser;
  field.value = withMention ? prependUserMentionForChat(v, state.validatedUser) : v;
}

function wireBlueprintSelect(selId, targetId, afterFill) {
  const sel = $(selId);
  if (!sel) return;
  const apply = () => {
    fillBlueprint(selId, targetId);
    afterFill?.();
  };
  sel.addEventListener('change', apply);
  sel.addEventListener('mouseup', () => {
    requestAnimationFrame(() => {
      if (sel.value) apply();
    });
  });
}

const LIVE_CHAT_FONT_MIN = 10;
const LIVE_CHAT_FONT_MAX = 20;
const LIVE_CHAT_FONT_PRESETS = [11, 12, 13, 14, 16];

function applyLiveChatFontSize(sizePx) {
  const px = Math.max(LIVE_CHAT_FONT_MIN, Math.min(LIVE_CHAT_FONT_MAX, Number(sizePx) || 13));
  const el = $('liveChat');
  if (el) el.style.setProperty('--live-chat-font-size', `${px}px`);
  const label = $('liveChatFontSizeLabel');
  if (label) label.textContent = `${px}px`;
  const sel = $('liveChatFontSize');
  if (sel && [...sel.options].some((o) => o.value === String(px))) {
    sel.value = String(px);
  }
  if (state.settings) state.settings.liveChatFontSize = px;
  const down = $('btnLiveChatFontDown');
  const up = $('btnLiveChatFontUp');
  if (down) down.disabled = px <= LIVE_CHAT_FONT_MIN;
  if (up) up.disabled = px >= LIVE_CHAT_FONT_MAX;
  return px;
}

function nearestLiveChatFontPreset(px) {
  const n = Number(px) || 13;
  let best = LIVE_CHAT_FONT_PRESETS[0];
  let dist = Math.abs(n - best);
  for (const p of LIVE_CHAT_FONT_PRESETS) {
    const d = Math.abs(n - p);
    if (d < dist) {
      best = p;
      dist = d;
    }
  }
  return best;
}

async function stepLiveChatFontSize(delta) {
  const cur = Number(state.settings?.liveChatFontSize) || 13;
  let next = cur + delta;
  if (delta > 0) next = Math.min(LIVE_CHAT_FONT_MAX, next);
  else next = Math.max(LIVE_CHAT_FONT_MIN, next);
  const px = applyLiveChatFontSize(next);
  state.settings = await modHub.saveSettings({ liveChatFontSize: px });
  const sel = $('liveChatFontSize');
  if (sel) sel.value = String(nearestLiveChatFontPreset(px));
}

function syncChatDisplaySettingsUi() {
  const colorOn = state.settings?.colorChatEnabled !== false;
  const badgesOn = state.settings?.showVipRankBadges !== false;
  if ($('colorChat')) $('colorChat').checked = colorOn;
  if ($('showVipRankBadges')) $('showVipRankBadges').checked = badgesOn;
  if ($('colorChatSettings')) $('colorChatSettings').checked = colorOn;
  if ($('showVipRankBadgesSettings')) $('showVipRankBadgesSettings').checked = badgesOn;
}

async function saveChatDisplaySettings(patch = {}) {
  state.settings = await modHub.saveSettings(patch);
  syncChatDisplaySettingsUi();
  LiveChat.invalidateChatDom();
  renderChats({ forceFull: true });
}

async function refreshAutomuteStatus() {
  window.AutomutePanel?.refreshStatus?.();
}

async function loadSettingsUi() {
  const s = await modHub.getSettings();
  state.settings = s;
  const migrated = migrateAutoMessages(s);
  if (!Array.isArray(s.autoMessages) || s.autoMessages.length === 0) {
    state.settings = await modHub.saveSettings({ autoMessages: migrated });
  } else {
    state.settings.autoMessages = migrated;
  }
  $('stakeDomain').innerHTML = (C.STAKE_MIRRORS || []).map((d) => `<option value="${d}">${d}</option>`).join('');
  $('stakeDomain').value = s.stakeDomain || 'stake.bet';
  if ($('wsHost')) $('wsHost').value = s.wsHost || 'stake.bet';
  $('prefChatroom').innerHTML = Object.keys(C.CHATROOMS || {}).map((k) => `<option value="${k}">${k}</option>`).join('');
  $('prefChatroom').value = s.prefChatroom || 'German';
  $('apiKey').value = s.apiKey || '';
  $('cookieMethod').value = s.cookieMethod || 'Non Permanent';
  $('clearance').value = s.clearance || '';
  $('logChat').checked = s.logChat !== false;
  $('logHash').checked = s.logHash !== false;
  $('useNativeWs').checked = s.useNativeWs !== false;
  $('maxChatRows').value = s.maxChatRows ?? 1000;
  if ($('liveChatFontSize')) {
    $('liveChatFontSize').value = String(applyLiveChatFontSize(s.liveChatFontSize ?? 13));
  } else {
    applyLiveChatFontSize(s.liveChatFontSize ?? 13);
  }
  syncChatDisplaySettingsUi();
  if ($('modChatEnabled')) $('modChatEnabled').checked = s.modChatEnabled !== false;
  if ($('modChatUrl')) {
    $('modChatUrl').value = s.modChatUrl || C.MOD_CHAT_DEFAULT_URL || 'wss://announcement-anaheim-filled-ripe.trycloudflare.com';
  }
  const ah = Number(s.autodelHour ?? 23);
  const am = Number(s.autodelMinute ?? 59);
  if ($('autodelTime')) {
    $('autodelTime').value = `${String(ah).padStart(2, '0')}:${String(am).padStart(2, '0')}`;
  }
  $('dataPathLabel').textContent = s.dataPath || 'Datengrube/';
  $('mutePeriod').innerHTML = (C.MUTE_PERIODS || []).map((p) => `<option value="${p}">${p}</option>`).join('');
  $('rhGame').innerHTML = (C.STAKE_ORIGINALS || []).map((g) => `<option value="${g}">${g}</option>`).join('');
  if ($('rhTimerMinutes')) {
    $('rhTimerMinutes').value = String(s.rhCrashTimerMinutes ?? 60);
  }
  if ($('rhTimerSeconds')) {
    $('rhTimerSeconds').value = String(s.rhCrashTimerSeconds ?? 0);
  }
  updateRhGameModeUi();
  updateRhGameSelectOptions();
  await refreshBlueprints();
  if (
    state.blueprints.chat.length === 0 &&
    state.blueprints.mute.length === 0 &&
    state.blueprints.warn.length === 0 &&
    state.blueprints.rh.length === 0
  ) {
    await modHub.seedBlueprints({ force: false });
    await refreshBlueprints();
  }
  if (s.dataPath || state.settings.dataPath) {
    await refreshVeri2();
    await refreshMutedWarnedSets();
  }
  loadAutoMsgUiFromSettings();
  renderCustomNotifySoundsList();
}

async function saveSettingsFromForm() {
  const timeParts = ($('autodelTime')?.value || '23:59').split(':');
  const autodelHour = parseInt(timeParts[0], 10);
  const autodelMinute = parseInt(timeParts[1], 10);
  state.settings = await modHub.saveSettings({
    stakeDomain: $('stakeDomain').value,
    prefChatroom: $('prefChatroom').value,
    apiKey: $('apiKey').value.trim(),
    cookieMethod: $('cookieMethod').value,
    clearance: $('clearance').value.trim(),
    logChat: $('logChat').checked,
    logHash: $('logHash').checked,
    useNativeWs: $('useNativeWs').checked,
    wsHost: ($('wsHost')?.value || 'stake.bet').trim() || 'stake.bet',
    maxChatRows: parseInt($('maxChatRows')?.value, 10) || 1000,
    liveChatFontSize: applyLiveChatFontSize($('liveChatFontSize')?.value ?? 13),
    colorChatEnabled: $('colorChatSettings')?.checked ?? $('colorChat')?.checked ?? true,
    showVipRankBadges: $('showVipRankBadgesSettings')?.checked ?? $('showVipRankBadges')?.checked ?? true,
    modChatEnabled: $('modChatEnabled')?.checked !== false,
    modChatUrl: ($('modChatUrl')?.value || C.MOD_CHAT_DEFAULT_URL || 'wss://announcement-anaheim-filled-ripe.trycloudflare.com').trim(),
    autodelHour: Number.isFinite(autodelHour) ? autodelHour : 23,
    autodelMinute: Number.isFinite(autodelMinute) ? autodelMinute : 59,
    rhCrashTimerMinutes: Math.max(0, Number($('rhTimerMinutes')?.value) || 0),
    rhCrashTimerSeconds: Math.max(0, Math.min(59, Number($('rhTimerSeconds')?.value) || 0))
  });
  $('dataPathLabel').textContent = state.settings.dataPath || 'Datengrube/';
  syncAutoMsgTimers();
}

async function doLogin() {
  const status = $('loginStatus');
  status.textContent = 'Login läuft…';
  await saveSettingsFromForm();
  const res = await modHub.login({ apiKey: $('apiKey').value.trim() });
  if (!res.ok) {
    const err = res.error === 'api_key_required' ? 'API-Key fehlt' : res.error || 'Fehler';
    status.textContent = `Login fehlgeschlagen: ${err}`;
    state.loggedIn = false;
    updateLoginUi();
    return;
  }
  state.loggedIn = true;
  state.modUser = stripAt(res.user) || res.user;
  if (res.convRates) {
    state.convRates = res.convRates;
    state.convRatesAt = Date.now();
  }
  await refreshConvRates();
  retagModMentions();
  await refreshMutedWarnedSets();
  status.textContent = `Eingeloggt als ${state.modUser}. Live-Chat gestartet.`;
  ModChat?.onLogin?.(state.modUser);
  updateLoginUi();
  renderChats();
  renderHubIndexes();
  if (state.settings.dataPath) {
    await refreshBlueprints();
    await refreshVeri2();
  }
  state.liveStats = {
    wsCount: 0,
    browserCount: 0,
    lastWsAt: 0,
    lastBrowserAt: 0,
    wsSubscribed: false,
    wsHost: $('wsHost')?.value || 'stake.bet'
  };
  updateLiveStatusUi();
  modHub.loadBets().then((res) => {
    if (res.ok) setBetsList(res.bets);
  });
}

function readBetsFiltersFromUi() {
  const v = state.betsView;
  v.filterUser = ($('betsFilterUser')?.value || '').trim();
  v.filterGame = ($('betsFilterGame')?.value || '').trim();
  v.filterDateFrom = $('betsFilterDateFrom')?.value || '';
  v.filterDateTo = $('betsFilterDateTo')?.value || '';
  v.filterMinMulti = $('betsFilterMinMulti')?.value ?? '';
  v.filterMaxMulti = $('betsFilterMaxMulti')?.value ?? '';
}

function syncBetsFiltersToUi() {
  const v = state.betsView;
  if ($('betsFilterUser')) $('betsFilterUser').value = v.filterUser;
  if ($('betsFilterGame')) $('betsFilterGame').value = v.filterGame;
  if ($('betsFilterDateFrom')) $('betsFilterDateFrom').value = v.filterDateFrom;
  if ($('betsFilterDateTo')) $('betsFilterDateTo').value = v.filterDateTo;
  if ($('betsFilterMinMulti')) $('betsFilterMinMulti').value = v.filterMinMulti;
  if ($('betsFilterMaxMulti')) $('betsFilterMaxMulti').value = v.filterMaxMulti;
}

function betRowDateIso(b) {
  const d = new Date(b.lastSeenAt || b.firstSeenAt);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function betSortMoney(b, field) {
  const amount = b[field];
  if (amount == null) return -1;
  const usd = toUsd(amount, b.currency);
  if (usd != null) return usd;
  const n = Number(amount);
  return Number.isFinite(n) ? n : -1;
}

function getFilteredSortedBets() {
  readBetsFiltersFromUi();
  const v = state.betsView;
  let rows = [...state.bets];

  if (v.filterUser) {
    const q = v.filterUser.replace(/^@/, '').toLowerCase();
    rows = rows.filter((b) => (b.lastUsername || b.username || '').toLowerCase().includes(q));
  }
  if (v.filterGame) {
    const q = v.filterGame.toLowerCase();
    rows = rows.filter((b) => (b.game || '').toLowerCase().includes(q));
  }
  if (v.filterDateFrom) {
    rows = rows.filter((b) => betRowDateIso(b) >= v.filterDateFrom);
  }
  if (v.filterDateTo) {
    rows = rows.filter((b) => betRowDateIso(b) <= v.filterDateTo);
  }
  const minM = v.filterMinMulti !== '' ? Number(v.filterMinMulti) : null;
  const maxM = v.filterMaxMulti !== '' ? Number(v.filterMaxMulti) : null;
  if (minM != null && Number.isFinite(minM)) {
    rows = rows.filter((b) => (b.multiplier || 0) >= minM);
  }
  if (maxM != null && Number.isFinite(maxM)) {
    rows = rows.filter((b) => (b.multiplier || 0) <= maxM);
  }

  const dir = v.sortDir === 'asc' ? 1 : -1;
  const col = v.sortCol || 'time';
  rows.sort((a, b) => {
    if (col === 'user') {
      const av = (a.lastUsername || a.username || '').toLowerCase();
      const bv = (b.lastUsername || b.username || '').toLowerCase();
      return av.localeCompare(bv) * dir;
    }
    if (col === 'game') {
      const av = (a.game || '').toLowerCase();
      const bv = (b.game || '').toLowerCase();
      return av.localeCompare(bv) * dir;
    }
    if (col === 'multi') {
      return ((a.multiplier || 0) - (b.multiplier || 0)) * dir;
    }
    if (col === 'amount') {
      return (betSortMoney(a, 'amount') - betSortMoney(b, 'amount')) * dir;
    }
    if (col === 'payout') {
      return (betSortMoney(a, 'payout') - betSortMoney(b, 'payout')) * dir;
    }
    return ((a.lastSeenAt || 0) - (b.lastSeenAt || 0)) * dir;
  });
  return rows;
}

function updateBetsSortHeaders() {
  document.querySelectorAll('#betsTable .bets-sort').forEach((th) => {
    const col = th.getAttribute('data-sort');
    const base = th.textContent.replace(/[\s▲▼]+$/, '').trim();
    if (col === state.betsView.sortCol) {
      th.textContent = `${base} ${state.betsView.sortDir === 'asc' ? '▲' : '▼'}`;
      th.classList.add('bets-sort-active');
    } else {
      th.textContent = base;
      th.classList.remove('bets-sort-active');
    }
  });
}

function upsertBetRecord(record) {
  if (!record?.key) return;
  const idx = state.bets.findIndex((b) => b.key === record.key);
  if (idx >= 0) state.bets[idx] = record;
  else state.bets.unshift(record);
  state.betByKey[record.key] = record;
  renderBetsTable();
  ensureConvRates().then(() => renderBetsTable());
}

function setBetsList(bets) {
  state.bets = Array.isArray(bets) ? [...bets] : [];
  state.betByKey = {};
  for (const b of state.bets) {
    if (b?.key) state.betByKey[b.key] = b;
  }
  renderBetsTable();
  ensureConvRates().then(() => renderBetsTable());
}

function renderBetsTable() {
  const body = $('betsTableBody');
  const status = $('betsStatus');
  if (!body) return;
  const total = state.bets.length;
  const rows = getFilteredSortedBets();
  updateBetsSortHeaders();
  const hasRates = state.convRates && Object.keys(state.convRates).length > 0;
  if (status) {
    const usdHint = hasRates ? ' · USD via Stake-Kurse' : state.loggedIn ? ' · USD-Kurse laden…' : ' · Login für USD-Umrechnung';
    status.textContent = total
      ? `${rows.length} / ${total} Wetten — Klick auf ID = kopieren · Doppelklick = Bet-Panel${usdHint}`
      : `Erkannte Bet-IDs werden in Datengrube/ gespeichert.${usdHint}`;
  }
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="hint">${
      total ? 'Keine Treffer für Filter.' : 'Noch keine Wetten — Bet-IDs erscheinen automatisch im Chat.'
    }</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((b) => {
      const ts = new Date(b.lastSeenAt || b.firstSeenAt).toLocaleString('de-DE', {
        dateStyle: 'short',
        timeStyle: 'short'
      });
      const sel = b.key === state.selectedBetKey ? ' bets-row-selected' : '';
      const st = b.lookupOk
        ? '<span class="bet-ok">OK</span>'
        : `<span class="bet-fail" title="${esc(b.lookupError || '')}">Fehler</span>`;
      const amt = fmtMoney(b.amount, b.currency);
      const pay = fmtMoney(b.payout, b.currency);
      const multi = b.multiplier > 0 ? `${b.multiplier.toFixed(2)}x` : '—';
      const userCell = formatBetPosterCell(b);
      const seen = b.seenCount > 1 ? ` <span class="bet-seen">×${b.seenCount}</span>` : '';
      return `<tr class="bets-row${sel}" data-key="${esc(b.key)}" title="${esc(b.message || '')}">
        <td>${esc(ts)}</td>
        <td>${userCell}${seen}</td>
        <td><code class="bet-id-copy" title="Klick = ID kopieren">${esc(b.betId)}</code></td>
        <td>${esc(b.game || '—')}</td>
        <td>${esc(multi)}</td>
        <td>${amt}</td>
        <td>${pay}</td>
        <td>${st}</td>
      </tr>`;
    })
    .join('');
}

function wireBets() {
  const onFilterChange = () => renderBetsTable();
  [
    'betsFilterUser',
    'betsFilterGame',
    'betsFilterDateFrom',
    'betsFilterDateTo',
    'betsFilterMinMulti',
    'betsFilterMaxMulti'
  ].forEach((id) => {
    $(id)?.addEventListener('input', onFilterChange);
    $(id)?.addEventListener('change', onFilterChange);
  });

  $('btnBetsResetFilters')?.addEventListener('click', () => {
    state.betsView.filterUser = '';
    state.betsView.filterGame = '';
    state.betsView.filterDateFrom = '';
    state.betsView.filterDateTo = '';
    state.betsView.filterMinMulti = '';
    state.betsView.filterMaxMulti = '';
    syncBetsFiltersToUi();
    renderBetsTable();
  });

  document.querySelectorAll('#betsTable .bets-sort').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-sort');
      if (!col) return;
      if (state.betsView.sortCol === col) {
        state.betsView.sortDir = state.betsView.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.betsView.sortCol = col;
        state.betsView.sortDir = col === 'user' || col === 'game' ? 'asc' : 'desc';
      }
      renderBetsTable();
    });
  });

  $('btnBetsReload')?.addEventListener('click', async () => {
    await ensureConvRates(true);
    const res = await modHub.loadBets();
    if (res.ok) setBetsList(res.bets);
    else renderBetsTable();
  });

  $('btnBetsClear')?.addEventListener('click', async () => {
    await modHub.clearBets();
    state.bets = [];
    state.betByKey = {};
    state.selectedBetKey = null;
    renderBetsTable();
  });

  $('btnBetsRefresh')?.addEventListener('click', async () => {
    const b = state.betByKey[state.selectedBetKey];
    if (!b?.betId) {
      if ($('betsStatus')) $('betsStatus').textContent = 'Zuerst eine Zeile anklicken, dann Lookup neu.';
      return;
    }
    if ($('betsStatus')) $('betsStatus').textContent = 'Lookup läuft…';
    await modHub.refreshBet(b.betId);
  });

  $('betsTableBody')?.addEventListener('click', (e) => {
    const code = e.target.closest('.bet-id-copy');
    const row = e.target.closest('.bets-row');
    if (!row) return;
    const b = state.betByKey[row.getAttribute('data-key')];
    if (code && b?.betId) {
      copyBetId(b.betId, $('betsStatus'));
      return;
    }
    state.selectedBetKey = row.getAttribute('data-key');
    renderBetsTable();
  });

  $('betsTableBody')?.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.bets-row');
    if (!row) return;
    const b = state.betByKey[row.getAttribute('data-key')];
    if (b?.betId) openBetLookup(b.betId);
  });
}

function showBetPanel(bet, betId) {
  const panel = $('betPanel');
  const body = $('betPanelBody');
  if (!panel || !body) return;
  const usdAmt = toUsd(bet.amount, bet.currency);
  const usdPay = toUsd(bet.payout, bet.currency);
  const at = bet.updatedAt || bet.createdAt;
  const time = at ? new Date(at).toLocaleString() : '—';
  body.innerHTML = `
    <dl>
      <dt>User</dt><dd>${esc(bet.user || '—')}</dd>
      <dt>Zeit</dt><dd>${esc(time)}</dd>
      <dt>Multiplikator</dt><dd>${bet.multiplier ? bet.multiplier.toFixed(4) + 'x' : '—'}</dd>
      <dt>Einsatz</dt><dd>${fmtCrypto(bet.amount, bet.currency)} ${usdAmt != null ? `(${fmtUsd(usdAmt)})` : ''}</dd>
      <dt>Auszahlung</dt><dd>${fmtCrypto(bet.payout, bet.currency)} ${usdPay != null ? `(${fmtUsd(usdPay)})` : ''}</dd>
      <dt>Spiel</dt><dd>${esc(bet.game || '—')}</dd>
      <dt>Bet ID</dt><dd><code>${esc(betId)}</code></dd>
    </dl>`;
  panel.classList.remove('hidden');
}

async function openBetLookup(betId) {
  if (!betId) return;
  $('betPanelBody').innerHTML = '<p class="hint">Lade…</p>';
  $('betPanel').classList.remove('hidden');
  const res = await modHub.betLookup(betId);
  if (!res.ok || !res.data) {
    $('betPanelBody').textContent = `Fehler: ${res.error || 'nicht gefunden'}`;
    return;
  }
  showBetPanel(res.data, betId);
}

function closePolicyMuteModal() {
  $('mutePolicyModal')?.classList.add('hidden');
  state.policyPending = null;
  switchModTab('mute');
}

function switchModTab(tabId) {
  document.querySelectorAll('.stake-mod-tab').forEach((btn) => {
    const active = btn.dataset.modTab === tabId && !btn.disabled;
    btn.classList.toggle('active', active);
  });
  document.querySelectorAll('.stake-mod-panel').forEach((panel) => {
    const active = panel.dataset.modPanel === tabId;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
}

function renderPolicyMuteHistory(list) {
  const el = $('policyMuteHistory');
  if (!el) return;
  const fmt = window.HistoryFormat?.formatStakeMuteHistoryTable;
  el.innerHTML = fmt ? fmt(list) : '<p class="stake-mod-hist-empty">—</p>';
}

function initPolicyModal() {
  const cats = Policy.POLICY_CATEGORIES || {};
  $('policyCategory').innerHTML = Object.values(cats)
    .map((c) => `<option value="${c.id}">${esc(c.label)}</option>`)
    .join('');
  $('policyDuration').innerHTML = (Policy.DURATION_OPTIONS || C.MUTE_PERIODS || [])
    .map((d) => `<option value="${d}">${d}</option>`)
    .join('');
}

function updatePolicySuggestion() {
  const reason = ($('policyMuteMsg')?.value || $('policyReason')?.value || '').trim();
  const cat = Policy.detectedReasonToCategory?.(reason);
  const catEl = $('policyCategory');
  if (cat && catEl) catEl.value = cat;
  const categoryId = catEl?.value || 'custom';
  const strikes = Policy.countStrikesInCategory?.(state.muteHistoryCache, categoryId) || 0;
  const mins = Policy.getSuggestedMinutes?.(categoryId, strikes);
  const label = mins != null ? Policy.minutesToLabel?.(mins) : 'manuell';
  const catHint = Policy.getCategoryHint?.(categoryId) || '';
  const hint = $('policySuggestion');
  if (hint) {
    hint.textContent =
      mins != null
        ? `Policy-Vorschlag: ${label} (Strike ${strikes + 1})${catHint ? ` — ${catHint}` : ''}`
        : catHint || 'Dauer manuell wählen';
  }
  const dur = Policy.minutesToDurationString?.(mins);
  if (dur) {
    const sel = $('policyDuration');
    const opt = Array.from(sel.options).find((o) => o.value === dur);
    if (opt) sel.value = dur;
    else if (mins && C.MUTE_PERIODS) {
      const approx = mins < 60 ? `${mins} minutes` : mins < 1440 ? `${Math.round(mins / 60)} hours` : `${Math.round(mins / 1440)} days`;
      const o2 = Array.from(sel.options).find((o) => o.value === approx);
      if (o2) sel.value = approx;
    }
  }
}

async function openFlaggedChatHistory(item) {
  await openIndexChatHistory(item);
}

function scrollChatHistoryHighlight() {
  const el = $('policyChatHistory');
  if (!el) return;
  const row = el.querySelector('.hist-row-highlight');
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.style.outline = '2px solid #ffb347';
  setTimeout(() => {
    row.style.outline = '';
  }, 2500);
}

async function loadPolicyChatTab(loadMore = false) {
  const el = $('policyChatHistory');
  const meta = $('policyChatHistoryMeta');
  const moreBtn = $('btnChatHistoryMore');
  if (!el || !state.validatedUser) return;

  if (!loadMore) state.chatHistoryLimit = 200;
  else state.chatHistoryLimit = Math.min(500, (state.chatHistoryLimit || 200) + 200);

  el.innerHTML = '<p class="hist-empty">Lade Chat-Historie…</p>';
  if (meta) meta.textContent = 'Lade…';
  if (moreBtn) moreBtn.disabled = true;

  const res = await modHub.chatHistory(state.validatedUser, { maxItems: state.chatHistoryLimit });
  if (!res.ok) {
    el.innerHTML = `<p class="hist-empty">Fehler: ${esc(res.error)}</p>`;
    if (meta) meta.textContent = 'Fehler';
    if (moreBtn) moreBtn.disabled = false;
    return;
  }

  const items = res.data?.user?.chatHistory || [];
  const highlightText = state.chatHistoryHighlight || '';
  el.innerHTML =
    window.HistoryFormat?.formatChatHistory(res.data, { highlightText }) || '<p class="hist-empty">—</p>';
  if (highlightText) {
    requestAnimationFrame(() => scrollChatHistoryHighlight());
    state.chatHistoryHighlight = '';
  }
  if (meta) {
    meta.textContent =
      items.length >= state.chatHistoryLimit
        ? `${items.length} Nachrichten (API, Limit ${state.chatHistoryLimit})`
        : `${items.length} Nachrichten (API, alles geladen)`;
  }
  if (moreBtn) {
    const canMore = items.length >= state.chatHistoryLimit && state.chatHistoryLimit < 500;
    moreBtn.classList.toggle('hidden', !canMore);
    moreBtn.disabled = false;
  }
}

async function loadPolicyTipsTab() {
  const el = $('policyTipHistory');
  if (!el || !state.validatedUser) return;
  el.innerHTML = '<p class="hist-empty">Lade Spenden-Historie…</p>';
  const res = await modHub.tipHistory(state.validatedUser);
  if (!res.ok) {
    el.innerHTML = `<p class="hist-empty">Fehler: ${esc(res.error)}</p>`;
    return;
  }
  el.innerHTML = window.HistoryFormat?.formatTipHistory(res.data) || '<p class="hist-empty">—</p>';
}

async function openModAction(initialTab = 'mute') {
  if (!state.validatedUserId) return;
  state.policyPending = { userId: state.validatedUserId, username: state.validatedUser };
  const v2 = isVeri2(state.validatedUser) ? ' ★' : '';
  $('policyUserName').textContent = `${state.validatedUser}${v2}`;
  $('policyReason').value = '';
  $('policyMuteMsg').value = '';
  const hist = await modHub.muteHistory(state.validatedUser);
  const user = hist.ok ? hist.data?.user : null;
  const hash = user?.hashedIp || state.validatedUserHashedIp || '';
  $('policyUserHash').textContent = hash ? `Hashed IP: ${hash}` : 'Hashed IP: —';
  if (user?.hashedIp) state.validatedUserHashedIp = user.hashedIp;
  state.muteHistoryCache = user?.community?.muteList || [];
  renderPolicyMuteHistory(state.muteHistoryCache);
  updatePolicySuggestion();
  switchModTab(initialTab);
  if (initialTab === 'chat') loadPolicyChatTab();
  else if (initialTab === 'tips') loadPolicyTipsTab();
  $('mutePolicyModal').classList.remove('hidden');
  if (initialTab === 'mute') $('policyMuteMsg')?.focus();
}

async function validateAndOpenModAction(username, initialTab = 'mute') {
  const name = stripAt(String(username || '').trim());
  if (!name) return false;
  document.querySelector('.tab[data-tab="hub"]')?.click();
  $('validateUsername').value = name;
  setValidateButtonState(false);
  $('validateStatus').textContent = 'Prüfe über Stake-API…';
  $('validateStatus').style.color = '';
  const res = await modHub.validateUser(name);
  const u = res.data?.user;
  if (res.ok && u?.id) {
    const canonical = stripAt(u.name) || name;
    state.validatedUser = canonical;
    state.validatedUserId = u.id;
    state.validatedUserHashedIp = u.hashedIp || '';
    $('validateUsername').value = canonical;
    const v2 = isVeri2(canonical) ? ' ★ Veri2' : '';
    $('validateStatus').textContent = `OK: ${canonical}${v2}`;
    $('validateStatus').style.color = '#00e701';
    setValidateButtonState(true);
    setUserActionsEnabled(true);
    syncModMessageMentions(canonical);
    LiveChat.invalidateChatDom();
    renderChats({ forceFull: true });
    await openModAction(initialTab);
    return true;
  }
  state.validatedUser = '';
  state.validatedUserId = '';
  state.validatedUserHashedIp = '';
  $('validateStatus').textContent =
    res.error === 'user_not_found'
      ? `User „${name}“ nicht gefunden (API)`
      : `Fehler: ${res.error || 'Validate fehlgeschlagen'}`;
  $('validateStatus').style.color = '';
  setValidateButtonState(false);
  setUserActionsEnabled(false);
  return false;
}

window.openModAction = openModAction;
window.validateAndOpenModAction = validateAndOpenModAction;

async function openPolicyMute() {
  return openModAction('mute');
}

async function applyPolicyMute() {
  if (!state.policyPending) return;
  const expire = $('policyDuration').value || $('mutePeriod').value;
  const message = ($('policyMuteMsg')?.value || '').trim();
  if (!message) {
    $('policySuggestion').textContent = 'Beschreibung (Mute-Grund) ist erforderlich.';
    $('policyMuteMsg')?.focus();
    return;
  }
  const btn = $('btnPolicyApply');
  if (btn) btn.disabled = true;
  const res = await modHub.muteUser({
    userId: state.policyPending.userId,
    expire,
    message
  });
  if (btn) btn.disabled = false;
  $('validateStatus').textContent = res.ok ? `Gemutet: ${state.policyPending.username}` : `Fehler: ${res.error}`;
  if (res.ok) {
    closePolicyMuteModal();
    await refreshMutedWarnedSets();
  }
}

async function processBetForRh(line) {
  const activeSessions = getActiveRhSessions();
  if (!activeSessions.length || !line.betId) return;
  if (isOwnModChatUser(line.username)) return;

  const cacheKey = line.betId.replace(/\./g, '');

  let game = '';
  let multiplier = line.multiplier || 0;
  let amount = null;
  let betHidden = false;
  const cached = state.betCache[cacheKey];
  if (cached) {
    game = cached.game;
    multiplier = cached.multiplier;
    amount = cached.amount;
    betHidden = !!cached.hidden;
  } else {
    const res = await modHub.betLookup(line.betId);
    if (res.ok && res.data) {
      game = res.data.game || '';
      multiplier = Number(res.data.multiplier) || multiplier;
      amount = res.data.amount != null ? Number(res.data.amount) : null;
      betHidden = !!res.data.hidden;
      state.betCache[cacheKey] = { game, multiplier, amount, hidden: betHidden };
    }
  }

  if (!game) return;

  const casinoId = normalizeRhCasinoTag(line.betId);
  let anyHit = false;

  for (const session of activeSessions) {
    if (!gameMatches(game, session.game)) continue;
    const highestMode = session.mode === 'highestMulti';
    if (!highestMode && multiplier < session.minMulti) continue;
    if (highestMode && multiplier <= 0) continue;

    const hidden = betHidden;
    const bet = { username: line.username, betId: line.betId, game, multiplier, amount, hidden, casinoId, ts: line.ts };
    const dup = session.bets.some((x) => x.betId === bet.betId && x.username === bet.username);
    if (dup) continue;

    session.bets.push(bet);
    anyHit = true;

    const logLine = `${new Date().toLocaleString()} | ${session.game} RH | ${hidden ? '[versteckt] ' : ''}${multiplier.toFixed(2)}x | ${game} | ${casinoId} | @${line.username}`;
    await modHub.appendLog(logLine);

    if (session.id === state.rhActiveId) renderRhBets();
  }

  if (anyHit) {
    line.rhHit = true;
    state.hitKeys.add(`${line.username}|${line.ts}`);
    renderRhSessionsList();
    if (getSelectedRhSession()) refreshRhStatusLine();
    LiveChat.invalidateChatDom();
    renderChats({ forceFull: true });
  }
}

const rhBetQueue = [];
let rhBetDraining = false;

function enqueueRhBet(line) {
  if (!line?.betId) return;
  rhBetQueue.push(line);
  drainRhBetQueue();
}

async function drainRhBetQueue() {
  if (rhBetDraining) return;
  rhBetDraining = true;
  try {
    while (rhBetQueue.length) {
      const line = rhBetQueue.shift();
      await processBetForRh(line);
    }
  } finally {
    rhBetDraining = false;
  }
}

function ingestLiveMessageSync(m, { receivedAt } = {}) {
  const line = parseChatLine(m.username, m.message, m.kind, m.timestamp);
  line.receivedAt = receivedAt ?? Date.now();
  if (m.rain && typeof m.rain === 'object') line.rain = m.rain;
  if (Array.isArray(m.flags) && m.flags.length) line.flags = m.flags;
  if (Array.isArray(m.roles) && m.roles.length) line.roles = m.roles;
  else if (isOwnModChatUser(line.username)) line.roles = ['moderator'];
  line.modMention = isMentionOfMod(line.message);
  pushChatLine(line);

  if (line.modMention) {
    state.tagged.unshift(buildTaggedIndexEntry(line));
    if (state.tagged.length > 50) state.tagged.length = 50;
    if (!isOwnModChatUser(line.username)) {
      playMentionNotifySound();
    }
  }

  if (line.kind === 'rain') {
    state.rains.unshift(buildRainIndexEntry(m, line));
    if (state.rains.length > 50) state.rains.length = 50;
  }

  const flag = scoreIncomingFlag(line);
  if (flag) {
    state.flagged.unshift(buildFlaggedIndexEntry(line, flag));
    if (state.flagged.length > 50) state.flagged.length = 50;
  }

  processRhTriviaHit(line);
  return line;
}

function processLiveMessageBatch(messages, { baseTs } = {}) {
  const ts0 = baseTs ?? Date.now();
  for (let i = 0; i < messages.length; i++) {
    const line = ingestLiveMessageSync(messages[i], { receivedAt: ts0 + i });
    if (line.betId) enqueueRhBet(line);
  }
  renderChats();
  renderHubIndexes();
}

function wireTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.panel-view').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`panel-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'wetten') {
        ensureConvRates().then(() => renderBetsTable());
      }
      if (btn.dataset.tab === 'analyse') {
        window.AnalysePanel?.onTabShow?.();
      }
      if (btn.dataset.tab === 'automute') {
        window.AutomutePanel?.onTabShow?.();
      }
    });
  });
}

function fillValidateUsernameFromChat(username) {
  const u = stripAt(username);
  if (!u) return;
  const field = $('validateUsername');
  if (!field) return;
  field.value = u;
  field.focus();
  if (typeof field.select === 'function') field.select();
  $('btnValidate')?.click();
}

function wireChatBoxDblClick(el) {
  el?.addEventListener('dblclick', (e) => {
    const userEl = e.target.closest('.user');
    if (userEl) {
      fillValidateUsernameFromChat(userEl.dataset.username || userEl.textContent);
      return;
    }
    const row = e.target.closest('[data-bet]');
    if (row) openBetLookup(row.getAttribute('data-bet'));
  });
}

function ensureCtxMenu() {
  if ($('ctxMenu')) return;
  const menu = document.createElement('div');
  menu.id = 'ctxMenu';
  menu.innerHTML = '<button type="button" data-action="bet">Bet Lookup</button><button type="button" data-action="validate">Validate User</button>';
  document.body.appendChild(menu);
  menu.addEventListener('click', (e) => {
    const action = e.target.closest('button')?.dataset?.action;
    const betId = menu.dataset.betId;
    const user = menu.dataset.user;
    menu.style.display = 'none';
    if (action === 'bet' && betId) openBetLookup(betId);
    if (action === 'validate' && user) {
      $('validateUsername').value = user;
      $('btnValidate').click();
    }
  });
  document.addEventListener('click', () => {
    menu.style.display = 'none';
  });
}

function wireHub() {
  ensureCtxMenu();

  $('autoscroll')?.addEventListener('change', () => {
    LiveChat.invalidateChatDom();
    if (isChatAutoscrollEnabled()) {
      const max = Number(state.settings.maxChatRows) || 1000;
      if (state.chatLines.length > max) {
        const drop = state.chatLines.length - max;
        state.chatLines = state.chatLines.slice(drop);
        state.chatLines.forEach((l, i) => {
          l.idx = i;
        });
      }
    }
    renderChats({ forceFull: true });
  });

  $('colorChat')?.addEventListener('change', async (e) => {
    await saveChatDisplaySettings({ colorChatEnabled: !!e.target.checked });
  });
  $('showVipRankBadges')?.addEventListener('change', async (e) => {
    await saveChatDisplaySettings({ showVipRankBadges: !!e.target.checked });
  });
  $('colorChatSettings')?.addEventListener('change', async (e) => {
    await saveChatDisplaySettings({ colorChatEnabled: !!e.target.checked });
  });
  $('showVipRankBadgesSettings')?.addEventListener('change', async (e) => {
    await saveChatDisplaySettings({ showVipRankBadges: !!e.target.checked });
  });

  $('btnClearLive')?.addEventListener('click', () => {
    state.chatLines = [];
    state.tagged = [];
    state.rains = [];
    state.flagged = [];
    state.liveFlagRoll = new Map();
    LiveChat.invalidateChatDom();
    renderChats({ forceFull: true });
    renderHubIndexes();
  });

  $('btnClearTagged')?.addEventListener('click', () => {
    state.tagged = [];
    renderHubIndexes();
  });
  $('btnClearRains')?.addEventListener('click', () => {
    state.rains = [];
    renderHubIndexes();
  });
  $('btnClearFlagged')?.addEventListener('click', () => {
    state.flagged = [];
    renderHubIndexes();
  });

  $('btnLiveChatFontDown')?.addEventListener('click', () => stepLiveChatFontSize(-1));
  $('btnLiveChatFontUp')?.addEventListener('click', () => stepLiveChatFontSize(1));

  let liveChatFilterTimer = null;
  function applyLiveChatFilter() {
    state.chatFilterKeyword = $('liveChatFilter')?.value?.trim() || '';
    LiveChat.invalidateChatDom();
    renderChats({ forceFull: true });
  }
  $('liveChatFilter')?.addEventListener('input', () => {
    clearTimeout(liveChatFilterTimer);
    liveChatFilterTimer = setTimeout(applyLiveChatFilter, 120);
  });
  $('liveChatFilter')?.addEventListener('search', applyLiveChatFilter);
  $('liveChatFilter')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const input = $('liveChatFilter');
      if (!input?.value) return;
      input.value = '';
      applyLiveChatFilter();
    }
  });

  $('liveChat')?.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.chat-line');
    if (!row) return;
    e.preventDefault();
    const menu = $('ctxMenu');
    menu.dataset.betId = row.getAttribute('data-bet') || '';
    const userEl = row.querySelector('.user');
    menu.dataset.user = userEl ? userEl.textContent.replace(/^@/, '') : '';
    menu.style.display = 'block';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
  });

  wireChatBoxDblClick($('liveChat'));
  wireChatBoxDblClick($('rhLiveChat'));

  $('btnCloseBet')?.addEventListener('click', () => $('betPanel').classList.add('hidden'));
  $('btnCloseOverlay')?.addEventListener('click', hideOverlay);

  wireBlueprintSelect('cbChatBlueprints', 'chatMessage');
  wireBlueprintSelect('cbMuteBlueprints', 'muteMessage');
  wireBlueprintSelect('cbWarnBlueprints', 'warnMessage');
  wireBlueprintSelect('cbRhBlueprints', 'rhChatMessage', () =>
    saveRhBlueprintToSession($('cbRhBlueprints')?.value)
  );

  $('btnAddChatBp')?.addEventListener('click', async () => {
    const line = $('chatMessage').value.trim();
    if (!line) return;
    await modHub.appendBlueprint({ type: 'chat', line });
    await refreshBlueprints();
    $('cbChatBlueprints').value = line;
  });

  $('btnAddMuteBp')?.addEventListener('click', async () => {
    const line = $('muteMessage').value.trim();
    if (!line) return;
    await modHub.appendBlueprint({ type: 'mute', line });
    await refreshBlueprints();
    $('cbMuteBlueprints').value = line;
  });

  $('btnAddWarnBp')?.addEventListener('click', async () => {
    const line = $('warnMessage').value.trim();
    if (!line) return;
    await modHub.appendBlueprint({ type: 'warn', line });
    await refreshBlueprints();
    $('cbWarnBlueprints').value = line;
  });

  $('btnValidate')?.addEventListener('click', async () => {
    const name = stripAt($('validateUsername').value.trim());
    if (!name) return;
    $('validateUsername').value = name;
    setValidateButtonState(false);
    $('validateStatus').textContent = 'Prüfe über Stake-API…';
    $('validateStatus').style.color = '';
    const res = await modHub.validateUser(name);
    const u = res.data?.user;
    if (res.ok && u?.id) {
      const canonical = stripAt(u.name) || name;
      state.validatedUser = canonical;
      state.validatedUserId = u.id;
      state.validatedUserHashedIp = u.hashedIp || '';
      $('validateUsername').value = canonical;
      const v2 = isVeri2(canonical) ? ' ★ Veri2' : '';
      $('validateStatus').textContent = `OK: ${canonical}${v2}`;
      $('validateStatus').style.color = '#00e701';
      setValidateButtonState(true);
      setUserActionsEnabled(true);
      syncModMessageMentions(canonical);
    } else {
      state.validatedUser = '';
      state.validatedUserId = '';
      state.validatedUserHashedIp = '';
      $('validateStatus').textContent =
        res.error === 'user_not_found'
          ? `User „${name}“ nicht gefunden (API)`
          : `Fehler: ${res.error || 'Validate fehlgeschlagen'}`;
      $('validateStatus').style.color = '';
      setValidateButtonState(false);
      setUserActionsEnabled(false);
    }
    LiveChat.invalidateChatDom();
    renderChats({ forceFull: true });
  });

  $('validateUsername')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('btnValidate')?.click();
    }
  });

  $('validateUsername')?.addEventListener('input', () => {
    const name = stripAt($('validateUsername').value.trim());
    if (!name) {
      clearValidatedUser();
      $('validateStatus').textContent = '—';
      $('validateStatus').style.color = '';
      return;
    }
    if (name.toLowerCase() !== stripAt(state.validatedUser).toLowerCase()) {
      clearValidatedUser();
      if ($('validateStatus').textContent.startsWith('OK:')) {
        $('validateStatus').textContent = '—';
        $('validateStatus').style.color = '';
      }
    }
  });

  $('btnModAction')?.addEventListener('click', () => openModAction('mute'));
  $('btnChatHistory')?.addEventListener('click', () => {
    if (!state.validatedUserId) {
      $('validateStatus').textContent = 'Zuerst User validieren für History.';
      return;
    }
    openModAction('chat');
  });
  $('btnPolicyApply')?.addEventListener('click', () => applyPolicyMute());
  $('btnPolicyUnmute')?.addEventListener('click', async () => {
    if (!state.validatedUserId) return;
    const res = await modHub.unmuteUser({ userId: state.validatedUserId });
    $('validateStatus').textContent = res.ok
      ? `Unmute: ${state.validatedUser}`
      : `Fehler: ${res.error}`;
    if (res.ok) {
      const hist = await modHub.muteHistory(state.validatedUser);
      const user = hist.ok ? hist.data?.user : null;
      state.muteHistoryCache = user?.community?.muteList || [];
      renderPolicyMuteHistory(state.muteHistoryCache);
    }
  });
  $('btnPolicyClose')?.addEventListener('click', () => closePolicyMuteModal());
  $('mutePolicyModal')?.addEventListener('click', (e) => {
    if (e.target === $('mutePolicyModal')) closePolicyMuteModal();
  });
  document.querySelectorAll('.stake-mod-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const tab = btn.dataset.modTab;
      switchModTab(tab);
      if (tab === 'chat') loadPolicyChatTab();
      else if (tab === 'tips') loadPolicyTipsTab();
    });
  });
  $('btnChatHistoryMore')?.addEventListener('click', () => loadPolicyChatTab(true));
  $('policyReason')?.addEventListener('input', updatePolicySuggestion);
  $('policyMuteMsg')?.addEventListener('input', () => {
    if ($('policyReason') && $('policyMuteMsg')?.value.trim()) {
      $('policyReason').value = $('policyMuteMsg').value;
    }
    updatePolicySuggestion();
  });
  $('policyCategory')?.addEventListener('change', updatePolicySuggestion);
  $('policyMuteMsg')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyPolicyMute();
    }
  });

  $('btnWarn')?.addEventListener('click', async () => {
    if (!state.validatedUser) return;
    const rawMsg = $('warnMessage').value.trim();
    if (!rawMsg) {
      $('validateStatus').textContent = 'Warn-Nachricht fehlt (Blueprint wählen).';
      return;
    }
    const msg = prependUserMentionForChat(rawMsg, state.validatedUser);
    const res = await modHub.warnUser({ username: state.validatedUser, message: msg });
    $('validateStatus').textContent = res.ok
      ? `Warnung an @${state.validatedUser} gesendet`
      : `Fehler: ${res.error}`;
    if (res.ok) await refreshMutedWarnedSets();
  });

  $('btnUserHash')?.addEventListener('click', async () => {
    const name = state.validatedUser || $('validateUsername').value.trim();
    if (!name) return;
    const res = await modHub.userHash(name);
    if (res.ok && res.data?.user) {
      setHistoryOut(HistoryFormat.formatUserDetails(res.data), 'User-Details');
      $('validateStatus').textContent = `Hash: ${res.data.user.hashedIp || '—'}`;
    } else {
      $('validateStatus').textContent = `Fehler: ${res.error}`;
    }
  });

  $('btnAddVeri2')?.addEventListener('click', async () => {
    const name = state.validatedUser || $('validateUsername').value.trim();
    if (!name) return;
    await modHub.addVeri2(name);
    await refreshVeri2();
    $('validateStatus').textContent = `Veri2: ${name} hinzugefügt`;
    renderChats();
  });

  $('btnMutedList')?.addEventListener('click', async () => {
    const res = await modHub.loadMutedWarned();
    if (!res.ok) {
      showOverlay('Muted Users', 'Kein Datenordner.');
      return;
    }
    const lines = (res.muted || []).map((r) => `${r.timestamp}\t${r.user}\t${r.period}\t${r.message}`);
    showOverlay('Muted Users', lines.join('\n') || '(leer)');
  });

  $('btnWarnedList')?.addEventListener('click', async () => {
    const res = await modHub.loadMutedWarned();
    if (!res.ok) {
      showOverlay('Warned Users', 'Kein Datenordner.');
      return;
    }
    const lines = (res.warned || []).map((r) => `${r.timestamp}\t${r.user}\t${r.message}`);
    showOverlay('Warned Users', lines.join('\n') || '(leer)');
  });

  $('btnAltCheck')?.addEventListener('click', async () => {
    const res = await modHub.duplicateIps();
    if (!res.ok || !res.groups?.length) {
      showOverlay('Alt-Check (Duplicate IP)', res.groups ? 'Keine Duplikate.' : 'Kein Datenordner / keine HashIP_All.csv');
      return;
    }
    const text = res.groups
      .map((g) => {
        const users = g.users.map((u) => (u.veri2 ? `★${u.name}` : u.name)).join(', ');
        return `IP ${g.ip}\n  ${users}`;
      })
      .join('\n\n');
    showOverlay('Alt-Check — Duplicate IPs', text);
  });

  $('btnAllMsg')?.addEventListener('click', () => {
    const name = state.validatedUser || $('validateUsername').value.trim();
    if (!name) {
      $('validateStatus').textContent = 'Zuerst User validieren für Allmsg.';
      return;
    }
    state.allmsgUser = name;
    const matches = state.chatLines.filter((l) => l.username.toLowerCase() === name.toLowerCase());
    LiveChat.invalidateChatDom();
    renderChats({ forceFull: true });
    $('validateStatus').textContent = `Allmsg: ${matches.length} Zeilen für ${name}`;
  });

  $('btnUndoMark')?.addEventListener('click', () => {
    state.allmsgUser = '';
    state.modMarkUser = state.modUser || '';
    LiveChat.invalidateChatDom();
    renderChats({ forceFull: true });
    $('validateStatus').textContent = state.modMarkUser ? `Undo mark: ${state.modMarkUser}` : 'Mod-User unbekannt';
  });

  $('btnShowBrowser')?.addEventListener('click', async () => {
    state.browserVisible = !state.browserVisible;
    await modHub.toggleBrowser(state.browserVisible);
    $('btnShowBrowser').textContent = state.browserVisible ? 'Browser verbergen' : 'Browser anzeigen';
  });

  $('btnHideToTray')?.addEventListener('click', () => {
    modHub.hideToTray?.();
  });

  async function sendModChatField(inputId, label, { mentionUser = false } = {}) {
    const raw = $(inputId)?.value?.trim();
    if (!raw) {
      $('validateStatus').textContent = `${label}: Text fehlt.`;
      return;
    }
    if (!state.loggedIn) {
      $('validateStatus').textContent = 'Zuerst einloggen.';
      return;
    }
    const msg =
      mentionUser && state.validatedUser ? prependUserMentionForChat(raw, state.validatedUser) : raw;
    const res = await modHub.sendChat({ message: msg, useGraphql: true, chatId: chatId() });
    if (res.ok) {
      const el = $(inputId);
      if (el) el.value = '';
    }
    $('validateStatus').textContent = res.ok ? `${label} gesendet` : `${label}: ${res.error}`;
  }

  $('btnSendMute')?.addEventListener('click', () =>
    sendModChatField('muteMessage', 'Mute-Text', { mentionUser: true })
  );
  $('btnSendWarn')?.addEventListener('click', () =>
    sendModChatField('warnMessage', 'Warn-Text', { mentionUser: true })
  );
  $('btnSendChat')?.addEventListener('click', () =>
    sendModChatField('chatMessage', 'Chat-Text', { mentionUser: false })
  );

  $('chatMessage')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!$('btnSendChat')?.disabled) $('btnSendChat').click();
    }
  });

  $('btnAddRhBp')?.addEventListener('click', async () => {
    const line = $('rhChatMessage').value.trim();
    if (!line) return;
    await modHub.appendBlueprint({ type: 'rh', line });
    await refreshBlueprints();
    $('cbRhBlueprints').value = line;
  });

  $('btnRhSendChat')?.addEventListener('click', async () => {
    const msg = $('rhChatMessage').value.trim();
    if (!msg) {
      $('rhRecordStatus').textContent = 'RH-Nachricht fehlt.';
      return;
    }
    saveRhBlueprintToSession($('cbRhBlueprints')?.value || msg);
    const session = getSelectedRhSession();
    const gameLabel = session?.game ? `${session.game} RH — ` : '';
    const res = await modHub.sendChat({ message: msg, useGraphql: true, chatId: chatId() });
    $('rhRecordStatus').textContent = res.ok ? `${gameLabel}RH-Nachricht gesendet.` : `${gameLabel}Fehler: ${res.error}`;
  });
}

async function stopRhWithAnnounce(reason = 'manuell', sessionId = state.rhActiveId) {
  const session = getRhSession(sessionId);
  if (!session?.active) {
    $('rhRecordStatus').textContent = 'Keine aktive RH für diese Auswahl.';
    return;
  }
  const game = session.game;
  if (state.loggedIn) {
    const res = await sendRhStopBlueprintToChat();
    if (!res.ok) {
      $('rhRecordStatus').textContent = `${game} RH — Stop-Nachricht fehlgeschlagen: ${res.error}`;
      return;
    }
  }
  await finishRhSession(sessionId, reason, { announced: true });
}

async function finishRhSession(sessionId, reason, opts = {}) {
  const session = getRhSession(sessionId);
  if (!session?.active) return;
  session.active = false;
  clearSessionDeadlineTimer(session);
  syncRhStatusTimer();

  const leader = getRhLeader(session);
  let summary;
  if (session.mode === 'highestMulti') {
    summary = leader
      ? `${session.game} beendet (${reason}). Gewinner: ${formatRhLeaderLine(leader)} — ${session.bets.length} Wetten.`
      : `${session.game} beendet (${reason}). Keine Wetten — ${session.bets.length} Einträge.`;
    const timerNote = session.overtime
      ? `Timer ${session.deadlineLabel} + Verlängerung`
      : `Timer ${session.deadlineLabel}`;
    await modHub.appendLog(
      `--- RH STOP ${session.game} höchster Multi | ${timerNote} | ${reason} | Gewinner: ${leader ? formatRhLeaderLine(leader) : '—'} ---`
    );
  } else {
    summary = `${session.game} gestoppt (${reason}). ${session.bets.length} Wetten geloggt.`;
    await modHub.appendLog(`--- RH STOP ${session.game} >= ${session.minMulti}x (${session.bets.length} bets) ---`);
  }
  if (opts.announced) {
    summary = `${session.game} RH — STOP gesendet · ${summary}`;
  }

  updateRhGameSelectOptions();
  renderRhSessionsList();
  if (sessionId === state.rhActiveId) {
    $('rhRecordStatus').textContent = summary;
    setRhStopButtonsEnabled(false);
    renderRhBets();
  }
}

function wireRh() {
  $('rhGame')?.addEventListener('change', updateRhGameModeUi);

  $('rhSessionsList')?.addEventListener('click', (e) => {
    const dismiss = e.target.closest('[data-rh-dismiss]');
    if (dismiss) {
      removeRhSession(dismiss.getAttribute('data-rh-dismiss'));
      return;
    }
    const item = e.target.closest('[data-rh-id]');
    if (item) selectRhSession(item.getAttribute('data-rh-id'));
  });

  $('btnRhStart')?.addEventListener('click', async () => {
    if (!state.loggedIn) {
      $('rhRecordStatus').textContent = 'Zuerst einloggen (API-Key).';
      return;
    }
    const game = $('rhGame').value;
    if (findActiveRhForGame(game)) {
      $('rhRecordStatus').textContent = `${game} läuft bereits — max. 1 RH pro Spiel.`;
      return;
    }

    const highestMode = isHighestMultiRhGame(game);
    const session = {
      id: nextRhId(),
      active: true,
      game,
      mode: highestMode ? 'highestMulti' : 'minMulti',
      minMulti: highestMode ? 0 : Number($('rhMinMulti').value) || 0,
      bets: [],
      startedAt: Date.now()
    };

    if (highestMode) {
      const durationMs = readRhTimerDurationMs();
      if (!durationMs) {
        $('rhRecordStatus').textContent = 'Timer: mindestens 1 Sekunde (Min/Sek) einstellen.';
        return;
      }
      session.durationMs = durationMs;
      session.deadlineLabel = rhTimerLabelFromMs(durationMs);
      session.deadlineTs = Date.now() + durationMs;
      await modHub.saveSettings({
        rhCrashTimerMinutes: Math.max(0, Number($('rhTimerMinutes')?.value) || 0),
        rhCrashTimerSeconds: Math.max(0, Math.min(59, Number($('rhTimerSeconds')?.value) || 0))
      });
      await modHub.appendLog(`--- RH START ${game} | höchster Multi | Timer ${session.deadlineLabel} ---`);
      session.deadlineTimer = setTimeout(() => {
        if (getRhSession(session.id)?.active) enterRhOvertime(session.id);
      }, durationMs);
    } else {
      await modHub.appendLog(`--- RH START ${game} >= ${session.minMulti}x ---`);
    }

    state.rhSessions.push(session);
    selectRhSession(session.id);
    updateRhGameSelectOptions();
    syncRhStatusTimer();
    refreshRhStatusLine();
    setRhStopButtonsEnabled(true);
  });

  $('btnRhStop')?.addEventListener('click', () => {
    const session = getSelectedRhSession();
    if (!session?.active) {
      $('rhRecordStatus').textContent = 'Keine aktive RH für diese Auswahl.';
      return;
    }
    finishRhSession(session.id, 'manuell');
  });
  $('btnRhStopAnnounce')?.addEventListener('click', () => stopRhWithAnnounce('manuell'));

  $('rhPlaceSelect')?.addEventListener('change', () => updateRhLeaderPostUi());
  $('btnRhPostLeader')?.addEventListener('click', () => postCurrentRhPlace());

  $('btnRhClear')?.addEventListener('click', () => {
    const session = getSelectedRhSession();
    if (!session) return;
    session.bets = [];
    renderRhBets();
    renderRhSessionsList();
    refreshRhStatusLine();
  });

  $('rhBetLog')?.addEventListener('click', (e) => {
    const row = e.target.closest('.bet-row');
    if (!row) return;
    const t = row.getAttribute('data-copy');
    if (t) copyBetId(t, $('rhModeHint'));
  });

  $('btnRhTriviaStart')?.addEventListener('click', () => startRhTrivia());
  $('btnRhTriviaStop')?.addEventListener('click', () => stopRhTrivia());
  $('btnRhTriviaClear')?.addEventListener('click', () => clearRhTrivia());
  $('rhTriviaSolution')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !state.rhTrivia.active) {
      e.preventDefault();
      startRhTrivia();
    }
  });

  updateRhTriviaUi();
  renderRhTriviaLog();
}

function updateStatusLabel(p) {
  const el = $('updateStatus');
  if (!el || !p?.state) return;
  const labels = {
    checking: 'Suche Updates…',
    available: `Update v${p.version || '?'} — Download…`,
    downloading: `Download ${p.percent ?? 0}%`,
    ready: `Update v${p.version || '?'} bereit — Neustart`,
    none: 'Keine Updates',
    error: `Update-Fehler: ${p.message || '?'}`
  };
  el.textContent = labels[p.state] || '—';
  renderUpdaterToast(p);
}

function renderUpdaterToast(p) {
  const box = $('updateToast');
  if (!box) return;
  const state = p?.state;
  const title = $('updateToastTitle');
  const body = $('updateToastBody');
  const progress = $('updateToastProgress');
  const bar = $('updateToastBar');
  const percent = $('updateToastPercent');
  const btnDl = $('btnUpdateDownload');
  const btnRestart = $('btnUpdateRestart');
  const btnDismiss = $('btnUpdateDismiss');
  const curVer = modHub.version || $('appVersion')?.textContent || '?';

  const hideActions = () => {
    btnDl?.classList.add('hidden');
    btnRestart?.classList.add('hidden');
    btnDismiss?.classList.add('hidden');
    progress?.classList.add('hidden');
  };

  if (!state || state === 'checking' || state === 'none') {
    box.classList.add('hidden');
    box.classList.remove('is-error');
    return;
  }

  box.classList.remove('hidden');
  box.classList.toggle('is-error', state === 'error');
  hideActions();

  if (state === 'available') {
    if (title) title.textContent = 'Update verfügbar';
    if (body) {
      body.textContent = `Version ${p.version || '?'} auf GitHub. Aktuell: v${curVer}. Download startet automatisch — oder manuell:`;
    }
    btnDl?.classList.remove('hidden');
    btnDismiss?.classList.remove('hidden');
    return;
  }

  if (state === 'downloading') {
    if (title) title.textContent = 'Update wird geladen…';
    if (body) body.textContent = `Stake Mod Hub v${p.version || '?'}`;
    progress?.classList.remove('hidden');
    const pct = Math.round(p.percent ?? 0);
    if (bar) bar.style.width = `${pct}%`;
    if (percent) percent.textContent = `${pct}%`;
    return;
  }

  if (state === 'ready') {
    if (title) title.textContent = 'Update bereit';
    if (body) body.textContent = `Version ${p.version || '?'} installieren und neu starten?`;
    btnRestart?.classList.remove('hidden');
    btnDismiss?.classList.remove('hidden');
    return;
  }

  if (state === 'error') {
    if (title) title.textContent = 'Update-Fehler';
    if (body) body.textContent = String(p.message || 'Unbekannter Fehler');
    btnDismiss?.classList.remove('hidden');
  }
}

const UPDATE_UI_CHECK_MS = 4 * 60 * 60 * 1000;

function wireUpdates() {
  let updateUiTimer = null;

  const triggerCheck = () => {
    modHub.checkForUpdates?.().catch(() => {});
  };

  modHub.onUpdateStatus?.((p) => updateStatusLabel(p));

  $('btnCheckUpdate')?.addEventListener('click', async () => {
    $('updateStatus').textContent = 'Prüfe…';
    const res = await modHub.checkForUpdates();
    if (res?.error === 'dev_mode') {
      $('updateStatus').textContent = 'Nur in installierter EXE (nicht npm start)';
      return;
    }
    if (!res?.ok) {
      $('updateStatus').textContent = `Fehler: ${res.error || 'unbekannt'}`;
      return;
    }
    if (res.updateInfo?.version) {
      $('updateStatus').textContent = `Release v${res.updateInfo.version} gefunden`;
    } else {
      $('updateStatus').textContent = 'Prüfung gestartet…';
    }
  });

  $('btnUpdateDownload')?.addEventListener('click', () => {
    modHub.startUpdateDownload?.();
    $('updateStatus').textContent = 'Download gestartet…';
  });

  $('btnUpdateRestart')?.addEventListener('click', () => {
    modHub.quitAndInstallUpdate?.();
  });

  $('btnUpdateDismiss')?.addEventListener('click', () => {
    $('updateToast')?.classList.add('hidden');
  });

  setTimeout(triggerCheck, 2000);
  if (updateUiTimer) clearInterval(updateUiTimer);
  updateUiTimer = setInterval(triggerCheck, UPDATE_UI_CHECK_MS);
}

function wireAutomsg() {
  $('btnAddAutoMsg')?.addEventListener('click', () => openAutoMsgEditor(null));

  $('automsgList')?.addEventListener('click', (e) => {
    const row = e.target.closest('.automsg-row');
    if (!row) return;
    const id = row.getAttribute('data-id');
    const btn = e.target.closest('button[data-action]');
    if (!btn || !id) return;
    if (btn.dataset.action === 'send') postAutoMessage(id, { auto: false });
    else if (btn.dataset.action === 'settings') openAutoMsgSettings(id);
  });

  $('automsgList')?.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.automsg-row');
    if (!row || e.target.closest('button')) return;
    openAutoMsgEditor(row.getAttribute('data-id'));
  });

  $('autoMsgEditText')?.addEventListener('input', () => updateAutoMsgEditPreview());
  $('autoMsgEditRulesLink')?.addEventListener('change', () => updateAutoMsgEditPreview());

  $('btnAutoMsgEditCancel')?.addEventListener('click', () => closeAutoMsgEditor());
  $('autoMsgEditModal')?.addEventListener('click', (e) => {
    if (e.target === $('autoMsgEditModal')) closeAutoMsgEditor();
  });

  $('btnAutoMsgEditSave')?.addEventListener('click', async () => {
    const label = ($('autoMsgEditLabel')?.value || '').trim() || 'Automsg';
    const text = ($('autoMsgEditText')?.value || '').trim();
    const appendRulesLink = !!$('autoMsgEditRulesLink')?.checked;
    const msgs = getAutoMessages().slice();
    const existingId = state.autoMsgEditId;
    if (existingId) {
      const idx = msgs.findIndex((m) => m.id === existingId);
      if (idx >= 0) {
        msgs[idx] = { ...msgs[idx], label, text, appendRulesLink };
      }
    } else {
      msgs.push({
        id: newAutoMsgId(),
        label,
        text,
        appendRulesLink,
        autoEnabled: false,
        autoIntervalMinutes: 60
      });
    }
    await persistAutoMsgSettings({ autoMessages: msgs });
    closeAutoMsgEditor();
    setAutomsgStatus(`„${label}“ gespeichert.`);
  });

  $('btnAutoMsgEditDelete')?.addEventListener('click', async () => {
    const id = state.autoMsgEditId;
    if (!id) return;
    const msgs = getAutoMessages().filter((m) => m.id !== id);
    await persistAutoMsgSettings({ autoMessages: msgs });
    closeAutoMsgEditor();
    setAutomsgStatus('Automsg gelöscht.');
  });

  $('btnAutoMsgSettingsCancel')?.addEventListener('click', () => closeAutoMsgSettings());
  $('autoMsgSettingsModal')?.addEventListener('click', (e) => {
    if (e.target === $('autoMsgSettingsModal')) closeAutoMsgSettings();
  });

  $('btnAutoMsgSettingsSave')?.addEventListener('click', async () => {
    const id = state.autoMsgSettingsId;
    if (!id) return;
    const msgs = getAutoMessages().map((m) => {
      if (m.id !== id) return m;
      return {
        ...m,
        autoEnabled: !!$('autoMsgSettingsEnabled')?.checked,
        autoIntervalMinutes: Math.max(0, Number($('autoMsgSettingsInterval')?.value) || 0)
      };
    });
    await persistAutoMsgSettings({ autoMessages: msgs });
    closeAutoMsgSettings();
    const entry = findAutoMessage(id);
    setAutomsgStatus(`Autopost für „${entry?.label || 'Automsg'}“ gespeichert.`);
  });

  $('mentionNotifyEnabled')?.addEventListener('change', () => {
    persistAutoMsgSettings({
      mentionNotifyEnabled: !!$('mentionNotifyEnabled')?.checked
    });
  });

  $('mentionNotifySound')?.addEventListener('change', () => {
    persistAutoMsgSettings({
      mentionNotifySound: $('mentionNotifySound')?.value || '1'
    });
  });

  $('mentionAliases')?.addEventListener('input', () => syncMentionAliasesFromUi({ persist: false }));
  $('mentionAliases')?.addEventListener('change', () => syncMentionAliasesFromUi({ persist: true }));
  $('mentionAliases')?.addEventListener('blur', () => syncMentionAliasesFromUi({ persist: true }));

  $('btnTestMentionSound')?.addEventListener('click', () => {
    playMentionNotifySound($('mentionNotifySound')?.value || '1');
  });
}

function wireNotifySounds() {
  $('btnImportNotifySound')?.addEventListener('click', () => importCustomNotifySound());

  $('customNotifySoundsList')?.addEventListener('click', async (e) => {
    const row = e.target.closest('.notify-sound-row');
    if (!row) return;
    const id = row.getAttribute('data-id');
    const action = e.target.closest('button')?.dataset?.action;
    if (action === 'test') {
      await NotifySounds?.playNotifySound?.(`custom:${id}`, modHub);
      return;
    }
    if (action === 'delete') {
      await deleteCustomNotifySound(id);
    }
  });
}

function wireSettings() {
  $('liveChatFontSize')?.addEventListener('change', async () => {
    const px = applyLiveChatFontSize($('liveChatFontSize').value);
    state.settings = await modHub.saveSettings({ liveChatFontSize: px });
  });

  $('btnSaveSettings')?.addEventListener('click', async () => {
    await saveSettingsFromForm();
    $('loginStatus').textContent = 'Einstellungen gespeichert.';
    if (state.loggedIn && ModChat?.isAllowedMod?.(state.modUser)) {
      ModChat.reconnect?.();
    }
    if (state.settings.dataPath) {
      await refreshBlueprints();
      await refreshVeri2();
    }
  });

  $('btnLogin')?.addEventListener('click', () => doLogin());

  $('btnStakeLogin')?.addEventListener('click', async () => {
    $('loginStatus').textContent = 'Browser öffnen… (optional)';
    await saveSettingsFromForm();
    const res = await modHub.stakeLogin({ stakeDomain: $('stakeDomain').value });
    if (res.ok) {
      const s = await modHub.getSettings();
      state.settings = s;
      $('clearance').value = s.clearance || res.clearance || '';
      $('loginStatus').textContent = s.clearance
        ? 'Cookies aktualisiert. CF-Wert übernommen.'
        : 'Browser geschlossen. Kein CF-Cookie gefunden — API-Key reicht oft trotzdem.';
    } else {
      $('loginStatus').textContent = `Cookie-Update: ${res.error}`;
    }
  });

  $('btnPickPath')?.addEventListener('click', async () => {
    const res = await modHub.pickDataPath();
    if (res.ok) {
      state.settings.dataPath = res.dataPath;
      $('dataPathLabel').textContent = res.dataPath;
      await modHub.seedBlueprints();
      await refreshBlueprints();
      await refreshVeri2();
    }
  });

  $('modChatEnabled')?.addEventListener('change', async () => {
    await saveSettingsFromForm();
    if (state.loggedIn && ModChat?.isAllowedMod?.(state.modUser)) {
      if (state.settings.modChatEnabled === false) ModChat.onLogout?.();
      else ModChat.onLogin?.(state.modUser);
    }
  });

  $('modChatUrl')?.addEventListener('change', async () => {
    await saveSettingsFromForm();
    if (state.loggedIn && ModChat?.isAllowedMod?.(state.modUser)) ModChat.reconnect?.();
  });

  $('btnSeedBlueprints')?.addEventListener('click', async () => {
    const res = await modHub.seedBlueprints({ force: true });
    if (!res.ok) {
      $('loginStatus').textContent = res.error ? `Blueprint-Import: ${res.error}` : 'Import fehlgeschlagen.';
      return;
    }
    if (res.dataPath) {
      state.settings.dataPath = res.dataPath;
      $('dataPathLabel').textContent = res.dataPath;
    }
    await refreshBlueprints();
    const nChat = state.blueprints.chat.length;
    const nMute = state.blueprints.mute.length;
    const nRh = state.blueprints.rh.length;
    $('loginStatus').textContent = `Blueprints: ${nChat} Chat, ${nMute} Mute, ${nRh} RH${res.bundledOk === false ? ' (defaults fehlen!)' : ''}.`;
  });
}

function startHubClock() {
  const el = $('hubClock');
  if (!el) return;
  const tick = () => {
    const now = new Date();
    const text = now.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    el.textContent = text;
    el.setAttribute('datetime', now.toISOString());
  };
  tick();
  if (state.hubClockTimer) clearInterval(state.hubClockTimer);
  state.hubClockTimer = setInterval(tick, 1000);
}

function initWindowControls() {
  const wrap = $('windowControls');
  if (!wrap || !modHub.isFrameless) return;
  wrap.hidden = false;

  const maxBtn = wrap.querySelector('[data-action="maximize"]');
  const setMaxIcon = async () => {
    const res = await modHub.windowIsMaximized?.();
    const maximized = !!res?.maximized;
    if (!maxBtn) return;
    maxBtn.innerHTML = maximized
      ? '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 0.5h5v2h2.5v7h-7.5v-9zm1 1v7h5.5v-5.5h-1.5v-1h-4z" fill="currentColor" /></svg>'
      : '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1" /></svg>';
    maxBtn.setAttribute('aria-label', maximized ? 'Restore window' : 'Maximize window');
  };

  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (action === 'minimize') void modHub.windowMinimize();
    if (action === 'maximize') void modHub.windowMaximize().then(() => setMaxIcon());
    if (action === 'close') void modHub.windowClose();
  });

  window.addEventListener('resize', () => {
    void setMaxIcon();
  });
  void setMaxIcon();
}

async function init() {
  if (!window.modHub) {
    document.body.innerHTML = '<p>modHub bridge missing — preload error</p>';
    return;
  }
  initWindowControls();
  $('appVersion').textContent = modHub.version || '0.3';
  LiveChat.init({
    state,
    $,
    esc,
    stripAt,
    formatChatTime,
    isVeri2,
    isOwnModChatUser
  });
  ModChat?.init?.({
    state,
    $,
    esc,
    formatChatTime
  });
  await Promise.all([
    Emotes?.init({
      button: $('btnEmotePicker'),
      panel: $('emotePicker'),
      textarea: $('chatMessage')
    }),
    RankBadges?.load(),
    RhPayoutTables?.init(rhPayoutElements())
  ]);
  startHubClock();
  initPolicyModal();
  wireTabs();
  wireHub();
  wireRh();
  wireBets();
  wireAutomsg();
  wireNotifySounds();
  AutomutePanel?.init?.({ $, esc, modHub, state, C });
  wireSettings();
  wireUpdates();
  await loadSettingsUi();
  updateLoginUi();
  setUserActionsEnabled(false);

  modHub.onSessionUpdated((s) => {
    state.settings = { ...state.settings, ...s };
    if (s.clearance) $('clearance').value = s.clearance;
  });

  modHub.onLiveMessages((payload) => {
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    if (!messages.length) return;
    const src = payload?.source || '';
    if (src === 'ws') {
      state.liveStats.wsCount += messages.length;
      state.liveStats.lastWsAt = Date.now();
    } else if (src === 'browser' || src === 'inject') {
      state.liveStats.browserCount += messages.length;
      state.liveStats.lastBrowserAt = Date.now();
    }
    const baseTs = Date.now();
    processLiveMessageBatch(messages, { baseTs });
    updateLiveStatusUi();
  });

  modHub.onAutomuteAction?.((entry) => {
    AutomutePanel?.onAutomuteAction?.(entry);
  });

  modHub.onWsStatus((st) => {
    const phase = st?.phase || '';
    if (st.wsHost) state.liveStats.wsHost = st.wsHost;
    if (st.subscribed) state.liveStats.wsSubscribed = true;
    if (phase === 'stopped') state.liveStats.wsSubscribed = false;

    if (phase === 'message') {
      state.liveStats.wsCount = st.msgCount || state.liveStats.wsCount;
      state.liveStats.lastWsAt = Date.now();
      updateLiveStatusUi();
      return;
    }

    if (phase === 'graphql_error') {
      return;
    }

    if (phase === 'reconnecting' || phase === 'error' || phase === 'closed') {
      if (state.liveStats.browserCount > 0 && Date.now() - state.liveStats.lastBrowserAt < 120000) {
        updateLiveStatusUi();
        return;
      }
      if (phase === 'closed' && state.liveStats.lastWsAt > Date.now() - 30000) {
        updateLiveStatusUi();
        return;
      }
      const err = st.error || st.reason || st.lastError || '';
      const badge = $('wsModeBadge');
      if (badge) {
        badge.style.display = '';
        badge.textContent = phase === 'error' ? 'WS: Fehler' : 'WS: reconnect';
        badge.classList.add('warn');
      }
      $('liveStatus').textContent = 'Live';
      $('wsDebug').textContent = err ? String(err).slice(0, 220) : 'WS verbindet neu…';
      return;
    }

    if (phase === 'subscribed') {
      state.liveStats.wsSubscribed = true;
      updateLiveStatusUi();
      return;
    }

    if (phase === 'connecting' || phase === 'open') {
      if (!state.liveStats.wsCount && !state.liveStats.injectCount) {
        $('wsModeBadge').textContent = phase === 'connecting' ? 'WS: verbinde…' : 'WS: handshake';
        $('wsDebug').textContent =
          phase === 'connecting'
            ? `Verbinde ${st.wsHost || 'stake.bet'}…`
            : 'WS offen, warte auf connection_ack…';
      }
    }
  });

  modHub.onLiveDebug(() => {});

  modHub.onBetRecord((record) => upsertBetRecord(record));
  modHub.onBetsLoaded((payload) => {
    if (payload?.bets) setBetsList(payload.bets);
  });

  if (state.settings.apiKey) {
    $('loginStatus').textContent = 'API-Key gespeichert — Login klicken.';
    modHub.loadBets().then((res) => {
      if (res.ok) setBetsList(res.bets);
    });
  }
}

init();
