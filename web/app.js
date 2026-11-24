import { Chess } from './vendor/chess.js';
import { Engine } from './engine.js';
import { OPENINGS } from './openings.js';

// ---------------------------------------------------------------- Constants

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';

const TIME_CONTROLS = {
  m100: { type: 'move', ms: 100, label: '0.1 s per move' },
  m300: { type: 'move', ms: 300, label: '0.3 s per move' },
  m1000: { type: 'move', ms: 1000, label: '1 s per move' },
  m3000: { type: 'move', ms: 3000, label: '3 s per move' },
  m10000: { type: 'move', ms: 10000, label: '10 s per move' },
  c60_0: { type: 'clock', base: 60_000, inc: 0, label: 'Bullet 1+0' },
  c180_2: { type: 'clock', base: 180_000, inc: 2000, label: 'Blitz 3+2' },
  c600_5: { type: 'clock', base: 600_000, inc: 5000, label: 'Rapid 10+5' },
};

const STRENGTHS = [
  ['max', 'Full strength'],
  ['3000', 'Elo 3000'],
  ['2700', 'Elo 2700'],
  ['2400', 'Elo 2400'],
  ['2100', 'Elo 2100'],
  ['1800', 'Elo 1800'],
  ['1500', 'Elo 1500'],
  ['1320', 'Elo 1320'],
];

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// ---------------------------------------------------------------- Helpers

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const other = (side) => (side === 'w' ? 'b' : 'w');

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('chesswatch:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('chesswatch:' + key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

function formatClock(ms) {
  ms = Math.max(0, ms);
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  if (ms < 20_000) return `${m}:${String(s).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatEval(ev) {
  if (!ev) return '–';
  if (ev.mate != null) {
    if (ev.mate === 0) return '#';
    return (ev.mate > 0 ? '#' : '#−') + Math.abs(ev.mate);
  }
  const v = ev.cp / 100;
  if (Math.abs(v) < 0.05) return '0.0';
  return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(v >= 10 || v <= -10 ? 0 : 1);
}

// White's winning chance in percent (Lichess formula)
function whiteWinPct(ev) {
  if (!ev) return 50;
  if (ev.mate != null) return ev.mate > 0 || (ev.mate === 0 && ev.matedSide === 'b') ? 100 : 0;
  const cp = Math.max(-1500, Math.min(1500, ev.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// Engine score (from the side to move) converted to White's point of view
function toWhitePov(info, side) {
  if (!info) return null;
  const sign = side === 'w' ? 1 : -1;
  if (info.mate != null) return { mate: info.mate * sign };
  return { cp: info.cp * sign };
}

function formatNps(nps) {
  if (!nps) return '–';
  if (nps >= 1e6) return (nps / 1e6).toFixed(2) + ' M';
  return Math.round(nps / 1000) + ' k';
}

function formatNodes(n) {
  if (!n) return '–';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' M';
  if (n >= 1e3) return Math.round(n / 1e3) + ' k';
  return String(n);
}

function pvToSan(fen, pv, max = 12) {
  const c = new Chess(fen);
  const out = [];
  for (const uci of pv.slice(0, max)) {
    const color = c.turn();
    const num = c.moveNumber();
    let mv;
    try {
      mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    if (color === 'w') out.push(`${num}. ${mv.san}`);
    else if (out.length === 0) out.push(`${num}… ${mv.san}`);
    else out.push(mv.san);
  }
  return out.join(' ');
}

function hasMatingMaterial(chess, side) {
  let minors = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== side) continue;
      if (sq.type === 'p' || sq.type === 'r' || sq.type === 'q') return true;
      if (sq.type === 'n' || sq.type === 'b') minors++;
    }
  }
  return minors >= 2;
}

// ---------------------------------------------------------------- State

const savedSettings = store.get('settings', {});

const state = {
  engines: { w: null, b: null },
  engineName: 'Stockfish 19',
  chess: new Chess(),
  plies: [], // { uci, san, from, to, flags, color, fen, book, eval, ms, check }
  opening: null,
  running: false,
  token: 0,
  over: null,
  tc: TIME_CONTROLS[savedSettings.tc] || TIME_CONTROLS.m1000,
  tcKey: TIME_CONTROLS[savedSettings.tc] ? savedSettings.tc : 'm1000',
  clock: { w: 0, b: 0 },
  thinking: null,
  live: null,
  viewPly: null, // null = live, -1 = start position, otherwise index into plies
  orientation: savedSettings.orientation === 'b' ? 'b' : 'w',
  strength: { w: savedSettings.strW || 'max', b: savedSettings.strB || 'max' },
  needsConfig: { w: true, b: true },
  autoplay: savedSettings.autoplay !== false,
  stepMode: !!savedSettings.stepMode,
  stepOnce: false,
  sound: !!savedSettings.sound,
  openingChoice: savedSettings.opening ?? 'random',
  tally: store.get('tally', { w: 0, d: 0, b: 0, games: [] }),
  ready: false,
  nextGameTimer: null,
  wakeLock: null,
};

function saveSettings() {
  store.set('settings', {
    tc: state.tcKey,
    orientation: state.orientation,
    strW: state.strength.w,
    strB: state.strength.b,
    autoplay: state.autoplay,
    stepMode: state.stepMode,
    sound: state.sound,
    opening: state.openingChoice,
  });
}

// ---------------------------------------------------------------- Board

const boardEl = $('board');
const squareEls = new Map();

function buildBoard() {
  boardEl.textContent = '';
  squareEls.clear();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const file = state.orientation === 'w' ? f : 7 - f;
      const rank = state.orientation === 'w' ? 7 - r : r;
      const sq = FILES[file] + (rank + 1);
      const el = document.createElement('div');
      el.className = 'sq ' + ((file + rank) % 2 === 0 ? 'dark' : 'light');
      el.dataset.sq = sq;
      el.setAttribute('role', 'gridcell');
      if (f === 0) {
        const c = document.createElement('span');
        c.className = 'coord rank';
        c.textContent = rank + 1;
        el.append(c);
      }
      if (r === 7) {
        const c = document.createElement('span');
        c.className = 'coord file';
        c.textContent = FILES[file];
        el.append(c);
      }
      boardEl.append(el);
      squareEls.set(sq, el);
    }
  }
}

function squareXY(sq) {
  const file = FILES.indexOf(sq[0]);
  const rank = +sq[1] - 1;
  return state.orientation === 'w' ? [file, 7 - rank] : [7 - file, rank];
}

function renderBoard(fen, lastMove, animate) {
  const c = new Chess(fen);
  const board = c.board();
  const checkSq = c.inCheck()
    ? board.flat().find((p) => p && p.type === 'k' && p.color === c.turn())?.square
    : null;

  const pieceAt = new Map();
  board.forEach((row, r) =>
    row.forEach((p, f) => {
      if (p) pieceAt.set(FILES[f] + (8 - r), p.color + p.type.toUpperCase());
    }),
  );

  for (const [sq, el] of squareEls) {
    const want = pieceAt.get(sq) || '';
    let pc = el.querySelector('.pc');
    if (want) {
      if (!pc) {
        pc = document.createElement('div');
        el.append(pc);
      }
      pc.className = 'pc ' + want;
      pc.style.transform = '';
      pc.style.transition = '';
    } else if (pc) {
      pc.remove();
    }
    el.classList.toggle('last', !!lastMove && (sq === lastMove.from || sq === lastMove.to));
    el.classList.toggle('check', sq === checkSq);
  }

  if (animate && lastMove && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const slides = [[lastMove.from, lastMove.to]];
    if (lastMove.flags?.includes('k')) {
      const r = lastMove.color === 'w' ? '1' : '8';
      slides.push(['h' + r, 'f' + r]);
    } else if (lastMove.flags?.includes('q')) {
      const r = lastMove.color === 'w' ? '1' : '8';
      slides.push(['a' + r, 'd' + r]);
    }
    for (const [from, to] of slides) {
      const pc = squareEls.get(to)?.querySelector('.pc');
      if (!pc) continue;
      const [fx, fy] = squareXY(from);
      const [tx, ty] = squareXY(to);
      pc.style.transition = 'none';
      pc.style.transform = `translate(${(fx - tx) * 100}%, ${(fy - ty) * 100}%)`;
      pc.getBoundingClientRect();
      pc.style.transition = `transform ${Math.min(180, Math.max(60, (state.tc.ms || 400) / 3))}ms ease-out`;
      pc.style.transform = '';
    }
  }
}

// ---------------------------------------------------------------- Rendering

function currentView() {
  const n = state.plies.length;
  const idx = state.viewPly == null ? n - 1 : state.viewPly;
  if (idx < 0) return { idx: -1, fen: START_FEN, ply: null };
  const ply = state.plies[idx];
  return { idx, fen: ply.fen, ply };
}

function displayedEval() {
  const view = currentView();
  if (state.viewPly == null) {
    if (state.over?.mateBy) return { mate: 0, matedSide: other(state.over.mateBy) };
    if (state.live?.ev) return state.live.ev;
  }
  return view.ply?.eval || null;
}

let lastRenderedPlies = -1;

function render({ animate = false } = {}) {
  const view = currentView();
  const lastMove = view.ply ? { from: view.ply.from, to: view.ply.to, flags: view.ply.flags, color: view.ply.color } : null;
  renderBoard(view.fen, lastMove, animate);
  renderEval();
  renderPlayers();
  renderMoves();
  renderGraph();
  renderOpening();
  renderStatus();
  renderResult();
  renderTally();
  $('reviewBar').hidden = state.viewPly == null;
  if (state.viewPly != null) {
    $('reviewText').textContent =
      state.viewPly < 0 ? 'Start position' : `Move ${Math.floor(state.viewPly / 2) + 1}${state.viewPly % 2 ? '…' : '.'} ${state.plies[state.viewPly].san}`;
  }
}

function renderEval() {
  const ev = displayedEval();
  const pct = whiteWinPct(ev);
  const fill = $('evalFill');
  fill.style.height = pct + '%';
  const bar = $('evalBar');
  bar.classList.toggle('flipped', state.orientation === 'b');
  const txt = formatEval(ev);
  $('evalNum').textContent = txt;
  $('evalNum').dataset.side = pct >= 50 ? 'w' : 'b';
  bar.setAttribute('aria-label', `Evaluation ${txt}`);
}

function materialDiff(fen) {
  const c = new Chess(fen);
  let diff = 0;
  for (const row of c.board()) for (const p of row) if (p) diff += (p.color === 'w' ? 1 : -1) * PIECE_VALUE[p.type];
  return diff;
}

function renderPlayers() {
  const view = currentView();
  const diff = materialDiff(view.fen);
  for (const side of ['w', 'b']) {
    const el = $(side === 'w' ? 'playerW' : 'playerB');
    el.style.order = side === state.orientation ? 3 : 1;
    el.querySelector('.pname').textContent = state.engineName;
    el.querySelector('.pstr').textContent = STRENGTHS.find(([v]) => v === state.strength[side])?.[1] || '';
    const adv = side === 'w' ? diff : -diff;
    el.querySelector('.pmat').textContent = adv > 0 ? `+${adv}` : '';
    const thinking = state.thinking?.side === side && state.viewPly == null;
    el.classList.toggle('thinking', thinking);
    el.classList.toggle('to-move', !state.over && state.chess.turn() === side);
    renderClock(side);
  }
}

function renderClock(side) {
  const el = $(side === 'w' ? 'playerW' : 'playerB');
  let ms = state.clock[side];
  if (state.thinking?.side === side) {
    const elapsed = performance.now() - state.thinking.start;
    ms = state.tc.type === 'clock' ? ms - elapsed : ms + elapsed;
  }
  const clockEl = el.querySelector('.ctime');
  clockEl.textContent = formatClock(ms);
  el.querySelector('.clabel').textContent = state.tc.type === 'clock' ? 'Remaining' : 'Used';
  el.classList.toggle('low', state.tc.type === 'clock' && ms < 10_000);
}

let tickerRunning = false;
function startTicker() {
  if (tickerRunning) return;
  tickerRunning = true;
  const tick = () => {
    if (!state.thinking) {
      tickerRunning = false;
      return;
    }
    renderClock(state.thinking.side);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderLive() {
  const live = state.live;
  const box = $('thinkBody');
  if (!live || !live.info) {
    $('thinkWho').textContent = state.running ? 'Engine starting…' : 'Waiting for the next move';
    $('thinkDepth').textContent = '–';
    $('thinkNodes').textContent = '–';
    $('thinkNps').textContent = '–';
    $('thinkEval').textContent = '–';
    $('thinkPv').textContent = '';
    box.dataset.side = '';
    return;
  }
  const { info, side, fen } = live;
  box.dataset.side = side;
  $('thinkWho').textContent = `${side === 'w' ? 'White' : 'Black'} ${state.thinking?.side === side ? 'is thinking' : 'has moved'}`;
  $('thinkDepth').textContent = info.depth >= 200 ? `${info.seldepth}` : `${info.depth}/${info.seldepth}`;
  $('thinkNodes').textContent = formatNodes(info.nodes);
  $('thinkNps').textContent = formatNps(info.nps);
  $('thinkEval').textContent = formatEval(live.ev);
  $('thinkPv').textContent = pvToSan(fen, info.pv);
  if (state.viewPly == null) renderEval();
}

function renderMoves() {
  const list = $('moveList');
  const n = state.plies.length;
  const active = currentView().idx;
  if (lastRenderedPlies !== n) {
    list.textContent = '';
    for (let i = 0; i < n; i += 2) {
      const row = document.createElement('li');
      const num = document.createElement('span');
      num.className = 'mnum';
      num.textContent = i / 2 + 1 + '.';
      row.append(num);
      for (const j of [i, i + 1]) {
        const p = state.plies[j];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mv';
        if (p) {
          b.textContent = p.san;
          b.dataset.ply = j;
          if (p.book) b.classList.add('book');
          b.title = p.book ? 'Opening book' : `${formatEval(p.eval)} · ${(p.ms / 1000).toFixed(1)} s`;
        } else {
          b.disabled = true;
          b.classList.add('empty');
        }
        row.append(b);
      }
      list.append(row);
    }
    lastRenderedPlies = n;
    if (state.viewPly == null) list.parentElement.scrollTop = list.parentElement.scrollHeight;
  }
  for (const b of list.querySelectorAll('.mv[data-ply]')) {
    b.classList.toggle('active', +b.dataset.ply === active);
  }
  if (state.over) {
    const r = document.createElement('li');
    r.className = 'mresult';
    r.textContent = `${state.over.result.replaceAll('1/2', '½')} · ${state.over.reason}`;
    list.querySelector('.mresult')?.remove();
    list.append(r);
  } else {
    list.querySelector('.mresult')?.remove();
  }
  $('moveCount').textContent = n ? `${Math.ceil(n / 2)} moves` : '';
}

function renderGraph() {
  const svg = $('graph');
  const W = 300;
  const H = 72;
  const plies = state.plies;
  const pts = [[0, H / 2]];
  const n = Math.max(plies.length, 40);
  plies.forEach((p, i) => {
    const pct = p.eval ? whiteWinPct(p.eval) : i > 0 ? (100 * (H - pts[pts.length - 1][1])) / H : 50;
    pts.push([((i + 1) / n) * W, H - (pct / 100) * H]);
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const area = `M0,${H / 2} L${line.replace(/ /g, ' L')} L${last[0].toFixed(1)},${H / 2} Z`;
  $('graphArea').setAttribute('d', area);
  $('graphLine').setAttribute('points', line);
  const active = currentView().idx;
  const cur = pts[active + 1] || last;
  $('graphDot').setAttribute('cx', cur[0]);
  $('graphDot').setAttribute('cy', cur[1]);
  $('graphDot').style.display = plies.length ? '' : 'none';
  svg.dataset.n = n;
}

function renderOpening() {
  const o = state.opening;
  $('openingEco').textContent = o ? o.eco : '—';
  $('openingName').textContent = o ? o.name : 'Start position';
}

function renderStatus() {
  const el = $('status');
  let s;
  let text;
  if (!state.ready) [s, text] = ['loading', 'Loading engine'];
  else if (state.over) [s, text] = ['over', 'Game over'];
  else if (state.running && state.stepOnce) [s, text] = ['running', 'Stockfish is moving'];
  else if (state.running) [s, text] = ['running', 'Live'];
  else if (state.stepMode) [s, text] = ['paused', 'Your call'];
  else [s, text] = ['paused', 'Paused'];
  el.dataset.state = s;
  el.querySelector('.stext').textContent = text;

  const btn = $('btnPlay');
  const step = $('btnStep');
  const side = state.chess.turn() === 'w' ? 'White' : 'Black';
  if (state.stepMode) {
    // Step mode: the main button allows exactly one engine move
    btn.textContent = state.over ? 'Next game' : state.running ? 'Stockfish is thinking…' : `Let ${side} move`;
    btn.disabled = !state.ready || state.running;
    btn.setAttribute('aria-pressed', 'false');
    step.hidden = true;
  } else {
    btn.textContent = state.running ? 'Pause' : state.over ? 'Next game' : state.plies.some((p) => !p.book) ? 'Resume' : 'Start';
    btn.disabled = !state.ready;
    btn.setAttribute('aria-pressed', String(state.running && !state.stepOnce));
    step.hidden = false;
    step.disabled = !state.ready || state.running || !!state.over;
    step.textContent = state.running && state.stepOnce ? 'Stockfish is thinking…' : 'Next move';
  }
}

function renderResult() {
  const el = $('result');
  if (!state.over || state.viewPly != null) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const r = state.over.result;
  $('resultScore').textContent = r === '1/2-1/2' ? '½ – ½' : r.replace('-', ' – ');
  $('resultWinner').textContent = r === '1-0' ? 'White wins' : r === '0-1' ? 'Black wins' : 'Draw';
  $('resultReason').textContent = state.over.reason;
  $('resultNext').textContent = state.nextGameTimer ? 'Next game starts in a moment' : '';
}

function renderTally() {
  const t = state.tally;
  $('tallyW').textContent = t.w;
  $('tallyD').textContent = t.d;
  $('tallyB').textContent = t.b;
  const total = t.w + t.d + t.b;
  const bar = $('tallyBar');
  bar.style.setProperty('--w', total ? (t.w / total) * 100 + '%' : '0%');
  bar.style.setProperty('--d', total ? (t.d / total) * 100 + '%' : '0%');
  bar.hidden = !total;
  const list = $('gameLog');
  list.textContent = '';
  for (const g of t.games.slice(0, 8)) {
    const li = document.createElement('li');
    const res = document.createElement('span');
    res.className = 'gres';
    res.dataset.r = g.result;
    res.textContent = g.result === '1/2-1/2' ? '½–½' : g.result.replace('-', '–');
    const txt = document.createElement('span');
    txt.className = 'gtxt';
    txt.textContent = `${g.opening} · ${g.reason} · ${g.moves} moves`;
    li.append(res, txt);
    list.append(li);
  }
  $('gameLogEmpty').hidden = t.games.length > 0;
}

// ---------------------------------------------------------------- Sound

let audioCtx = null;
function ensureAudio() {
  if (!state.sound || audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    audioCtx = null;
  }
}

function playMoveSound(capture) {
  if (!state.sound || !audioCtx) return;
  const t = audioCtx.currentTime;
  const len = capture ? 0.09 : 0.05;
  const buf = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * len), audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = capture ? 900 : 1600;
  filter.Q.value = 1.2;
  const gain = audioCtx.createGain();
  gain.gain.value = capture ? 0.9 : 0.6;
  src.connect(filter).connect(gain).connect(audioCtx.destination);
  src.start(t);
}

// ---------------------------------------------------------------- Game flow

function pickOpening() {
  if (state.openingChoice === 'start') return null;
  if (state.openingChoice === 'random') return OPENINGS[Math.floor(Math.random() * OPENINGS.length)];
  return OPENINGS[+state.openingChoice] || null;
}

function clearNextGameTimer() {
  if (state.nextGameTimer) {
    clearTimeout(state.nextGameTimer);
    state.nextGameTimer = null;
  }
}

async function halt() {
  state.running = false;
  state.stepOnce = false;
  state.token++;
  state.thinking = null;
  releaseWakeLock();
  await Promise.all(['w', 'b'].map((s) => state.engines[s]?.stop()));
}

async function newGame({ autostart = true } = {}) {
  clearNextGameTimer();
  await halt();
  if (state.pendingTc) {
    state.tc = state.pendingTc;
    state.pendingTc = null;
    $('tcHint').textContent = '';
  }
  state.chess = new Chess();
  state.plies = [];
  state.over = null;
  state.live = null;
  state.viewPly = null;
  state.opening = pickOpening();
  lastRenderedPlies = -1;
  if (state.opening) {
    for (const san of state.opening.moves.split(' ')) {
      const mv = state.chess.move(san);
      state.plies.push(plyFrom(mv, { book: true }));
    }
  }
  state.clock = state.tc.type === 'clock' ? { w: state.tc.base, b: state.tc.base } : { w: 0, b: 0 };
  if (state.ready) await Promise.all(['w', 'b'].map((s) => state.engines[s].newGame()));
  render();
  renderLive();
  if (autostart && state.ready && !state.stepMode) start();
}

function plyFrom(mv, extra = {}) {
  return {
    uci: mv.from + mv.to + (mv.promotion || ''),
    san: mv.san,
    from: mv.from,
    to: mv.to,
    flags: mv.flags,
    color: mv.color,
    fen: mv.after,
    captured: !!mv.captured,
    eval: null,
    ms: 0,
    ...extra,
  };
}

function start({ once = false } = {}) {
  if (!state.ready || state.running) return;
  if (state.over) {
    newGame();
    return;
  }
  clearNextGameTimer();
  if (state.viewPly != null) state.viewPly = null;
  state.stepOnce = once;
  ensureAudio();
  state.running = true;
  state.token++;
  requestWakeLock();
  render();
  loop(state.token);
}

async function pause() {
  await halt();
  render();
  renderLive();
}

async function loop(tok) {
  while (state.running && tok === state.token) {
    if (checkGameOver()) return;
    const side = state.chess.turn();
    const eng = state.engines[side];

    if (state.needsConfig[side]) {
      state.needsConfig[side] = false;
      await eng.configure(state.strength[side]);
      if (tok !== state.token) return;
    }

    const moves = state.plies.map((p) => p.uci).join(' ');
    const position = 'position startpos' + (moves ? ' moves ' + moves : '');
    const tc = state.tc;
    const go =
      tc.type === 'move'
        ? `go movetime ${tc.ms}`
        : `go wtime ${Math.max(1, Math.round(state.clock.w))} btime ${Math.max(1, Math.round(state.clock.b))} winc ${tc.inc} binc ${tc.inc}`;

    const fen = state.chess.fen();
    state.live = { side, info: null, ev: null, fen };
    state.thinking = { side, start: performance.now() };
    renderPlayers();
    renderLive();
    startTicker();

    const res = await eng.search(position, go, (info) => {
      if (tok !== state.token) return;
      state.live = { side, info, ev: toWhitePov(info, side), fen };
      renderLive();
    });

    if (tok !== state.token || !state.running) return;
    const elapsed = performance.now() - state.thinking.start;
    state.thinking = null;

    if (tc.type === 'clock') {
      state.clock[side] -= elapsed;
      if (state.clock[side] <= 0) {
        state.clock[side] = 0;
        if (hasMatingMaterial(state.chess, other(side))) {
          finish(side === 'w' ? '0-1' : '1-0', 'Time forfeit');
        } else {
          finish('1/2-1/2', 'Time ran out, but no mating material');
        }
        return;
      }
      state.clock[side] += tc.inc;
    } else {
      state.clock[side] += elapsed;
    }

    const bm = res.bestmove;
    if (!bm || bm === '(none)') {
      if (!checkGameOver()) finish('1/2-1/2', 'Engine found no move');
      return;
    }
    let mv;
    try {
      mv = state.chess.move({ from: bm.slice(0, 2), to: bm.slice(2, 4), promotion: bm[4] });
    } catch {
      finish(side === 'w' ? '0-1' : '1-0', `Illegal move ${bm}`);
      return;
    }
    state.plies.push(plyFrom(mv, { eval: toWhitePov(res.info, side), ms: elapsed }));
    playMoveSound(!!mv.captured);
    render({ animate: state.viewPly == null });
    renderLive();

    // With very short think times, pause briefly so you can still follow the game.
    if (state.stepOnce) {
      // Exactly one move was allowed, now wait again
      state.stepOnce = false;
      state.running = false;
      state.token++;
      releaseWakeLock();
      if (!checkGameOver()) {
        render();
        renderLive();
      }
      return;
    }

    if (tc.type === 'move' && tc.ms < 300) await sleep(120);
  }
}

function checkGameOver() {
  const c = state.chess;
  if (c.isCheckmate()) {
    const winner = other(c.turn());
    finish(winner === 'w' ? '1-0' : '0-1', 'Checkmate', { mateBy: winner });
    return true;
  }
  if (c.isStalemate()) return finish('1/2-1/2', 'Stalemate'), true;
  if (c.isInsufficientMaterial()) return finish('1/2-1/2', 'Insufficient material'), true;
  if (c.isThreefoldRepetition()) return finish('1/2-1/2', 'Threefold repetition'), true;
  if (c.isDrawByFiftyMoves()) return finish('1/2-1/2', '50-move rule'), true;
  return false;
}

function finish(result, reason, extra = {}) {
  state.over = { result, reason, ...extra };
  state.running = false;
  state.token++;
  state.thinking = null;
  releaseWakeLock();

  const t = state.tally;
  if (result === '1-0') t.w++;
  else if (result === '0-1') t.b++;
  else t.d++;
  t.games.unshift({
    result,
    reason,
    opening: state.opening?.name || 'Start position',
    moves: Math.ceil(state.plies.length / 2),
    white: state.strength.w,
    black: state.strength.b,
  });
  t.games = t.games.slice(0, 50);
  store.set('tally', t);

  if (state.autoplay && !state.stepMode) {
    state.nextGameTimer = setTimeout(() => {
      state.nextGameTimer = null;
      newGame();
    }, 5000);
  }
  render();
  renderLive();
}

// ---------------------------------------------------------------- PGN

function buildPgn() {
  const c = new Chess();
  for (const p of state.plies) c.move(p.san);
  const d = new Date();
  const label = (s) => `${state.engineName}${state.strength[s] === 'max' ? '' : ` (Elo ${state.strength[s]})`}`;
  c.setHeader('Event', 'Chesswatch engine game');
  c.setHeader('Site', 'Chesswatch');
  c.setHeader('Date', `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`);
  c.setHeader('White', label('w'));
  c.setHeader('Black', label('b'));
  c.setHeader('Result', state.over?.result || '*');
  if (state.opening) {
    c.setHeader('ECO', state.opening.eco);
    c.setHeader('Opening', state.opening.name);
  }
  c.setHeader('TimeControl', state.tc.type === 'clock' ? `${state.tc.base / 1000}+${state.tc.inc / 1000}` : `${state.tc.ms / 1000}s/move`);
  if (state.over) c.setHeader('Termination', state.over.reason);
  let pgn = c.pgn({ maxWidth: 80 });
  if (state.over && !/(1-0|0-1|1\/2-1\/2)\s*$/.test(pgn)) pgn += ' ' + state.over.result;
  return pgn;
}

async function copyPgn() {
  const pgn = buildPgn();
  const box = $('pgnBox');
  box.value = pgn;
  try {
    await navigator.clipboard.writeText(pgn);
    toast('PGN copied');
  } catch {
    $('pgnWrap').hidden = false;
    box.focus();
    box.select();
    toast('Copying was blocked. The PGN is selected for you.');
  }
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

// ---------------------------------------------------------------- Wake Lock

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !state.wakeLock) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener?.('release', () => (state.wakeLock = null));
    }
  } catch {
    state.wakeLock = null;
  }
}
function releaseWakeLock() {
  try {
    state.wakeLock?.release();
  } catch {
    /* ignore */
  }
  state.wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.running) requestWakeLock();
});

// ---------------------------------------------------------------- Navigation

function goTo(idx) {
  const n = state.plies.length;
  if (idx == null || idx >= n - 1) state.viewPly = null;
  else state.viewPly = Math.max(-1, idx);
  render();
  const active = $('moveList').querySelector('.mv.active');
  active?.scrollIntoView({ block: 'nearest' });
}

function step(delta) {
  const cur = state.viewPly == null ? state.plies.length - 1 : state.viewPly;
  goTo(cur + delta);
}

// ---------------------------------------------------------------- Controls

function fillSelect(sel, options, value) {
  sel.textContent = '';
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    sel.append(o);
  }
  sel.value = value;
}

function setupControls() {
  fillSelect($('strW'), STRENGTHS, state.strength.w);
  fillSelect($('strB'), STRENGTHS, state.strength.b);
  fillSelect(
    $('tc'),
    Object.entries(TIME_CONTROLS).map(([k, v]) => [k, v.label]),
    state.tcKey,
  );
  fillSelect(
    $('opening'),
    [['random', 'Random from the book'], ['start', 'Start position'], ...OPENINGS.map((o, i) => [String(i), `${o.eco} ${o.name}`])],
    state.openingChoice,
  );
  $('autoplay').checked = state.autoplay;
  $('sound').checked = state.sound;

  for (const side of ['w', 'b']) {
    $(side === 'w' ? 'strW' : 'strB').addEventListener('change', (e) => {
      state.strength[side] = e.target.value;
      state.needsConfig[side] = true;
      saveSettings();
      renderPlayers();
    });
  }

  $('tc').addEventListener('change', (e) => {
    const next = TIME_CONTROLS[e.target.value];
    const prev = state.tc;
    state.tcKey = e.target.value;
    saveSettings();
    const midGame = state.plies.some((p) => !p.book) && !state.over;
    if (next.type === 'move' && prev.type === 'move') {
      state.tc = next;
      $('tcHint').textContent = midGame ? 'Applies from the next move.' : '';
    } else if (midGame) {
      state.pendingTc = next;
      $('tcHint').textContent = 'Applies from the next game.';
    } else {
      state.tc = next;
      state.clock = next.type === 'clock' ? { w: next.base, b: next.base } : { w: 0, b: 0 };
      $('tcHint').textContent = '';
      renderPlayers();
    }
  });

  $('opening').addEventListener('change', (e) => {
    state.openingChoice = e.target.value;
    saveSettings();
  });
  $('autoplay').addEventListener('change', (e) => {
    state.autoplay = e.target.checked;
    saveSettings();
    if (!state.autoplay) clearNextGameTimer();
    renderResult();
  });
  $('sound').addEventListener('change', (e) => {
    state.sound = e.target.checked;
    saveSettings();
    ensureAudio();
  });

  $('btnPlay').addEventListener('click', () => {
    if (state.stepMode) return state.running ? null : start({ once: true });
    return state.running ? pause() : start();
  });
  $('btnStep').addEventListener('click', () => start({ once: true }));
  $('stepMode').checked = state.stepMode;
  $('stepMode').addEventListener('change', async (e) => {
    state.stepMode = e.target.checked;
    saveSettings();
    if (state.stepMode) {
      clearNextGameTimer();
      // Let a running search finish its move
      if (state.running) state.stepOnce = true;
    }
    render();
  });
  $('btnNew').addEventListener('click', () => {
    ensureAudio();
    newGame();
  });
  $('btnFlip').addEventListener('click', flip);
  $('btnPgn').addEventListener('click', copyPgn);
  $('btnLive').addEventListener('click', () => goTo(null));
  $('btnPrev').addEventListener('click', () => step(-1));
  $('btnNext').addEventListener('click', () => step(1));
  $('btnResetTally').addEventListener('click', () => {
    state.tally = { w: 0, d: 0, b: 0, games: [] };
    store.set('tally', state.tally);
    renderTally();
  });
  $('moveList').addEventListener('click', (e) => {
    const b = e.target.closest('.mv[data-ply]');
    if (b) goTo(+b.dataset.ply);
  });
  $('graph').addEventListener('click', (e) => {
    const svg = $('graph');
    const rect = svg.getBoundingClientRect();
    const n = +svg.dataset.n || 40;
    const idx = Math.round(((e.clientX - rect.left) / rect.width) * n) - 1;
    if (state.plies.length) goTo(Math.min(idx, state.plies.length - 1));
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    if (e.key === ' ') {
      e.preventDefault();
      $('btnPlay').click();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'f' || e.key === 'F') {
      flip();
    } else if (e.key === 'Enter' || e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      if (!state.running) start({ once: true });
    } else if (e.key === 'n' || e.key === 'N') {
      $('btnNew').click();
    } else if (e.key === 'Escape' || e.key === 'End') {
      goTo(null);
    }
  });
}

function flip() {
  state.orientation = other(state.orientation);
  saveSettings();
  buildBoard();
  render();
}

// ---------------------------------------------------------------- Boot

async function boot() {
  buildBoard();
  setupControls();
  state.opening = null;
  render();
  renderLive();

  try {
    const [w, b] = [new Engine(), new Engine()];
    state.engines = { w, b };
    await Promise.all([w.init(), b.init()]);
    state.engineName = w.name || 'Stockfish 19';
    $('engineName').textContent = w.name;
    state.ready = true;
  } catch (err) {
    console.error(err);
    $('status').dataset.state = 'error';
    $('status').querySelector('.stext').textContent = 'Engine error';
    toast('Stockfish could not be loaded. Is the page served by a web server?');
    return;
  }
  await newGame({ autostart: true });
}

boot();
