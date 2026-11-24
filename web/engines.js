// Every Stockfish build that runs in a browser without special server headers.
// Newer engines use a neural network (NNUE) and can be limited by Elo,
// older ones use the classic hand-written evaluation and a 0–20 skill level.

// Where the website lives. The desktop and iOS apps load very large engine
// files from here instead of shipping them inside the app.
export const SITE_URL = 'https://enricozehnder.github.io/chesswatch/';

export const ENGINES = [
  {
    id: 'sf19-lite',
    name: 'Stockfish 19 Lite',
    version: '19',
    tag: 'Lite',
    eval: 'NNUE',
    script: 'engines/sf19-lite/stockfish-19-lite-single.js',
    size: '1.8 MB',
    note: 'Fast to load, small neural network',
  },
  {
    id: 'sf19',
    name: 'Stockfish 19',
    version: '19',
    eval: 'NNUE',
    script: 'engines/sf19/stockfish-19-single.js',
    wasm: 'engines/sf19/stockfish-19-single.wasm',
    remoteInApps: true,
    size: '95 MB',
    note: 'Full strength, big download',
  },
  {
    id: 'sf18',
    name: 'Stockfish 18 Lite',
    version: '18',
    tag: 'Lite',
    eval: 'NNUE',
    script: 'engines/sf18/stockfish-18-lite-single.js',
    size: '7 MB',
  },
  {
    id: 'sf17',
    name: 'Stockfish 17.1 Lite',
    version: '17',
    tag: 'Lite',
    eval: 'NNUE',
    script: 'engines/sf17/stockfish-17.1-lite-single-03e3232.js',
    size: '7 MB',
  },
  {
    id: 'sf16',
    name: 'Stockfish 16',
    version: '16',
    eval: 'NNUE',
    script: 'engines/sf16/stockfish-nnue-16-single.js',
    size: '39 MB',
  },
  {
    id: 'sf11',
    name: 'Stockfish 11',
    version: '11',
    eval: 'Classic',
    script: 'engines/sf11/stockfish.js',
    size: '3.6 MB',
    note: 'Last version before neural networks',
  },
  {
    id: 'sf10',
    name: 'Stockfish 10',
    version: '10',
    eval: 'Classic',
    script: 'engines/sf10/stockfish.js',
    size: '0.4 MB',
  },
  {
    id: 'sf8',
    name: 'Stockfish 8',
    version: '8',
    eval: 'Classic',
    script: 'engines/sf8/stockfish.js',
    size: '1 MB',
    note: 'The one AlphaZero played in 2017',
  },
  {
    id: 'sf6',
    name: 'Stockfish 6',
    version: '6',
    eval: 'Classic',
    script: 'engines/sf6/stockfish.js',
    size: '3.2 MB',
    note: 'Oldest browser build',
  },
];

export const DEFAULT_ENGINE = 'sf19-lite';

export function engineById(id) {
  return ENGINES.find((e) => e.id === id) || ENGINES.find((e) => e.id === DEFAULT_ENGINE);
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
