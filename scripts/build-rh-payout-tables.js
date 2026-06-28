#!/usr/bin/env node
/**
 * Baut lib/rh-payout-tables.json aus den Stake-Payout-XLSX-Dateien.
 * Liest alle relevanten Sheets (Stufen/Hits), nicht nur Overview-Maxima.
 * Usage: node scripts/build-rh-payout-tables.js [ordner-mit-xlsx]
 */
const fs = require('fs');
const path = require('path');

let XLSX;
try {
  XLSX = require('xlsx');
} catch (_) {
  console.error('Bitte zuerst: npm install xlsx --save-dev');
  process.exit(1);
}

const OUT = path.join(__dirname, '..', 'lib', 'rh-payout-tables.json');

const FILES = {
  'Dragon Tower': 'Stake_Dragon_Tower_Payout_Table.xlsx',
  Drill: 'Stake_Drill_Payout_Table.xlsx',
  Moles: 'Stake_Moles_Payout_Table.xlsx',
  Pump: 'Stake_Pump_Payout_Table.xlsx',
  Tarot: 'Stake_Tarot_Payout_Table.xlsx',
  'Rock Paper Scissors': 'Stake_Rock_Paper_Scissors_Payout_Table.xlsx',
  Chicken: 'Stake_Chicken_Payout_Table.xlsx'
};

const DRAGON_TOWER_SHEETS = ['Easy', 'Medium', 'Hard', 'Expert', 'Master'];
const CHICKEN_SHEETS = ['Easy', 'Medium', 'Hard', 'Expert'];

