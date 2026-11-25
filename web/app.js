import { Chess } from './vendor/chess.js';
import { Engine, levelToElo, levelToSkill } from './engine.js';
import { ENGINES, DEFAULT_ENGINE, engineById, isValidPlayer, HUMAN } from './engines.js';
import { OPENINGS } from './openings.js';
import * as sound from './sounds.js';

// ---------------------------------------------------------------- Constants

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';

const TIME_CONTROLS = {
  m100: { type: 'move', ms: 100, label: '0.1 s', sub: 'per move' },
  m300: { type: 'move', ms: 300, label: '0.3 s', sub: 'per move' },
  m1000: { type: 'move', ms: 1000, label: '1 s', sub: 'per move' },
  m3000: { type: 'move', ms: 3000, label: '3 s', sub: 'per move' },
  m10000: { type: 'move', ms: 10000, label: '10 s', sub: 'per move' },
  c60_0: { type: 'clock', base: 60_000, inc: 0, label: '1+0', sub: 'bullet' },
  c180_2: { type: 'clock', base: 180_000, inc: 2000, label: '3+2', sub: 'blitz' },
  c600_5: { type: 'clock', base: 600_000, inc: 5000, label: '10+5', sub: 'rapid' },
  custom: { type: 'move', custom: true, label: 'Custom', sub: 'per move' },
  smart: { type: 'smart', label: 'Smart', sub: 'when sure' },
};

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };

// ---------------------------------------------------------------- Helpers

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const other = (side) => (side === 'w' ? 'b' : 'w');
const sideName = (side) => (side === 'w' ? 'White' : 'Black');
const S = (side) => side.toUpperCase();

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('chesswatch:v2:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('chesswatch:v2:' + key, JSON.stringify(value));
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
  if (!ev) return '0.0';
  if (ev.mate != null) {
    if (ev.mate === 0) return '#';
    return (ev.mate > 0 ? '#' : '#−') + Math.abs(ev.mate);
  }
  const v = ev.cp / 100;
  if (Math.abs(v) < 0.05) return '0.0';
  return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(Math.abs(v) >= 10 ? 0 : 1);
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
  if (!info || (info.cp == null && info.mate == null)) return null;
  const sign = side === 'w' ? 1 : -1;
  if (info.mate != null) return { mate: info.mate * sign };
  return { cp: info.cp * sign };
}

