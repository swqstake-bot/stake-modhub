/* global MODHUB_CONST, modHub, StakeModPolicy */

const C = window.MODHUB_CONST || {};
const Policy = window.StakeModPolicy || {};

const state = {
  settings: {},
  loggedIn: false,
  modUser: '',
  validatedUser: '',
  validatedUserId: '',
  chatLines: [],
  rhSessions: [],
  rhActiveId: null,
  rhNextId: 1,
  betCache: {},
  hitKeys: new Set(),
  convRates: {},
  convRatesAt: 0,
  hubClockTimer: null,
  veri2: new Set(),
  blueprints: { chat: [], mute: [], warn: [], rh: [] },
  tagged: [],
  rains: [],
  recentLines: [],
  apiRecent: [],
  allmsgUser: '',
  modMarkUser: '',
  browserVisible: false,
  rhStatusTimer: null,
  policyPending: null,
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
    return `@${first} <span class="bet-seen" title="Zuletzt im Chat gepostet">→ @${esc(last)}</span>`;
  }
  return `@${first}`;
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

function retagModMentions() {
  for (const line of state.chatLines) {
    line.modMention = isMentionOfMod(line.message);
  }
  state.tagged = state.chatLines
    .filter((l) => l.modMention)
    .slice(-50)
    .reverse()
    .map((line) => ({
      username: line.username,
      time: new Date(line.ts).toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }),
      text: line.message,
      preview: line.message.slice(0, 120),
      idx: line.idx
    }));
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

function formatRhCasinoTag(bet) {
  const raw = String(bet?.betId || bet?.casinoId || '')
    .replace(/^casino:/i, '')
    .trim();
  if (/^[a-f0-9-]{36}$/i.test(raw)) return `casino:${raw}`;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '#—';
  const parts = [];
  for (let i = digits.length; i > 0; i -= 3) {
    parts.unshift(digits.slice(Math.max(0, i - 3), i));
  }
  return `#${parts.join('.')}`;
}