function parseMult(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw)
    .trim()
    .replace(/\s/g, '')
    .replace(/,/g, '')
    .replace(/x$/i, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function roundMulti(n) {
  if (n >= 1000) return Math.round(n * 100) / 100;
  return Math.round(n * 100) / 100;
}

function formatMulti(n) {
  const r = roundMulti(n);
  if (r >= 1000) {
    return r.toLocaleString('de-DE', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  }
  return String(r);
}

function readWorkbook(filePath) {
  return XLSX.readFile(filePath, { cellDates: false });
}

function sheetToRows(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
}

function findSheet(wb, predicate) {
  for (const name of wb.SheetNames) {
    if (predicate(name, sheetToRows(wb, name))) return name;
  }
  return wb.SheetNames[0] || null;
}

function option(label, multi, extra = {}) {
  return { label, multi: roundMulti(multi), ...extra };
}

function parseStageSheet(rows, { stageCol = 0, multiCol = 4, stagePrefix = 'Stufe' }) {
  const options = [];
  let headerFound = false;
  for (const row of rows) {
    if (!row?.length) continue;
    const c0 = String(row[0] ?? '').trim();
    if (!headerFound) {
      if (/stufe|step|hit|depth|level|card/i.test(c0)) headerFound = true;
      continue;
    }
    if (!c0 || c0 === 'Hinweis' || c0.startsWith('Hinweis')) break;
    const stage = row[stageCol];
    const multi = parseMult(row[multiCol]);
    if (multi == null) continue;
    const stageLabel = typeof stage === 'number' ? `${stagePrefix} ${stage}` : String(stage);
    options.push(option(`${stageLabel} — ${formatMulti(multi)}x`, multi, { stage }));
  }
  return options;
}

function parseDragonTower(wb) {
  const variants = [];
  for (const sheetName of DRAGON_TOWER_SHEETS) {
    if (!wb.SheetNames.includes(sheetName)) continue;
    const rows = sheetToRows(wb, sheetName);
    const options = parseStageSheet(rows, { stageCol: 0, multiCol: 4, stagePrefix: 'Stufe' });
    if (!options.length) continue;
    const setup = rows.find((r) => typeof r?.[0] === 'number' && r[1])?.[1] || '';
    variants.push({
      id: sheetName.toLowerCase(),
      label: sheetName,
      setup: setup ? String(setup) : '',
      options
    });
  }
  return variants.length ? { type: 'variants', variants } : null;
}

function parseChicken(wb) {
  const variants = [];
  for (const sheetName of CHICKEN_SHEETS) {
    if (!wb.SheetNames.includes(sheetName)) continue;
    const rows = sheetToRows(wb, sheetName);
    const options = parseStageSheet(rows, { stageCol: 0, multiCol: 1, stagePrefix: 'Schritt' });
    if (!options.length) continue;
    variants.push({ id: sheetName.toLowerCase(), label: sheetName, options });
  }
  return variants.length ? { type: 'variants', variants } : null;
}

function parseMoles(wb) {
  const probSheet = wb.SheetNames.includes('Probabilities') ? 'Probabilities' : null;
  if (probSheet) {
    const rows = sheetToRows(wb, probSheet);
    const bySetting = new Map();
    let header = false;
    for (const row of rows) {
      if (!row?.length) continue;
      if (String(row[0] ?? '') === 'Setting') {
        header = true;
        continue;
      }
      if (!header) continue;
      const setting = String(row[0] ?? '').trim();
      const hit = row[1];
      const multi = parseMult(row[2]);
      if (!setting || multi == null) continue;
      const id = setting.toLowerCase().replace(/\s+/g, '-');
      if (!bySetting.has(id)) {
        bySetting.set(id, { id, label: setting, options: [] });
      }
      bySetting.get(id).options.push(
        option(`Hit ${hit} — ${formatMulti(multi)}x`, multi, { hit: Number(hit) || hit })
      );
    }
    const variants = [...bySetting.values()];
    if (variants.length) return { type: 'variants', variants };
  }

  if (wb.SheetNames.includes('Full Table')) {
    const rows = sheetToRows(wb, 'Full Table');
    const header = rows[0];
    if (!header?.length) return null;
    const variants = [];
    for (let col = 1; col < header.length; col++) {
      const label = String(header[col] ?? '').trim();
      if (!label) continue;
      const options = [];
      for (let r = 1; r < rows.length; r++) {
        const hit = rows[r][0];
        const multi = parseMult(rows[r][col]);
        if (multi == null) continue;
        options.push(option(`Hit ${hit} — ${formatMulti(multi)}x`, multi, { hit: Number(hit) || hit }));
      }
      if (options.length) {
        variants.push({ id: label.toLowerCase().replace(/\s+/g, '-'), label, options });
      }
    }
    if (variants.length) return { type: 'variants', variants };
  }
  return null;
}

function parseLevelTableRows(rows, headerNeedle) {
  const options = [];
  let start = false;
  for (const row of rows) {
    if (!row?.length) continue;
    const c0 = String(row[0] ?? '').trim();
    if (!start) {
      if (c0 === headerNeedle[0] && String(row[1] ?? '').toLowerCase().includes(headerNeedle[1].toLowerCase())) {
        start = true;
      }
      continue;
    }
    if (!c0 || /^rollhunt/i.test(c0)) break;
    const multi = parseMult(row[1]);
    if (multi == null) continue;
    options.push(option(`${c0} — ${formatMulti(multi)}x`, multi));
  }
  return options;
}

function parseRockPaperScissors(wb) {
  const RTP_BASE = 1.96;
  const MAX_ROUNDS = 20;
  const options = [];
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const multi = roundMulti(RTP_BASE * 2 ** (round - 1));
    options.push(option(`Runde ${round} — ${formatMulti(multi)}x`, multi, { round }));
  }
  return { type: 'levels', options, meta: { rtpBase: RTP_BASE, maxRounds: MAX_ROUNDS } };
}

/** Stake Mines 5×5 — Multiplikator aus Minen + Diamanten (RTP ~99 %). */
function generateMinesTable() {
  const GRID = 25;
  const RTP = 0.99;
  const variants = [];

  for (let mines = 1; mines <= 24; mines += 1) {
    const options = [];
    const maxDiamonds = GRID - mines;
    for (let diamonds = 1; diamonds <= maxDiamonds; diamonds += 1) {
      let prod = 1;
      for (let i = 0; i < diamonds; i += 1) {
        prod *= (GRID - i) / (GRID - mines - i);
      }
      const multi = roundMulti(RTP * prod);
      const diaLabel = diamonds === 1 ? '1 Diamant' : `${diamonds} Diamanten`;
      options.push(
        option(`${diaLabel} — ${formatMulti(multi)}x`, multi, { diamonds, mines })
      );
    }
    variants.push({
      id: String(mines),
      label: mines === 1 ? '1 Mine' : `${mines} Minen`,
      mines,
      options
    });
  }

  return {
    type: 'variants',
    variants,
    meta: { grid: GRID, rtp: RTP, source: 'Stake Mines payout formula (25 tiles)' }
  };
}

function parseLevelTableWorkbook(wb, headerNeedle) {
  for (const name of wb.SheetNames) {
    const options = parseLevelTableRows(sheetToRows(wb, name), headerNeedle);
    if (options.length) return { type: 'levels', options };
  }
  return null;
}

function parseGame(game, filePath) {
  const wb = readWorkbook(filePath);
  switch (game) {
    case 'Dragon Tower':
      return parseDragonTower(wb);
    case 'Chicken':
      return parseChicken(wb);
    case 'Moles':
      return parseMoles(wb);
    case 'Drill':
      return parseLevelTableWorkbook(wb, ['Depth', 'Multiplier']);
    case 'Pump':
      return parseLevelTableWorkbook(wb, ['Level', 'Multiplier']);
    case 'Tarot':
      return parseLevelTableWorkbook(wb, ['Card', 'Multiplier']);
    case 'Rock Paper Scissors':
      return parseRockPaperScissors(wb);
    default:
      return null;
  }
}

function countOptions(parsed) {
  if (!parsed) return 0;
  if (parsed.type === 'variants') {
    return parsed.variants.reduce((n, v) => n + (v.options?.length || 0), 0);
  }
  return parsed.options?.length || 0;
}

function main() {
  const srcDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'defaults', 'payout-tables'));
  const out = { version: 2, games: {} };
  let missing = 0;
  let total = 0;

  for (const [game, file] of Object.entries(FILES)) {
    const fp = path.join(srcDir, file);
    if (!fs.existsSync(fp)) {
      console.warn('fehlt:', fp);
      missing += 1;
      continue;
    }
    const parsed = parseGame(game, fp);
    if (parsed) {
      out.games[game] = parsed;
      const count = countOptions(parsed);
      total += count;
      const detail =
        parsed.type === 'variants'
          ? `${parsed.variants.length} Settings, ${count} Multis`
          : `${count} Multis`;
      console.log(`${game}: ${detail}`);
    }
  }

  if (!Object.keys(out.games).length) {
    console.error('Keine Tabellen gefunden in', srcDir);
    process.exit(1);
  }

  out.games.Mines = generateMinesTable();
  const minesCount = countOptions(out.games.Mines);
  total += minesCount;
  console.log(`Mines: 24 Minen-Settings, ${minesCount} Multis`);

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`→ ${OUT} (${total} Multis gesamt${missing ? `, ${missing} Dateien fehlend` : ''})`);
}

main();
