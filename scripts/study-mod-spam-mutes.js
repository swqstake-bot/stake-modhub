/**
 * Einmal-Studie: Mod-Mute-Ankündigungen im Chat → Opfer-Verlauf davor.
 * node scripts/study-mod-spam-mutes.js [Datengrube-Pfad]
 */
const path = require('path');
const { listChatLogFiles, loadMessagesFromFiles } = require('../lib/analyse/load-chat-logs');
const { parseStakeChatCsvFile } = require('../lib/analyse/parse-chat-csv');
const { normalizeText, stripForDedupeKey, isCommunityShort, collectDuplicateStats } = require('../lib/analyse/dedupe');

const MODS = new Set(['kartenstapel', 'swaqline', 'droz', 'wheelyboy321']);
const SPAM_RE =
  /muted!?|mute,|mute for|mute\s*-/i;
const SPAM_REASON_RE =
  /spam|nonsense|low\s*qu?alli|low\s*quality|kein\s*spa/i;

function extractVictim(message) {
  const m = normalizeText(message);
  const at = m.match(/@([\w\u00C0-\u024f]{2,})/i);
  return at ? at[1] : null;
}

function isSpamMuteAnnouncement(mod, message) {
  if (!MODS.has(mod.toLowerCase())) return false;
  const m = normalizeText(message);
  if (!SPAM_RE.test(m)) return false;
  return SPAM_REASON_RE.test(m) || /muted\s*-\s*spam/i.test(m);
}

function wordCount(t) {
  return normalizeText(t).split(/\s+/).filter(Boolean).length;
}

function isLowQualityFiller(text) {
  const k = stripForDedupeKey(text);
  if (!k) return true;
  if (isCommunityShort(text)) return true;
  if (/^(gz+|gg+|gl+|bust|rip|f|w|l|k|same|true|nice|danke|thx|ty|ehre|moin|prost)$/i.test(k.replace(/\s/g, ''))) return true;
  if (/^g+z+$/i.test(k.replace(/\s/g, ''))) return true;
  if (k.length <= 4) return true;
  return false;
}