function buildRhPlaceMessage(bet, session, place) {
  const medal = { 1: '🥇', 2: '🥈', 3: '🥉' }[place] || '🏆';
  const user = stripAt(bet.username);
  const multi = (bet.multiplier || 0).toFixed(2);
  const game = String(bet.game || session?.game || '').trim();
  const casino = formatRhCasinoTag(bet);
  const gameShort = game.length > 12 ? game.slice(0, 12) : game;
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
  const hint = $('rhModeHint');
  if (hint) {
    hint.textContent = crashMode
      ? 'Crash/Slide: Timer → Verlängerung bis Stop. Platz 1–3 posten (max. 160 Zeichen). ● = hidden.'
      : 'Klassisch: Wetten ab Min-Multi. Platz 1–3 posten (max. 160 Zeichen). Max. 1 RH/Spiel. ● = hidden.';
  }
  updateRhLeaderPostUi();
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

function isMentionOfMod(message) {
  const mod = stripAt(state.modUser);
  if (!mod) return false;
  const esc = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`@${esc}\\b`, 'i');
  return re.test(String(message || ''));
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

function pushChatLine(line) {
  line.idx = state.chatLines.length;
  state.chatLines.push(line);
  const max = Number(state.settings.maxChatRows) || 1000;
  if (state.chatLines.length > max) {
    const drop = state.chatLines.length - max;
    state.chatLines = state.chatLines.slice(drop);
    state.chatLines.forEach((l, i) => {
      l.idx = i;
    });
  }
}

function lineClasses(m) {
  const parts = ['chat-line'];
  if (m.kind === 'tip') parts.push('kind-tip');
  if (m.kind === 'rain') parts.push('kind-rain');
  if (m.kind === 'trivia') parts.push('kind-trivia');
  if (m.kind === 'race') parts.push('kind-race');
  if (m.kind === 'bot') parts.push('kind-bot');
  if (m.rhHit) parts.push('rh-hit');
  if (isVeri2(m.username)) parts.push('veri2');
  if (m.modMention) parts.push('mark-tagged');
  if (state.allmsgUser && m.username.toLowerCase() === state.allmsgUser.toLowerCase()) parts.push('mark-yellow');
  if (state.modMarkUser && m.username.toLowerCase() === state.modMarkUser.toLowerCase()) parts.push('mark-mod');
  return parts.join(' ');
}

function renderChatBox(el, lines, opts = {}) {
  if (!el) return;
  const slice = lines.slice(-300);
  el.innerHTML = slice
    .map((m) => {
      const cls = lineClasses(m);
      const betAttr = m.betId ? ` data-bet="${esc(m.betId)}" title="Bet-ID: ${esc(m.betId)} — Doppelklick = Lookup"` : '';
      const idxAttr = ` data-idx="${m.idx}"`;
      const msgCls = m.betId ? ' has-bet-id' : '';
      return `<div class="${cls}${msgCls}"${idxAttr}${betAttr}><span class="user">${esc(stripAt(m.username))}</span>: ${esc(m.message)}</div>`;
    })
    .join('');
  if (opts.autoscroll !== false && ($('autoscroll')?.checked ?? true)) {
    el.scrollTop = el.scrollHeight;
  }
}

function renderChats() {
  renderChatBox($('liveChat'), state.chatLines);
  renderChatBox($('rhLiveChat'), state.chatLines);
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
  const recipientText = recipients.length ? recipients.join(', ') : String(line.message || '').trim();
  return {
    username: giver,
    time,
    text: recipientText,
    preview: recipientText,
    idx: line.idx
  };
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
    return `<div class="index-item" data-i="${i}" title="${esc(fullTitle)}">
      <div class="index-item-meta">
        ${user ? `<span class="index-item-user">${esc(user)}</span>` : '<span></span>'}
        ${time ? `<span class="index-item-time">${esc(time)}</span>` : ''}
      </div>
      ${msg ? `<div class="index-item-msg">${esc(msg)}</div>` : ''}
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

function renderTaggedRainRecent() {
  renderIndexList($('tagIndex'), state.tagged, (it) => scrollToLine(it.idx));
  renderIndexList($('rainIndex'), state.rains, (it) => scrollToLine(it.idx));
  const recent = state.apiRecent.length ? state.apiRecent : state.recentLines;
  renderIndexList($('recentPanel'), recent, (it) => {
    if (it.idx != null) scrollToLine(it.idx);
  });
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
    'btnMute',
    'btnUnmute',
    'btnWarn',
    'btnUserHash',
    'btnSendChat',
    'btnSendMute',
    'btnSendWarn',
    'btnChatHist',
    'btnTipHist',
    'btnMuteHist',
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
    'btnAltCheck',
    'btnApiRecent'
  ];
  ids.forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !on;
  });
}

function setUserActionsEnabled(on) {
  ['btnMute', 'btnUnmute', 'btnWarn', 'btnUserHash', 'btnChatHist', 'btnTipHist', 'btnMuteHist', 'btnAddVeri2', 'btnApiRecent'].forEach((id) => {
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

async function loadSettingsUi() {
  const s = await modHub.getSettings();
  state.settings = s;
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
  }
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
    autodelHour: Number.isFinite(autodelHour) ? autodelHour : 23,
    autodelMinute: Number.isFinite(autodelMinute) ? autodelMinute : 59,
    rhCrashTimerMinutes: Math.max(0, Number($('rhTimerMinutes')?.value) || 0),
    rhCrashTimerSeconds: Math.max(0, Math.min(59, Number($('rhTimerSeconds')?.value) || 0))
  });
  $('dataPathLabel').textContent = state.settings.dataPath || 'Datengrube/';
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
  status.textContent = `Eingeloggt als ${state.modUser}. Live-Chat gestartet.`;
  updateLoginUi();
  renderChats();
  renderTaggedRainRecent();
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
  const reason = $('policyReason').value;
  const cat = Policy.detectedReasonToCategory?.(reason);
  const catEl = $('policyCategory');
  if (cat && catEl) catEl.value = cat;
  const categoryId = catEl?.value || 'custom';
  const strikes = Policy.countStrikesInCategory?.(state.muteHistoryCache, categoryId) || 0;
  const mins = Policy.getSuggestedMinutes?.(categoryId, strikes);
  const label = mins != null ? Policy.minutesToLabel?.(mins) : 'manuell';
  $('policySuggestion').textContent = mins != null ? `Vorschlag: ${label} (Strike ${strikes + 1})` : 'Kategorie manuell wählen';
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

async function openPolicyMute() {
  if (!state.validatedUserId) return;
  state.policyPending = { userId: state.validatedUserId, username: state.validatedUser };
  $('policyUserLine').textContent = `User: ${state.validatedUser}`;
  $('policyReason').value = $('muteMessage').value.trim();
  $('policyMuteMsg').value = prependUserMentionForChat($('muteMessage').value.trim(), state.validatedUser);
  const hist = await modHub.muteHistory(state.validatedUser);
  state.muteHistoryCache = hist.ok ? hist.data?.user?.community?.muteList || [] : [];
  updatePolicySuggestion();
  $('mutePolicyModal').classList.remove('hidden');
}

async function applyPolicyMute() {
  if (!state.policyPending) return;
  const expire = $('policyDuration').value || $('mutePeriod').value;
  const rawMsg = $('policyMuteMsg').value.trim() || $('muteMessage').value.trim();
  const message = prependUserMentionForChat(rawMsg, state.policyPending.username);
  const res = await modHub.muteUser({
    userId: state.policyPending.userId,
    expire,
    message
  });
  $('validateStatus').textContent = res.ok ? `Gemutet: ${state.policyPending.username}` : `Fehler: ${res.error}`;
  $('mutePolicyModal').classList.add('hidden');
  state.policyPending = null;
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

  const casinoId = /^[a-f0-9-]{36}$/i.test(line.betId) ? `casino:${line.betId}` : `casino:${line.betId.replace(/\./g, '')}`;
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
  }
}

async function onLiveMessage(m) {
  const line = parseChatLine(m.username, m.message, m.kind, m.timestamp);
  if (m.rain && typeof m.rain === 'object') line.rain = m.rain;
  line.modMention = isMentionOfMod(line.message);
  pushChatLine(line);

  if (line.modMention) {
    state.tagged.unshift({
      username: line.username,
      time: new Date(line.ts).toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }),
      text: line.message,
      preview: line.message.slice(0, 120),
      idx: line.idx
    });
    if (state.tagged.length > 50) state.tagged.length = 50;
  }

  if (line.kind === 'rain') {
    state.rains.unshift(buildRainIndexEntry(m, line));
    if (state.rains.length > 50) state.rains.length = 50;
  }

  if (line.betId) await processBetForRh(line);

  renderChats();
  renderTaggedRainRecent();
}

function wireTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.panel-view').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`panel-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'bets') {
        ensureConvRates().then(() => renderBetsTable());
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
      fillValidateUsernameFromChat(userEl.textContent);
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

  $('btnClearLive')?.addEventListener('click', () => {
    state.chatLines = [];
    state.tagged = [];
    state.rains = [];
    renderChats();
    renderTaggedRainRecent();
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

  $('cbChatBlueprints')?.addEventListener('change', () => fillBlueprint('cbChatBlueprints', 'chatMessage'));
  $('cbMuteBlueprints')?.addEventListener('change', () => fillBlueprint('cbMuteBlueprints', 'muteMessage'));
  $('cbWarnBlueprints')?.addEventListener('change', () => fillBlueprint('cbWarnBlueprints', 'warnMessage'));
  $('cbRhBlueprints')?.addEventListener('change', () => {
    fillBlueprint('cbRhBlueprints', 'rhChatMessage');
    saveRhBlueprintToSession($('cbRhBlueprints')?.value);
  });

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
      $('validateStatus').textContent =
        res.error === 'user_not_found'
          ? `User „${name}“ nicht gefunden (API)`
          : `Fehler: ${res.error || 'Validate fehlgeschlagen'}`;
      $('validateStatus').style.color = '';
      setValidateButtonState(false);
      setUserActionsEnabled(false);
    }
    renderChats();
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

  $('btnMute')?.addEventListener('click', () => openPolicyMute());
  $('btnPolicyApply')?.addEventListener('click', () => applyPolicyMute());
  $('btnPolicyCancel')?.addEventListener('click', () => {
    $('mutePolicyModal').classList.add('hidden');
    state.policyPending = null;
  });
  $('policyReason')?.addEventListener('input', updatePolicySuggestion);
  $('policyCategory')?.addEventListener('change', updatePolicySuggestion);

  $('btnUnmute')?.addEventListener('click', async () => {
    if (!state.validatedUserId) return;
    const res = await modHub.unmuteUser({ userId: state.validatedUserId });
    $('validateStatus').textContent = res.ok ? `Unmute: ${state.validatedUser}` : `Fehler: ${res.error}`;
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

  $('btnApiRecent')?.addEventListener('click', async () => {
    if (!state.validatedUser) {
      $('validateStatus').textContent = 'Zuerst User validieren.';
      return;
    }
    $('validateStatus').textContent = 'Lade API-Chat-Historie…';
    const res = await modHub.chatHistory(state.validatedUser);
    if (!res.ok) {
      $('validateStatus').textContent = `Fehler: ${res.error}`;
      return;
    }
    const items = res.data?.user?.chatHistory || [];
    const fmtText = window.HistoryFormat?.chatHistoryItemText || ((h) => h?.data?.message || '(kein Text)');
    state.apiRecent = items.slice(0, 40).map((h) => {
      const time = h.createdAt
        ? new Date(h.createdAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
        : '—';
      const room = h.chat?.name || '';
      const msg = fmtText(h);
      const text = room ? `${msg} · ${room}` : msg;
      return { label: time, time, text: text.slice(0, 140), preview: text };
    });
    state.recentLines = [];
    renderTaggedRainRecent();
    $('validateStatus').textContent = `API Recent: ${state.apiRecent.length} Zeilen`;
  });

  $('btnAllMsg')?.addEventListener('click', () => {
    const name = state.validatedUser || $('validateUsername').value.trim();
    if (!name) {
      $('validateStatus').textContent = 'Zuerst User validieren für Allmsg.';
      return;
    }
    state.allmsgUser = name;
    state.apiRecent = [];
    const matches = state.chatLines.filter((l) => l.username.toLowerCase() === name.toLowerCase());
    state.recentLines = matches.slice(-30).map((l) => {
      const time = new Date(l.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      return {
        label: `${time} @${l.username}`,
        time,
        text: l.message,
        idx: l.idx,
        preview: l.message
      };
    });
    renderChats();
    renderTaggedRainRecent();
    $('validateStatus').textContent = `Allmsg: ${matches.length} Zeilen für ${name}`;
  });

  $('btnUndoMark')?.addEventListener('click', () => {
    state.allmsgUser = '';
    state.modMarkUser = state.modUser || '';
    renderChats();
    $('validateStatus').textContent = state.modMarkUser ? `Undo mark: ${state.modMarkUser}` : 'Mod-User unbekannt';
  });

  $('btnShowBrowser')?.addEventListener('click', async () => {
    state.browserVisible = !state.browserVisible;
    await modHub.toggleBrowser(state.browserVisible);
    $('btnShowBrowser').textContent = state.browserVisible ? 'Browser verbergen' : 'Browser anzeigen';
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
    $('validateStatus').textContent = res.ok ? `${label} gesendet` : `${label}: ${res.error}`;
  }

  $('btnSendMute')?.addEventListener('click', () =>
    sendModChatField('muteMessage', 'Mute-Text', { mentionUser: true })
  );
  $('btnSendWarn')?.addEventListener('click', () =>
    sendModChatField('warnMessage', 'Warn-Text', { mentionUser: true })
  );
  $('btnSendChat')?.addEventListener('click', () =>
    sendModChatField('chatMessage', 'Chat-Text', { mentionUser: true })
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

  $('btnChatHist')?.addEventListener('click', async () => {
    if (!state.validatedUser) {
      setHistoryOut('<p class="hist-empty">Zuerst User validieren.</p>', 'Chat-Historie');
      return;
    }
    setHistoryOut('<p class="hist-empty">Lade Chat-Historie…</p>', 'Chat-Historie');
    const res = await modHub.chatHistory(state.validatedUser);
    if (!res.ok) {
      setHistoryOut(`<p class="hist-empty">Fehler: ${esc(res.error)}</p>`, 'Chat-Historie');
      return;
    }
    setHistoryOut(HistoryFormat.formatChatHistory(res.data), 'Chat-Historie');
  });

  $('btnTipHist')?.addEventListener('click', async () => {
    if (!state.validatedUser) {
      setHistoryOut('<p class="hist-empty">Zuerst User validieren.</p>', 'Tip-Historie');
      return;
    }
    setHistoryOut('<p class="hist-empty">Lade Tip-Historie…</p>', 'Tip-Historie');
    const res = await modHub.tipHistory(state.validatedUser);
    if (!res.ok) {
      setHistoryOut(`<p class="hist-empty">Fehler: ${esc(res.error)}</p>`, 'Tip-Historie');
      return;
    }
    setHistoryOut(HistoryFormat.formatTipHistory(res.data), 'Tip-Historie');
  });

  $('btnMuteHist')?.addEventListener('click', async () => {
    if (!state.validatedUser) {
      setHistoryOut('<p class="hist-empty">Zuerst User validieren.</p>', 'Mute-Historie');
      return;
    }
    setHistoryOut('<p class="hist-empty">Lade Mute-Historie…</p>', 'Mute-Historie');
    const res = await modHub.muteHistory(state.validatedUser);
    if (!res.ok) {
      setHistoryOut(`<p class="hist-empty">Fehler: ${esc(res.error)}</p>`, 'Mute-Historie');
      return;
    }
    setHistoryOut(HistoryFormat.formatMuteHistory(res.data), 'Mute-Historie');
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
}

function wireUpdates() {
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
}

function wireSettings() {
  $('btnSaveSettings')?.addEventListener('click', async () => {
    await saveSettingsFromForm();
    $('loginStatus').textContent = 'Einstellungen gespeichert.';
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

async function init() {
  if (!window.modHub) {
    document.body.innerHTML = '<p>modHub bridge missing — preload error</p>';
    return;
  }
  $('appVersion').textContent = modHub.version || '0.3';
  startHubClock();
  initPolicyModal();
  wireTabs();
  wireHub();
  wireRh();
  wireBets();
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
    for (const m of messages) onLiveMessage(m);
    updateLiveStatusUi();
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
