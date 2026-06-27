(function () {
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function chatHistoryItemText(h) {
    const data = h?.data;
    if (!data) return '(kein Inhalt)';
    if (data.message) return String(data.message);
    if (data.bot?.message) return String(data.bot.message);
    const tip = data.tip;
    if (tip) {
      const to = tip.user?.name || '?';
      const amt = tip.amount != null ? `${tip.amount} ${tip.currency || ''}`.trim() : '';
      return `Tip → @${to}${amt ? ` (${amt})` : ''}`;
    }
    const rain = data.rain;
    if (rain) {
      const giver = rain.user?.name || '?';
      const amt = rain.amount != null ? `${rain.amount} ${rain.currency || ''}`.trim() : '';
      return `Rain von @${giver}${amt ? ` (${amt})` : ''}`;
    }
    if (data.question != null) {
      const prize = data.amount != null ? ` (${data.amount} ${data.currency || ''})` : '';
      return `[Trivia] ${data.status || ''} ${data.question}${prize}`.trim();
    }
    if (data.race) return `[Race] ${data.race.name || 'Race'} (${data.race.status || ''})`;
    return '(kein Text)';
  }

  function normHistMatchText(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function messageMatchesHighlight(msg, highlightText) {
    const a = normHistMatchText(msg);
    const b = normHistMatchText(highlightText);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a))) return true;
    return false;
  }

  function formatChatHistory(data, opts = {}) {
    const items = data?.user?.chatHistory;
    const highlightText = opts.highlightText || '';
    if (!Array.isArray(items) || !items.length) {
      if (highlightText) {
        return `<p class="hist-empty">Keine Chat-Historie in der API. Live-Nachricht: <em>${esc(highlightText)}</em></p>`;
      }
      return '<p class="hist-empty">Keine Chat-Historie.</p>';
    }
    let highlightFound = false;
    const rows = items
      .map((h, i) => {
        const room = h.chat?.name || '—';
        const ts = h.createdAt ? new Date(h.createdAt).toLocaleString('de-DE') : '—';
        const msg = chatHistoryItemText(h);
        const hl = highlightText && messageMatchesHighlight(msg, highlightText);
        if (hl) highlightFound = true;
        const cls = hl ? 'hist-row-highlight' : '';
        return `<tr class="${cls}" data-hist-i="${i}"><td>${esc(ts)}</td><td>${esc(room)}</td><td>${esc(msg)}</td></tr>`;
      })
      .join('');
    const note =
      highlightText && !highlightFound
        ? `<p class="hist-highlight-miss hint">Live-Treffer noch nicht in der API — zeigt den API-Verlauf:</p>`
        : '';
    return `${note}<table class="hist-table"><thead><tr><th>Zeit</th><th>Raum</th><th>Nachricht</th></tr></thead><tbody>${rows}</tbody></table>`;
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

  function formatStakeMuteHistoryTable(list) {
    if (!Array.isArray(list) || !list.length) {
      return '<p class="stake-mod-hist-empty">Keine Mute-Historie.</p>';
    }
    const rows = list
      .map((m) => {
        const grund = m.message || '—';
        const mod = m.authUser?.name || '—';
        const d = m.createdAt ? new Date(m.createdAt) : null;
        const ts = d
          ? `${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`
          : '—';
        return `<tr><td>${esc(grund)}</td><td>${esc(mod)}</td><td>${esc(ts)}</td></tr>`;
      })
      .join('');
    return `<table class="stake-mod-hist-table"><thead><tr><th>Grund</th><th>Stummgeschaltet von</th><th>Erstellt am</th></tr></thead><tbody>${rows}</tbody></table>`;
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
    const tags = [];
    if (u.isHighroller) tags.push('Highroller');
    if (u.isSportHighroller) tags.push('Sport-HR');
    if (u.isRainproof) tags.push('Rainproof');
    if (u.isIgnored) tags.push('Ignored');
    if (u.preferenceHideBets) tags.push('Hide bets');
  return `<div class="hist-user">
    <p><strong>@${esc(u.name)}</strong> · ID ${esc(u.id)}</p>
    <p>Erstellt: ${u.createdAt ? new Date(u.createdAt).toLocaleString('de-DE') : '—'} · Gemutet: ${u.isMuted ? 'ja' : 'nein'}</p>
    <p>Tags: ${esc(tags.join(', ') || '—')} · Flags: ${esc(flags)} · Rollen: ${esc(roles)}</p>
    ${
      st
        ? `<p>Stats: ${esc(st.bets)} Wetten · ${esc(st.wins)} W · ${esc(st.losses)} L · Umsatz ${esc(st.betAmount)} ${esc(st.currency || '')}</p>`
        : ''
    }
    ${u.hashedIp ? `<p>IP-Hash: <code>${esc(u.hashedIp)}</code></p>` : ''}
  </div>`;
  }

  window.HistoryFormat = {
    chatHistoryItemText,
    normHistMatchText,
    messageMatchesHighlight,
    formatChatHistory,
    formatTipHistory,
    formatMuteHistory,
    formatStakeMuteHistoryTable,
    formatUserDetails
  };
})();
