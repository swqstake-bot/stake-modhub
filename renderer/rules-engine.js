/**
 * Heuristische Regel-Auswertung (Orientierung Chatregeln DE / Policy 2026).
 * Kein Ersatz für menschliche Moderation — nur Zahlen über exportierte Logs.
 */
(function (global) {
  'use strict';

  const MENTION_FLOOD_THRESHOLD = 8;
  const MENTION_FLOOD_WEIGHT = 0.75;
  const MENTION_FLOOD_ID = 'mention_flood';
  const MAX_HITS_PER_MSG = 12;

  let activeRules = null;
  let compiled = null;

  function normalizeMsgText(s) {
    return String(s == null ? '' : s).toLowerCase();
  }

  function capsMetrics(rawText, cfg) {
    const letters = String(rawText).replace(/[^a-zA-ZäöüÄÖÜß]/g, '');
    if (!cfg || letters.length < (cfg.minLetters || 14)) {
      return { ratio: 0, triggered: false };
    }
    const upperCount = (letters.match(/[A-ZÄÖÜ]/g) || []).length;
    const ratio = upperCount / letters.length;
    const thr = cfg.ratioThreshold != null ? cfg.ratioThreshold : 0.62;
    return { ratio, triggered: ratio >= thr };
  }

  /** @param {ReturnType<typeof compileRules>} c */
  function scoreOneMessage(rawText, c) {
    const lower = normalizeMsgText(rawText);
    const hits = {};

    const cm = capsMetrics(rawText, c.capsConfig);

    for (let ci = 0; ci < c.categories.length; ci++) {
      const cat = c.categories[ci];
      let n = 0;
      for (let ki = 0; ki < cat.keywordsLower.length; ki++) {
        const kw = cat.keywordsLower[ki];
        if (kw.length > 0 && lower.indexOf(kw) !== -1) n++;
      }
      for (let pi = 0; pi < cat.patternsRx.length; pi++) {
        const rx = cat.patternsRx[pi];
        const m = String(rawText).match(rx);
        if (m) n += m.length;
      }
      if (n > 0) {
        hits[cat.id] = Math.min(n, MAX_HITS_PER_MSG);
      }
    }

    const atMatches = String(rawText).match(/@[\w\u00C0-\u024f\u0386-\uFFFF]{2,}/g);
    const atLen = atMatches ? atMatches.length : 0;
    const mfTh =
      c.mentionFlood && typeof c.mentionFlood.threshold === 'number'
        ? c.mentionFlood.threshold
        : MENTION_FLOOD_THRESHOLD;
    if (atLen >= mfTh) {
      hits[MENTION_FLOOD_ID] = 1;
    }

    return { hits, capsRatio: cm.ratio, capsTriggered: cm.triggered };
  }

  function compileRules(rules) {
    const capsCfg = rules.caps || {};
    const cats = (rules.categories || []).map(function (cat) {
      const keywordsLower = (cat.keywords || [])
        .map(function (k) {
          return String(k).trim().toLowerCase();
        })
        .filter(Boolean);
      const patternsRx = (cat.patterns || [])
        .map(function (p) {
          try {
            return new RegExp(p, 'gi');
          } catch (err) {
            console.warn('[rules-engine] Ungültiges Muster:', p, err);
            return null;
          }
        })
        .filter(Boolean);
      return {
        id: cat.id,
        label: cat.label || cat.id,
        weight: typeof cat.weight === 'number' ? cat.weight : 1,
        policyHint: cat.policyHint || '',
        keywordsLower: keywordsLower,
        patternsRx: patternsRx
      };
    });
    const mf = rules.mentionFlood || {};
    return {
      capsConfig: capsCfg,
      categories: cats,
      mentionFlood: {
        threshold:
          typeof mf.threshold === 'number' && isFinite(mf.threshold)
            ? mf.threshold
            : MENTION_FLOOD_THRESHOLD,
        weight:
          typeof mf.weight === 'number' && isFinite(mf.weight) ? mf.weight : MENTION_FLOOD_WEIGHT
      }
    };
  }

  function setRules(rules) {
    activeRules = rules;
    compiled = compileRules(rules);
  }

  function getRules() {
    return activeRules;
  }

  function getCompiled() {
    return compiled;
  }

  function initSync() {
    if (global.STAKE_CHAT_RULES_BUNDLE && typeof global.STAKE_CHAT_RULES_BUNDLE === 'object') {
      setRules(global.STAKE_CHAT_RULES_BUNDLE);
      return Promise.resolve(activeRules);
    }
    return initFetch();
  }

  function initFetch() {
    return fetch('chat-rules.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(function (json) {
        setRules(json);
        return activeRules;
      })
      .catch(function () {
        if (global.STAKE_CHAT_RULES_BUNDLE && typeof global.STAKE_CHAT_RULES_BUNDLE === 'object') {
          setRules(global.STAKE_CHAT_RULES_BUNDLE);
          return activeRules;
        }
        setRules({ version: '0', caps: { minLetters: 99, ratioThreshold: 1, weight: 0 }, categories: [] });
        return activeRules;
      });
  }

  /**
   * @param {Array<{username:string,message:string}>} messages
   * @returns {Array<object>}
   */
  function buildUserRuleStats(messages) {
    const c = compiled;
    const mfWeight =
      c && c.mentionFlood && typeof c.mentionFlood.weight === 'number'
        ? c.mentionFlood.weight
        : MENTION_FLOOD_WEIGHT;
    if (!c || !messages || !messages.length) return [];

    const byUser = new Map();

    for (let mi = 0; mi < messages.length; mi++) {
      const m = messages[mi];
      const u = m.username;
      if (!u) continue;

      if (!byUser.has(u)) {
        byUser.set(u, {
          username: u,
          totalMessages: 0,
          byCategory: {},
          capsTriggers: 0,
          capsRatioSum: 0,
          concernScore: 0
        });
      }
      const row = byUser.get(u);
      row.totalMessages++;
      const sc = scoreOneMessage(m.message, c);
      row.capsRatioSum += sc.capsRatio;
      if (sc.capsTriggered) row.capsTriggers++;

      const hitKeys = Object.keys(sc.hits);
      for (let hi = 0; hi < hitKeys.length; hi++) {
        const k = hitKeys[hi];
        const add = sc.hits[k];
        row.byCategory[k] = (row.byCategory[k] || 0) + add;
      }
    }

    const catMeta = {};
    for (let i = 0; i < (activeRules && activeRules.categories ? activeRules.categories.length : 0); i++) {
      const cat = activeRules.categories[i];
      catMeta[cat.id] = { label: cat.label, weight: cat.weight };
    }
    catMeta[MENTION_FLOOD_ID] = { label: 'Viele @-Mentions', weight: mfWeight };

    const list = [];
    const sqrt = Math.sqrt;
    const users = Array.from(byUser.values());
    for (let ui = 0; ui < users.length; ui++) {
      const row = users[ui];
      const denom = sqrt(row.totalMessages + 1);
      let score = 0;

      const bKeys = Object.keys(row.byCategory);
      for (let bi = 0; bi < bKeys.length; bi++) {
        const cid = bKeys[bi];
        const hits = row.byCategory[cid];
        let w =
          cid === MENTION_FLOOD_ID
            ? mfWeight
            : catMeta[cid] && typeof catMeta[cid].weight === 'number'
              ? catMeta[cid].weight
              : 1;
        score += w * (hits / denom);
      }

      if (row.capsTriggers > 0) {
        const cw = activeRules && activeRules.caps && typeof activeRules.caps.weight === 'number'
          ? activeRules.caps.weight
          : 0.85;
        score += cw * (row.capsTriggers / denom);
      }

      row.concernScore = score;
      row.capsRate =
        row.totalMessages > 0 ? row.capsTriggers / row.totalMessages : 0;
      row.capsAvgRatio =
        row.totalMessages > 0 ? row.capsRatioSum / row.totalMessages : 0;

      let topCat = null;
      let topVal = 0;
      for (let bi = 0; bi < bKeys.length; bi++) {
        const cid = bKeys[bi];
        const h = row.byCategory[cid];
        if (h > topVal) {
          topVal = h;
          topCat = cid;
        }
      }
      if (!topCat && row.capsTriggers > 0) {
        row.topCategoryId = 'caps';
        row.topCategoryLabel =
          (activeRules && activeRules.caps && activeRules.caps.label) || 'Caps';
      } else {
        row.topCategoryId = topCat;
        row.topCategoryLabel =
          topCat && catMeta[topCat] ? catMeta[topCat].label : topCat || '—';
      }

      list.push(row);
    }

    return list;
  }

  function rankByConcern(rows, minMessages, limit) {
    const min = minMessages != null ? minMessages : 3;
    const lim = limit != null ? limit : 40;
    return rows
      .filter(function (r) {
        return r.totalMessages >= min && r.concernScore > 0;
      })
      .sort(function (a, b) {
        return b.concernScore - a.concernScore;
      })
      .slice(0, lim);
  }

  function rankByCategory(rows, categoryId, minMessages, limit) {
    const min = minMessages != null ? minMessages : 3;
    const lim = limit != null ? limit : 40;
    return rows
      .filter(function (r) {
        return r.totalMessages >= min && (r.byCategory[categoryId] || 0) > 0;
      })
      .sort(function (a, b) {
        const ra = (a.byCategory[categoryId] || 0) / a.totalMessages;
        const rb = (b.byCategory[categoryId] || 0) / b.totalMessages;
        if (rb !== ra) return rb - ra;
        return (b.byCategory[categoryId] || 0) - (a.byCategory[categoryId] || 0);
      })
      .slice(0, lim);
  }

  function rankExternalHits(rows, minMessages, limit) {
    var ids = ['telegram_connect', 'discord_ad', 'privacy_links', 'scam_social'];
    var min = minMessages != null ? minMessages : 3;
    var lim = limit != null ? limit : 40;
    var scored = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.totalMessages < min) continue;
      var s = 0;
      for (var j = 0; j < ids.length; j++) {
        s += r.byCategory[ids[j]] || 0;
      }
      if (s > 0)
        scored.push({
          username: r.username,
          totalMessages: r.totalMessages,
          byCategory: r.byCategory,
          externalHits: s,
          externalRate: s / r.totalMessages
        });
    }
    scored.sort(function (a, b) {
      if (b.externalRate !== a.externalRate) return b.externalRate - a.externalRate;
      return b.externalHits - a.externalHits;
    });
    return scored.slice(0, lim);
  }

  function rankCaps(rows, minMessages, limit) {
    const min = minMessages != null ? minMessages : 3;
    const lim = limit != null ? limit : 40;
    return rows
      .filter(function (r) {
        return r.totalMessages >= min && r.capsTriggers > 0;
      })
      .sort(function (a, b) {
        if (b.capsRate !== a.capsRate) return b.capsRate - a.capsRate;
        return b.capsTriggers - a.capsTriggers;
      })
      .slice(0, lim);
  }

  global.StakeChatRules = {
    initSync: initSync,
    initFetch: initFetch,
    getRules: getRules,
    getCompiled: getCompiled,
    buildUserRuleStats: buildUserRuleStats,
    rankByConcern: rankByConcern,
    rankByCategory: rankByCategory,
    rankCaps: rankCaps,
    rankExternalHits: rankExternalHits
  };
})(typeof window !== 'undefined' ? window : self);
