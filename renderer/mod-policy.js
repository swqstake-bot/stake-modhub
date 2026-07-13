/* Policy 2026 — Stake Chat Moderation & Mute Policy
 * Quelle: https://docs.google.com/document/d/1hKij1JV3h7WFrqfbT-lEVYRiTj-crGfjeC46onu7ck4/edit
 * Perm-Mutes nur in den unten definierten schweren Kategorien und fast nie sofort.
 */
(function (global) {
  'use strict';

  const POLICY_DOC_URL =
    'https://docs.google.com/document/d/1hKij1JV3h7WFrqfbT-lEVYRiTj-crGfjeC46onu7ck4/edit';

  /** 0 = permanent / indefinite */
  const PERM = 0;

  const POLICY_CATEGORIES = {
    begging: {
      id: 'begging',
      label: 'Betteln',
      minutes: [10, 60, 240, 1440, 2880, 4320, 7200, 10080],
      capRepeat: 10080,
      hint: '10 Min → Dropdown hoch bis max. 7 Tage, danach immer 7 Tage. Kein Perm.'
    },
    scam_social: {
      id: 'scam_social',
      label: 'Scam-Links / Socials (Betrug)',
      minutes: [1440, 259200, PERM],
      capRepeat: null,
      hint: '1 Tag → 6 Monate → Perm (nur nach vorherigen Mutes, nicht sofort).'
    },
    telegram_connect: {
      id: 'telegram_connect',
      label: 'Telegram nur zum Vernetzen',
      minutes: [1440, 10080],
      capRepeat: 10080,
      hint: '1 Tag → 7 Tage → danach jeweils 7 Tage. Kein Perm.'
    },
    selling_accounts: {
      id: 'selling_accounts',
      label: 'Account-Verkauf',
      minutes: [43200, 129600, 259200, PERM],
      capRepeat: null,
      hint: '30 Tage → 3 Monate → 6 Monate → Perm.'
    },
    racism_hate: {
      id: 'racism_hate',
      label: 'Rassismus / Hatespeech (schwer)',
      minutes: [1440, 43200, 129600, 259200, PERM],
      capRepeat: null,
      hint: '1 Tag → 30 Tage → 3 Monate → 6 Monate → Perm.'
    },
    chat_bot: {
      id: 'chat_bot',
      label: 'Chat-Bot',
      minutes: [1440, 259200, PERM],
      capRepeat: null,
      hint: '1 Tag → 6 Monate → Perm.'
    },
    chat_jumping: {
      id: 'chat_jumping',
      label: 'Chat Jumping',
      minutes: [1440, 10080, 43200],
      capRepeat: 43200,
      hint: '1 Tag → 7 Tage → 30 Tage → danach 30 Tage. Rain-Abuser an Team melden.'
    },
    minor_spam_caps: {
      id: 'minor_spam_caps',
      label: 'Spam / Caps',
      minutes: [10, 60, 240, 1440, 2880, 4320, 7200, 10080],
      capRepeat: 10080,
      hint: 'Dropdown bis 7 Tage, danach 7 Tage wiederholen. Kein Perm.'
    },
    toxic_behavior: {
      id: 'toxic_behavior',
      label: 'Toxic / Beleidigung',
      minutes: [10, 60, 240, 1440, 2880, 4320, 7200, 10080],
      capRepeat: 10080,
      hint: 'Dropdown bis 7 Tage, danach 7 Tage wiederholen. Kein Perm.'
    },
    custom: {
      id: 'custom',
      label: 'Manuell',
      minutes: null,
      capRepeat: null,
      hint: 'Dauer selbst wählen.'
    }
  };

  const DURATION_OPTIONS = [
    '10 minutes',
    '30 minutes',
    '1 hour',
    '2 hours',
    '4 hours',
    '1 day',
    '2 days',
    '3 days',
    '5 days',
    '1 week',
    '2 weeks',
    '1 month',
    '2 months',
    '3 months',
    '6 months',
    '1 year',
    'indefinite'
  ];

  function minutesToLabel(mins) {
    if (mins === PERM) return 'permanent';
    if (mins == null) return 'manuell';
    if (mins < 60) return `${mins} Min`;
    if (mins < 1440) return `${Math.round(mins / 60)} Std`;
    if (mins < 10080) return `${Math.round(mins / 1440)} Tag(e)`;
    if (mins < 43200) return `${Math.round(mins / 1440)} Tag(e)`;
    if (mins < 525600) return `${Math.round(mins / 43200)} Monat(e)`;
    return `${Math.round(mins / 525600)} Jahr(e)`;
  }

  function minutesToDurationString(mins) {
    if (mins === PERM) return 'indefinite';
    if (mins == null) return null;
    if (mins < 60) return `${mins} minutes`;
    if (mins < 1440) return `${Math.round(mins / 60)} hours`;
    if (mins < 10080) return `${Math.round(mins / 1440)} days`;
    if (mins === 10080) return '1 week';
    if (mins === 20160) return '2 weeks';
    if (mins === 43200) return '1 month';
    if (mins === 86400) return '2 months';
    if (mins === 129600) return '3 months';
    if (mins === 259200) return '6 months';
    if (mins === 525600) return '1 year';
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
      (v || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const t = normalize(text);
    if (!t) return null;
    if (/chat\s*bot|chatbot|bot\s*usage|using\s*chat\s*bot/.test(t)) return 'chat_bot';
    if (/missed raintalk|raintalk|rain talk|chat jumping|wrong lang|wrong language|falsche sprache/.test(t)) {
      return 'chat_jumping';
    }
    if (/begging|beggar|betteln|gebettel/.test(t)) return 'begging';
    if (/sell(ing)?|account transfer|resell|account.?verkauf/.test(t)) return 'selling_accounts';
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

  function getCategoryHint(categoryId) {
    return POLICY_CATEGORIES[categoryId]?.hint || '';
  }

  global.StakeModPolicy = {
    POLICY_DOC_URL,
    PERM,
    POLICY_CATEGORIES,
    DURATION_OPTIONS,
    minutesToLabel,
    minutesToDurationString,
    getSuggestedMinutes,
    getCategoryHint,
    detectedReasonToCategory,
    countStrikesInCategory
  };
})(typeof window !== 'undefined' ? window : global);
