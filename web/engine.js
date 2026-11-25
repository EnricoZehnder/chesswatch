// Thin wrapper around a Stockfish web worker that speaks UCI.
import { workerUrl } from './engines.js';

export class Engine {
  constructor(def) {
    this.def = def;
    this.worker = new Worker(workerUrl(def));
    this.listeners = new Set();
    this.busy = null; // promise of the running search
    this.options = {}; // UCI options the engine reported
    this.limited = false;
    this.nodeLimit = 0; // for engines without a strength setting
    this.dead = false;
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      for (const fn of [...this.listeners]) fn(line);
    };
    this.failed = new Promise((_, reject) => {
      this.worker.onerror = (e) => reject(new Error(e.message || 'Engine failed to load'));
    });
    this.failed.catch(() => {});
  }

  send(cmd) {
    if (!this.dead) this.worker.postMessage(cmd);
  }

  waitFor(re) {
    const p = new Promise((resolve) => {
      const fn = (line) => {
        if (re.test(line)) {
          this.listeners.delete(fn);
          resolve(line);
        }
      };
      this.listeners.add(fn);
    });
    return Promise.race([p, this.failed]);
  }

  async init() {
    const collect = (line) => {
      const m = line.match(/^option name (.+?) type (\w+)(?: default (\S*))?(?: min (-?\d+))?(?: max (-?\d+))?/);
      if (m) this.options[m[1]] = { type: m[2], def: m[3], min: m[4] != null ? +m[4] : null, max: m[5] != null ? +m[5] : null };
    };
    this.listeners.add(collect);
    this.send('uci');
    await this.waitFor(/^uciok/);
    this.listeners.delete(collect);
    const hash = this.options.Hash;
    if (hash && (hash.max == null || hash.max >= 32)) this.send('setoption name Hash value 32');
    await this.ready();
  }

  get usesElo() {
    return !!this.options.UCI_Elo;
  }

  get eloRange() {
    const o = this.options.UCI_Elo;
    return o ? [o.min ?? 1320, o.max ?? 3190] : null;
  }

  async ready() {
    const p = this.waitFor(/^readyok/);
    this.send('isready');
    await p;
  }

  // level: 0–100, where 100 means full strength.
  async configure(level) {
    await this.stop();
    const full = level >= 100;
    this.limited = !full;
    this.nodeLimit = 0;
    if (this.usesElo) {
      if (full) {
        this.send('setoption name UCI_LimitStrength value false');
        this.send('setoption name Skill Level value 20');
      } else {
        this.send('setoption name UCI_LimitStrength value true');
        this.send(`setoption name UCI_Elo value ${levelToElo(level, this.eloRange)}`);
      }
    } else if (this.options['Skill Level']) {
      this.send(`setoption name Skill Level value ${levelToSkill(level)}`);
    } else if (!full) {
      this.nodeLimit = levelToNodes(level);
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
    this.busy = done.finally(() => {
      this.busy = null;
    });
    this.send(position);
    this.send(goCmd);
    return done;
  }

  terminate() {
    this.dead = true;
    this.listeners.clear();
    this.worker.terminate();
  }
}

export function levelToElo(level, range = [1320, 3190]) {
  const [lo, hi] = range;
  return Math.round((lo + (level / 100) * (hi - lo)) / 10) * 10;
}

// Level 0 ≈ 40 nodes per move (very weak), level 99 ≈ 900k nodes.
export function levelToNodes(level) {
  return Math.round(40 * Math.pow(25000, level / 100));
}

export function levelToSkill(level) {
  return Math.max(0, Math.min(20, Math.round((level / 100) * 20)));
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
      case 'pv': {
        // Some old builds append extra fields after the moves; keep only moves.
        const rest = t.slice(i + 1);
        const end = rest.findIndex((m) => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m));
        info.pv = end === -1 ? rest : rest.slice(0, end);
        i = t.length;
        break;
      }
    }
  }
  return info;
}