function formatNps(nps) {
  if (!nps) return '–';
  if (nps >= 1e6) return (nps / 1e6).toFixed(2) + ' M/s';
  return Math.round(nps / 1000) + ' k/s';
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
  return out;
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

const saved = store.get('settings', {});
const validEngine = (id) => (isValidPlayer(id) ? id : DEFAULT_ENGINE);
const validLevel = (v) => (Number.isFinite(+v) ? Math.max(0, Math.min(100, +v)) : 100);

const state = {
  engines: { w: null, b: null },
  engineId: { w: validEngine(saved.engW), b: validEngine(saved.engB) },
  level: { w: validLevel(saved.lvlW), b: validLevel(saved.lvlB) },
  needsConfig: { w: true, b: true },
  chess: new Chess(),
  plies: [], // { uci, san, from, to, flags, color, fen, book, eval, ms }
  opening: null,
  running: false,
  token: 0,
  over: null,
  tcKey: TIME_CONTROLS[saved.tc] ? saved.tc : 'm1000',
  tc: TIME_CONTROLS[saved.tc] || TIME_CONTROLS.m1000,
  pendingTc: null,
  customMs: Number.isFinite(saved.customMs) ? Math.max(100, Math.min(3_600_000, saved.customMs)) : 5000,
  clock: { w: 0, b: 0 },
  thinking: null,
  live: null,
  viewPly: null, // null = live, -1 = start position, otherwise index into plies
  orientation: saved.orientation === 'b' ? 'b' : 'w',
  startPos: saved.startPos !== false,
  openingChoice: saved.opening ?? 'random',
  stepMode: !!saved.stepMode,
  stepOnce: false,
  stepWaiter: null, // resolves when Next move is pressed
  humanWaiter: null, // resolves when the human makes a move
  selected: null, // square the human picked up
  autoplay: saved.autoplay !== false,
  sound: saved.sound !== false,
  arrow: saved.arrow !== false,
  tally: store.get('tally', { w: 0, d: 0, b: 0, games: [] }),
  ready: false,
  loading: 0,
  nextGameTimer: null,
  wakeLock: null,
};

function saveSettings() {
  store.set('settings', {
    engW: state.engineId.w,
    engB: state.engineId.b,
    lvlW: state.level.w,
    lvlB: state.level.b,
    tc: state.tcKey,
    customMs: state.customMs,
    orientation: state.orientation,
    startPos: state.startPos,
    opening: state.openingChoice,
    stepMode: state.stepMode,
    autoplay: state.autoplay,
    sound: state.sound,
    arrow: state.arrow,
  });
}

// ---------------------------------------------------------------- Engines

const isHuman = (side) => state.engineId[side] === 'human';

function strengthLabel(side, short = false) {
  const def = engineById(state.engineId[side]);
  if (def.human) return short ? 'You' : 'Human player';
  const lvl = state.level[side];
  if (lvl >= 100) return short ? 'Max' : 'Max strength';
  const eng = state.engines[side];
  if (def.strength === 'elo') return `Elo ${levelToElo(lvl, eng?.eloRange || undefined)}`;
  if (def.strength === 'skill') return `Skill ${levelToSkill(lvl)}/20`;
  return `Level ${Math.round(lvl)}`;
}

// Think time per move for the "per move" and "when sure" controls.
function moveTimeMs() {
  const tc = state.tc;
  if (tc.custom || tc.type === 'smart') return state.customMs;
  return tc.ms;
}

function showLoader(text, sub) {
  state.loading++;
  $('loaderText').textContent = text;
  $('loaderSub').textContent = sub || '';
  $('loader').hidden = false;
}
function hideLoader() {
  state.loading = Math.max(0, state.loading - 1);
  if (!state.loading) $('loader').hidden = true;
}

// Makes sure the engine for this side is the selected version and ready.
async function ensureEngine(side) {
  const want = engineById(state.engineId[side]);
  let eng = state.engines[side];
  if (want.human) {
    eng?.terminate();
    state.engines[side] = null;
    return null;
  }
  if (eng && eng.def.id === want.id && !eng.dead) return eng;
  eng?.terminate();
  state.engines[side] = null;
  const big = parseFloat(want.size) >= 20;
  showLoader(`Loading ${want.name}`, big ? `${want.size} download, this can take a moment` : '');
  try {
    eng = new Engine(want);
    await eng.init();
    state.engines[side] = eng;
    state.needsConfig[side] = true;
    return eng;
  } catch (err) {
    eng?.terminate();
    throw err;
  } finally {
    hideLoader();
    renderPlayers();
    renderSetup();
  }
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
  renderInput();

  if (animate && lastMove && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const slides = [[lastMove.from, lastMove.to]];
    if (lastMove.flags?.includes('k')) {
      const r = lastMove.color === 'w' ? '1' : '8';
      slides.push(['h' + r, 'f' + r]);
    } else if (lastMove.flags?.includes('q')) {
      const r = lastMove.color === 'w' ? '1' : '8';
      slides.push(['a' + r, 'd' + r]);
    }
    const dur = Math.min(200, Math.max(70, (state.tc.ms || 450) / 3));
    for (const [from, to] of slides) {
      const pc = squareEls.get(to)?.querySelector('.pc');
      if (!pc) continue;
      const [fx, fy] = squareXY(from);
      const [tx, ty] = squareXY(to);
      pc.style.transition = 'none';
      pc.style.transform = `translate(${(fx - tx) * 100}%, ${(fy - ty) * 100}%)`;
      pc.getBoundingClientRect();
      pc.style.transition = `transform ${dur}ms cubic-bezier(0.2, 0.7, 0.2, 1)`;
      pc.style.transform = '';
    }
  }
}

// Human input: which pieces can be picked up, the selected square and its legal moves.
function humanToMove() {
  return !!state.humanWaiter && state.viewPly == null && !state.over;
}

function renderInput() {
  const active = humanToMove();
  boardEl.classList.toggle('input', active);
  const side = state.chess.turn();
  const targets = new Map();
  if (active && state.selected) {
    for (const m of state.chess.moves({ square: state.selected, verbose: true })) targets.set(m.to, !!m.captured);
  }
  for (const [sq, el] of squareEls) {
    const pc = el.querySelector('.pc');
    pc?.classList.toggle('mine', active && pc.className.includes(' ' + side));
    el.classList.toggle('sel', active && sq === state.selected);
    let dot = el.querySelector('.dot');
    if (targets.has(sq)) {
      if (!dot) {
        dot = document.createElement('span');
        el.append(dot);
      }
      dot.className = 'dot' + (targets.get(sq) ? ' cap' : '');
    } else dot?.remove();
  }
}

function renderArrow() {
  const line = $('bestArrow');
  const live = state.live;
  const show =
    state.arrow && state.running && state.viewPly == null && live?.info?.pv?.length && live.fen === state.chess.fen();
  if (!show) {
    line.setAttribute('visibility', 'hidden');
    return;
  }
  const uci = live.info.pv[0];
  const [fx, fy] = squareXY(uci.slice(0, 2));
  const [tx, ty] = squareXY(uci.slice(2, 4));
  const c = (v) => v * 100 + 50;
  // Stop a little short so the arrowhead sits inside the target square.
  const dx = tx - fx;
  const dy = ty - fy;
  const len = Math.hypot(dx, dy) || 1;
  const shorten = 0.28;
  line.setAttribute('x1', c(fx));
  line.setAttribute('y1', c(fy));
  line.setAttribute('x2', c(tx) - (dx / len) * shorten * 100);
  line.setAttribute('y2', c(ty) - (dy / len) * shorten * 100);
  line.setAttribute('visibility', 'visible');
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
  renderArrow();
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
      state.viewPly < 0
        ? 'start position'
        : `${Math.floor(state.viewPly / 2) + 1}${state.viewPly % 2 ? '…' : '.'} ${state.plies[state.viewPly].san}`;
  }
}

