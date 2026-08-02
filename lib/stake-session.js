const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const {
  DEFAULT_SETTINGS,
  DEFAULT_HUB_SITE,
  HUB_SITE_KEYS,
  cloneHubSite,
  pickHubKeys,
  normalizeSiteKey
} = require('./stake-constants');

function settingsPath() {
  return path.join(app.getPath('userData'), 'modhub-settings.json');
}

const DEPRECATED_MOD_CHAT_URLS = new Set([
  'ws://192.168.178.177:3847',
  'wss://gratis-automatically-ministry-measurements.trycloudflare.com'
]);

function isLegacyModChatUrl(url) {
  const u = String(url || '').trim();
  if (!u) return true;
  if (DEPRECATED_MOD_CHAT_URLS.has(u)) return true;
  const lower = u.toLowerCase();
  if (/trycloudflare\.com/.test(lower)) return false;
  return (
    /^wss?:\/\/(192\.168\.|10\.|127\.0\.0\.1|localhost\b)/.test(lower) ||
    (/:3847/.test(lower) && !/trycloudflare\.com/.test(lower))
  );
}

function extractLegacyHub(raw) {
  const fromFlat = pickHubKeys(raw);
  const hasAny = HUB_SITE_KEYS.some((k) => Object.prototype.hasOwnProperty.call(raw || {}, k));
  return hasAny ? cloneHubSite({ ...DEFAULT_HUB_SITE, ...fromFlat }) : cloneHubSite(DEFAULT_HUB_SITE);
}

/** Ensure hubBySite exists; migrate flat RH/automsg/automute into both sites once. */
function migrateHubBySite(settings) {
  const next = { ...settings };
  let dirty = false;
  const legacy = extractLegacyHub(settings);
  const incoming = settings.hubBySite && typeof settings.hubBySite === 'object' ? settings.hubBySite : null;

  if (!incoming || !incoming.com || !incoming.eu) {
    next.hubBySite = {
      com: cloneHubSite(incoming?.com || legacy),
      eu: cloneHubSite(incoming?.eu || legacy)
    };
    dirty = true;
  } else {
    next.hubBySite = {
      com: cloneHubSite(incoming.com),
      eu: cloneHubSite(incoming.eu)
    };
  }

  const active = normalizeSiteKey(next.activeSite);
  Object.assign(next, cloneHubSite(next.hubBySite[active]));
  return { settings: next, dirty };
}

function getHubSettings(settings, site) {
  const s = settings || DEFAULT_SETTINGS;
  const key = normalizeSiteKey(site);
  const hub = s.hubBySite?.[key];
  return cloneHubSite(hub || pickHubKeys(s));
}

function syncFlatFromActiveHub(settings) {
  const active = normalizeSiteKey(settings.activeSite);
  const hub = getHubSettings(settings, active);
  return { ...settings, ...hub };
}

function loadSettings() {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) {
      return syncFlatFromActiveHub({
        ...DEFAULT_SETTINGS,
        hubBySite: {
          com: cloneHubSite(DEFAULT_HUB_SITE),
          eu: cloneHubSite(DEFAULT_HUB_SITE)
        }
      });
    }
    const v = JSON.parse(fs.readFileSync(p, 'utf8'));
    let next = { ...DEFAULT_SETTINGS, ...v };
    let dirty = false;
    if (isLegacyModChatUrl(next.modChatUrl)) {
      next.modChatUrl = DEFAULT_SETTINGS.modChatUrl;
      dirty = true;
    }
    if ('modChatToken' in next) {
      delete next.modChatToken;
      dirty = true;
    }
    const migrated = migrateHubBySite(next);
    next = migrated.settings;
    dirty = dirty || migrated.dirty;
    if (dirty) {
      try {
        fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
      } catch (_) {
        /* ignore */
      }
    }
    return next;
  } catch (_) {
    return syncFlatFromActiveHub({
      ...DEFAULT_SETTINGS,
      hubBySite: {
        com: cloneHubSite(DEFAULT_HUB_SITE),
        eu: cloneHubSite(DEFAULT_HUB_SITE)
      }
    });
  }
}

function saveSettings(partial = {}) {
  const cur = loadSettings();
  const rest = { ...partial };
  delete rest.modChatToken;
  delete rest.hubBySite;

  const hubPatchFromPartial = pickHubKeys(partial);
  for (const k of HUB_SITE_KEYS) delete rest[k];

  let next = { ...cur, ...rest };
  if (isLegacyModChatUrl(next.modChatUrl)) {
    next.modChatUrl = DEFAULT_SETTINGS.modChatUrl;
  }

  const hubBySite = {
    com: cloneHubSite(cur.hubBySite?.com),
    eu: cloneHubSite(cur.hubBySite?.eu)
  };
  if (partial.hubBySite?.com) {
    hubBySite.com = cloneHubSite({ ...hubBySite.com, ...partial.hubBySite.com });
  }
  if (partial.hubBySite?.eu) {
    hubBySite.eu = cloneHubSite({ ...hubBySite.eu, ...partial.hubBySite.eu });
  }

  const targetSite = normalizeSiteKey(
    Object.prototype.hasOwnProperty.call(partial, 'activeSite') ? partial.activeSite : cur.activeSite
  );
  if (Object.keys(hubPatchFromPartial).length) {
    hubBySite[targetSite] = cloneHubSite({ ...hubBySite[targetSite], ...hubPatchFromPartial });
  }

  next.hubBySite = hubBySite;
  next.activeSite = normalizeSiteKey(next.activeSite);
  next = syncFlatFromActiveHub(next);

  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function patchHubSettings(site, hubPartial) {
  const key = normalizeSiteKey(site);
  return saveSettings({
    hubBySite: {
      [key]: hubPartial || {}
    }
  });
}

function normalizeHostname(domain) {
  if (!domain || typeof domain !== 'string') return 'stake.bet';
  return domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim() || 'stake.bet';
}

module.exports = {
  settingsPath,
  loadSettings,
  saveSettings,
  patchHubSettings,
  getHubSettings,
  normalizeHostname,
  normalizeSiteKey
};
