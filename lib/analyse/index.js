const {
  listChatLogFiles,
  filterFilesByRange,
  loadMessagesFromFiles,
  resolveRange
} = require('./load-chat-logs');
const { shouldIncludeMessage, analyseMessages, DEFAULTS } = require('./user-stats');
const dataFiles = require('../data-files');
const { getCalibrationMeta } = require('./calibration');

function loadMutedWarnedUsers(dir) {
  const { muted, warned } = dataFiles.loadMutedWarned(dir);
  const mutedSet = new Set();
  const warnedSet = new Set();
  for (const r of muted) {
    if (r.user) mutedSet.add(r.user.toLowerCase());
  }
  for (const r of warned) {
    if (r.user) warnedSet.add(r.user.toLowerCase());
  }
  return { mutedSet, warnedSet };
}

function enrichWithModContext(rows, { mutedSet, warnedSet, duplicateIpUsers, veri2Set }) {
  return rows.map((r) => {
    const key = r.username.toLowerCase();
    return {
      ...r,
      mutedLocal: mutedSet.has(key),
      warnedLocal: warnedSet.has(key),
      veri2: veri2Set?.has(key) || false,
      duplicateIpWith: duplicateIpUsers?.get(key) || null
    };
  });
}

function buildDuplicateIpUserMap(dir) {
  const groups = dataFiles.findDuplicateIps(dir);
  const map = new Map();
  for (const g of groups) {
    for (const u of g.users) {
      const others = g.users.filter((x) => x.toLowerCase() !== u.toLowerCase());
      if (others.length) map.set(u.toLowerCase(), others);
    }
  }
  return map;
}

function buildUserIndex(rows) {
  const index = {};
  for (const r of rows) {
    index[r.username.toLowerCase()] = r;
  }
  return index;
}

function runAnalyse(dir, options = {}) {
  if (!dir) return { ok: false, error: 'no_data_dir' };

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const report = (phase, percent, detail) => {
    if (onProgress) onProgress({ phase, percent, detail });
  };

  const preset = options.preset || 'today';
  report('init', 2, 'Dateien suchen…');
  const allFiles = listChatLogFiles(dir);
  if (!allFiles.length) {
    return {
      ok: true,
      empty: true,
      preset,
      message: 'Keine Chat-CSVs in Datengrube/ gefunden.'
    };
  }

  const range = resolveRange(preset);
  const selected = filterFilesByRange(allFiles, range.fromMs, range.toMs);

  if (!selected.length) {
    const hint =
      preset === 'today'
        ? 'Keine Chat-CSV für heute in Datengrube/.'
        : 'Keine Chat-CSVs für den aktuellen Kalendermonat in Datengrube/.';
    return {
      ok: true,
      empty: true,
      preset,
      range: {
        fromMs: range.fromMs,
        toMs: range.toMs,
        from: new Date(range.fromMs).toLocaleDateString('de-DE'),
        to: new Date(range.toMs).toLocaleDateString('de-DE')
      },
      rangeLabel: range.label,
      files: allFiles.map((f) => f.basename),
      message: hint
    };
  }

  const { messages: rawMessages, fileStats } = loadMessagesFromFiles(selected, {
    fromMs: range.fromMs,
    toMs: range.toMs,
    onFileLoaded: (done, total, stat, msgCount) => {
      const pct = 5 + Math.round((done / total) * 60);
      report(
        'load',
        pct,
        `CSV ${done}/${total}: ${stat.file} (${msgCount.toLocaleString('de-DE')} Msgs)`
      );
    }
  });

  report('analyze', 72, `${rawMessages.length.toLocaleString('de-DE')} Nachrichten auswerten…`);

  const { mutedSet, warnedSet } = loadMutedWarnedUsers(dir);
  const veri2Set = new Set(dataFiles.loadVeri2(dir));

  const statsOpts = {
    minMessagesFriendlist: options.minMessagesFriendlist ?? DEFAULTS.minMessagesFriendlist,
    minMessagesEnforcement: options.minMessagesEnforcement ?? DEFAULTS.minMessagesEnforcement,
    minActiveDays: options.minActiveDays ?? DEFAULTS.minActiveDays,
    maxOneWordRatio: options.maxOneWordRatio ?? DEFAULTS.maxOneWordRatio,
    maxDuplicateRatio: options.maxDuplicateRatio ?? DEFAULTS.maxDuplicateRatio,
    mutedSet,
    warnedSet,
    veri2Set
  };

  const result = analyseMessages(rawMessages, statsOpts);
  report('enrich', 88, 'Listen & Kontext aufbauen…');
  const dupIpMap = buildDuplicateIpUserMap(dir);

  const enrich = (list) =>
    enrichWithModContext(list, { mutedSet, warnedSet, duplicateIpUsers: dupIpMap, veri2Set });

  const friendlist = enrich(result.friendlist);
  const enforcement = enrich(result.enforcement);
  const enforcementBuckets = {
    bot: enrich(result.enforcementBuckets.bot),
    spam: enrich(result.enforcementBuckets.spam),
    toxic: enrich(result.enforcementBuckets.toxic),
    begging: enrich(result.enforcementBuckets.begging),
    other: enrich(result.enforcementBuckets.other)
  };
  const userIndex = buildUserIndex(
    enrich(result.rows.filter((r) => r.totalMessages >= DEFAULTS.minMessagesEnforcement))
  );

  report('done', 100, 'Fertig');

  return {
    ok: true,
    preset,
    rangeLabel: range.label || preset,
    range: {
      fromMs: range.fromMs,
      toMs: range.toMs,
      from: new Date(range.fromMs).toLocaleDateString('de-DE'),
      to: new Date(range.toMs).toLocaleDateString('de-DE')
    },
    files: selected.map((f) => f.basename),
    fileStats,
    messagesRaw: rawMessages.length,
    messagesUsed: result.messagesUsed,
    users: result.users,
    userIndex,
    friendlist,
    enforcement,
    enforcementBuckets,
    calibration: getCalibrationMeta()
  };
}

module.exports = {
  runAnalyse,
  listChatLogFiles,
  DEFAULTS
};
