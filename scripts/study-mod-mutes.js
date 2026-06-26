/**
 * Intensiv-Studie: Mod-Mute-Ankündigungen im Chat → Opfer-Verlauf + Kontrollgruppe.
 * node scripts/study-mod-mutes.js [Chatlogs-Ordner]
 */
const fs = require('fs');
const path = require('path');
const { listChatLogFiles } = require('../lib/analyse/load-chat-logs');
const { parseStakeChatCsvFile } = require('../lib/analyse/parse-chat-csv');
const { normalizeText, stripForDedupeKey, isCommunityShort, collectDuplicateStats } = require('../lib/analyse/dedupe');
const {
  collectLowQualityStats,
  isLowQualitySpamMessage,
  emojiMetrics
} = require('../lib/analyse/low-quality-spam');

const MODS = new Set(['kartenstapel', 'swaqline', 'droz', 'wheelyboy321']);
const MUTE_RE = /muted!?|mute,|mute for|mute\s*-/i;

const CATEGORIES = {
  spam: /spam|nonsense|low\s*qu?alli|low\s*quality|schlechte\s*chat|kein\s*spa{3,}/i,
  toxic: /toxic|toxisch|unangemessen|beleidigung|hate|hass|verhalten/i,
  begging: /bettel|begging|rain|tip|betteln/i,
  caps: /caps|schrei/i,
  other: /.*/
};

function extractVictim(message) {
  const m = normalizeText(message);
  const at = m.match(/@([\w\u00C0-\u024f\d_]{2,})/i);
  return at ? at[1] : null;
}

function classifyMuteReason(message) {
  const m = normalizeText(message);
  if (CATEGORIES.spam.test(m)) return 'spam';
  if (CATEGORIES.toxic.test(m)) return 'toxic';
  if (CATEGORIES.begging.test(m)) return 'begging';
  if (CATEGORIES.caps.test(m)) return 'caps';
  return 'other';
}

function isModMuteAnnouncement(mod, message) {
  if (!MODS.has(String(mod).toLowerCase())) return false;
  return MUTE_RE.test(normalizeText(message)) && extractVictim(message);
}

function wordCount(t) {
  return normalizeText(t).split(/\s+/).filter(Boolean).length;
}

function toxicSignals(text) {
  const raw = normalizeText(text);
  const t = raw.toLowerCase();
  let score = 0;
  const hits = [];
  if (/fick|fuck|huren|wichser|spast|idiot|opfer|nutte|bastard|arschloch|kacke|scheiss|scheiß/.test(t)) {
    score += 2;
    hits.push('beleidigung');
  }
  if (/stfu|halt(?:\s+dein)?(?:\s+)?maul|klappe|verpiss|hau\s+ab/.test(t)) {
    score += 2;
    hits.push('aggressiv');
  }
  if (/eddie/.test(t) && /scheis|idiot|fick|huren|nutte/.test(t)) {
    score += 2;
    hits.push('eddie-toxic');
  }
  if (/rtp/.test(t) && /scheis|betrug|fake|abzock|manip/.test(t)) {
    score += 1;
    hits.push('rtp-rant');
  }
  if (/nix\s+geht|nichts\s+geht|alles\s+schrott|so\s+ein\s+dreck/.test(t)) {
    score += 1;
    hits.push('negativ');
  }
  if (/@\w+/.test(t) && score > 0) hits.push('mention+insult');
  return { score, hits };
}

