#!/usr/bin/env node
/**
 * Vollständiger Audit: Analyse-Engine + Kalibrierung vs. Mod-Mutes.
 * node scripts/audit-analyse.js
 */
const { runAnalyse } = require('../lib/analyse');
const { getDatengrubePath } = require('../lib/data-path');
const { getCalibrationMeta } = require('../lib/analyse/calibration');

const MODS = ['droz', 'kartenstapel', 'swaqline', 'wheelyboy321'];
const SPAM_MUTES = [
  'Hayvanmodus',
  'Spielboy',
  'Martin251085',
  'PascalGTH',
  'metzgii',
  'Jituvishnoi',
  '48alex86'
];
const TOXIC_MUTES = ['Rakoonq', 'Ziege420', 'firo47'];
const CLEAN_ACTIVE = ['Paradoxon', 'Sacksocke', 'Kingkux'];

let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
}

function fail(label, detail) {
  failed++;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

function auditPreset(preset) {
  console.log(`\n=== Preset: ${preset} ===`);
  const r = runAnalyse(getDatengrubePath(), { preset });
  if (!r.ok) {
    fail('runAnalyse ok', r.error);
    return null;
  }
  if (r.empty) {
    console.log(`  (leer: ${r.message})`);
    return r;
  }

  console.log(`  Msgs: ${r.messagesUsed}, User: ${r.users}, Enforcement: ${r.enforcement.length}`);

  const tiers = {};
  for (const e of r.enforcement) tiers[e.enforcementTier] = (tiers[e.enforcementTier] || 0) + 1;
  console.log('  Stufen:', tiers);

  for (const m of MODS) {
    const inList = r.enforcement.some((e) => e.username.toLowerCase() === m);
    if (inList) fail(`Mod ${m} nicht in Enforcement`, 'ist drin');
    else ok(`Mod ${m} ausgeschlossen`);
  }

  if (preset === 'month') {
    for (const name of CLEAN_ACTIVE) {
      const inList = r.enforcement.some((e) => e.username === name);
      const row = r.userIndex[name.toLowerCase()];
      if (inList && row && (row.muteMatchScore || 0) < 50) {
        fail(`${name} in Top-50`, `Match ${row.muteMatchScore}`);
      } else if (!inList) {
        ok(`${name} nicht in Top-50`);
      }
    }
  }

  return r;
}

function auditMuteRecall(r) {
  if (!r || r.empty) return;
  console.log('\n=== Mod-Mute Recall (Monat) ===');

  for (const name of SPAM_MUTES) {
    const row = r.userIndex[name.toLowerCase()];
    if (!row) {
      console.log(`  – ${name}: nicht im Zeitraum (OK)`);
      continue;
    }
    const good =
      row.enforcementTier === 'spam' ||
      (row.spamMatch >= 50) ||
      (row.muteMatchScore >= 50 && row.lowQualityRatio >= 0.35);
    if (good) ok(`${name}: ${row.enforcementTier} match=${row.muteMatchScore} LQ=${Math.round(row.lowQualityRatio * 100)}% gz×${row.maxGzSame}`);
    else fail(`${name}`, `tier=${row.enforcementTier} match=${row.muteMatchScore} LQ=${Math.round(row.lowQualityRatio * 100)}%`);
  }

  for (const name of TOXIC_MUTES) {
    const row = r.userIndex[name.toLowerCase()];
    if (!row) {
      console.log(`  – ${name}: nicht im Zeitraum (OK)`);
      continue;
    }
    const good = row.enforcementTier === 'toxic' || row.toxicMatch >= 35 || row.toxicRatio >= 0.05;
    if (good) ok(`${name}: ${row.enforcementTier} match=${row.muteMatchScore} toxic=${row.toxicMatch} LQ=${Math.round(row.lowQualityRatio * 100)}%`);
    else fail(`${name}`, `tier=${row.enforcementTier} toxicMatch=${row.toxicMatch}`);
  }
}

function auditFriendlist(r) {
  if (!r || r.empty) return;
  console.log('\n=== Friendlist (Monat) ===');
  console.log(`  Kandidaten: ${r.friendlist.length}`);

  if (r.friendlist.length < 2) fail('Mindestens 2 Friendlist-Kandidaten', String(r.friendlist.length));
  else ok(`≥2 Kandidaten (${r.friendlist.length})`);

  for (const u of r.friendlist) {
    if (u.totalMessages < 150) fail(`${u.username} <150 Msgs`, String(u.totalMessages));
    if (u.activeDays < 10) fail(`${u.username} <10 Tage`, String(u.activeDays));
    if (['bot', 'toxic', 'begging', 'coord'].includes(u.enforcementTier)) {
      fail(`${u.username} Problem-Stufe`, u.enforcementTier);
    }
  }
  if (!r.friendlist.some((u) => u.totalMessages < 150 || u.activeDays < 10)) {
    ok('Alle Kandidaten ≥150 Msgs & ≥10 aktive Tage');
  }

  for (const name of CLEAN_ACTIVE) {
    const row = r.userIndex[name.toLowerCase()];
    if (!row || row.totalMessages < 150) continue;
    const inFl = r.friendlist.some((u) => u.username.toLowerCase() === name.toLowerCase());
    if (inFl) ok(`${name} in Friendlist`);
    else console.log(`  – ${name}: nicht in Top-30 (LQ ${Math.round((row.lowQualityRatio || 0) * 100)}%, gz ${Math.round((row.gzBustRatio || 0) * 100)}%)`);
  }

  for (const m of MODS) {
    const inFl = r.friendlist.some((u) => u.username.toLowerCase() === m);
    if (inFl) fail(`Mod ${m} in Friendlist`, 'ist drin');
    else ok(`Mod ${m} nicht in Friendlist`);
  }

  let spamInFl = false;
  for (const name of SPAM_MUTES) {
    const inFl = r.friendlist.some((u) => u.username.toLowerCase() === name.toLowerCase());
    if (inFl) {
      fail(`Spam-Mute ${name} in Friendlist`);
      spamInFl = true;
    }
  }
  if (!spamInFl) ok('Keine bekannten Spam-Mutes in Friendlist');
}

function auditDataIntegrity(r) {
  if (!r || r.empty) return;
  console.log('\n=== Daten-Integrität ===');

  let badRows = 0;
  for (const e of r.enforcement) {
    if (e.muteMatchScore == null) badRows++;
    if (!e.enforcementTier) badRows++;
    if (!Array.isArray(e.chips)) badRows++;
  }
  if (badRows) fail('Enforcement-Zeilen unvollständig', String(badRows));
  else ok('Alle Enforcement-Zeilen haben Match + Stufe + Chips');

  const allCoord = r.enforcement.every((e) => e.enforcementTier === 'coord');
  if (allCoord && r.enforcement.length > 10) fail('Nur coord-Stufe', 'verdächtig');
  else ok('Stufen-Mix plausibel');

  const all100 = r.enforcement.filter((e) => e.muteMatchScore >= 95).length;
  if (all100 > 40) fail('Zu viele Match≥95', String(all100));
  else ok(`Match-Verteilung ok (≥95: ${all100}/${r.enforcement.length})`);
}

function main() {
  console.log('Audit Analyse-Engine');
  const meta = getCalibrationMeta();
  console.log(`Kalibrierung: ${meta.spamCases} Spam, ${meta.toxicCases} Toxic (${meta.generatedAt || '?'})`);

  const month = auditPreset('month');
  auditMuteRecall(month);
  auditFriendlist(month);
  auditDataIntegrity(month);

  auditPreset('today');

  console.log(`\n${failed ? `FEHLER: ${failed}` : 'Alles OK.'}`);
  process.exit(failed ? 1 : 0);
}

main();
