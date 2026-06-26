const { normalizeText, isCommunityShort, collectDuplicateStats } = require('./dedupe');
const { analyseBotSignals, countFloodBursts } = require('./bot-signals');
const { buildUserRuleStats } = require('./rule-hits');
const { collectLowQualityStats, lowQualityRiskBonus, isGzDominantChatter } = require('./low-quality-spam');
const { collectToxicStats, toxicRiskBonus } = require('./toxic-heuristics');
const { collectBeggingStats, beggingRiskBonus } = require('./begging-heuristics');
const {
  detectCoordinatedSpam,
  coordinatedRiskBonus,
  isCoordinatedSpam
} = require('./coordinated-spam');
const { collectFirstDayStats, firstDayRiskBonus, isFirstDaySuspicious } = require('./first-day');
const { deriveEnforcementSignals } = require('./calibration');
const { pickSampleMessages } = require('./sample-messages');
const {
  FRIENDLIST_DEFAULTS,
  scoreFriendlistMatch,
  passesFriendlistFilter
} = require('./friendlist-score');

const DEFAULTS = {
  minMessagesFriendlist: FRIENDLIST_DEFAULTS.minMessages,
  minMessagesEnforcement: 8,
  minActiveDays: FRIENDLIST_DEFAULTS.minActiveDays,
  maxOneWordRatio: FRIENDLIST_DEFAULTS.maxOneWordRatio,
  maxDuplicateRatio: FRIENDLIST_DEFAULTS.maxDuplicateRatio
};

/** Mod-/System-Accounts nicht für Friendlist */
const FRIENDLIST_EXCLUDE = new Set([
  'swaqline',
  'rain-bot',
  'eddie',
  'droz',
  'kartenstapel',
  'wheelyboy321'
]);

/** Mod-Team nicht in Enforcement-Liste (aktiver Chat ≠ Verdacht) */
const ENFORCEMENT_EXCLUDE = new Set([
  'swaqline',
  'droz',
  'kartenstapel',
  'wheelyboy321',
  'rain-bot',
  'eddie'
]);

/** Aktive Unterhaltung: viele @-Antworten, normale Satzlänge, wenig LQ/Kurztext. */
function isConversationalUser({ replyRatio, avgWords, oneWordRatio, lowQualityRatio }) {
  return (
    replyRatio >= 0.22 &&
    avgWords >= 3.8 &&
    oneWordRatio < 0.22 &&
    lowQualityRatio < 0.22
  );
}

/** Flood nur relevant wenn zusätzlich Spam-Signale — nicht bei normalem Chat-Tempo. */
function isSpamFlood(floodBursts, lq, oneWordRatio, dup, conversational) {
  if (conversational || floodBursts < 4) return false;
  return (
    lq.lowQualityRatio >= 0.35 ||
    oneWordRatio >= 0.4 ||
    dup.duplicateRatio >= 0.22 ||
    dup.maxSameMessageCount >= 10
  );
}

