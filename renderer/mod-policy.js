/* Mute Timers 2026: Google Doc + Mladen's shared-category clarification. */
(function (global) {
  'use strict';

  const DAY = 1440;
  const MONTH = 30 * DAY;
  const STANDARD = [10, 60, 240, DAY, 2 * DAY, 3 * DAY, 5 * DAY, 7 * DAY];
  // Zero represents permanent. null represents a manual decision.
  const POLICY_CATEGORIES = {
    begging: { id: 'begging', label: 'Passive Begging / Begging / Tag Spamming', minutes: STANDARD, color: '#e06666' },
    minor_spam_caps: { id: 'minor_spam_caps', label: 'Caps / Spam / Chat Abuse', minutes: STANDARD, color: '#6d9eeb' },
    low_quality: { id: 'low_quality', label: 'Low Quality Chat', minutes: STANDARD, color: '#93c47d' },
    wrong_language: { id: 'wrong_language', label: 'Wrong Language / Falsche Sprache', minutes: STANDARD },
    scam_social: { id: 'scam_social', label: 'Scam-Links / Social-Spam / Telegram / Telefonnummer', minutes: [DAY, 6 * MONTH, 0] },
    telegram_connect: { id: 'telegram_connect', label: 'Socials / Codes / Wallet teilen (normal)', minutes: [DAY, 7 * DAY] },
    selling_accounts: { id: 'selling_accounts', label: 'Account-Verkauf', minutes: [30 * DAY, 3 * MONTH, 6 * MONTH, 0] },
    racism_hate: { id: 'racism_hate', label: 'Rassismus / Hate Speech / Toxic', minutes: [DAY, 30 * DAY, 3 * MONTH, 6 * MONTH, 0] },
    chat_jumping: { id: 'chat_jumping', label: 'Chat Jumping', minutes: [DAY, 7 * DAY, 30 * DAY] },
    suicidal_addiction: { id: 'suicidal_addiction', label: 'Suizid / Sucht', minutes: [30 * DAY] },
    advertising_streamers: { id: 'advertising_streamers', label: 'Streamer-Werbung', minutes: [DAY, 7 * DAY] },
    politics_religion: { id: 'politics_religion', label: 'Politik / Religion', minutes: [DAY, 7 * DAY] },
    other_casinos: { id: 'other_casinos', label: 'Andere Casinos erwähnen / bewerben', minutes: [DAY, 7 * DAY, 14 * DAY, MONTH, 2 * MONTH, 3 * MONTH, 6 * MONTH] },
    chat_bot: { id: 'chat_bot', label: 'Chat Bot (nur bei sicherem Nachweis)', minutes: [DAY, 6 * MONTH, 0] }
  };

  // Violations remain separate checkboxes; categoryId controls shared history.
  const VIOLATIONS = [
    { id: 'passive_begging', label: 'Passive Begging', categoryId: 'begging' },
    { id: 'begging', label: 'Begging', categoryId: 'begging' },
    { id: 'tag_spamming', label: 'Tag Spamming', categoryId: 'begging' },
    { id: 'caps', label: 'Caps', categoryId: 'minor_spam_caps' },
    { id: 'spam', label: 'Spam', categoryId: 'minor_spam_caps' },
    { id: 'chat_abuse', label: 'Chat Abuse', categoryId: 'minor_spam_caps' },
    { id: 'low_quality', label: 'Low Quality Chat', categoryId: 'low_quality' },
    { id: 'wrong_language', label: 'Wrong Language', categoryId: 'wrong_language' },
    ...Object.values(POLICY_CATEGORIES).filter((c) => !['begging', 'minor_spam_caps', 'low_quality', 'wrong_language'].includes(c.id))
      .map((c) => ({ id: c.id, label: c.label, categoryId: c.id }))
  ];

  const DURATION_OPTIONS = [
    '10 minutes', '30 minutes', '1 hour', '2 hours', '4 hours', '1 day', '2 days', '3 days',
    '5 days', '7 days', '14 days', '30 days', '2 months', '3 months', '6 months', '1 year', 'indefinite'
  ];

  function minutesToLabel(mins) {
    if (mins == null) return 'manuell';
    if (mins === 0) return 'permanent';
    if (mins < 60) return mins + ' Minuten';
    if (mins < DAY) return mins / 60 + (mins === 60 ? ' Stunde' : ' Stunden');
    if (mins > MONTH && mins % MONTH === 0) return mins / MONTH + ' Monate';
    return mins / DAY + (mins === DAY ? ' Tag' : ' Tage');
  }

  function minutesToDurationString(mins) {
    if (mins == null) return null;
    if (mins === 0) return 'indefinite';
    if (mins < 60) return mins + ' minutes';
    if (mins < DAY) return mins / 60 + (mins === 60 ? ' hour' : ' hours');
    if (mins > MONTH && mins % MONTH === 0) return mins / MONTH + ' months';
    return mins / DAY + (mins === DAY ? ' day' : ' days');
  }

  function getSuggestedMinutes(categoryId, strikeIndex) {
    const steps = POLICY_CATEGORIES[categoryId]?.minutes;
    if (!steps) return null;
    const index = Math.max(0, Math.floor(Number(strikeIndex) || 0));
    return steps[Math.min(index, steps.length - 1)];
  }

  function detectedReasonToViolations(text) {
    // Our saved checkbox suffix is authoritative if a moderator corrected detection.
    const savedRules = String(text || '').match(/\| Regeln:\s*(.*)$/s);
    if (savedRules) text = savedRules[1];
    // Ignore usernames and rule links in the saved blueprints.
    const t = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/https?:\/\/\S+|@[\w.-]+/g, ' ').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return [];
    const ids = new Set();
    const add = (id, test) => { if (test) ids.add(id); };
    const passive = /passiv\w*\s*(begg|bettel|slotcall)|missed rain|verpasster regen|spenden kommentar|commenting tips/.test(t);
    const tagSpam = /tag\s*spam|spam\w*\s*tag|nonsense tag|sinnlos\w* tag/.test(t);
    const socialSpam = /scam|phish|fraud|betrug|telegram|phone\s*number|telefonnummer|spam\w*[^;&|]*social|social[^;&|]*spam/.test(t);
    add('passive_begging', passive);
    add('begging', /begg|bettel|gebettel|loan|borrow|lend|leihen|asking for rain/.test(t.replace(/passiv\w*\s*(begg\w*|bettel\w*)/g, '')));
    add('tag_spamming', tagSpam);
    const spamText = t.replace(/tag\s*spam\w*|spam\w*\s*tag\w*|nonsense tag\w*/g, '');
    add('caps', /\bcaps\b/.test(t));
    add('spam', !socialSpam && /\bspam\w*/.test(spamText));
    add('chat_abuse', /chat abuse/.test(t));
    // Older mute notes also use mixed wording such as "low Qualität Chat / Spam".
    add('low_quality', /low\s*(?:quality|qualitat)|schlechte\w* chat\s*qualitat|nonsense chat/.test(t));
    add('wrong_language', /wrong lang|falsche sprache/.test(t));
    add('scam_social', socialSpam);
    add('telegram_connect', !socialSpam && /social|sozial|twitter|instagram|wallet|drop\s*code|sharing[^;&|]*codes|codes? (teilen|sharing)|kontaktversuch|personal contact/.test(t));
    add('selling_accounts', /sell\w*[^;&|]*acc|acc\w*[^;&|]*(sell|verkauf)|account transfer|resell|trading account/.test(t));
    add('racism_hate', /racis|hate speech|hatespeech|slur|hassrede|rassismus|toxic|toxisch|beleid\w*|rightist extremist/.test(t));
    add('chat_jumping', /chat\s*jump/.test(t));
    add('suicidal_addiction', /suicid|suizid|addiction|sucht|selbstmord/.test(t));
    add('advertising_streamers', /streamer/.test(t));
    add('politics_religion', /politic|politik|religio/.test(t));
    add('other_casinos', /other casinos?|anderen? casinos?|fremd\w* casinos?/.test(t));
    add('chat_bot', /chat\s*bot/.test(t));
    return [...ids];
  }

  function categoriesForViolations(ids) {
    return [...new Set(VIOLATIONS.filter((v) => ids.includes(v.id)).map((v) => v.categoryId))];
  }

  function detectedReasonsToCategories(text) {
    return categoriesForViolations(detectedReasonToViolations(text));
  }

  function detectedReasonToCategory(text) {
    return detectedReasonsToCategories(text)[0] || null;
  }

  function countStrikesInCategory(muteList, categoryId) {
    return (Array.isArray(muteList) ? muteList : []).filter((m) =>
      detectedReasonsToCategories(m.message).includes(categoryId)).length;
  }

  function historyDurationMinutes(mute) {
    const start = Date.parse(mute.createdAt);
    if (!Number.isFinite(start)) return null;
    if (mute.expireAt === null) return 0;
    const end = Date.parse(mute.expireAt);
    if (!Number.isFinite(end) || end <= start) return null;
    return Math.round((end - start) / 60000);
  }

  function getCategorySuggestion(muteList, categoryId) {
    const steps = POLICY_CATEGORIES[categoryId]?.minutes;
    if (!steps) return { categoryId, strikes: 0, minutes: null };
    const history = (Array.isArray(muteList) ? muteList : [])
      .filter((m) => detectedReasonsToCategories(m.message).includes(categoryId));
    // Advance from the latest actual duration. Use strike count only when
    // historical dates are missing, including histories from older policies.
    const latest = history.slice().sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))[0];
    let index = history.length;
    if (latest) {
      const previous = historyDurationMinutes(latest);
      if (previous != null) {
        const next = previous === 0 ? steps.length - 1 : steps.findIndex((n) => n === 0 || n > previous + 1);
        index = next < 0 ? steps.length - 1 : next;
      }
    }
    return { categoryId, strikes: history.length, minutes: getSuggestedMinutes(categoryId, index) };
  }

  function getMuteSuggestion(muteList, categoryIds) {
    const suggestions = [...new Set(categoryIds)].map((id) => getCategorySuggestion(muteList, id));
    const known = suggestions.filter((s) => s.minutes != null);
    const longest = known.reduce((best, s) => !best || s.minutes === 0 || (best.minutes !== 0 && s.minutes > best.minutes) ? s : best, null);
    return { suggestions, minutes: longest?.minutes ?? null, categoryId: longest?.categoryId ?? null };
  }

  function buildMuteMessage(message, violationIds) {
    const labels = VIOLATIONS.filter((v) => violationIds.includes(v.id)).map((v) => v.label);
    // Replace our own rules suffix so edited checkbox selections cannot leave stale rules.
    const base = String(message || '').replace(/\s*\| Regeln:.*$/s, '')
      .replace(/^Muted\s+\d+\s*(minutes?|hours?|days?|weeks?|months?|years?)\s*!?/i, 'Muted!').trim();
    return labels.length ? [base, 'Regeln: ' + labels.join('; ')].filter(Boolean).join(' | ') : base;
  }

  function buildMuteChatText(username, violationIds, reason, rulesLink) {
    const chatLabels = {
      passive_begging: 'Passives Betteln im Chat', begging: 'Betteln im Chat',
      tag_spamming: 'Tag-Spamming', caps: 'Caps im Chat', spam: 'Spam im Chat',
      chat_abuse: 'Chat-Missbrauch', low_quality: 'Sehr schlechte Chat-Qualität',
      wrong_language: 'Falsche Sprache im Chat', scam_social: 'Scam-Links / Social-Spam / unerlaubte Kontaktdaten',
      telegram_connect: 'Teilen von Socials / Codes / Wallet', selling_accounts: 'Account-Verkauf',
      racism_hate: 'Rassismus / Hate Speech / toxisches Verhalten', chat_jumping: 'Chat Jumping',
      suicidal_addiction: 'Suizid- / Suchtthematik', advertising_streamers: 'Streamer-Werbung',
      politics_religion: 'Politik / Religion im Chat', other_casinos: 'Nennen oder Bewerben anderer Casinos',
      chat_bot: 'Chat-Bot-Nutzung'
    };
    const labels = VIOLATIONS.filter((v) => violationIds.includes(v.id)).map((v) => chatLabels[v.id] || v.label);
    // Private extra notes stay in mute history when checkbox reasons are available.
    const fallback = buildMuteMessage(reason, []).replace(/^@[\w.-]+\s*/, '').replace(/^Muted!\s*/i, '')
      .replace(/\s*[-→]+>?.*Deutsche Chatregeln.*$/i, '').trim();
    const body = labels.join('; ') || fallback;
    const user = String(username || '').replace(/^@+/, '').trim();
    const link = rulesLink || 'https://stakecommunity.com/topic/119796-deutsche-chat-regeln/#comment-2423075';
    return `${user ? '@' + user + ' ' : ''}Muted! ${body} -> 📜Deutsche Chatregeln📜 ${link}`;
  }

  global.StakeModPolicy = {
    POLICY_CATEGORIES, VIOLATIONS, DURATION_OPTIONS, minutesToLabel, minutesToDurationString,
    getSuggestedMinutes, detectedReasonToViolations, categoriesForViolations,
    detectedReasonsToCategories, detectedReasonToCategory, countStrikesInCategory,
    historyDurationMinutes, getCategorySuggestion, getMuteSuggestion, buildMuteMessage, buildMuteChatText
  };
})(typeof window !== 'undefined' ? window : global);
