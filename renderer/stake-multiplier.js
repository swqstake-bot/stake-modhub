(function (global) {
  function normalizeStakeMultiplier(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(n * 100 + 1e-9) / 100;
  }

  function formatStakeMultiplier(value) {
    return normalizeStakeMultiplier(value).toFixed(2);
  }

  global.StakeMultiplier = { normalizeStakeMultiplier, formatStakeMultiplier };
})(window);
