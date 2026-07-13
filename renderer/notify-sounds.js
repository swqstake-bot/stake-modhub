(function (global) {
  'use strict';

  const BUILTIN_LABELS = {
    1: '1 — Kurz',
    2: '2 — Doppelt',
    3: '3 — Tief',
    4: '4 — Melodie',
    5: '5 — Alarm'
  };

  let audioCtx = null;
  const customCache = new Map();

  function parseSoundId(raw) {
    const s = String(raw ?? '1').trim();
    if (s.startsWith('custom:')) return { type: 'custom', id: s.slice(7) };
    if (s.startsWith('builtin:')) return { type: 'builtin', id: Number(s.slice(8)) || 1 };
    const n = Number(s);
    if (Number.isFinite(n) && n >= 1 && n <= 5) return { type: 'builtin', id: n };
    if (s.startsWith('snd-')) return { type: 'custom', id: s };
    return { type: 'builtin', id: 1 };
  }

  function formatSoundId(parsed) {
    if (!parsed) return '1';
    if (parsed.type === 'custom') return `custom:${parsed.id}`;
    return String(Math.min(5, Math.max(1, Number(parsed.id) || 1)));
  }

  function buildSoundOptions(customSounds = []) {
    const opts = Object.entries(BUILTIN_LABELS).map(([v, label]) => ({
      value: v,
      label
    }));
    for (const s of customSounds || []) {
      if (!s?.id) continue;
      opts.push({ value: `custom:${s.id}`, label: `★ ${s.label || s.filename || s.id}` });
    }
    return opts;
  }

  function fillSoundSelect(el, customSounds, selected) {
    if (!el) return;
    const opts = buildSoundOptions(customSounds);
    const sel = formatSoundId(parseSoundId(selected));
    el.innerHTML = opts.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
    const hit = opts.find((o) => o.value === sel);
    el.value = hit ? hit.value : opts[0]?.value || '1';
  }

  async function ensureAudioCtx() {
    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function playBuiltin(id) {
    const n = Math.min(5, Math.max(1, Number(id) || 1));
    const playTone = (ctx, freq, start, dur, type = 'sine', gain = 0.12) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.05);
    };
    const t0 = audioCtx.currentTime + 0.02;
    if (n === 1) playTone(audioCtx, 880, t0, 0.12);
    else if (n === 2) {
      playTone(audioCtx, 740, t0, 0.1);
      playTone(audioCtx, 740, t0 + 0.16, 0.1);
    } else if (n === 3) playTone(audioCtx, 440, t0, 0.22, 'triangle', 0.14);
    else if (n === 4) {
      playTone(audioCtx, 523, t0, 0.1);
      playTone(audioCtx, 659, t0 + 0.12, 0.1);
      playTone(audioCtx, 784, t0 + 0.24, 0.14);
    } else {
      playTone(audioCtx, 980, t0, 0.08, 'square', 0.08);
      playTone(audioCtx, 980, t0 + 0.12, 0.08, 'square', 0.08);
      playTone(audioCtx, 980, t0 + 0.24, 0.08, 'square', 0.08);
    }
  }

  async function playCustom(id, modHub) {
    if (!modHub?.notifySoundData) return false;
    let dataUrl = customCache.get(id);
    if (!dataUrl) {
      const res = await modHub.notifySoundData(id);
      if (!res?.ok || !res.dataUrl) return false;
      dataUrl = res.dataUrl;
      customCache.set(id, dataUrl);
    }
    const audio = new Audio(dataUrl);
    audio.volume = 0.9;
    await audio.play();
    return true;
  }

  async function playNotifySound(soundId, modHub) {
    const parsed = parseSoundId(soundId);
    try {
      if (parsed.type === 'custom') {
        return playCustom(parsed.id, modHub);
      }
      const ctx = await ensureAudioCtx();
      if (!ctx) return false;
      playBuiltin(parsed.id);
      return true;
    } catch (_) {
      return false;
    }
  }

  function invalidateCustomCache(id) {
    if (id) customCache.delete(id);
    else customCache.clear();
  }

  global.NotifySounds = {
    BUILTIN_LABELS,
    parseSoundId,
    formatSoundId,
    buildSoundOptions,
    fillSoundSelect,
    playNotifySound,
    invalidateCustomCache
  };
})(typeof window !== 'undefined' ? window : global);
