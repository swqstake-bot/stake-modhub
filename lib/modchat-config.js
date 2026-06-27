/** Shared Mod-Chat relay config (DE mods). */

const MOD_CHAT_ALLOWED = Object.freeze(['swaqline', 'droz', 'wheelyboy321', 'kartenstapel']);

const MOD_CHAT_DEFAULT_URL = 'ws://192.168.178.177:3847';

const MOD_CHAT_PORT = 3847;

const MOD_CHAT_HISTORY_MAX = 200;

function normalizeModName(name) {
  return String(name || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function isAllowedModChatUser(name) {
  return MOD_CHAT_ALLOWED.includes(normalizeModName(name));
}

module.exports = {
  MOD_CHAT_ALLOWED,
  MOD_CHAT_DEFAULT_URL,
  MOD_CHAT_PORT,
  MOD_CHAT_HISTORY_MAX,
  normalizeModName,
  isAllowedModChatUser
};