function analyzeWindow(msgs) {
  if (!msgs.length) return null;
  let fillers = 0;
  let gzLike = 0;
  const keys = new Map();
  for (const m of msgs) {
    const msg = m.message || '';
    if (isLowQualityFiller(msg)) fillers++;
    const k = stripForDedupeKey(msg);
    if (/^g+z|gz|gg|bust|rip$/i.test(k.replace(/\s/g, '')) || /^g+z+$/i.test(k.replace(/\s/g, ''))) gzLike++;
    if (k) keys.set(k, (keys.get(k) || 0) + 1);
  }
  const dup = collectDuplicateStats(msgs);
  const n = msgs.length;
  let maxBurst = 0;
  const ts = msgs.map((m) => m.timestamp).filter(Number.isFinite).sort((a, b) => a - b);
  for (let i = 0; i < ts.length; i++) {
    let c = 1;
    for (let j = i + 1; j < ts.length && ts[j] - ts[i] <= 120000; j++) c++;
    if (c > maxBurst) maxBurst = c;
  }
  const topRepeats = [...keys.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  return {
    count: n,
    fillerRatio: fillers / n,
    gzLikeRatio: gzLike / n,
    oneWordRatio: msgs.filter((m) => wordCount(m.message) <= 1).length / n,
    duplicateRatio: dup.duplicateRatio,
    maxSame: dup.maxSameMessageCount,
    burst2min: maxBurst,
    avgLen: msgs.reduce((s, m) => s + normalizeText(m.message).length, 0) / n,
    samples: msgs.slice(-8).map((m) => m.message),
    topRepeats
  };
}

function main() {
  const dir =
    process.argv[2] ||
    path.join(__dirname, '..', 'Datengrube');
  const files = listChatLogFiles(dir);
  const all = [];
  for (const f of files) {
    const { messages } = parseStakeChatCsvFile(f.path);
    for (const m of messages) all.push(m);
  }
  all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const byUser = new Map();
  for (const m of all) {
    const u = m.username;
    if (!byUser.has(u)) byUser.set(u, []);
    byUser.get(u).push(m);
  }

  const events = [];
  for (const m of all) {
    if (!isSpamMuteAnnouncement(m.username, m.message)) continue;
    const victim = extractVictim(m.message);
    if (!victim) continue;
    events.push({
      ts: m.timestamp,
      mod: m.username,
      victim,
      reason: normalizeText(m.message).slice(0, 120)
    });
  }

  console.log(`Spam/Nonsense/LQ Mutes gefunden: ${events.length}\n`);

  const stats = [];
  const WINDOW_MS = 45 * 60 * 1000;

  for (const ev of events) {
    const hist = byUser.get(ev.victim) || [];
    const before = hist.filter(
      (m) => m.timestamp && ev.ts && m.timestamp <= ev.ts && ev.ts - m.timestamp <= WINDOW_MS
    );
    const a = analyzeWindow(before);
    if (!a || a.count < 3) continue;
    stats.push({ ...ev, analysis: a });
    console.log(`--- ${ev.victim} ← ${ev.mod} @ ${new Date(ev.ts).toLocaleString('de-DE')}`);
    console.log(`    Grund: ${ev.reason}`);
    console.log(
      `    45min davor: ${a.count} msgs | filler ${(a.fillerRatio * 100).toFixed(0)}% | gz/bust ${(a.gzLikeRatio * 100).toFixed(0)}% | 1-word ${(a.oneWordRatio * 100).toFixed(0)}% | dupl ${(a.duplicateRatio * 100).toFixed(0)}% | burst/2m ${a.burst2min} | maxSame ${a.maxSame}`
    );
    if (a.topRepeats.length) {
      console.log(`    repeats: ${a.topRepeats.map(([t, c]) => `${t}×${c}`).join(', ')}`);
    }
    console.log(`    last: ${a.samples.slice(-4).join(' | ')}`);
    console.log('');
  }

  if (!stats.length) {
    console.log('Keine auswertbaren Fälle.');
    return;
  }

  const avg = (key) => stats.reduce((s, x) => s + x.analysis[key], 0) / stats.length;
  console.log('=== DURCHSCHNITT (45min vor Spam-Mute) ===');
  console.log(`Fälle: ${stats.length}`);
  console.log(`Msgs: ${avg('count').toFixed(1)}`);
  console.log(`Filler-Ratio: ${(avg('fillerRatio') * 100).toFixed(1)}%`);
  console.log(`GZ/Bust-Ratio: ${(avg('gzLikeRatio') * 100).toFixed(1)}%`);
  console.log(`Ein-Wort: ${(avg('oneWordRatio') * 100).toFixed(1)}%`);
  console.log(`Duplikat: ${(avg('duplicateRatio') * 100).toFixed(1)}%`);
  console.log(`Burst/2min: ${avg('burst2min').toFixed(1)}`);
  console.log(`Max gleicher Text: ${avg('maxSame').toFixed(1)}`);

  const mins = {
    fillerRatio: Math.min(...stats.map((s) => s.analysis.fillerRatio)),
    gzLikeRatio: Math.min(...stats.map((s) => s.analysis.gzLikeRatio)),
    oneWordRatio: Math.min(...stats.map((s) => s.analysis.oneWordRatio)),
    duplicateRatio: Math.min(...stats.map((s) => s.analysis.duplicateRatio)),
    burst2min: Math.min(...stats.map((s) => s.analysis.burst2min)),
    count: Math.min(...stats.map((s) => s.analysis.count))
  };
  console.log('\n=== MINIMUM (untere Grenze — darunter selten gemutet) ===');
  console.log(JSON.stringify(mins, null, 2));
}

main();
