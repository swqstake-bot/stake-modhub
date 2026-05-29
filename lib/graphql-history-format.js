function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatChatHistory(data) {
  const items = data?.user?.chatHistory;
  if (!Array.isArray(items) || !items.length) return '<p class="hist-empty">Keine Chat-Historie.</p>';
  const rows = items
    .map((h) => {
      const room = h.chat?.name || '—';
      const ts = h.createdAt ? new Date(h.createdAt).toLocaleString('de-DE') : '—';
      const msg = h.data?.message || '(kein Text)';
      return `<tr><td>${esc(ts)}</td><td>${esc(room)}</td><td>${esc(msg)}</td></tr>`;
    })
    .join('');
  return `<table class="hist-table"><thead><tr><th>Zeit</th><th>Raum</th><th>Nachricht</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function formatTipHistory(data) {
  const items = data?.user?.tipHistory;
  if (!Array.isArray(items) || !items.length) return '<p class="hist-empty">Keine Tips.</p>';
  const rows = items
    .map((t) => {
      const from = t.sendBy?.name || '—';
      const to = t.user?.name || '—';
      const amt = t.amount != null ? `${t.amount} ${t.currency || ''}` : '—';
      const ts = t.createdAt ? new Date(t.createdAt).toLocaleString('de-DE') : '—';
      const pub = t.isPublic ? 'ja' : 'nein';
      const room = t.chat?.name || '—';
      return `<tr><td>${esc(ts)}</td><td>@${esc(from)}</td><td>@${esc(to)}</td><td>${esc(amt)}</td><td>${esc(room)}</td><td>${pub}</td></tr>`;
    })
    .join('');
  return `<table class="hist-table"><thead><tr><th>Zeit</th><th>Von</th><th>An</th><th>Betrag</th><th>Chat</th><th>Öffentlich</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function formatMuteHistory(data) {
  const list = data?.user?.community?.muteList;
  if (!Array.isArray(list) || !list.length) return '<p class="hist-empty">Keine Mute-Historie.</p>';
  const rows = list
    .map((m) => {
      const mod = m.authUser?.name || '—';
      const ts = m.createdAt ? new Date(m.createdAt).toLocaleString('de-DE') : '—';
      const exp = m.expireAt ? new Date(m.expireAt).toLocaleString('de-DE') : 'permanent';
      return `<tr><td>${esc(ts)}</td><td>@${esc(mod)}</td><td>${esc(m.message)}</td><td>${esc(exp)}</td></tr>`;
    })
    .join('');
  return `<table class="hist-table"><thead><tr><th>Zeit</th><th>Mod</th><th>Grund</th><th>Bis</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function formatUserDetails(data) {
  const u = data?.user;
  if (!u) return '<p class="hist-empty">User nicht gefunden.</p>';
  const st = u.statistic;
  const flags = (u.flags || []).map((f) => f.flag).filter(Boolean).join(', ') || '—';
  const roles = (u.roles || []).map((r) => r.name).filter(Boolean).join(', ') || '—';
  return `<div class="hist-user">
    <p><strong>@${esc(u.name)}</strong> · ID ${esc(u.id)}</p>
    <p>Erstellt: ${u.createdAt ? new Date(u.createdAt).toLocaleString('de-DE') : '—'} · Gemutet: ${u.isMuted ? 'ja' : 'nein'}</p>
    <p>Flags: ${esc(flags)} · Rollen: ${esc(roles)}</p>
    ${
      st
        ? `<p>Stats: ${esc(st.bets)} Wetten · ${esc(st.wins)} W · ${esc(st.losses)} L · Umsatz ${esc(st.betAmount)} ${esc(st.currency || '')}</p>`
        : ''
    }
  </div>`;
}

module.exports = {
  formatChatHistory,
  formatTipHistory,
  formatMuteHistory,
  formatUserDetails
};
