#!/usr/bin/env node
/**
 * Extrahiert Stake-Chat-Emotes aus HAR → assets/emotes/ (merged, überschreibt index nicht komplett)
 * Usage: node scripts/extract-emotes-from-har.js [path/to/emotes.har]
 */
const fs = require('fs');
const path = require('path');

const harPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emotes.har'));
const outDir = path.join(__dirname, '..', 'assets', 'emotes');
const indexPath = path.join(outDir, 'index.json');

if (!fs.existsSync(harPath)) {
  console.error('HAR nicht gefunden:', harPath);
  process.exit(1);
}

const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
const byName = new Map();

for (const entry of har.log.entries || []) {
  const url = entry.request?.url || '';
  const m = url.match(/immutable\/assets\/([a-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([a-z]+)$/i);
  if (!m) continue;
  const name = m[1].toLowerCase();
  const content = entry.response?.content;
  if (!content?.text) continue;
  const size = content.size || content.text.length;
  const prev = byName.get(name);
  if (!prev || size > prev.size) {
    byName.set(name, {
      name,
      mime: content.mimeType || 'image/webp',
      encoding: content.encoding || 'base64',
      text: content.text,
      size
    });
  }
}

const existing = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : [];
const indexByName = new Map(existing.map((e) => [String(e.name).toLowerCase(), e]));
let added = 0;
let updated = 0;

fs.mkdirSync(outDir, { recursive: true });

for (const [name, item] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const ext = item.mime.includes('gif') ? 'gif' : item.mime.includes('png') ? 'png' : 'webp';
  const file = `${name}.${ext}`;
  const buf = Buffer.from(item.text, item.encoding === 'base64' ? 'base64' : 'utf8');
  fs.writeFileSync(path.join(outDir, file), buf);
  const had = indexByName.has(name);
  indexByName.set(name, { name, file, token: `:${name}:` });
  if (had) updated += 1;
  else added += 1;
}

const merged = [...indexByName.values()].sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(indexPath, JSON.stringify(merged, null, 2));
console.log(`Extracted ${byName.size} from HAR → +${added} new, ${updated} updated, total ${merged.length}`);
