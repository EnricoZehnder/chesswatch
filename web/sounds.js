// Move sounds. The samples in sounds/ are synthesized for Chesswatch
// (a modelled wooden piece on a wooden board), so they're free to use.

const NAMES = ['move', 'capture', 'castle', 'check', 'promote', 'start', 'end'];

let ctx = null;
const buffers = {};
let loading = null;
let enabled = true;
const listeners = new Set();

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    ctx.onstatechange = notify;
  }
  return ctx;
}

function notify() {
  for (const fn of listeners) fn(isLocked());
}

async function load() {
  const c = getCtx();
  if (!c) return;
  loading ??= Promise.all(
    NAMES.map(async (n) => {
      try {
        const res = await fetch(new URL(`sounds/${n}.wav`, location.href));
        const data = await res.arrayBuffer();
        buffers[n] = await new Promise((ok, fail) => c.decodeAudioData(data, ok, fail));
      } catch {
        /* a missing sound just stays silent */
      }
    }),
  );
  return loading;
}

// Browsers only allow audio after the first click or key press.
export function isLocked() {
  return enabled && (!ctx || ctx.state !== 'running');
}

export function onLockChange(fn) {
  listeners.add(fn);
}

export function unlock() {
  const c = getCtx();
  if (!c) return;
  load();
  if (c.state !== 'running') c.resume().then(notify, notify);
}

export function setEnabled(on) {
  enabled = on;
  if (on) unlock();
  notify();
}

export function play(name) {
  if (!enabled || !ctx || ctx.state !== 'running' || !buffers[name]) return;
  const src = ctx.createBufferSource();
  src.buffer = buffers[name];
  const gain = ctx.createGain();
  gain.gain.value = name === 'start' || name === 'end' ? 0.7 : 1;
  src.connect(gain).connect(ctx.destination);
  src.start();
}

export function soundForMove(move, givesCheck) {
  if (givesCheck) return 'check';
  if (move.promotion) return 'promote';
  if (move.flags.includes('k') || move.flags.includes('q')) return 'castle';
  if (move.captured) return 'capture';
  return 'move';
}

export function init() {
  // Try right away (works in the desktop app); otherwise wait for a gesture.
  unlock();
  const kick = () => unlock();
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, kick, { capture: true, passive: true });
  }
}
