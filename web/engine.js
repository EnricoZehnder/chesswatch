// Thin wrapper around a Stockfish web worker that speaks UCI.

const ENGINE_URL = new URL('./vendor/stockfish-19-lite-single.js', import.meta.url).href;

export class Engine {
  constructor() {
    this.worker = new Worker(ENGINE_URL);
    this.listeners = new Set();
    this.busy = null; // promise of the running search
    this.name = 'Stockfish';
    this.limited = false;
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      for (const fn of [...this.listeners]) fn(line);
    };
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  waitFor(re) {
    return new Promise((resolve) => {
      const fn = (line) => {
        if (re.test(line)) {
          this.listeners.delete(fn);
          resolve(line);
        }
      };
      this.listeners.add(fn);
    });
  }

  async init() {
    const idLine = this.waitFor(/^id name /);
    this.send('uci');
    this.name = (await idLine).slice(8).replace(/\s*WASM$/, '');
    await this.waitFor(/^uciok/);
    this.send('setoption name Hash value 32');
    await this.ready();
  }

  async ready() {
    const p = this.waitFor(/^readyok/);
    this.send('isready');
    await p;
  }

  // strength: 'max' or an Elo number (1320–3190)
  async configure(strength) {
    await this.stop();
    this.limited = strength !== 'max';
    if (strength === 'max') {
      this.send('setoption name UCI_LimitStrength value false');
    } else {
      this.send('setoption name UCI_LimitStrength value true');
      this.send(`setoption name UCI_Elo value ${strength}`);
    }
    await this.ready();
  }

  async newGame() {
    await this.stop();
    this.send('ucinewgame');
    await this.ready();
  }

  async stop() {
    if (this.busy) {
      this.send('stop');
      await this.busy;
    }
  }

  // Starts a search. onInfo receives parsed "info" lines.
  // Resolves to { bestmove, info } once the engine reports "bestmove".
  async search(position, goCmd, onInfo) {
    await this.stop();
    let last = null;
    const done = new Promise((resolve) => {
      const fn = (line) => {
        if (line.startsWith('info ') && line.includes(' pv ') && line.includes(' score ')) {
          const info = parseInfo(line);
          if (info.multipv && info.multipv !== 1) return;
          // With limited strength, Stockfish ends with a pseudo line for the
          // deliberately weaker move ("score cp 0", no new depth). The score
          // before it is the real one; only take the chosen move from the last line.
          if (this.limited && last && info.cp === 0 && last.cp !== 0 && info.depth <= last.depth) {
            last = { ...last, pv: info.pv };
          } else {
            last = info;
          }
          onInfo?.(last);
        } else if (line.startsWith('bestmove')) {
          this.listeners.delete(fn);
          resolve({ bestmove: line.split(/\s+/)[1], info: last });
        }
      };
      this.listeners.add(fn);
    });
    this.busy = done.finally(() => { this.busy = null; });
    this.send(position);
    this.send(goCmd);
    return done;
  }

  terminate() {
    this.worker.terminate();
  }
}

function parseInfo(line) {
  const t = line.split(/\s+/);
  const info = { depth: 0, seldepth: 0, nodes: 0, nps: 0, time: 0, pv: [], multipv: 1 };
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth': info.depth = +t[++i]; break;
      case 'seldepth': info.seldepth = +t[++i]; break;
      case 'multipv': info.multipv = +t[++i]; break;
      case 'nodes': info.nodes = +t[++i]; break;
      case 'nps': info.nps = +t[++i]; break;
      case 'time': info.time = +t[++i]; break;
      case 'score': {
        const kind = t[++i];
        const val = +t[++i];
        if (kind === 'cp') info.cp = val; else info.mate = val;
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') i++;
        break;
      }
      case 'pv': info.pv = t.slice(i + 1); i = t.length; break;
    }
  }
  return info;
}
