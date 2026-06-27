#!/usr/bin/env node
/**
 * Extrahiert VIP/Rank-Badge-SVGs aus einer Stake-HAR-Aufnahme.
 * Stake lädt Rank-Icons als inline-SVG in JS-Chunks (nicht als separate Bild-URLs).
 *
 * Usage: node scripts/extract-rank-badges-from-har.js [path/to/capture.har]
 */
const fs = require('fs');
const path = require('path');

const harPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emotes.har'));
const outDir = path.join(__dirname, '..', 'assets', 'rank-badges');

/** GraphQL flag → Stake icon component name (from COImGU_b.js) */
const FLAG_TO_ICON = {
  none: 'VIPNone',
  bronze: 'VIPBronze',
  silver: 'VIPSilver',
  gold: 'VIPGold',
  platinum: 'VIPPlatinumI',
  'wagered(500k)': 'VIPPlatinumII',
  'wagered(1m)': 'VIPPlatinumIII',
  'wagered(2.5m)': 'VIPPlatinumIV',
  'wagered(5m)': 'VIPPlatinumV',
  'wagered(10m)': 'VIPPlatinumVI',
  'wagered(25m)': 'VIPDiamondI',
  'wagered(50m)': 'VIPDiamondII',
  'wagered(100m)': 'VIPDiamondIII',
  'wagered(250m)': 'VIPDiamondIV',
  'wagered(500m)': 'VIPDiamondV',
  'wagered(1000m)': 'VIPObsidianI',
  'wagered(2500m)': 'VIPObsidianII',
  'wagered(5000m)': 'VIPOpalI',
  'wagered(10000m)': 'VIPOpalII',
  'wagered(25000m)': 'VIPPlutoniumI'
};

const FLAG_LABELS = {
  none: 'None',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum I',
  'wagered(500k)': 'Platinum II',
  'wagered(1m)': 'Platinum III',
  'wagered(2.5m)': 'Platinum IV',
  'wagered(5m)': 'Platinum V',
  'wagered(10m)': 'Platinum VI',
  'wagered(25m)': 'Diamond I',
  'wagered(50m)': 'Diamond II',
  'wagered(100m)': 'Diamond III',
  'wagered(250m)': 'Diamond IV',
  'wagered(500m)': 'Diamond V',
  'wagered(1000m)': 'Obsidian I',
  'wagered(2500m)': 'Obsidian II',
  'wagered(5000m)': 'Opal I',
  'wagered(10000m)': 'Opal II',
  'wagered(25000m)': 'Plutonium'
};

const RANK_HINTS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'obsidian', 'opal', 'vip', 'wagered', 'rank', 'badge'];

if (!fs.existsSync(harPath)) {
  console.error('HAR nicht gefunden:', harPath);
  process.exit(1);
}

function extractSvgIconFromJs(text) {
  const iconMatch = text.match(/data-ds-icon":"(VIP[A-Za-z0-9]+)"/);
  if (!iconMatch) return null;

  let best = '';
  for (const m of text.matchAll(/'(<svg>.*?)'/g)) {
    const candidate = m[1];
    if (!candidate.includes('<path') && !candidate.includes('<defs')) continue;
    if (candidate.length > best.length) best = candidate;
  }
  if (!best) return null;

  const svg = best
    .replace(/<!>/g, '')
    .replace(/fill-opacity/g, 'fill-opacity');

  return { iconName: iconMatch[1], svg };
}

function finalizeSvg(svg) {
  if (!svg.startsWith('<svg')) return svg;
  if (svg.includes('viewBox=')) {
    return svg.replace('<svg>', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${svg.slice(5)}`;
}

const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
const iconsByName = new Map();

for (const entry of har.log.entries || []) {
  const text = entry.response?.content?.text;
  if (!text || typeof text !== 'string') continue;

  const extracted = extractSvgIconFromJs(text);
  if (extracted) {
    const prev = iconsByName.get(extracted.iconName);
    if (!prev || extracted.svg.length > prev.svg.length) {
      iconsByName.set(extracted.iconName, extracted);
    }
  }
}

// Fallback: legacy image assets from immutable/assets/
const imageByName = new Map();
for (const entry of har.log.entries || []) {
  const url = entry.request?.url || '';
  const m = url.match(/immutable\/assets\/([a-z0-9_.()-]+)\.([A-Za-z0-9_-]+)\.([a-z]+)$/i);
  if (!m) continue;
  const name = m[1].toLowerCase();
  if (!RANK_HINTS.some((h) => name.includes(h))) continue;
  const content = entry.response?.content;
  if (!content?.text) continue;
  const size = content.size || content.text.length;
  const prev = imageByName.get(name);
  if (!prev || size > prev.size) {
    imageByName.set(name, {
      name,
      mime: content.mimeType || 'image/webp',
      encoding: content.encoding || 'base64',
      text: content.text,
      size
    });
  }
}

fs.mkdirSync(outDir, { recursive: true });

const index = [];
for (const [flag, iconName] of Object.entries(FLAG_TO_ICON)) {
  const icon = iconsByName.get(iconName);
  if (!icon) continue;
  const file = `${flag.replace(/[^a-z0-9]+/gi, '_')}.svg`;
  const svg = finalizeSvg(icon.svg);
  fs.writeFileSync(path.join(outDir, file), svg, 'utf8');
  index.push({
    flag,
    file,
    label: FLAG_LABELS[flag] || flag,
    icon: iconName
  });
}

for (const [name, item] of [...imageByName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (index.some((i) => i.flag === name)) continue;
  const ext = item.mime.includes('gif') ? 'gif' : item.mime.includes('png') ? 'png' : 'webp';
  const file = `${name}.${ext}`;
  const buf = Buffer.from(item.text, item.encoding === 'base64' ? 'base64' : 'utf8');
  fs.writeFileSync(path.join(outDir, file), buf);
  index.push({ flag: name, file, label: name });
}

fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2));

console.log(`Extracted ${index.length} rank badge(s) → ${outDir}`);
console.log(`  SVG icons from JS: ${iconsByName.size}`);
console.log(`  Image assets: ${imageByName.size}`);
if (!index.length) {
  console.log('Keine Rank-Badges gefunden. HAR mit offenem Stake-Chat (VIP-Icons geladen) aufnehmen.');
} else if (iconsByName.size) {
  console.log('Icons:', [...iconsByName.keys()].sort().join(', '));
}
