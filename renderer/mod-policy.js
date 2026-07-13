/* Policy 2026 — ported from chat/policy.js for Electron renderer */
(function (global) {
  'use strict';

  const POLICY_CATEGORIES = {
    begging: { id: 'begging', label: 'Betteln', minutes: [10, 60, 240, 1440, 2880, 4320, 7200, 10080], capRepeat: 10080 },
    scam_social: { id: 'scam_social', label: 'Scam/Socials', minutes: [1440, 259200], capRepeat: null },
    telegram_connect: { id: 'telegram_connect', label: 'Telegram (connect)', minutes: [1440, 10080], capRepeat: 10080 },
    selling_accounts: { id: 'selling_accounts', label: 'Account-Verkauf', minutes: [43200, 129600, 259200], capRepeat: null },
    racism_hate: { id: 'racism_hate', label: 'Rassismus/Hate', minutes: [1440, 43200, 129600, 259200], capRepeat: null },
    chat_jumping: { id: 'chat_jumping', label: 'Chat Jumping', minutes: [1440, 10080, 43200], capRepeat: 43200 },
    minor_spam_caps: { id: 'minor_spam_caps', label: 'Spam/Caps', minutes: [10, 60, 240, 1440, 10080], capRepeat: 10080 },
    toxic_behavior: { id: 'toxic_behavior', label: 'Toxic/Beleidigung', minutes: [10, 60, 240, 1440, 10080], capRepeat: 10080 },
    custom: { id: 'custom', label: 'Manuell', minutes: null, capRepeat: null }
  };

  const DURATION_OPTIONS = [
    '10 minutes', '30 minutes', '1 hour', '2 hours', '4 hours', '1 day', '2 days', '3 days',
    '5 days', '1 week', '2 weeks', '1 month', '2 months', '3 months', '6 months', '1 year', 'indefinite'
  ];

  function minutesToLabel(mins) {
    if (mins === 0) return 'unbegrenzt';
    if (mins < 60) return mins + ' Min';
    if (mins < 1440) return Math.round(mins / 60) + ' Std';
    return Math.round(mins / 1440) + ' Tag(e)';
  }

  function minutesToDurationString(mins) {
    if (mins === 0 || mins == null) return null;
    if (mins < 60) return `${mins} minutes`;
    if (mins < 1440) return `${Math.round(mins / 60)} hours`;
    if (mins < 10080) return `${Math.round(mins / 1440)} days`;
    if (mins < 43200) return `${Math.round(mins / 1440)} days`;
    if (mins < 525600) return `${Math.round(mins / 43200)} months`;
    return `${Math.round(mins / 525600)} years`;
  }

  function getSuggestedMinutes(categoryId, strikeIndex) {
    const cat = POLICY_CATEGORIES[categoryId];
    if (!cat || !cat.minutes || categoryId === 'custom') return null;
    const arr = cat.minutes;
    if (strikeIndex >= arr.length) {
      return cat.capRepeat != null ? cat.capRepeat : arr[arr.length - 1];
    }
    return arr[strikeIndex];
  }

  function detectedReasonToCategory(text) {
    const normalize = (v) =>
      (v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
    const t = normalize(text);
    if (!t) return null;
    if (/missed raintalk|raintalk|rain talk|chat jumping|wrong lang|wrong language|falsche sprache/.test(t)) return 'chat_jumping';
    if (/begging|beggar|betteln|gebettel/.test(t)) return 'begging';
    if (/sell(ing)?|account transfer|resell/.test(t)) return 'selling_accounts';
    if (/racis|hate speech|hatespeech|slur|hassrede|rassismus/.test(t)) return 'racism_hate';
    if (t.includes('telegram')) return /scam|phish|fraud|phone/.test(t) ? 'scam_social' : 'telegram_connect';
    if (/scam|twitter|instagram|phone|social|betrug/.test(t)) return 'scam_social';
    if (/loan|borrow|lend|leihen/.test(t)) return 'begging';
    if (/toxic|beleidigung|unangemessen|toxisch/.test(t)) return 'toxic_behavior';
    if (/caps|spam/.test(t)) return 'minor_spam_caps';
    return null;
  }

  function countStrikesInCategory(muteList, categoryId) {
    if (!muteList || !categoryId) return 0;
    let n = 0;
    for (const m of muteList) {
      const cat = detectedReasonToCategory(m.message || '');
      if (cat === categoryId) n++;
    }
    return n;
  }

  global.StakeModPolicy = {
    POLICY_CATEGORIES,
    DURATION_OPTIONS,
    minutesToLabel,
    minutesToDurationString,
    getSuggestedMinutes,
    detectedReasonToCategory,
    countStrikesInCategory
  };
})(typeof window !== 'undefined' ? window : global);
