(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.MuteDuration = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function formatMuteDuration(createdAt, expireAt) {
    if (!expireAt) return 'unbegrenzt';
    const start = new Date(createdAt);
    const end = new Date(expireAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return '—';
    let ms = end.getTime() - start.getTime();
    if (ms <= 0) return '< 1 Min';
    const days = Math.floor(ms / 86400000);
    ms %= 86400000;
    const hours = Math.floor(ms / 3600000);
    ms %= 3600000;
    const minutes = Math.floor(ms / 60000);
    const parts = [];
    if (days) parts.push(`${days} ${days === 1 ? 'Tag' : 'Tage'}`);
    if (hours) parts.push(`${hours} ${hours === 1 ? 'Stunde' : 'Stunden'}`);
    if (minutes) parts.push(`${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`);
    return parts.length ? parts.join(' ') : '< 1 Min';
  }

  return { formatMuteDuration };
});
