#!/usr/bin/env node
/**
 * Prüft ob kalibrierte Spam/Toxic-Heuristiken bekannte Mod-Mute-Fälle treffen.
 * node scripts/validate-analyse-calibration.js [Chatlogs-Ordner]
 */
const path = require('path');
const { runAnalyse } = require('../lib/analyse');
const { getDatengrubePath } = require('../lib/data-path');

const chatlogs = process.argv[2] || path.join(__dirname, '..', 'Chatlogs');
const dataDir = getDatengrubePath();

// Bekannte Spam-Mutes aus Studie (Auszug)
const SPAM_EXPECTED = [
  'Hayvanmodus',
  'Spielboy',
  'metzgii',
  'Martin251085',
  'PascalGTH',
  'Jituvishnoi'
];

// Bekannte Toxic-Mutes (Auszug)
const TOXIC_EXPECTED = ['firo47', 'Ziege420', 'Rakoonq'];

async function main() {
  const month = runAnalyse(dataDir, { preset: 'month' });
  if (!month.ok || month.empty) {
    console.log('Monats-Analyse leer — prüfe ob Chatlogs im Zeitraum liegen.');
    console.log('Dirs:', month.chatDirs || []);
    process.exit(1);
  }

  const idx = month.userIndex || {};
  console.log(`\n=== Kalibrierungs-Check (${month.messagesUsed} Msgs, ${month.users} User) ===\n`);

  let spamHits = 0;
  for (const name of SPAM_EXPECTED) {
    const row = idx[name.toLowerCase()] || Object.values(idx).find((r) => r.username === name);
    if (!row) {
      console.log(`  SPAM ${name}: nicht im Zeitraum`);
      continue;
    }
    const ok = ['spam', 'flood', 'bot'].includes(row.enforcementTier) || row.lowQualityRatio >= 0.32;
    if (ok) spamHits++;
    console.log(
      `  SPAM ${name}: tier=${row.enforcementTier} risk=${row.riskScore} LQ=${Math.round(row.lowQualityRatio * 100)}% gz×${row.maxGzSame} ${ok ? '✓' : '✗'}`
    );
  }

  let toxicHits = 0;
  for (const name of TOXIC_EXPECTED) {
    const row = idx[name.toLowerCase()] || Object.values(idx).find((r) => r.username === name);
    if (!row) {
      console.log(`  TOXIC ${name}: nicht im Zeitraum`);
      continue;
    }
    const ok = row.enforcementTier === 'toxic' || row.toxicRatio >= 0.05 || row.toxicHits >= 2;
    if (ok) toxicHits++;
    console.log(
      `  TOXIC ${name}: tier=${row.enforcementTier} toxic=${Math.round(row.toxicRatio * 100)}% hits=${row.toxicHits} ${ok ? '✓' : '✗'}`
    );
  }

  console.log(`\nSpam-Treffer: ${spamHits}/${SPAM_EXPECTED.length}, Toxic-Treffer: ${toxicHits}/${TOXIC_EXPECTED.length}`);
  console.log(`Top-5 Enforcement:`);
  for (const r of (month.enforcement || []).slice(0, 5)) {
    console.log(
      `  ${r.username} [${r.enforcementTier}] risk=${r.riskScore} LQ=${Math.round((r.lowQualityRatio || 0) * 100)}% toxic=${Math.round((r.toxicRatio || 0) * 100)}%`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