function wordCount(text) {
  const t = normalizeText(text);
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function isOneWordMessage(text) {
  return wordCount(text) <= 1;
}

function isShortMessage(text, maxChars = 12) {
  return normalizeText(text).length <= maxChars;
}

function shouldIncludeMessage(m) {
  const msg = normalizeText(m.message);
  if (!msg || !m.username) return false;
  if (/^\[TIP\]/i.test(msg) || /^\[BOT\]/i.test(msg)) return false;
  if (/rain-bot/i.test(msg) || /Erhaltener Regen/i.test(msg)) return false;
  if (/erhalten.*regen/i.test(msg) && /rain-bot/i.test(msg)) return false;
  if (/^📜\s*Chatregeln:/i.test(msg)) return false;
  if (/^Einzahlung bestätigt\./i.test(msg)) return false;
  if (/^Sie haben\s+.+\s+von\s+@/i.test(msg)) return false;
  return true;
}

function dayKey(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildChips(row) {
  const chips = [];
  if (row.repeatOffender) {
    chips.push({
      id: 'repeat',
      label: row.mutedLocal ? 'Wiederholung (Mute)' : 'Wiederholung (Warn)',
      severity: 'high'
    });
  }
  if (row.coordinatedHits >= 1 && row.coordStrong) {
    chips.push({
      id: 'coord',
      label: `Multi×${row.coordinatedHits}${row.coordPartners?.length ? ` (${row.coordPartners.slice(0, 2).join(', ')})` : ''}`,
      severity: 'high'
    });
  }
  if (row.firstDaySuspicious) {
    chips.push({ id: 'firstday', label: `Ersttag ${row.firstDayMessages} Msgs`, severity: 'med' });
  }
  if (row.botLevel) chips.push({ id: 'bot', label: `Bot ${row.botLevel}`, severity: 'high' });
  if (row.beggingHits >= 2 || row.beggingRatio >= 0.05) {
    chips.push({ id: 'beg', label: `Bettel ${Math.round((row.beggingRatio || 0) * 100)}%`, severity: 'high' });
  }
  if (row.lowQualityRatio >= 0.35) {
    chips.push({ id: 'lq', label: `LQ ${Math.round(row.lowQualityRatio * 100)}%`, severity: 'high' });
  }
  if ((row.gzBustRatio || 0) >= 0.08) {
    chips.push({
      id: 'gzb',
      label: `GZ ${Math.round(row.gzBustRatio * 100)}%`,
      severity: row.gzBustRatio >= 0.2 ? 'high' : 'med'
    });
  }
  if (row.maxGzSame >= 4 && (row.gzBustRatio || 0) >= 0.1) {
    chips.push({ id: 'gz', label: `gz×${row.maxGzSame}`, severity: 'med' });
  }
  if (
    isGzDominantChatter(
      { gzBustRatio: row.gzBustRatio, gzLines: row.gzLines, maxGzSame: row.maxGzSame },
      row.totalMessages,
      row.oneWordRatio,
      row.avgWordsPerMessage
    )
  ) {
    chips.push({ id: 'gzonly', label: 'nur GZ/LQ', severity: 'high' });
  }
  if (row.toxicRatio >= 0.06 || (row.toxicHits >= 3 && row.toxicRatio >= 0.03)) {
    chips.push({ id: 'toxic', label: `Toxic ${Math.round(row.toxicRatio * 100)}%`, severity: 'high' });
  }
  if (row.duplicateRatio >= 0.25) chips.push({ id: 'dupl', label: `Dupl ${Math.round(row.duplicateRatio * 100)}%`, severity: 'med' });
  if (row.oneWordRatio >= 0.5) chips.push({ id: 'kurz', label: `Kurz ${Math.round(row.oneWordRatio * 100)}%`, severity: 'med' });
  if (row.spamFlood) chips.push({ id: 'flood', label: `Flood×${row.floodBursts}`, severity: 'high' });
  if (row.topCategoryLabel && row.enforcementTier === 'review') {
    chips.push({ id: 'rule', label: row.topCategoryLabel, severity: 'high' });
  }
  if (row.capsTriggers >= 2) chips.push({ id: 'caps', label: 'Caps', severity: 'med' });
  return chips.slice(0, 6);
}

function buildUserRows(messages, ruleRowsByUser, opts = {}, coordByUser = new Map()) {
  const o = { ...DEFAULTS, ...opts };
  const byUser = new Map();

  for (const m of messages) {
    const u = m.username;
    if (!byUser.has(u)) {
      byUser.set(u, {
        username: u,
        messages: [],
        totalMessages: 0,
        oneWordMessages: 0,
        shortMessages: 0,
        communityShortMessages: 0,
        replyMessages: 0,
        activeDays: new Set(),
        totalWords: 0
      });
    }
    const st = byUser.get(u);
    st.messages.push(m);
    st.totalMessages++;
    if (isOneWordMessage(m.message)) st.oneWordMessages++;
    if (isShortMessage(m.message)) st.shortMessages++;
    if (isCommunityShort(m.message)) st.communityShortMessages++;
    if (/@[\w\u00C0-\u024f]{2,}/i.test(normalizeText(m.message))) st.replyMessages++;
    st.totalWords += wordCount(m.message);
    const dk = dayKey(m.timestamp);
    if (dk) st.activeDays.add(dk);
  }

  const ruleMap = new Map((ruleRowsByUser || []).map((r) => [r.username, r]));
  const mutedSet = opts.mutedSet || new Set();
  const warnedSet = opts.warnedSet || new Set();
  const rows = [];

  for (const st of byUser.values()) {
    const userKey = st.username.toLowerCase();
    const dup = collectDuplicateStats(st.messages);
    const lq = collectLowQualityStats(st.messages);
    const toxic = collectToxicStats(st.messages);
    const begging = collectBeggingStats(st.messages);
    const firstDay = collectFirstDayStats(st.messages);
    const coord = coordByUser.get(userKey) || {
      coordinatedHits: 0,
      partnerCount: 0,
      partners: [],
      sampleTexts: []
    };
    const bot = analyseBotSignals(st.messages);
    const floodBursts = countFloodBursts(st.messages);
    const rule = ruleMap.get(st.username) || {};
    const oneWordRatio = st.totalMessages ? st.oneWordMessages / st.totalMessages : 0;
    const shortRatio = st.totalMessages ? st.shortMessages / st.totalMessages : 0;
    const communityShortRatio = st.totalMessages ? st.communityShortMessages / st.totalMessages : 0;
    const avgWords = st.totalMessages ? st.totalWords / st.totalMessages : 0;
    const activeDays = st.activeDays.size;
    const replyRatio = st.totalMessages ? st.replyMessages / st.totalMessages : 0;
    const uniqueRatio = st.totalMessages ? dup.uniqueTexts / st.totalMessages : 0;
    const conversational = isConversationalUser({
      replyRatio,
      avgWords,
      oneWordRatio,
      lowQualityRatio: lq.lowQualityRatio
    });
    const spamFlood = isSpamFlood(floodBursts, lq, oneWordRatio, dup, conversational);

    const substance = Math.max(0.5, avgWords);
    const dupPenalty = 1 / (1 + dup.duplicateRatio * 3 + (dup.maxSameMessageCount > 4 ? 0.5 : 0));
    const activity = Math.log1p(st.totalMessages);
    const communityNorm = Math.max(0.15, 1 - Math.max(0, communityShortRatio - 0.35) * 1.2);
    const antiSpam = (1 - oneWordRatio * 0.75) * communityNorm;
    const regularity = Math.min(1, activeDays / 12);
    const engagement = Math.min(1, replyRatio * 3);
    const variety = Math.min(1, uniqueRatio * 2);

    let qualityScore =
      (regularity * 30 +
        Math.min(1, Math.log1p(substance) / 2) * 25 +
        variety * 20 +
        engagement * 15 +
        Math.min(1, activity / Math.log1p(400)) * 10) *
      antiSpam *
      dupPenalty;

    const concern = rule.concernScore || 0;
    let riskScore =
      dup.duplicateRatio * 35 +
      oneWordRatio * 22 +
      shortRatio * 12 +
      (conversational ? floodBursts * 1.5 : floodBursts * 3) +
      bot.botScore * 0.55 +
      Math.min(28, concern * 12) +
      (dup.maxSameMessageCount >= 6 ? 12 : dup.maxSameMessageCount >= 4 ? 5 : 0);

    if (rule.byCategory?.begging) riskScore += Math.min(15, rule.byCategory.begging * 4);

    riskScore += lowQualityRiskBonus(lq, st.totalMessages, oneWordRatio);
    riskScore += toxicRiskBonus(toxic, st.totalMessages);
    riskScore += beggingRiskBonus(begging, st.totalMessages);
    riskScore += coordinatedRiskBonus(coord);
    riskScore += firstDayRiskBonus(firstDay, activeDays, st.totalMessages);

    const mutedLocal = mutedSet.has(userKey);
    const warnedLocal = warnedSet.has(userKey);
    const repeatOffender = mutedLocal || warnedLocal;
    if (mutedLocal) riskScore += 18;
    else if (warnedLocal) riskScore += 10;

    riskScore = Math.min(100, Math.round(riskScore * 10) / 10);
    qualityScore = Math.min(100, Math.round(qualityScore * 10) / 10);

    let enforcementTier = 'review';
    const dupSpam = dup.duplicateRatio >= 0.28 || dup.maxSameMessageCount >= 5;
    const botLike =
      (bot.botLevel === 'hoch' && dupSpam) ||
      (bot.botLevel === 'mittel' && dup.duplicateRatio >= 0.4 && dup.maxSameMessageCount >= 4);

    if (botLike) {
      enforcementTier = 'bot';
    }

    const coordStrong = isCoordinatedSpam(coord, {
      maxGzSame: lq.maxGzSame,
      lowQualityRatio: lq.lowQualityRatio,
      oneWordRatio
    });
    const firstDayFlag = isFirstDaySuspicious(firstDay, activeDays, st.totalMessages);

    const sampleMessages = pickSampleMessages(st.messages, {
      enforcementTier,
      topRepeatText: dup.topRepeatText,
      coordSampleTexts: coord.sampleTexts
    });

    const row = {
      username: st.username,
      totalMessages: st.totalMessages,
      activeDays,
      oneWordRatio,
      shortRatio,
      duplicateRatio: dup.duplicateRatio,
      maxSameMessageCount: dup.maxSameMessageCount,
      lowQualityRatio: lq.lowQualityRatio,
      gzBustRatio: lq.gzBustRatio,
      maxGzSame: lq.maxGzSame,
      gzLines: lq.gzLines,
      emojiFloodHits: lq.emojiFloodHits,
      toxicRatio: toxic.toxicRatio,
      toxicHits: toxic.toxicHits,
      toxicTypes: toxic.toxicTypes,
      beggingHits: begging.beggingHits,
      beggingRatio: begging.beggingRatio,
      beggingTypes: begging.beggingTypes,
      coordinatedHits: coord.coordinatedHits,
      coordStrongHits: coord.strongHits || 0,
      coordStrong,
      coordPartnerCount: coord.partnerCount,
      coordPartners: coord.partners,
      coordSampleTexts: coord.sampleTexts,
      firstDayKey: firstDay.firstDayKey,
      firstDayMessages: firstDay.firstDayMessages,
      firstDayShare: firstDay.firstDayShare,
      firstDayLowQualityRatio: firstDay.firstDayLowQualityRatio,
      firstDaySuspicious: firstDayFlag,
      repeatOffender,
      mutedLocal,
      warnedLocal,
      topRepeatText: dup.topRepeatText,
      avgWordsPerMessage: Math.round(avgWords * 100) / 100,
      qualityScore,
      riskScore,
      botScore: bot.botScore,
      botLevel: bot.botLevel,
      intervalMedianSec: bot.intervalMedianSec,
      floodBursts,
      spamFlood,
      conversational,
      replyRatio,
      concernScore: concern,
      topCategoryId: rule.topCategoryId || null,
      topCategoryLabel: rule.topCategoryLabel || null,
      byCategory: rule.byCategory || {},
      capsTriggers: rule.capsTriggers || 0,
      enforcementTier,
      chips: [],
      sampleMessages
    };

    const calibrated = deriveEnforcementSignals(row);
    Object.assign(row, calibrated);
    row.friendMatchScore = scoreFriendlistMatch(row);
    row.chips = buildChips(row);
    rows.push(row);
  }

  return rows;
}

function rankFriendlist(rows, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const filterOpts = {
    ...FRIENDLIST_DEFAULTS,
    excludeSet: FRIENDLIST_EXCLUDE,
    mutedSet: o.mutedSet || new Set(),
    warnedSet: o.warnedSet || new Set(),
    minMessages: o.minMessagesFriendlist ?? FRIENDLIST_DEFAULTS.minMessages,
    minActiveDays: o.minActiveDays ?? FRIENDLIST_DEFAULTS.minActiveDays
  };
  return rows
    .filter((r) => passesFriendlistFilter(r, filterOpts))
    .sort(
      (a, b) =>
        (b.friendMatchScore || 0) - (a.friendMatchScore || 0) ||
        b.qualityScore - a.qualityScore ||
        b.totalMessages - a.totalMessages
    );
}

function rankEnforcement(rows, opts = {}) {
  const min = opts.minMessagesEnforcement ?? DEFAULTS.minMessagesEnforcement;
  const tierOrder = { bot: 0, spam: 1, toxic: 2, begging: 3, coord: 4, flood: 5, review: 6 };
  const sorted = rows
    .filter((r) => {
      if (ENFORCEMENT_EXCLUDE.has(r.username.toLowerCase())) return false;
      return (
        r.totalMessages >= min &&
        ((r.muteMatchScore || 0) >= 28 ||
          ['toxic', 'spam', 'bot', 'flood', 'begging', 'coord'].includes(r.enforcementTier) ||
          r.repeatOffender)
      );
    })
    .sort((a, b) => {
      if (a.mutedLocal !== b.mutedLocal) return a.mutedLocal ? 1 : -1;
      if (a.repeatOffender !== b.repeatOffender) return a.repeatOffender ? -1 : 1;
      return (
        (b.muteMatchScore || 0) - (a.muteMatchScore || 0) ||
        (tierOrder[a.enforcementTier] ?? 9) - (tierOrder[b.enforcementTier] ?? 9) ||
        b.riskScore - a.riskScore ||
        b.totalMessages - a.totalMessages
      );
    });

  const primary = sorted.slice(0, 48);
  const seen = new Set(primary.map((r) => r.username.toLowerCase()));
  const pinned = sorted.filter(
    (r) =>
      !seen.has(r.username.toLowerCase()) &&
      r.enforcementTier !== 'spam' &&
      (r.muteMatchScore || 0) >= 40
  );
  return [...primary, ...pinned].slice(0, 60);
}

const ENFORCEMENT_BUCKET_LIMIT = 30;

function enforcementBucketKey(row) {
  const tier = row.enforcementTier || 'review';
  if (tier === 'bot') return 'bot';
  if (tier === 'toxic') return 'toxic';
  if (tier === 'spam' || tier === 'flood') return 'spam';
  if (tier === 'begging') return 'begging';
  if (tier === 'review' && row.primarySignal === 'bettel?') return 'begging';
  return 'other';
}

function passesEnforcementCandidate(row, opts = {}) {
  if (ENFORCEMENT_EXCLUDE.has(row.username.toLowerCase())) return false;
  const min = opts.minMessagesEnforcement ?? DEFAULTS.minMessagesEnforcement;
  return (
    row.totalMessages >= min &&
    ((row.muteMatchScore || 0) >= 28 ||
      ['toxic', 'spam', 'bot', 'flood', 'begging', 'coord'].includes(row.enforcementTier) ||
      row.repeatOffender)
  );
}

function rankEnforcementBuckets(rows, opts = {}) {
  const buckets = { bot: [], spam: [], toxic: [], begging: [], other: [] };
  for (const r of rows) {
    if (!passesEnforcementCandidate(r, opts)) continue;
    buckets[enforcementBucketKey(r)].push(r);
  }
  const muteFirst = (a, b) => {
    if (a.mutedLocal !== b.mutedLocal) return a.mutedLocal ? 1 : -1;
    if (a.repeatOffender !== b.repeatOffender) return a.repeatOffender ? -1 : 1;
    return 0;
  };
  buckets.bot.sort(
    (a, b) =>
      muteFirst(a, b) ||
      (b.riskScore || 0) - (a.riskScore || 0) ||
      (b.muteMatchScore || 0) - (a.muteMatchScore || 0)
  );
  buckets.spam.sort(
    (a, b) =>
      muteFirst(a, b) ||
      (b.spamMatch || 0) - (a.spamMatch || 0) ||
      (b.gzBustRatio || 0) - (a.gzBustRatio || 0) ||
      (b.lowQualityRatio || 0) - (a.lowQualityRatio || 0)
  );
  buckets.toxic.sort(
    (a, b) =>
      muteFirst(a, b) ||
      (b.toxicMatch || 0) - (a.toxicMatch || 0) ||
      (b.toxicRatio || 0) - (a.toxicRatio || 0)
  );
  buckets.begging.sort(
    (a, b) =>
      muteFirst(a, b) ||
      (b.beggingMatch || 0) - (a.beggingMatch || 0) ||
      (b.beggingRatio || 0) - (a.beggingRatio || 0) ||
      (b.beggingHits || 0) - (a.beggingHits || 0)
  );
  buckets.other.sort(
    (a, b) =>
      muteFirst(a, b) ||
      (b.muteMatchScore || 0) - (a.muteMatchScore || 0) ||
      (b.riskScore || 0) - (a.riskScore || 0)
  );
  for (const key of Object.keys(buckets)) {
    buckets[key] = buckets[key].slice(0, ENFORCEMENT_BUCKET_LIMIT);
  }
  return buckets;
}

function analyseMessages(messages, opts = {}) {
  const filtered = messages.filter(shouldIncludeMessage);
  const ruleRows = buildUserRuleStats(filtered);
  const coordByUser = detectCoordinatedSpam(filtered);
  const rows = buildUserRows(filtered, ruleRows, opts, coordByUser);
  const enrichedRows = rows.map((r) => ({
    ...r,
    mutedLocal: r.mutedLocal || opts.mutedSet?.has(r.username.toLowerCase()) || false,
    warnedLocal: r.warnedLocal || opts.warnedSet?.has(r.username.toLowerCase()) || false,
    repeatOffender:
      r.repeatOffender ||
      opts.mutedSet?.has(r.username.toLowerCase()) ||
      opts.warnedSet?.has(r.username.toLowerCase()) ||
      false
  }));
  return {
    messagesTotal: messages.length,
    messagesUsed: filtered.length,
    users: rows.length,
    rows: enrichedRows,
    friendlist: rankFriendlist(enrichedRows, opts).slice(0, 30),
    enforcement: rankEnforcement(enrichedRows, opts).slice(0, 60),
    enforcementBuckets: rankEnforcementBuckets(enrichedRows, opts)
  };
}

module.exports = {
  DEFAULTS,
  shouldIncludeMessage,
  analyseMessages,
  rankFriendlist,
  rankEnforcement,
  rankEnforcementBuckets,
  enforcementBucketKey
};
