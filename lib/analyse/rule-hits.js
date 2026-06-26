const fs = require('fs');
const path = require('path');

const RULES_PATH = path.join(__dirname, 'chat-rules.json');
let compiled = null;

function capsMetrics(rawText, cfg) {
  const letters = String(rawText).replace(/[^a-zA-ZäöüÄÖÜß]/g, '');
  if (!cfg || letters.length < (cfg.minLetters || 14)) return { ratio: 0, triggered: false };
  const upperCount = (letters.match(/[A-ZÄÖÜ]/g) || []).length;
  const ratio = upperCount / letters.length;
  const thr = cfg.ratioThreshold != null ? cfg.ratioThreshold : 0.64;
  return { ratio, triggered: ratio >= thr };
}

function compileRules(rules) {
  const capsCfg = rules.caps || {};
  const cats = (rules.categories || []).map((cat) => ({
    id: cat.id,
    label: cat.label || cat.id,
    weight: typeof cat.weight === 'number' ? cat.weight : 1,
    policyHint: cat.policyHint || '',
    keywordsLower: (cat.keywords || []).map((k) => String(k).trim().toLowerCase()).filter(Boolean),
    patternsRx: (cat.patterns || [])
      .map((p) => {
        try {
          return new RegExp(p, 'gi');
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
  }));
  const mf = rules.mentionFlood || {};
  return {
    capsConfig: capsCfg,
    categories: cats,
    mentionFlood: {
      threshold: typeof mf.threshold === 'number' ? mf.threshold : 8,
      weight: typeof mf.weight === 'number' ? mf.weight : 0.72
    }
  };
}

function getCompiled() {
  if (compiled) return compiled;
  const rules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
  compiled = compileRules(rules);
  compiled.activeRules = rules;
  return compiled;
}

function scoreOneMessage(rawText, c) {
  const lower = String(rawText == null ? '' : rawText).toLowerCase();
  const hits = {};
  const cm = capsMetrics(rawText, c.capsConfig);

  for (const cat of c.categories) {
    let n = 0;
    for (const kw of cat.keywordsLower) {
      if (kw && lower.includes(kw)) n++;
    }
    for (const rx of cat.patternsRx) {
      const m = String(rawText).match(rx);
      if (m) n += m.length;
    }
    if (n > 0) hits[cat.id] = Math.min(n, 12);
  }

  const atMatches = String(rawText).match(/@[\w\u00C0-\u024f\u0386-\uFFFF]{2,}/g);
  const atLen = atMatches ? atMatches.length : 0;
  if (atLen >= c.mentionFlood.threshold) hits.mention_flood = 1;

  return { hits, capsTriggered: cm.triggered };
}

function buildUserRuleStats(messages) {
  const c = getCompiled();
  const mfWeight = c.mentionFlood.weight;
  const byUser = new Map();

  for (const m of messages) {
    const u = m.username;
    if (!u) continue;
    if (!byUser.has(u)) {
      byUser.set(u, {
        username: u,
        totalMessages: 0,
        byCategory: {},
        capsTriggers: 0,
        concernScore: 0
      });
    }
    const row = byUser.get(u);
    row.totalMessages++;
    const sc = scoreOneMessage(m.message, c);
    if (sc.capsTriggered) row.capsTriggers++;
    for (const [k, v] of Object.entries(sc.hits)) {
      row.byCategory[k] = (row.byCategory[k] || 0) + v;
    }
  }

  const catMeta = {};
  for (const cat of c.activeRules.categories || []) {
    catMeta[cat.id] = { label: cat.label, weight: cat.weight };
  }
  catMeta.mention_flood = { label: 'Viele @-Mentions', weight: mfWeight };

  const list = [];
  for (const row of byUser.values()) {
    const denom = Math.sqrt(row.totalMessages + 1);
    let score = 0;
    for (const [cid, hits] of Object.entries(row.byCategory)) {
      const w = cid === 'mention_flood' ? mfWeight : catMeta[cid]?.weight ?? 1;
      score += w * (hits / denom);
    }
    if (row.capsTriggers > 0) {
      const cw = c.activeRules.caps?.weight ?? 0.82;
      score += cw * (row.capsTriggers / denom);
    }
    row.concernScore = score;

    let topCat = null;
    let topVal = 0;
    for (const [cid, h] of Object.entries(row.byCategory)) {
      if (h > topVal) {
        topVal = h;
        topCat = cid;
      }
    }
    row.topCategoryId = topCat || (row.capsTriggers ? 'caps' : null);
    row.topCategoryLabel =
      topCat && catMeta[topCat]
        ? catMeta[topCat].label
        : row.capsTriggers
          ? c.activeRules.caps?.label || 'Caps'
          : null;
    list.push(row);
  }
  return list;
}

module.exports = {
  getCompiled,
  buildUserRuleStats
};