function analyzeWindow(msgs) {
  if (!msgs.length) return null;
  const n = msgs.length;
  const lq = collectLowQualityStats(msgs);
  const dup = collectDuplicateStats(msgs);
  let toxicHits = 0;
  let toxicScoreSum = 0;
  const toxicTypes = new Map();

  for (const m of msgs) {
    const ts = toxicSignals(m.message || '');
    if (ts.score > 0) {
      toxicHits++;
      toxicScoreSum += ts.score;
      for (const h of ts.hits) toxicTypes.set(h, (toxicTypes.get(h) || 0) + 1);
    }
  }

  let maxBurst = 0;
  const timestamps = msgs.map((m) => m.timestamp).filter(Number.isFinite).sort((a, b) => a - b);
  for (let i = 0; i < timestamps.length; i++) {
    let c = 1;
    for (let j = i + 1; j < timestamps.length && timestamps[j] - timestamps[i] <= 120000; j++) c++;
    if (c > maxBurst) maxBurst = c;
  }

  const keys = new Map();
  for (const m of msgs) {
    const k = stripForDedupeKey(m.message);
    if (k) keys.set(k, (keys.get(k) || 0) + 1);
  }
  const topRepeats = [...keys.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return {
    count: n,
    lowQualityRatio: lq.lowQualityRatio,
    gzBustRatio: lq.gzBustRatio,
    gzLines: lq.gzLines,
    maxGzSame: lq.maxGzSame,
    emojiFloodHits: lq.emojiFloodHits,
    oneWordRatio: msgs.filter((m) => wordCount(m.message) <= 1).length / n,
    duplicateRatio: dup.duplicateRatio,
    maxSame: dup.maxSameMessageCount,
    burst2min: maxBurst,
    toxicHits,
    toxicRatio: toxicHits / n,
    toxicScoreSum,
    toxicTypes: Object.fromEntries(toxicTypes),
    topRepeats,
    samples: msgs.slice(-6).map((m) => m.message)
  };
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.floor((s.length - 1) * p);
  return s[i];
}

function summarizeStats(items, key) {
  const vals = items.map((x) => x.analysis[key]).filter((v) => typeof v === 'number');
  if (!vals.length) return null;
  return {
    n: vals.length,
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    p25: percentile(vals, 0.25),
    p50: percentile(vals, 0.5),
    p75: percentile(vals, 0.75)
  };
}

function main() {
  const dir = process.argv[2] || path.join(__dirname, '..', 'Chatlogs');
  const files = listChatLogFiles(dir);
  console.log(`Ordner: ${dir}`);
  console.log(`Chat-CSVs: ${files.length}\n`);

  const all = [];
  for (const f of files) {
    const { messages } = parseStakeChatCsvFile(f.path);
    for (const m of messages) all.push(m);
  }
  all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  console.log(`Nachrichten gesamt: ${all.length}\n`);

  const byUser = new Map();
  for (const m of all) {
    if (!byUser.has(m.username)) byUser.set(m.username, []);
    byUser.get(m.username).push(m);
  }

  const events = [];
  for (const m of all) {
    if (!isModMuteAnnouncement(m.username, m.message)) continue;
    const victim = extractVictim(m.message);
    if (!victim) continue;
    events.push({
      ts: m.timestamp,
      mod: m.username,
      victim,
      category: classifyMuteReason(m.message),
      reason: normalizeText(m.message).slice(0, 140)
    });
  }

  const byCat = {};
  for (const ev of events) {
    byCat[ev.category] = (byCat[ev.category] || 0) + 1;
  }
  console.log(`Mod-Mute-Ankündigungen: ${events.length}`);
  console.log('Kategorien:', byCat, '\n');

  const WINDOW_MS = 45 * 60 * 1000;
  const studied = { spam: [], toxic: [], begging: [], caps: [], other: [] };

  for (const ev of events) {
    const hist = byUser.get(ev.victim) || byUser.get(ev.victim.toLowerCase()) || [];
    const before = hist.filter(
      (m) => m.timestamp && ev.ts && m.timestamp <= ev.ts && ev.ts - m.timestamp <= WINDOW_MS
    );
    const a = analyzeWindow(before);
    if (!a || a.count < 2) continue;
    const bucket = studied[ev.category] || studied.other;
    bucket.push({ ...ev, analysis: a });
  }

  for (const cat of ['spam', 'toxic', 'begging', 'caps']) {
    const list = studied[cat];
    console.log(`\n${'='.repeat(60)}\n${cat.toUpperCase()} — ${list.length} auswertbare Fälle\n`);
    for (const item of list.slice(0, 25)) {
      const a = item.analysis;
      console.log(`--- ${item.victim} ← ${item.mod}`);
      console.log(`    ${item.reason}`);
      console.log(
        `    45min: ${a.count} msgs | LQ ${(a.lowQualityRatio * 100).toFixed(0)}% | gz ${(a.gzBustRatio * 100).toFixed(0)}% | emoji×${a.emojiFloodHits} | dupl ${(a.duplicateRatio * 100).toFixed(0)}% | burst ${a.burst2min} | toxic ${(a.toxicRatio * 100).toFixed(0)}%`
      );
      if (a.topRepeats.length) console.log(`    repeats: ${a.topRepeats.map(([t, c]) => `${t.slice(0, 30)}×${c}`).join(', ')}`);
      if (Object.keys(a.toxicTypes).length) console.log(`    toxic: ${JSON.stringify(a.toxicTypes)}`);
      console.log(`    last: ${a.samples.slice(-3).join(' | ').slice(0, 200)}`);
    }
    if (list.length > 25) console.log(`... +${list.length - 25} weitere`);
  }

  // Kontrollgruppe: aktive User ohne Mod-Mute in Studie
  const mutedVictims = new Set(events.map((e) => e.victim.toLowerCase()));
  const controls = [];
  for (const [user, msgs] of byUser) {
    if (MODS.has(user.toLowerCase()) || mutedVictims.has(user.toLowerCase())) continue;
    if (msgs.length < 20 || msgs.length > 200) continue;
    const slice = msgs.slice(-40);
    const a = analyzeWindow(slice);
    if (a) controls.push({ user, analysis: a });
  }
  controls.sort((a, b) => b.analysis.count - a.analysis.count);
  const controlSample = controls.slice(0, Math.min(80, controls.length));

  console.log(`\n${'='.repeat(60)}\nKALIBRIERUNG (45min-Fenster)\n`);

  const metrics = [
    'lowQualityRatio',
    'gzBustRatio',
    'oneWordRatio',
    'duplicateRatio',
    'burst2min',
    'emojiFloodHits',
    'toxicRatio',
    'maxGzSame'
  ];

  const calibration = { generatedAt: new Date().toISOString(), source: dir, categories: {} };

  for (const cat of ['spam', 'toxic']) {
    const list = studied[cat];
    const cal = { cases: list.length, metrics: {} };
    for (const key of metrics) {
      const s = summarizeStats(list, key);
      const c = summarizeStats(controlSample, key);
      cal.metrics[key] = { muted: s, control: c };
    }
    calibration.categories[cat] = cal;

    console.log(`\n--- ${cat.toUpperCase()} (${list.length} Fälle) vs Kontrolle (${controlSample.length}) ---`);
    for (const key of metrics) {
      const m = cal.metrics[key];
      if (!m.muted) continue;
      console.log(
        `  ${key}: muted avg ${(m.muted.avg * (key.includes('Ratio') ? 100 : 1)).toFixed(1)}${key.includes('Ratio') ? '%' : ''} | control avg ${(m.control?.avg * (key.includes('Ratio') ? 100 : 1)).toFixed(1)}${key.includes('Ratio') ? '%' : ''} | muted p25 ${(m.muted.p25 * (key.includes('Ratio') ? 100 : 1)).toFixed(1)}`
      );
    }
  }

  // Empfohlene Schwellen: p25 der gemuteten Fälle (sensibel) 
  const thresholds = {};
  for (const cat of ['spam', 'toxic']) {
    const list = studied[cat];
    if (!list.length) continue;
    thresholds[cat] = {
      minMessages: Math.max(4, Math.floor(percentile(list.map((x) => x.analysis.count), 0.25))),
      lowQualityRatio: percentile(list.map((x) => x.analysis.lowQualityRatio), 0.2),
      gzBustRatio: percentile(list.map((x) => x.analysis.gzBustRatio), 0.2),
      oneWordRatio: percentile(list.map((x) => x.analysis.oneWordRatio), 0.2),
      duplicateRatio: percentile(list.map((x) => x.analysis.duplicateRatio), 0.2),
      burst2min: Math.max(2, Math.floor(percentile(list.map((x) => x.analysis.burst2min), 0.2))),
      emojiFloodHits: Math.max(1, Math.floor(percentile(list.map((x) => x.analysis.emojiFloodHits), 0.2))),
      toxicRatio: percentile(list.map((x) => x.analysis.toxicRatio), 0.2),
      maxGzSame: Math.max(3, Math.floor(percentile(list.map((x) => x.analysis.maxGzSame), 0.2)))
    };
  }
  calibration.thresholds = thresholds;

  console.log('\n=== EMPFOHLENE SCHWELLEN (JSON) ===');
  console.log(JSON.stringify(calibration, null, 2));

  const outPath = path.join(__dirname, '..', 'lib', 'analyse', 'mute-calibration.json');
  fs.writeFileSync(outPath, JSON.stringify(calibration, null, 2), 'utf8');
  console.log(`\nGespeichert: ${outPath}`);
}

main();