function renderEval() {
  const ev = displayedEval();
  const pct = whiteWinPct(ev);
  $('evalFill').style.height = pct + '%';
  const bar = $('evalBar');
  bar.classList.toggle('flipped', state.orientation === 'b');
  const txt = formatEval(ev);
  $('evalNum').textContent = txt;
  $('evalNum').dataset.side = pct >= 50 ? 'w' : 'b';
  bar.setAttribute('aria-label', `Evaluation ${txt}`);
}

function capturedFor(fen) {
  // Pieces each side has captured from the other.
  const c = new Chess(fen);
  const have = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  let diff = 0;
  for (const row of c.board()) {
    for (const p of row) {
      if (!p) continue;
      if (p.type !== 'k') have[p.color][p.type]++;
      diff += (p.color === 'w' ? 1 : -1) * PIECE_VALUE[p.type];
    }
  }
  const took = { w: [], b: [] };
  for (const side of ['w', 'b']) {
    const victim = other(side);
    for (const t of ['q', 'r', 'b', 'n', 'p']) {
      const n = Math.max(0, START_COUNT[t] - have[victim][t]);
      for (let i = 0; i < n; i++) took[side].push(victim + t.toUpperCase());
    }
  }
  return { took, diff };
}

function renderPlayers() {
  const view = currentView();
  const { took, diff } = capturedFor(view.fen);
  for (const side of ['w', 'b']) {
    const el = $(side === 'w' ? 'playerW' : 'playerB');
    const def = engineById(state.engineId[side]);
    el.style.order = side === state.orientation ? 3 : 1;
    el.querySelector('.pname').textContent = def.name;
    el.querySelector('.av-num').textContent = def.badge;
    el.querySelector('.av-sub').textContent = def.sub || '';
    el.querySelector('.avatar').dataset.family = def.family;
    el.querySelector('.pstr').textContent = strengthLabel(side);

    const cap = el.querySelector('.captured');
    const key = took[side].join(',');
    if (cap.dataset.key !== key) {
      cap.dataset.key = key;
      cap.textContent = '';
      let prev = '';
      for (const code of took[side]) {
        const i = document.createElement('span');
        i.className = 'cp pc-icon ' + code + (prev && prev !== code ? ' gap' : '');
        cap.append(i);
        prev = code;
      }
    }
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
  el.querySelector('.ctime').textContent = formatClock(ms);
  el.querySelector('.clabel').textContent = state.tc.type === 'clock' ? 'left' : 'used';
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
    const t = state.thinking;
    if (t.human && state.tc.type === 'clock' && state.clock[t.side] - (performance.now() - t.start) <= 0) {
      state.thinking = null;
      tickerRunning = false;
      flagFall(t.side);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderLive() {
  const live = state.live;
  const box = $('thinkBody');
  if (state.humanWaiter && !state.over) {
    box.dataset.side = state.chess.turn();
    $('thinkWho').textContent = isHuman(other(state.chess.turn()))
      ? `${sideName(state.chess.turn())} to move`
      : `Your move (${sideName(state.chess.turn())})`;
    renderArrow();
    return;
  }
  if (!live || !live.info) {
    $('thinkWho').textContent = state.over
      ? 'Game over'
      : state.running
        ? `${sideName(state.chess.turn())} is thinking`
        : state.stepMode
          ? 'Press play to start'
          : 'Paused';
    box.dataset.side = state.running ? state.chess.turn() : '';
    if (!live) {
      $('thinkDepth').textContent = '–';
      $('thinkNodes').textContent = '–';
      $('thinkNps').textContent = '–';
      $('thinkEval').textContent = formatEval(displayedEval());
      $('thinkPv').textContent = '';
    }
    renderArrow();
    return;
  }
  const { info, side, fen } = live;
  box.dataset.side = side;
  $('thinkWho').textContent =
    state.stepWaiter && state.thinking?.side === side
      ? `${sideName(side)} is thinking · press Next move`
      : `${sideName(side)} ${state.thinking?.side === side ? 'is thinking' : 'played'}`;
  $('thinkDepth').textContent = info.depth >= 200 ? `${info.seldepth}` : `${info.depth}`;
  $('thinkNodes').textContent = formatNodes(info.nodes);
  $('thinkNps').textContent = formatNps(info.nps);
  $('thinkEval').textContent = formatEval(live.ev);
  const pv = pvToSan(fen, info.pv);
  const pvEl = $('thinkPv');
  pvEl.textContent = '';
  pv.forEach((m, i) => {
    if (i) pvEl.append(' ');
    if (i === 0) {
      const b = document.createElement('b');
      b.textContent = m;
      pvEl.append(b);
    } else pvEl.append(m);
  });
  if (state.viewPly == null) renderEval();
  renderArrow();
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
    if (state.viewPly == null) {
      const sc = $('movesScroll');
      sc.scrollTop = sc.scrollHeight;
    }
  }
  for (const b of list.querySelectorAll('.mv[data-ply]')) b.classList.toggle('active', +b.dataset.ply === active);
  list.querySelector('.mresult')?.remove();
  if (state.over) {
    const r = document.createElement('li');
    r.className = 'mresult';
    r.textContent = `${state.over.result.replaceAll('1/2', '½')} · ${state.over.reason}`;
    list.append(r);
  }
  $('movesEmpty').hidden = n > 0;
  $('moveCount').textContent = n ? `${Math.ceil(n / 2)} ${Math.ceil(n / 2) === 1 ? 'move' : 'moves'}` : '';
}

function renderGraph() {
  const svg = $('graph');
  const W = 300;
  const H = 64;
  const plies = state.plies;
  const pts = [[0, H / 2]];
  const n = Math.max(plies.length, 40);
  plies.forEach((p, i) => {
    const pct = p.eval ? whiteWinPct(p.eval) : i > 0 ? (100 * (H - pts[pts.length - 1][1])) / H : 50;
    pts.push([((i + 1) / n) * W, H - (pct / 100) * H]);
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  $('graphArea').setAttribute('d', `M0,${H / 2} L${line.replace(/ /g, ' L')} L${last[0].toFixed(1)},${H / 2} Z`);
  $('graphLine').setAttribute('points', line);
  const cur = pts[currentView().idx + 1] || last;
  $('graphDot').setAttribute('cx', cur[0]);
  $('graphDot').setAttribute('cy', cur[1]);
  $('graphDot').style.display = plies.length ? '' : 'none';
  svg.dataset.n = n;
}

function renderOpening() {
  const o = state.opening;
  $('openingEco').textContent = o ? o.eco : '';
  $('openingName').textContent = o ? o.name : 'Starting position';
}

function renderStatus() {
  const el = $('status');
  let s;
  let text;
  if (!state.ready) [s, text] = ['loading', 'Loading'];
  else if (state.over) [s, text] = ['over', 'Game over'];
  else if (state.humanWaiter) [s, text] = ['running', 'Your move'];
  else if (state.running && state.stepMode) [s, text] = ['running', 'Step mode'];
  else if (state.running) [s, text] = ['running', 'Live'];
  else [s, text] = ['paused', 'Paused'];
  el.dataset.state = s;
  el.querySelector('.stext').textContent = text;

  const play = $('btnPlay');
  const step = $('btnStep');
  const playing = state.running && !state.stepOnce;
  play.disabled = !state.ready;
  play.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  const label = state.over
    ? 'Next game'
    : playing
      ? 'Pause'
      : state.plies.some((p) => !p.book)
        ? 'Resume'
        : 'Start';
  play.setAttribute('aria-label', label);
  play.title = `${label} (Space)`;
  // Next move: plays the move the engine is thinking about (step mode),
  // or lets the engine play exactly one move while paused.
  const engineTurn = !isHuman(state.chess.turn());
  step.disabled = !state.ready || !!state.over || !engineTurn || (state.running && !state.stepWaiter);
  step.querySelector('span').textContent = state.running && state.stepOnce ? 'Thinking…' : 'Next move';
  step.classList.toggle('btn-accent', !!state.stepWaiter);
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
  $('resultWinner').textContent =
    r === '1-0'
      ? `${engineById(state.engineId.w).name} wins`
      : r === '0-1'
        ? `${engineById(state.engineId.b).name} wins`
        : 'Draw';
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
  for (const g of t.games.slice(0, 12)) {
    const li = document.createElement('li');
    const res = document.createElement('span');
    res.className = 'gres';
    res.textContent = g.result === '1/2-1/2' ? '½–½' : g.result.replace('-', '–');
    const txt = document.createElement('span');
    txt.className = 'gtxt';
    const names = g.white && g.black ? `${g.white} vs ${g.black} · ` : '';
    txt.textContent = `${names}${g.reason} · ${g.moves} moves`;
    txt.title = `${names}${g.opening} · ${g.reason} · ${g.moves} moves`;
    li.append(res, txt);
    list.append(li);
  }
  $('gameLogEmpty').hidden = t.games.length > 0;
}

function renderSound() {
  const btn = $('btnSound');
  btn.setAttribute('aria-pressed', String(state.sound));
  btn.setAttribute('aria-label', state.sound ? 'Sound on' : 'Sound off');
  btn.querySelector('use').setAttribute('href', state.sound ? '#i-sound' : '#i-mute');
  $('soundHint').hidden = !(state.sound && sound.isLocked());
  $('sound').checked = state.sound;
}

// ---------------------------------------------------------------- Match setup panel

function renderSetup() {
  for (const side of ['w', 'b']) {
    const def = engineById(state.engineId[side]);
    $('eng' + S(side)).value = def.id;
    const bits = def.human ? [] : [def.eval === 'NNUE' ? 'Neural network' : 'Classic evaluation', def.size];
    if (def.note) bits.push(def.note);
    $('note' + S(side)).textContent = bits.join(' · ');
    const range = $('lvl' + S(side));
    range.value = state.level[side];
    range.style.setProperty('--p', state.level[side] + '%');
    $('lvlOut' + S(side)).textContent = strengthLabel(side, true);
    const eng = state.engines[side];
    $('lvlMin' + S(side)).textContent =
      def.strength === 'elo' ? `Elo ${eng?.eloRange?.[0] ?? 1320}` : def.strength === 'skill' ? 'Skill 0' : 'Level 0';
    range.closest('.sidecard').querySelector('[data-strength]').hidden = !!def.human;
  }
  const tc = TIME_CONTROLS[state.tcKey];
  $('customRow').hidden = !(tc.custom || tc.type === 'smart');
  $('customLabel').textContent = tc.type === 'smart' ? 'Think at most' : 'Think time per move';
  $('customHint').textContent =
    tc.type === 'smart'
      ? 'The engine moves as soon as its best move stays the same and the score stops changing.'
      : '';
  if (document.activeElement?.closest?.('.tin') == null) {
    $('customMin').value = Math.floor(state.customMs / 60000);
    $('customSec').value = Math.round((state.customMs % 60000) / 1000 * 10) / 10;
  }
  for (const b of $('tcSeg').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.tc === state.tcKey));
  $('startPos').checked = state.startPos;
  $('openingRow').hidden = state.startPos;
  $('opening').value = state.openingChoice;
  $('stepMode').checked = state.stepMode;
  $('autoplay').checked = state.autoplay;
  $('arrow').checked = state.arrow;
  renderSound();
}

// ---------------------------------------------------------------- Game flow

function pickOpening() {
  if (state.startPos) return null;
  if (state.openingChoice === 'random') return OPENINGS[Math.floor(Math.random() * OPENINGS.length)];
  return OPENINGS[+state.openingChoice] || null;
}

function clearNextGameTimer() {
  if (state.nextGameTimer) {
    clearTimeout(state.nextGameTimer);
    state.nextGameTimer = null;
  }
}

function resolveWaiters() {
  const sw = state.stepWaiter;
  const hw = state.humanWaiter;
  state.stepWaiter = null;
  state.humanWaiter = null;
  state.selected = null;
  sw?.(false);
  hw?.(false);
}

async function halt() {
  state.running = false;
  state.stepOnce = false;
  state.token++;
  state.thinking = null;
  resolveWaiters();
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
  // Playing one side yourself? Put your pieces at the bottom.
  const humans = ['w', 'b'].filter(isHuman);
  if (humans.length === 1 && state.orientation !== humans[0]) {
    state.orientation = humans[0];
    buildBoard();
  }
  state.clock = state.tc.type === 'clock' ? { w: state.tc.base, b: state.tc.base } : { w: 0, b: 0 };
  render();
  renderLive();
  if (state.ready) {
    for (const s of ['w', 'b']) if (state.engines[s]) await state.engines[s].newGame();
    sound.play('start');
    if (autostart) start();
  }
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
  state.viewPly = null;
  state.stepOnce = once;
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

// "Next move": in step mode, play what the engine found so far; when paused, let it play one move.
function nextMove() {
  if (state.stepWaiter) {
    const w = state.stepWaiter;
    state.stepWaiter = null;
    w(true);
    render();
  } else if (!state.running && !state.over && !isHuman(state.chess.turn())) {
    start({ once: true });
  }
}

function waitForStepClick() {
  return new Promise((resolve) => {
    state.stepWaiter = resolve;
    renderStatus();
    renderLive();
  });
}

// "When sure": stop once the best move has stayed the same for several depths
// and the score has settled. The time limit still applies on top.
function smartStopper(eng, legalMoves) {
  const done = []; // best move and score at the end of each depth
  let depth = 0;
  let cur = null;
  let stopped = false;
  const t0 = performance.now();
  return (info) => {
    if (stopped || !info.pv?.length) return;
    const elapsed = performance.now() - t0;
    if (legalMoves === 1 && elapsed > 150) {
      stopped = true;
      eng.send('stop');
      return;
    }
    if (info.depth > depth) {
      if (cur) done.push(cur);
      depth = info.depth;
    }
    const score = info.mate != null ? Math.sign(info.mate) * (100000 - Math.abs(info.mate)) : info.cp ?? 0;
    cur = { move: info.pv[0], score };
    if (elapsed < 300) return;
    const mateFound = Math.abs(score) > 50000;
    const need = mateFound ? 2 : 6;
    if (done.length < (mateFound ? 4 : 10)) return;
    const recent = done.slice(-need);
    if (!recent.every((d) => d.move === cur.move)) return;
    const scores = recent.map((d) => d.score).concat(score);
    const swing = Math.max(...scores) - Math.min(...scores);
    if (mateFound || swing <= 30) {
      stopped = true;
      eng.send('stop');
    }
  };
}

// Applies a move for either player and updates clocks, sounds and the board.
function playMove(mv, side, elapsed, evalWhite, animate) {
  const tc = state.tc;
  if (tc.type === 'clock' && !state.stepMode) {
    state.clock[side] -= elapsed;
    if (state.clock[side] <= 0) {
      flagFall(side);
      return false;
    }
    state.clock[side] += tc.inc;
  } else if (tc.type !== 'clock') {
    state.clock[side] += elapsed;
  }
  state.plies.push(plyFrom(mv, { eval: evalWhite, ms: elapsed }));
  if (!state.chess.isGameOver()) sound.play(sound.soundForMove(mv, state.chess.inCheck()));
  render({ animate: animate && state.viewPly == null });
  renderLive();
  return true;
}

function flagFall(side) {
  state.clock[side] = 0;
  if (hasMatingMaterial(state.chess, other(side))) finish(side === 'w' ? '0-1' : '1-0', 'Time forfeit');
  else finish('1/2-1/2', 'Time ran out, but no mating material');
}

// Waits for the human to move. Resolves true when a move was made.
function humanTurn(side) {
  state.thinking = { side, start: performance.now(), human: true };
  state.selected = null;
  startTicker();
  return new Promise((resolve) => {
    state.humanWaiter = resolve;
    render();
    renderLive();
  });
}

async function loop(tok) {
  while (state.running && tok === state.token) {
    if (checkGameOver()) return;
    const side = state.chess.turn();

    if (isHuman(side)) {
      const moved = await humanTurn(side);
      if (!moved || tok !== state.token) return;
      continue;
    }

    let eng;
    try {
      eng = await ensureEngine(side);
    } catch (err) {
      console.error(err);
      toast(`${engineById(state.engineId[side]).name} could not be loaded. Check your connection.`);
      await halt();
      render();
      renderLive();
      return;
    }
    if (tok !== state.token) return;

    if (state.needsConfig[side]) {
      state.needsConfig[side] = false;
      await eng.configure(state.level[side]);
      if (tok !== state.token) return;
    }

    const moves = state.plies.map((p) => p.uci).join(' ');
    const position = 'position startpos' + (moves ? ' moves ' + moves : '');
    const tc = state.tc;
    const step = state.stepMode && !state.stepOnce;
    let go;
    if (step) go = 'go infinite';
    else if (tc.type === 'clock')
      go = `go wtime ${Math.max(1, Math.round(state.clock.w))} btime ${Math.max(1, Math.round(state.clock.b))} winc ${tc.inc} binc ${tc.inc}`;
    else go = `go movetime ${moveTimeMs()}`;
    if (eng.nodeLimit) go += ` nodes ${eng.nodeLimit}`;

    const fen = state.chess.fen();
    state.live = { side, info: null, ev: null, fen };
    state.thinking = { side, start: performance.now() };
    renderPlayers();
    renderLive();
    startTicker();

    const smart = !step && tc.type === 'smart' ? smartStopper(eng, state.chess.moves().length) : null;
    const searching = eng.search(position, go, (info) => {
      if (tok !== state.token) return;
      state.live = { side, info, ev: toWhitePov(info, side), fen };
      smart?.(info);
      renderLive();
    });

    let res;
    if (step) {
      // Think until Next move is pressed. If the engine finishes on its own
      // (node limit), keep its move and still wait for the click.
      let finished = null;
      searching.then((r) => (finished = r));
      const go_ = await waitForStepClick();
      if (!go_ || tok !== state.token) return;
      if (!finished) eng.send('stop');
      res = await searching;
    } else {
      res = await searching;
    }

    if (tok !== state.token || !state.running) return;
    const elapsed = performance.now() - state.thinking.start;
    state.thinking = null;

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
    if (!playMove(mv, side, elapsed, toWhitePov(res.info, side), true)) return;

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

    // With very short think times, pause briefly so you can still follow the game.
    if (!step && tc.type === 'move' && moveTimeMs() < 300) await sleep(140);
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
  state.stepOnce = false;
  state.token++;
  state.thinking = null;
  resolveWaiters();
  releaseWakeLock();
  sound.play('end');

  const t = state.tally;
  if (result === '1-0') t.w++;
  else if (result === '0-1') t.b++;
  else t.d++;
  t.games.unshift({
    result,
    reason,
    opening: state.opening?.name || 'Starting position',
    moves: Math.ceil(state.plies.length / 2),
    white: engineById(state.engineId.w).name,
    black: engineById(state.engineId.b).name,
  });
  t.games = t.games.slice(0, 50);
  store.set('tally', t);

  if (state.autoplay && !state.stepMode && !isHuman('w') && !isHuman('b')) {
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
  const label = (s) => {
    const name = engineById(state.engineId[s]).name;
    return state.level[s] >= 100 ? name : `${name} (${strengthLabel(s, true)})`;
  };
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
    box.hidden = false;
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
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

// ---------------------------------------------------------------- Wake lock

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
  $('moveList').querySelector('.mv.active')?.scrollIntoView({ block: 'nearest' });
}

function step(delta) {
  const cur = state.viewPly == null ? state.plies.length - 1 : state.viewPly;
  goTo(cur + delta);
}

// ---------------------------------------------------------------- Controls

function selectTab(name) {
  for (const t of document.querySelectorAll('[role="tab"]')) {
    const on = t.id === 'tab-' + name;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
  }
  try {
    sessionStorage.setItem('chesswatch:tab', name);
  } catch {
    /* ignore */
  }
}

function setupControls() {
  // Engine pickers
  for (const side of ['w', 'b']) {
    const sel = $('eng' + S(side));
    const groups = [['Player', [HUMAN]]];
    for (const e of ENGINES) {
      let g = groups.find(([label]) => label === e.group);
      if (!g) groups.push((g = [e.group, []]));
      g[1].push(e);
    }
    for (const [label, list] of groups) {
      const g = document.createElement('optgroup');
      g.label = label;
      for (const e of list) {
        const o = document.createElement('option');
        o.value = e.id;
        o.textContent = e.human ? 'You (play yourself)' : e.name;
        g.append(o);
      }
      sel.append(g);
    }
    sel.addEventListener('change', async () => {
      state.engineId[side] = sel.value;
      state.needsConfig[side] = true;
      saveSettings();
      renderSetup();
      renderPlayers();
      await restartIfRunning();
      // Load it right away so the next move doesn't wait.
      ensureEngine(side).catch(() => toast(`${engineById(sel.value).name} could not be loaded.`));
    });

    const range = $('lvl' + S(side));
    range.addEventListener('input', () => {
      state.level[side] = +range.value;
      state.needsConfig[side] = true;
      range.style.setProperty('--p', range.value + '%');
      $('lvlOut' + S(side)).textContent = strengthLabel(side, true);
      renderPlayers();
    });
    range.addEventListener('change', saveSettings);
  }

  $('btnSwap').addEventListener('click', async () => {
    const wasRunning = state.running;
    if (wasRunning) await halt();
    [state.engineId.w, state.engineId.b] = [state.engineId.b, state.engineId.w];
    [state.level.w, state.level.b] = [state.level.b, state.level.w];
    [state.engines.w, state.engines.b] = [state.engines.b, state.engines.w];
    state.needsConfig = { w: true, b: true };
    saveSettings();
    renderSetup();
    render();
    if (wasRunning) start();
  });

  // Custom think time (minutes + seconds)
  const readCustom = () => {
    const m = Math.max(0, Math.min(60, Math.floor(+$('customMin').value || 0)));
    const sec = Math.max(0, Math.min(59.9, +$('customSec').value || 0));
    state.customMs = Math.max(100, Math.round((m * 60 + sec) * 1000));
    saveSettings();
  };
  for (const id of ['customMin', 'customSec']) {
    $(id).addEventListener('input', readCustom);
    $(id).addEventListener('change', () => {
      readCustom();
      renderSetup();
    });
  }

  // Time control
  const seg = $('tcSeg');
  for (const [key, tc] of Object.entries(TIME_CONTROLS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.tc = key;
    b.innerHTML = `<span></span><small></small>`;
    b.querySelector('span').textContent = tc.label;
    b.querySelector('small').textContent = tc.sub;
    b.addEventListener('click', () => setTimeControl(key));
    seg.append(b);
  }

  // Openings
  const op = $('opening');
  const opts = [['random', 'Random opening'], ...OPENINGS.map((o, i) => [String(i), `${o.eco} · ${o.name}`])];
  for (const [v, label] of opts) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    op.append(o);
  }
  op.addEventListener('change', () => {
    state.openingChoice = op.value;
    saveSettings();
  });

  $('startPos').addEventListener('change', (e) => {
    state.startPos = e.target.checked;
    $('openingRow').hidden = state.startPos;
    saveSettings();
    toast('Applies from the next game');
  });
  $('stepMode').addEventListener('change', async (e) => {
    state.stepMode = e.target.checked;
    saveSettings();
    if (state.stepMode) clearNextGameTimer();
    await restartIfRunning();
    render();
    renderLive();
  });
  $('autoplay').addEventListener('change', (e) => {
    state.autoplay = e.target.checked;
    saveSettings();
    if (!state.autoplay) clearNextGameTimer();
    renderResult();
  });
  $('arrow').addEventListener('change', (e) => {
    state.arrow = e.target.checked;
    saveSettings();
    renderArrow();
  });
  const setSound = (on) => {
    state.sound = on;
    sound.setEnabled(on);
    saveSettings();
    renderSound();
    if (on) sound.play('move');
  };
  $('sound').addEventListener('change', (e) => setSound(e.target.checked));
  $('btnSound').addEventListener('click', () => {
    if (state.sound && sound.isLocked()) {
      sound.unlock();
      return;
    }
    setSound(!state.sound);
  });
  sound.onLockChange(renderSound);

  // Tabs
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t.id.slice(4)));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      e.stopPropagation();
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      selectTab(next.id.slice(4));
      next.focus();
    });
  });
  try {
    const t = sessionStorage.getItem('chesswatch:tab');
    if (t && $('tab-' + t)) selectTab(t);
  } catch {
    /* ignore */
  }

  // Transport
  $('btnPlay').addEventListener('click', () => (state.running ? pause() : start()));
  $('btnStep').addEventListener('click', nextMove);
  setupBoardInput();
  $('btnNew').addEventListener('click', () => newGame());
  $('btnAgain').addEventListener('click', () => newGame());
  $('btnFlip').addEventListener('click', flip);
  $('btnPgn').addEventListener('click', copyPgn);
  $('btnLive').addEventListener('click', () => goTo(null));
  $('btnFirst').addEventListener('click', () => goTo(-1));
  $('btnPrev').addEventListener('click', () => step(-1));
  $('btnNext').addEventListener('click', () => step(1));
  $('btnLast').addEventListener('click', () => goTo(null));
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
    if (e.target.closest('input, select, textarea, [role="tab"]') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === ' ') {
      e.preventDefault();
      $('btnPlay').click();
    } else if (k === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    } else if (k === 'ArrowRight') {
      e.preventDefault();
      step(1);
    } else if (k === 'Home') {
      goTo(-1);
    } else if (k === 'End' || k === 'Escape') {
      goTo(null);
    } else if (k === 'Enter' && !e.target.closest('button, a')) {
      e.preventDefault();
      nextMove();
    } else if (k === 'f' || k === 'F') {
      flip();
    } else if (k === 'n' || k === 'N') {
      newGame();
    } else if (k === 'm' || k === 'M') {
      $('btnSound').click();
    }
  });
}

