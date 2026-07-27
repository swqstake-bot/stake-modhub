/**
 * Live-Chat-Rendering — aus app.js ausgelagert (inkrementell + Voll-Render).
 */
(function (global) {
  /** @type {object | null} */
  let ctx = null;

  function getCtx() {
    if (!ctx) throw new Error('LiveChat.init() required');
    return ctx;
  }

  function init(context) {
    ctx = context;
    ctx.state.chatDomHeadUid = null;
    ctx.state.chatDomCount = 0;
  }

  function isChatAutoscrollEnabled() {
    const el = getCtx().$('autoscroll');
    return el ? el.checked : true;
  }

  function getEffectiveChatStoreMax() {
    if (!isChatAutoscrollEnabled()) return Infinity;
    return Number(getCtx().state.settings.maxChatRows) || 1000;
  }

  function getChatLinesForDisplay(lines) {
    if (!isChatAutoscrollEnabled()) return lines;
    return lines.length > 300 ? lines.slice(-300) : lines;
  }

  function getChatFilterKeyword() {
    return String(getCtx().state.chatFilterKeyword || '').trim();
  }

  function matchesChatFilter(line, keyword) {
    if (!keyword) return true;
    const { stripAt } = getCtx();
    const lower = keyword.toLowerCase();
    const user = stripAt(line.username || '').toLowerCase();
    const msg = String(line.message || '').toLowerCase();
    return user.includes(lower) || msg.includes(lower);
  }

  function getDisplayChatLines(lines) {
    const slice = getChatLinesForDisplay(lines);
    const keyword = getChatFilterKeyword();
    if (!keyword) {
      return { lines: slice, keyword: '', matchCount: slice.length, totalCount: slice.length };
    }
    const filtered = slice.filter((line) => matchesChatFilter(line, keyword));
    return {
      lines: filtered,
      keyword,
      matchCount: filtered.length,
      totalCount: slice.length
    };
  }

  function formatChatFilterEmptyHtml(keyword) {
    const { esc } = getCtx();
    return `<p class="hint chat-filter-empty">Keine Treffer für „${esc(keyword)}“ in den angezeigten Zeilen.</p>`;
  }

  function updateChatFilterStatus(meta) {
    const { $ } = getCtx();
    const el = $('liveChatFilterStatus');
    if (!el) return;
    if (!meta.keyword) {
      el.textContent = '';
      el.classList.add('hidden');
      return;
    }
    el.textContent = `${meta.matchCount} / ${meta.totalCount}`;
    el.classList.remove('hidden');
  }

  function ensureLineUid(line) {
    const { state } = getCtx();
    if (line.uid == null) {
      state.chatLineUid += 1;
      line.uid = state.chatLineUid;
    }
    return line.uid;
  }

  function pushChatLine(line) {
    const { state } = getCtx();
    ensureLineUid(line);
    line.idx = state.chatLines.length;
    state.chatLines.push(line);
    const max = getEffectiveChatStoreMax();
    if (Number.isFinite(max) && state.chatLines.length > max) {
      const drop = state.chatLines.length - max;
      state.chatLines = state.chatLines.slice(drop);
      state.chatLines.forEach((l, i) => {
        l.idx = i;
      });
    }
    return line;
  }

  function lineClasses(m) {
    const { state, isVeri2, isOwnModChatUser } = getCtx();
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
    if (typeof isOwnModChatUser === 'function' && isOwnModChatUser(m.username)) parts.push('is-self');
    return parts.join(' ');
  }

  function formatChatLineHtml(m) {
    const { esc, stripAt, formatChatTime, state } = getCtx();
    const cls = lineClasses(m);
    const betAttr = m.betId ? ` data-bet="${esc(m.betId)}" title="Bet-ID: ${esc(m.betId)} — Doppelklick = Lookup"` : '';
    const idxAttr = ` data-idx="${m.idx}" data-uid="${m.uid}"`;
    const msgCls = m.betId ? ' has-bet-id' : '';
    const displayTs = m.receivedAt ?? m.ts;
    const timeLabel = formatChatTime(displayTs);
    const serverLabel = m.receivedAt && m.ts !== m.receivedAt ? formatChatTime(m.ts) : '';
    const timeTitle = serverLabel ? `Empfang ${timeLabel} · Server ${serverLabel}` : timeLabel;
    const msgHtml = window.Emotes?.formatMessageHtml
      ? window.Emotes.formatMessageHtml(m.message, esc)
      : esc(m.message);

    const userName = stripAt(m.username);
    const colorEnabled = state?.settings?.colorChatEnabled !== false;
    const badgesEnabled = state?.settings?.showVipRankBadges !== false;
    const isSelf = typeof getCtx().isOwnModChatUser === 'function' && getCtx().isOwnModChatUser(userName);

    const badgeHtml = window.RankBadges?.formatUserBadgesHtml
      ? window.RankBadges.formatUserBadgesHtml({ flags: m.flags, roles: m.roles }, esc, { enabled: badgesEnabled })
      : window.RankBadges?.formatFlagsHtml
        ? window.RankBadges.formatFlagsHtml(m.flags, esc, { enabled: badgesEnabled })
        : '';

    const userHtml = window.ChatColors?.formatUserHtml
      ? window.ChatColors.formatUserHtml(userName, { isSelf, esc, colorEnabled })
      : `<span class="user" data-username="${esc(userName)}">${esc(userName)}</span>`;

    return `<div class="${cls}${msgCls}"${idxAttr}${betAttr}><span class="chat-time" title="${esc(timeTitle)}">${esc(timeLabel)}</span>${badgeHtml}<span class="chat-user-wrap">${userHtml}</span>: ${msgHtml}</div>`;
  }

  function needsFullChatRender(displayLines) {
    const { state } = getCtx();
    if (!displayLines.length) {
      state.chatDomHeadUid = null;
      state.chatDomCount = 0;
      return true;
    }
    const headUid = displayLines[0].uid;
    if (state.chatDomHeadUid == null || state.chatDomCount === 0) return true;
    if (headUid !== state.chatDomHeadUid) return true;
    if (displayLines.length < state.chatDomCount) return true;
    return false;
  }

  function renderChatBox(el, lines, opts = {}) {
    if (!el) return;
    const { state } = getCtx();
    const autoscroll = opts.autoscroll !== false && isChatAutoscrollEnabled();
    const prevTop = el.scrollTop;
    let anchorUid = null;
    let anchorOffset = 0;
    if (!autoscroll) {
      for (const child of el.querySelectorAll('.chat-line[data-uid]')) {
        const top = child.offsetTop;
        if (top + child.offsetHeight > prevTop + 1) {
          anchorUid = child.getAttribute('data-uid');
          anchorOffset = top - prevTop;
          break;
        }
      }
    }
    const meta = getDisplayChatLines(lines);
    const slice = meta.lines;
    slice.forEach(ensureLineUid);
    if (!slice.length && meta.keyword) {
      el.innerHTML = formatChatFilterEmptyHtml(meta.keyword);
    } else {
      el.innerHTML = slice.map((m) => formatChatLineHtml(m)).join('');
    }
    state.chatDomHeadUid = slice[0]?.uid ?? null;
    state.chatDomCount = slice.length;
    if (autoscroll) {
      el.scrollTop = el.scrollHeight;
    } else if (anchorUid != null) {
      const anchor = el.querySelector(`[data-uid="${anchorUid}"]`);
      el.scrollTop = anchor ? Math.max(0, anchor.offsetTop - anchorOffset) : prevTop;
    } else {
      el.scrollTop = prevTop;
    }
  }

  function appendChatBoxLines(el, newLines, displayLines) {
    if (!el || !newLines.length) return;
    const { state } = getCtx();
    const autoscroll = isChatAutoscrollEnabled();
    const maxDisplay = 300;
    const frag = document.createDocumentFragment();
    const wrap = document.createElement('div');
    wrap.innerHTML = newLines.map((m) => formatChatLineHtml(m)).join('');
    while (wrap.firstChild) frag.appendChild(wrap.firstChild);
    el.appendChild(frag);

    if (autoscroll && displayLines.length > maxDisplay) {
      const trim = displayLines.length - maxDisplay;
      const children = el.querySelectorAll('.chat-line');
      for (let i = 0; i < trim && children[i]; i++) {
        children[i].remove();
      }
    }

    state.chatDomHeadUid = displayLines[0]?.uid ?? null;
    state.chatDomCount = Math.min(displayLines.length, autoscroll ? maxDisplay : displayLines.length);

    if (autoscroll) {
      el.scrollTop = el.scrollHeight;
    }
  }

  function renderChats(opts = {}) {
    const { $, state } = getCtx();
    const meta = getDisplayChatLines(state.chatLines);
    const displayLines = meta.lines;
    displayLines.forEach(ensureLineUid);
    updateChatFilterStatus(meta);

    const live = $('liveChat');
    const rh = $('rhLiveChat');
    const forceFull = !!opts.forceFull || !!meta.keyword;

    if (forceFull || needsFullChatRender(displayLines)) {
      renderChatBox(live, state.chatLines);
      renderChatBox(rh, state.chatLines);
      return;
    }

    const prevCount = state.chatDomCount || 0;
    const newLines = displayLines.slice(prevCount);
    if (!newLines.length) {
      return;
    }

    appendChatBoxLines(live, newLines, displayLines);
    appendChatBoxLines(rh, newLines, displayLines);
  }

  function invalidateChatDom() {
    const { state } = getCtx();
    state.chatDomHeadUid = null;
    state.chatDomCount = 0;
  }

  global.LiveChat = {
    init,
    pushChatLine,
    renderChats,
    invalidateChatDom,
    getChatLinesForDisplay,
    getDisplayChatLines
  };
})(window);
