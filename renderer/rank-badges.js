/**
 * VIP / rank badges — local assets from HAR extract, else compact fallback chip.
 */
(function (global) {
  /** @type {Map<string, { flag: string, file: string, label: string }>} */
  let byFlag = new Map();
  let loadPromise = null;

  const FLAG_ALIASES = [
    ['none', 'none'],
    ['bronze', 'bronze'],
    ['silver', 'silver'],
    ['gold', 'gold'],
    ['platinum', 'platinum'],
    ['wagered(500k)', 'platinum2'],
    ['wagered(1m)', 'platinum3'],
    ['wagered(2.5m)', 'platinum4'],
    ['wagered(5m)', 'platinum5'],
    ['wagered(10m)', 'platinum6'],
    ['wagered(25m)', 'diamond'],
    ['wagered(50m)', 'diamond2'],
    ['wagered(100m)', 'diamond3'],
    ['wagered(250m)', 'diamond4'],
    ['wagered(500m)', 'diamond5'],
    ['wagered(1b)', 'obsidian'],
    ['wagered(2.5b)', 'obsidian2'],
    ['wagered(5b)', 'opal'],
    ['wagered(10b)', 'opal2']
  ];

  const FALLBACK_LABEL = {
    none: '—',
    bronze: 'B',
    silver: 'S',
    gold: 'G',
    platinum: 'P',
    platinum2: 'P2',
    platinum3: 'P3',
    platinum4: 'P4',
    platinum5: 'P5',
    platinum6: 'P6',
    diamond: 'D',
    diamond2: 'D2',
    diamond3: 'D3',
    diamond4: 'D4',
    diamond5: 'D5',
    obsidian: 'O',
    obsidian2: 'O2',
    opal: 'Op',
    opal2: 'Op2'
  };

  function defaultEsc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function normalizeFlag(flag) {
    return String(flag || '')
      .trim()
      .toLowerCase();
  }

  function resolveFlagKey(flag) {
    const f = normalizeFlag(flag);
    if (!f) return null;
    if (byFlag.has(f)) return f;
    for (const [needle, key] of FLAG_ALIASES) {
      if (f === needle || f.includes(needle)) {
        if (byFlag.has(key)) return key;
        if (byFlag.has(needle)) return needle;
        return key;
      }
    }
    return f;
  }

  const FLAG_ORDER = [
    'none',
    'bronze',
    'silver',
    'gold',
    'platinum',
    'wagered(500k)',
    'wagered(1m)',
    'wagered(2.5m)',
    'wagered(5m)',
    'wagered(10m)',
    'wagered(25m)',
    'wagered(50m)',
    'wagered(100m)',
    'wagered(250m)',
    'wagered(500m)',
    'wagered(1000m)',
    'wagered(2500m)',
    'wagered(5000m)',
    'wagered(10000m)',
    'wagered(25000m)'
  ];

  function flagRank(flag) {
    const f = normalizeFlag(flag);
    const idx = FLAG_ORDER.indexOf(f);
    return idx >= 0 ? idx : -1;
  }

  function pickPrimaryFlag(flags) {
    if (!Array.isArray(flags) || !flags.length) return null;
    let best = null;
    let bestRank = -1;
    for (const raw of flags) {
      const f = typeof raw === 'string' ? raw : raw?.flag;
      const rank = flagRank(f);
      if (rank > bestRank) {
        bestRank = rank;
        best = normalizeFlag(f);
      }
    }
    return best && best !== 'none' ? best : null;
  }

  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch('./assets/rank-badges/index.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((items) => {
        byFlag = new Map();
        for (const item of Array.isArray(items) ? items : []) {
          const flag = normalizeFlag(item.flag || item.name);
          if (!flag) continue;
          byFlag.set(flag, {
            flag,
            file: item.file,
            label: item.label || flag
          });
        }
        return [...byFlag.values()];
      })
      .catch(() => {
        byFlag = new Map();
        return [];
      });
    return loadPromise;
  }

  function formatFlagsHtml(flags, escFn, { enabled = true } = {}) {
    if (!enabled) return '';
    const esc = escFn || defaultEsc;
    const primary = pickPrimaryFlag(flags);
    if (!primary || primary === 'none') return '';

    const key = resolveFlagKey(primary);
    const asset = key ? byFlag.get(key) : null;
    if (asset?.file) {
      return `<img class="chat-rank-badge" src="./assets/rank-badges/${esc(asset.file)}" alt="${esc(asset.label || primary)}" title="${esc(primary)}" loading="lazy" decoding="async">`;
    }

    const label = FALLBACK_LABEL[key] || primary.slice(0, 3).toUpperCase();
    return `<span class="chat-rank-fallback" title="${esc(primary)}">${esc(label)}</span>`;
  }

  function isModerator(roles) {
    if (!Array.isArray(roles) || !roles.length) return false;
    return roles.some((r) => String(r || '').toLowerCase() === 'moderator');
  }

  function formatModBadgeHtml(roles, escFn, { enabled = true } = {}) {
    if (!enabled || !isModerator(roles)) return '';
    const esc = escFn || defaultEsc;
    const asset = byFlag.get('moderator');
    if (asset?.file) {
      return `<img class="chat-mod-badge" src="./assets/rank-badges/${esc(asset.file)}" alt="Moderator" title="Moderator" loading="lazy" decoding="async">`;
    }
    return `<span class="chat-mod-fallback" title="Moderator">MOD</span>`;
  }

  function formatUserBadgesHtml({ flags, roles }, escFn, { enabled = true } = {}) {
    const mod = formatModBadgeHtml(roles, escFn, { enabled });
    const vip = formatFlagsHtml(flags, escFn, { enabled });
    return `${mod}${vip}`;
  }

  global.RankBadges = {
    load,
    pickPrimaryFlag,
    isModerator,
    formatFlagsHtml,
    formatModBadgeHtml,
    formatUserBadgesHtml,
    getCatalog: () => [...byFlag.values()]
  };
})(window);
