/** Text-Normalisierung für Automute-Matching (Unicode-Bold-Spam, etc.). */

const MATH_ALPHA_BLOCKS = [
  [0x1d400, 0x1d419, 65],
  [0x1d41a, 0x1d433, 97],
  [0x1d434, 0x1d44d, 65],
  [0x1d44e, 0x1d467, 97],
  [0x1d468, 0x1d481, 65],
  [0x1d482, 0x1d49b, 97],
  [0x1d5d4, 0x1d5ed, 65],
  [0x1d5ee, 0x1d607, 97],
  [0x1d63c, 0x1d655, 65],
  [0x1d656, 0x1d66f, 97],
  [0x1d670, 0x1d689, 65],
  [0x1d68a, 0x1d6a3, 97]
];

function mathAlphaToAscii(cp) {
  for (const [start, end, base] of MATH_ALPHA_BLOCKS) {
    if (cp >= start && cp <= end) return String.fromCharCode(base + (cp - start));
  }
  return null;
}

function normalizeForAutomute(text) {
  let out = '';
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    const mapped = mathAlphaToAscii(cp);
    if (mapped) {
      out += mapped;
      continue;
    }
    out += ch;
  }
  return out
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { normalizeForAutomute, mathAlphaToAscii };
