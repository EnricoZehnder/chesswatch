// Every engine that runs in a browser without special server headers.
// strength: 'elo'   = UCI_Elo 1320–max (newer Stockfish)
//           'skill' = Skill Level 0–20 (older Stockfish)
//           'level' = no built-in setting; Chesswatch limits the search nodes instead

// Where the website lives. The desktop and iOS apps load very large engine
// files from here instead of shipping them inside the app.
export const SITE_URL = 'https://enricozehnder.github.io/chesswatch/';

export const HUMAN = {
  id: 'human',
  name: 'You',
  human: true,
  badge: 'You',
  family: 'human',
  note: 'Drag or click the pieces to play this side yourself',
};

export const ENGINES = [
  {
    id: 'sf19-lite',
    name: 'Stockfish 19 Lite',
    badge: '19',
    sub: 'SF',
    family: 'stockfish',
    group: 'Stockfish',
    eval: 'NNUE',
    strength: 'elo',
    script: 'engines/sf19-lite/stockfish-19-lite-single.js',
    size: '1.8 MB',
    note: 'Fast to load, small neural network',
  },
  {
    id: 'sf19',
    name: 'Stockfish 19',
    badge: '19',
    sub: 'SF',
    family: 'stockfish',
    group: 'Stockfish',
    eval: 'NNUE',
    strength: 'elo',
    script: 'engines/sf19/stockfish-19-single.js',
    wasm: 'engines/sf19/stockfish-19-single.wasm',
    remoteInApps: true,
    size: '95 MB',
    note: 'Full strength, big download',
  },
  {
    id: 'sf18',
    name: 'Stockfish 18 Lite',
    badge: '18',
    sub: 'SF',
    family: 'stockfish',
    group: 'Stockfish',
    eval: 'NNUE',
    strength: 'elo',
    script: 'engines/sf18/stockfish-18-lite-single.js',
    size: '7 MB',
  },
  {
    id: 'sf17',
    name: 'Stockfish 17.1 Lite',
    badge: '17',
    sub: 'SF',
    family: 'stockfish',
    group: 'Stockfish',
    eval: 'NNUE',
    strength: 'elo',
    script: 'engines/sf17/stockfish-17.1-lite-single-03e3232.js',
    size: '7 MB',
  },
  {
    id: 'sf16',
    name: 'Stockfish 16',
    badge: '16',
    sub: 'SF',
    family: 'stockfish',
    group: 'Stockfish',
    eval: 'NNUE',
    strength: 'elo',
    script: 'engines/sf16/stockfish-nnue-16-single.js',
    size: '39 MB',
  },
  {
    id: 'sf11',
    name: 'Stockfish 11',
    badge: '11',
    sub: 'SF',
    family: 'stockfish-classic',
    group: 'Classic Stockfish',
    eval: 'Classic',
    strength: 'skill',
    script: 'engines/sf11/stockfish.js',
    size: '3.6 MB',
    note: 'Last version before neural networks',
  },
  {
    id: 'sf10',
    name: 'Stockfish 10',
    badge: '10',
    sub: 'SF',
    family: 'stockfish-classic',
    group: 'Classic Stockfish',
    eval: 'Classic',
    strength: 'skill',
    script: 'engines/sf10/stockfish.js',
    size: '0.4 MB',
  },
  {
    id: 'sf8',
    name: 'Stockfish 8',
    badge: '8',
    sub: 'SF',
    family: 'stockfish-classic',
    group: 'Classic Stockfish',
    eval: 'Classic',
    strength: 'skill',
    script: 'engines/sf8/stockfish.js',
    size: '1 MB',
    note: 'The one AlphaZero played in 2017',
  },
  {
    id: 'sf6',
    name: 'Stockfish 6',
    badge: '6',
    sub: 'SF',
    family: 'stockfish-classic',
    group: 'Classic Stockfish',
    eval: 'Classic',
    strength: 'skill',
    script: 'engines/sf6/stockfish.js',
    size: '3.2 MB',
    note: 'Oldest browser build',
  },
  {
    id: 'berserk',
    name: 'Berserk',
    badge: 'Bk',
    family: 'berserk',
    group: 'Other engines',
    eval: 'NNUE',
    strength: 'level',
    script: 'engines/berserk/berserk.js',
    wasm: 'engines/berserk/berserk.wasm',
    remoteInApps: true,
    size: '38 MB',
    note: 'Open-source engine by Jay Honnold, built for the browser by Chesswatch',
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    badge: 'Ob',
    family: 'obsidian',
    group: 'Other engines',
    eval: 'NNUE',
    strength: 'level',
    script: 'engines/obsidian/obsidian.js',
    wasm: 'engines/obsidian/obsidian.wasm',
    remoteInApps: true,
    size: '29 MB',
    note: 'Open-source engine by Gabriele Lombardo, built for the browser by Chesswatch',
  },
  {
    id: 'lozza',
    name: 'Lozza 11',
    badge: 'Lz',
    family: 'lozza',
    group: 'Other engines',
    eval: 'NNUE',
    strength: 'level',
    script: 'engines/lozza/lozza11.0.js',
    size: '0.7 MB',
    note: 'Written entirely in JavaScript',
  },
];

export const DEFAULT_ENGINE = 'sf19-lite';

export function engineById(id) {
  if (id === 'human') return HUMAN;
  return ENGINES.find((e) => e.id === id) || ENGINES.find((e) => e.id === DEFAULT_ENGINE);
}

export function isValidPlayer(id) {
  return id === 'human' || ENGINES.some((e) => e.id === id);
}

// Inside the desktop/iOS app the page isn't served over http(s).
export function isApp() {
  return !/^https?:$/.test(location.protocol);
}

export function workerUrl(engine) {
  const script = new URL(engine.script, location.href).href;
  if (engine.remoteInApps && isApp()) {
    return script + '#' + encodeURIComponent(SITE_URL + engine.wasm);
  }
  return script;
}
