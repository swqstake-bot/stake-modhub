/** Mod-Chat relay config — standalone (kopierbar ohne ModHub). */

const MOD_CHAT_ALLOWED = Object.freeze(['swaqline', 'droz', 'wheelyboy321', 'kartenstapel']);

const MOD_CHAT_DEFAULT_URL = 'wss://announcement-anaheim-filled-ripe.trycloudflare.com';

const MOD_CHAT_PORT = 3847;

const MOD_CHAT_HISTORY_MAX = 200;

/** Optional: set MODCHAT_TOKEN env on server + same value in ModHub Settings */
const MOD_CHAT_TOKEN = String(process.env.MODCHAT_TOKEN || '').trim();

function normalizeModName(name) {
  return String(name || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function isAllowedModChatUser(name) {
  return MOD_CHAT_ALLOWED.includes(normalizeModName(name));
}

function isValidModChatToken(token) {
  if (!MOD_CHAT_TOKEN) return true;
  return String(token || '').trim() === MOD_CHAT_TOKEN;
}

module.exports = {
  MOD_CHAT_ALLOWED,
  MOD_CHAT_DEFAULT_URL,
  MOD_CHAT_PORT,
  MOD_CHAT_HISTORY_MAX,
  MOD_CHAT_TOKEN,
  normalizeModName,
  isAllowedModChatUser,
  isValidModChatToken
};