// Re-start the game loop from the current position (after changing players or modes).
async function restartIfRunning() {
  if (!state.running) return;
  await halt();
  start();
}

// ---------------------------------------------------------------- Playing by hand

function squareFromPoint(x, y) {
  const el = document.elementFromPoint(x, y)?.closest?.('.sq');
  return el && boardEl.contains(el) ? el.dataset.sq : null;
}

function legalTargets(from) {
  return state.chess.moves({ square: from, verbose: true });
}

function askPromotion(color) {
  return new Promise((resolve) => {
    const box = $('promo');
    for (const b of box.querySelectorAll('button')) {
      b.querySelector('.pc').className = 'pc ' + color + b.dataset.p.toUpperCase();
      b.onclick = () => {
        box.hidden = true;
        resolve(b.dataset.p);
      };
    }
    box.onclick = (e) => {
      if (e.target === box) {
        box.hidden = true;
        resolve(null);
      }
    };
    box.hidden = false;
    box.querySelector('button').focus();
  });
}

async function tryHumanMove(from, to, animate) {
  if (!humanToMove()) return false;
  const options = legalTargets(from).filter((m) => m.to === to);
  if (!options.length) return false;
  let promotion;
  if (options.some((m) => m.promotion)) {
    promotion = await askPromotion(state.chess.turn());
    if (!promotion || !humanToMove()) return false;
  }
  const side = state.chess.turn();
  const mv = state.chess.move({ from, to, promotion });
  const elapsed = performance.now() - (state.thinking?.start ?? performance.now());
  state.thinking = null;
  state.selected = null;
  const resolve = state.humanWaiter;
  state.humanWaiter = null;
  if (playMove(mv, side, elapsed, null, animate)) resolve?.(true);
  else resolve?.(false);
  return true;
}

