/** Shared Automute coordination logic (relay server + ModHub client). */

const { normalizeModName } = require('./config');

/**
 * @param {readonly string[]} hierarchy highest priority first
 * @param {Map<string, { automuteEnabled?: boolean, automuteLive?: boolean }>} mods
 */
function computeAutomuteExecutor(hierarchy, mods) {
  for (const name of hierarchy || []) {
    const key = normalizeModName(name);
    const row = mods.get(key);
    if (row?.automuteEnabled && row?.automuteLive) return key;
  }
  return null;
}

function automutePresenceFromSettings(settings = {}) {
  const enabled = settings.automuteEnabled !== false;
  const live = enabled && settings.automuteDryRun === false;
  return { automuteEnabled: enabled, automuteLive: live };
}

module.exports = {
  computeAutomuteExecutor,
  automutePresenceFromSettings
};