function setupBoardInput() {
  let drag = null; // { from, pointerId, ghost, piece, startX, startY, moved }

  boardEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (!humanToMove()) {
      if (state.humanWaiter && state.viewPly != null) goTo(null); // back to the live position
      return;
    }
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    const piece = state.chess.get(sq);
    if (state.selected && state.selected !== sq && legalTargets(state.selected).some((m) => m.to === sq)) {
      tryHumanMove(state.selected, sq, true);
      return;
    }
    if (!piece || piece.color !== state.chess.turn()) {
      state.selected = null;
      renderInput();
      return;
    }
    e.preventDefault();
    state.selected = sq;
    renderInput();
    const pc = squareEls.get(sq).querySelector('.pc');
    drag = { from: sq, pointerId: e.pointerId, pc, ghost: null, startX: e.clientX, startY: e.clientY };
    boardEl.setPointerCapture(e.pointerId);
  });

  boardEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return;
      const size = drag.pc.getBoundingClientRect().width;
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'ghost ' + [...drag.pc.classList].find((c) => /^[wb][PNBRQK]$/.test(c));
      drag.ghost.style.width = drag.ghost.style.height = size + 'px';
      document.body.append(drag.ghost);
      drag.pc.classList.add('lifted');
    }
    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';
    const over = squareFromPoint(e.clientX, e.clientY);
    for (const [sq, el] of squareEls) el.classList.toggle('drop-target', sq === over && sq !== drag.from);
  });

  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    for (const el of squareEls.values()) el.classList.remove('drop-target');
    if (!d.ghost) return; // a plain click keeps the piece selected
    d.ghost.remove();
    d.pc.classList.remove('lifted');
    const to = e.type === 'pointerup' ? squareFromPoint(e.clientX, e.clientY) : null;
    if (to && to !== d.from) {
      tryHumanMove(d.from, to, false).then((ok) => {
        if (!ok) {
          state.selected = null;
          renderInput();
        }
      });
    }
  };
  boardEl.addEventListener('pointerup', endDrag);
  boardEl.addEventListener('pointercancel', endDrag);
}

function setTimeControl(key) {
  const next = TIME_CONTROLS[key];
  const prev = state.tc;
  state.tcKey = key;
  saveSettings();
  const midGame = state.plies.some((p) => !p.book) && !state.over;
  if (next.type !== 'clock' && prev.type !== 'clock') {
    state.tc = next;
    state.pendingTc = null;
    $('tcHint').textContent = '';
  } else if (midGame) {
    state.pendingTc = next;
    $('tcHint').textContent = 'Applies from the next game.';
  } else {
    state.tc = next;
    state.pendingTc = null;
    state.clock = next.type === 'clock' ? { w: next.base, b: next.base } : { w: 0, b: 0 };
    $('tcHint').textContent = '';
  }
  renderSetup();
  renderPlayers();
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
  sound.init();
  sound.setEnabled(state.sound);
  renderSetup();
  render();
  renderLive();

  try {
    await Promise.all([ensureEngine('w'), ensureEngine('b')]);
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
