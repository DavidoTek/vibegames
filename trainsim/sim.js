// Rail network model and train simulation. No DOM in here, so the capacity
// analysis can run headless copies of the whole simulation.
//
// Track lives on a grid: every edge joins two neighbouring grid points
// (8 directions). A train may pass a node only if it turns by at most 45°,
// so any node with several such continuations is a switch.
// Directed edge ids: de = edge * 2 + side, side 0 = a->b, 1 = b->a.

export const DX = [1, 1, 0, -1, -1, -1, 0, 1];
export const DY = [0, 1, 1, 1, 0, -1, -1, -1];
export const DIR_NAMES = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];

export const TIME_SCALE = 10;     // game seconds per simulated second (clock and per-hour figures)
export const KMH = 25;            // km/h per cell/s, display only
export const HOUR = 3600 / TIME_SCALE;
const REV_COST = 12;              // pathfinding cost of reversing at a platform
const BUSY_COST = 10;             // soft cost of track that another train holds
const PASS_COST = 1.5;            // extra cost per cell through another station's platform
export const STUCK_TIME = 60;     // a train waiting this long (sim s) is towed away
const EMA_TIME = 60;              // smoothing time (sim s) for usage figures

export const TYPES = {
  commuter: { name: "Commuter", vmax: 3.5, acc: 1.8, dec: 2.6, len: 2.4, cars: 2, dwell: 3 },
  regional: { name: "Regional", vmax: 4.2, acc: 1.4, dec: 2.4, len: 3.2, cars: 3, dwell: 4 },
  express: { name: "Express", vmax: 6, acc: 1.1, dec: 2.2, len: 4.4, cars: 4, dwell: 5 },
  freight: { name: "Freight", vmax: 3, acc: 0.5, dec: 1.4, len: 6, cars: 7, dwell: 10 },
};

export const LINE_COLORS = ["#ff5a5f", "#3fa7ff", "#ffc145", "#47d18c", "#b07bff", "#ff8f3f", "#4fe0e0", "#ff6fb5"];
export const STATION_NAMES = [
  "Oakridge", "Millbrook", "Ferngate", "Ashby", "Kingsmoor", "Riverside", "Elmstead", "Northgate",
  "Lakeside", "Stonebridge", "Bramley", "Cliffton", "Redhill", "Fairview", "Hollow End", "Marston",
];

export function dirOf(dx, dy) {
  for (let i = 0; i < 8; i++) if (DX[i] === dx && DY[i] === dy) return i;
  return -1;
}

export function edgeKey(x1, y1, x2, y2) {
  if (x1 > x2 || (x1 === x2 && y1 > y2)) return `${x2},${y2},${x1},${y1}`;
  return `${x1},${y1},${x2},${y2}`;
}

// ---------------------------------------------------------------------------
// Layout: the plain, JSON-serialisable description of a map

export function emptyLayout() {
  return { tracks: {}, platforms: {}, signals: {}, stations: {}, lines: [], nextId: 1 };
}

// Unit edge keys along a straight or 45° line.
export function octiline(x1, y1, x2, y2) {
  const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
  const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  const keys = [];
  for (let i = 0; i < n; i++) {
    keys.push(edgeKey(x1 + dx * i, y1 + dy * i, x1 + dx * (i + 1), y1 + dy * (i + 1)));
  }
  return keys;
}

export function polyKeys(pts) {
  const keys = [];
  for (let i = 1; i < pts.length; i++) keys.push(...octiline(...pts[i - 1], ...pts[i]));
  return keys;
}

// The two-leg route a drag draws: straight then diagonal, or diagonal first.
export function dragPath(x1, y1, x2, y2, diagFirst) {
  const ax = Math.abs(x2 - x1), ay = Math.abs(y2 - y1);
  const sx = Math.sign(x2 - x1), sy = Math.sign(y2 - y1);
  const d = Math.min(ax, ay);
  let mid;
  if (diagFirst) mid = [x1 + sx * d, y1 + sy * d];
  else mid = ax > ay ? [x2 - sx * d, y1] : [x1, y2 - sy * d];
  return [[x1, y1], mid, [x2, y2]];
}

export function addTrack(L, pts) {
  for (const k of polyKeys(pts)) L.tracks[k] = 1;
}

export function addStation(L, name) {
  const id = "s" + L.nextId++;
  L.stations[id] = { name };
  return id;
}

export function markPlatform(L, id, pts) {
  for (const k of polyKeys(pts)) if (L.tracks[k]) L.platforms[k] = id;
}

export function signalKey(x, y, d) {
  return `${x},${y},${d}`;
}

export function lineSeq(L, line) {
  const s = line.stops.filter((id) => L.stations[id]);
  if (s.length < 2 || line.circular) return s;
  return s.concat(s.slice(1, -1).reverse());
}

// ---------------------------------------------------------------------------
// Net: graph derived from a layout (rebuilt after every edit)

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    this.topKey = k[0];
    const lk = k.pop(), lv = v.pop();
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export class Net {
  constructor(L) {
    this.nodes = new Map();
    this.nodeList = [];
    this.edges = [];
    this.byKey = new Map();
    const node = (x, y) => {
      const k = x + "," + y;
      let n = this.nodes.get(k);
      if (!n) {
        n = { x, y, k, i: this.nodeList.length, adj: [-1, -1, -1, -1, -1, -1, -1, -1], sw: false, deg: 0 };
        this.nodes.set(k, n);
        this.nodeList.push(n);
      }
      return n;
    };
    for (const k of Object.keys(L.tracks)) {
      const [x1, y1, x2, y2] = k.split(",").map(Number);
      const d = dirOf(x2 - x1, y2 - y1);
      if (d < 0) continue;
      const a = node(x1, y1), b = node(x2, y2);
      const st = L.platforms[k];
      const e = { i: this.edges.length, k, a, b, d, len: d % 2 ? Math.SQRT2 : 1, st: st && L.stations[st] ? st : null, cross: -1 };
      a.adj[d] = e.i; b.adj[(d + 4) % 8] = e.i;
      a.deg++; b.deg++;
      this.edges.push(e);
      this.byKey.set(k, e);
    }
    // Two diagonals of the same grid cell cross each other without a node.
    for (const e of this.edges) {
      if (e.d % 2 === 0) continue;
      const o = this.byKey.get(edgeKey(e.a.x, e.b.y, e.b.x, e.a.y));
      if (o) e.cross = o.i;
    }

    const D = this.edges.length * 2;
    this.nexts = new Array(D);
    this.prevs = Array.from({ length: D }, () => []);
    for (let de = 0; de < D; de++) {
      const e = this.edges[de >> 1], dir = this.dirOf(de), to = this.to(de);
      const out = [];
      for (const k of [dir, (dir + 1) % 8, (dir + 7) % 8]) {
        const j = to.adj[k];
        if (j >= 0 && j !== e.i) out.push(j * 2 + (this.edges[j].a === to ? 0 : 1));
      }
      this.nexts[de] = out;
      if (out.length > 1) to.sw = true;
    }
    for (let de = 0; de < D; de++) for (const n of this.nexts[de]) this.prevs[n].push(de);

    // Signals: at node (x,y) for trains arriving there travelling in direction d.
    // 0 = two-way (only trains facing it stop), 1 = one-way (no entry from behind).
    this.sig = new Int8Array(D).fill(-1);
    this.sigList = [];
    for (const [k, oneWay] of Object.entries(L.signals)) {
      const [x, y, d] = k.split(",").map(Number);
      const n = this.nodes.get(x + "," + y);
      const j = n ? n.adj[(d + 4) % 8] : -1;
      if (j < 0) continue;
      const de = j * 2 + (this.edges[j].b === n ? 0 : 1);
      this.sig[de] = oneWay ? 1 : 0;
      this.sigList.push(de);
    }

    this.stations = new Map();
    for (const [id, s] of Object.entries(L.stations)) {
      this.stations.set(id, { id, name: s.name, edges: [], cx: 0, cy: 0, top: 0, tracks: 0 });
    }
    for (const e of this.edges) if (e.st) this.stations.get(e.st).edges.push(e.i);
    for (const s of this.stations.values()) {
      if (!s.edges.length) continue;
      let sx = 0, sy = 0, top = Infinity;
      for (const i of s.edges) {
        const e = this.edges[i];
        sx += e.a.x + e.b.x; sy += e.a.y + e.b.y;
        top = Math.min(top, e.a.y, e.b.y);
      }
      s.cx = sx / (2 * s.edges.length);
      s.cy = sy / (2 * s.edges.length);
      s.top = top;
      s.tracks = this.countTracks(s);
    }
    this.legCache = new Map();
  }

  dirOf(de) { const e = this.edges[de >> 1]; return de & 1 ? (e.d + 4) % 8 : e.d; }
  from(de) { const e = this.edges[de >> 1]; return de & 1 ? e.b : e.a; }
  to(de) { const e = this.edges[de >> 1]; return de & 1 ? e.a : e.b; }
  len(de) { return this.edges[de >> 1].len; }
  blocked(de) { return this.sig[de ^ 1] === 1; }

  // Platform tracks = groups of platform edges connected through nodes.
  countTracks(s) {
    const seen = new Set();
    let n = 0;
    for (const i of s.edges) {
      if (seen.has(i)) continue;
      n++;
      const stack = [i];
      seen.add(i);
      while (stack.length) {
        const e = this.edges[stack.pop()];
        for (const nd of [e.a, e.b]) for (const j of nd.adj) {
          if (j >= 0 && !seen.has(j) && this.edges[j].st === s.id) { seen.add(j); stack.push(j); }
        }
      }
    }
    return n;
  }

  // Platform edges that continue straight on after `de` (where a train stops).
  chain(de, st) {
    const out = [];
    const seen = new Set([de >> 1]);
    let cur = de;
    for (;;) {
      let nx = -1;
      for (const n of this.nexts[cur]) {
        if (this.edges[n >> 1].st !== st || seen.has(n >> 1) || this.blocked(n)) continue;
        if (nx < 0 || this.dirOf(n) === this.dirOf(cur)) nx = n;
      }
      if (nx < 0) return out;
      out.push(nx);
      seen.add(nx >> 1);
      cur = nx;
    }
  }

  // Cheapest route from the end of directed edge `from` to a stopping point
  // at station `st`. owner(edge) says who else holds an edge (0 = nobody,
  // Infinity = impassable); each other train in the way adds a fixed cost,
  // so a train prefers a free platform but won't detour around one it is
  // merely following. When
  // `after` is given, platforms are also scored by how well the train can
  // carry on from there, so a train bound for a branch picks a platform that
  // leads onto it.
  search(from, st, owner, after) {
    const D = this.edges.length * 2;
    const dist = new Float64Array(D).fill(Infinity);
    const prev = new Int32Array(D).fill(-1);
    const heap = new Heap();
    const relax = (de, c, p) => {
      if (c < dist[de]) { dist[de] = c; prev[de] = p; heap.push(c, de); }
    };
    const cost = (de, cur) => {
      if (this.blocked(de)) return Infinity;
      const o = owner ? owner(de >> 1) : 0;
      if (o === Infinity) return Infinity;
      const x = o && o !== owner(cur >> 1) ? BUSY_COST : 0;
      const e = this.edges[de >> 1];
      // Running through other stations' platforms is allowed but discouraged,
      // so through trains don't wander onto single-track detours via stations.
      const pass = e.st && e.st !== st ? e.len * PASS_COST : 0;
      return e.len + x + pass + (cur >= 0 && this.dirOf(de) !== this.dirOf(cur) ? 0.15 : 0);
    };
    for (const d of this.nexts[from]) relax(d, cost(d, from), -1);
    let best = -1, bestCost = Infinity, bestChain = null;
    while (heap.size) {
      const de = heap.pop(), c = heap.topKey;
      if (c > dist[de]) continue;
      if (c >= bestCost) break;
      if (this.edges[de >> 1].st === st) {
        const chain = this.chain(de, st);
        let total = c, cur = de;
        for (const d of chain) { total += cost(d, cur); cur = d; }
        total += this.legCost(chain.length ? chain[chain.length - 1] : de, after);
        if (total < bestCost) { bestCost = total; best = de; bestChain = chain; }
      }
      for (const n of this.nexts[de]) {
        const w = cost(n, de);
        if (w < Infinity) relax(n, c + w, de);
      }
    }
    if (best < 0 || bestCost === Infinity) return null;
    const des = [];
    for (let d = best; d >= 0; d = prev[d]) des.push(d);
    des.reverse();
    return { des: des.concat(bestChain), cost: bestCost };
  }

  // Static estimate of the next leg from a stopping point (cached).
  legCost(endDe, st) {
    if (!st) return 0;
    const key = endDe + "|" + st;
    let c = this.legCache.get(key);
    if (c === undefined) {
      const f = this.search(endDe, st, null, null);
      const r = this.search(endDe ^ 1, st, null, null);
      c = Math.min(f ? f.cost : 1e4, r ? r.cost + REV_COST : 1e4);
      this.legCache.set(key, c);
    }
    return c;
  }

  nearestEdge(wx, wy, maxD) {
    let best = null, bd = maxD;
    for (const e of this.edges) {
      const d = segDist(wx, wy, e.a.x, e.a.y, e.b.x, e.b.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
}

export function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
}

// ---------------------------------------------------------------------------
// Sim: trains, reservations and statistics
//
// Every train reserves track before it may use it: from where it stands up
// to the next signal facing it, or straight to its platform if there is no
// signal in between (like path signals). Trains only ever move inside their
// own reservation, so they can't collide; reservations are released edge by
// edge as the tail clears them.

export class Sim {
  constructor(L, opts = {}) {
    this.L = L;
    this.headless = !!opts.headless;
    this.t = 0;
    this.t0 = 0;
    this.trains = [];
    this.nextTrain = 1;
    this.events = [];             // messages for the UI (towed trains)
    this.cursor = new Map();
    this.spawnT = 0;
    this.net = null;
    this.switchSet = new Map();
    this.resetStats();
    this.rebuild();
  }

  resetStats() {
    this.t0 = this.t;
    this.lineStats = new Map();
    this.stationStats = new Map();
    this.deadlocks = 0;
  }

  lineStat(id) {
    let s = this.lineStats.get(id);
    if (!s) this.lineStats.set(id, s = { arr: [], run: 0, wait: 0, dwell: 0 });
    return s;
  }

  stationStat(id) {
    let s = this.stationStats.get(id);
    if (!s) this.stationStats.set(id, s = { arr: [] });
    return s;
  }

  // Arrivals per game hour over the last game hour.
  perHour(arr) {
    while (arr.length && arr[0] < this.t - HOUR) arr.shift();
    const span = Math.min(HOUR, this.t - this.t0);
    return span > 1 ? arr.length * HOUR / span : 0;
  }

  rebuild() {
    const old = this.net;
    const saved = old ? this.trains.map((t) => ({ t, path: t.path.map((de) => [old.edges[de >> 1].k, de & 1]) })) : [];
    const oldUtil = new Map();
    if (old) old.edges.forEach((e, i) => oldUtil.set(e.k, this.util[i]));
    const net = this.net = new Net(this.L);
    const E = net.edges.length;
    this.resv = new Int32Array(E);
    this.util = new Float32Array(E);
    net.edges.forEach((e, i) => { this.util[i] = oldUtil.get(e.k) || 0; });
    this.sigWait = new Float32Array(E * 2);
    this.waitNow = new Uint8Array(E * 2);
    this.switchSet = new Map();
    this.trains = [];
    for (const { t, path } of saved) {
      const des = path.map(([k, s]) => { const e = net.byKey.get(k); return e ? e.i * 2 + s : -1; });
      const ok = des.every((d, i) => d >= 0 && (i === 0 || net.nexts[des[i - 1]].includes(d)))
        && des.every((d) => !this.resv[d >> 1])
        && this.L.lines.some((l) => l.id === t.line);
      if (!ok) continue;
      t.path = des;
      for (const d of des) this.resv[d >> 1] = t.id;
      this.trains.push(t);
    }
  }

  step(dt) {
    this.t += dt;
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 1; this.balanceLines(); }
    this.waitNow.fill(0);
    for (const tr of this.trains) this.stepTrain(tr, dt);
    // Deadlock breaker: tow away trains that have been stuck for ages; the
    // line respawns them somewhere free. Counted so the stats show it.
    for (const tr of this.trains) {
      if (tr.waitT < STUCK_TIME) continue;
      this.deadlocks++;
      this.lineStat(tr.line).deadlocks = (this.lineStat(tr.line).deadlocks || 0) + 1;
      this.events.push({ kind: "towed", train: tr, t: this.t });
      this.removeTrain(tr);
    }
    if (this.headless) return;
    const k = Math.min(1, dt / EMA_TIME);
    const u = this.util, r = this.resv;
    for (let i = 0; i < u.length; i++) u[i] += ((r[i] ? 1 : 0) - u[i]) * k;
    for (const de of this.net.sigList) this.sigWait[de] += (this.waitNow[de] - this.sigWait[de]) * k;
  }

  // Spawn or retire trains until every line runs as many as it asks for.
  balanceLines() {
    for (const tr of [...this.trains]) {
      if (!this.L.lines.some((l) => l.id === tr.line)) this.removeTrain(tr);
    }
    for (const line of this.L.lines) {
      const mine = this.trains.filter((t) => t.line === line.id);
      if (mine.length < line.trains) this.spawn(line);
      else if (mine.length > line.trains) {
        const victim = mine.find((t) => t.state !== "run") || mine.find((t) => t.v === 0);
        if (victim) this.removeTrain(victim);
      }
    }
  }

  removeTrain(tr) {
    for (const d of tr.path) if (this.resv[d >> 1] === tr.id) this.resv[d >> 1] = 0;
    this.trains = this.trains.filter((t) => t !== tr);
  }

  spawn(line) {
    const seq = lineSeq(this.L, line);
    if (seq.length < 2) return false;
    const c = this.cursor.get(line.id) || 0;
    for (let k = 0; k < seq.length; k++) {
      const idx = (c + k) % seq.length;
      if (this.spawnAt(line, seq, idx)) {
        this.cursor.set(line.id, idx + 1);
        return true;
      }
    }
    return false;
  }

  spawnAt(line, seq, idx) {
    const net = this.net, st = net.stations.get(seq[idx]);
    const T = TYPES[line.type] || TYPES.regional;
    if (!st) return false;
    for (const ei of st.edges) {
      for (const side of [0, 1]) {
        const de = ei * 2 + side;
        if (net.blocked(de) || net.chain(de, st.id).length) continue;
        const body = this.walkBack(de, T.len, st.id);
        if (!body || !body.every((d) => this.edgeFree(d >> 1, -1))) continue;
        const id = this.nextTrain++;
        const tr = {
          id, line: line.id, type: line.type in TYPES ? line.type : "regional", len: T.len,
          path: body, head: 0, v: 0, odo: 0, state: "dwell", dwell: T.dwell,
          stop: idx, dest: seq[idx], after: seq[(idx + 1) % seq.length],
          final: true, tryT: 0, waitT: 0, noRouteT: 0, noRoute: false,
        };
        tr.head = body.reduce((s, d) => s + net.len(d), 0);
        for (const d of body) this.resv[d >> 1] = id;
        this.trains.push(tr);
        return true;
      }
    }
    return false;
  }

  // Edges behind a stopping point long enough to hold a train (tail first).
  walkBack(de, len, st) {
    const net = this.net;
    const body = [de];
    let acc = net.len(de), cur = de;
    while (acc < len + 0.05) {
      let pick = -1, score = -1;
      for (const p of net.prevs[cur]) {
        if (net.blocked(p) || body.includes(p) || body.includes(p ^ 1)) continue;
        const s = (net.edges[p >> 1].st === st ? 2 : 0) + (net.dirOf(p) === net.dirOf(cur) ? 1 : 0);
        if (s > score) { score = s; pick = p; }
      }
      if (pick < 0) return null;
      body.unshift(pick);
      acc += net.len(pick);
      cur = pick;
    }
    return body;
  }

  nodeFree(n, id) {
    for (const j of n.adj) {
      if (j >= 0) {
        const r = this.resv[j];
        if (r && r !== id) return false;
      }
    }
    return true;
  }

  edgeFree(e, id) {
    const r = this.resv[e];
    if (r && r !== id) return false;
    const E = this.net.edges[e];
    if (E.cross >= 0) {
      const c = this.resv[E.cross];
      if (c && c !== id) return false;
    }
    return this.nodeFree(E.a, id) && this.nodeFree(E.b, id);
  }

  line(tr) {
    return this.L.lines.find((l) => l.id === tr.line);
  }

  nextStop(tr) {
    const line = this.line(tr);
    const seq = line ? lineSeq(this.L, line) : [];
    if (!seq.length) return;
    tr.stop = (tr.stop + 1) % seq.length;
    tr.dest = seq[tr.stop];
    tr.after = seq[(tr.stop + 1) % seq.length];
  }

  stepTrain(tr, dt) {
    const T = TYPES[tr.type];
    const ls = this.lineStat(tr.line);
    if (tr.state === "dwell") {
      ls.dwell += dt;
      tr.dwell -= dt;
      if (tr.dwell > 0) return;
      this.nextStop(tr);
      tr.state = "ready";
      tr.tryT = 0;
    }
    if (tr.state === "ready") {
      tr.tryT -= dt;
      if (tr.tryT <= 0) {
        tr.tryT = 0.5;
        const r = this.advance(tr, true);
        if (r === "ok") {
          tr.state = "run";
          tr.noRouteT = 0;
          tr.noRoute = false;
        } else if (r === "noroute") {
          // Unreachable stop: give up on it after a moment so the line keeps going.
          tr.noRouteT += 0.5;
          if (tr.noRouteT >= 3) { tr.noRoute = true; tr.noRouteT = 0; this.nextStop(tr); }
        }
      }
      if (tr.state === "ready") {
        tr.waitT += dt;
        ls.wait += dt;
        return;
      }
    }

    let remain = this.plen(tr) - tr.head;
    if (!tr.final) {
      tr.tryT -= dt;
      if (remain < tr.v * tr.v / (2 * T.dec) + 1.5 && tr.tryT <= 0) {
        tr.tryT = this.advance(tr, false) === "ok" ? 0 : 0.4;
        remain = this.plen(tr) - tr.head;
      }
    }
    const room = Math.max(0, remain - (tr.final ? 0 : 0.12));
    tr.v = Math.min(tr.v + T.acc * dt, T.vmax, Math.sqrt(2 * T.dec * room));
    const mv = Math.min(tr.v * dt, room);
    tr.head += mv;
    tr.odo += mv;
    this.trim(tr);
    if (room - mv < 0.005) {
      tr.v = 0;
      if (tr.final) { this.arrive(tr); return; }
      tr.waitT += dt;
      ls.wait += dt;
      this.waitNow[tr.path[tr.path.length - 1]] = 1;
    } else {
      tr.waitT = 0;
      ls.run += dt;
    }
  }

  arrive(tr) {
    const T = TYPES[tr.type];
    tr.state = "dwell";
    tr.dwell = T.dwell;
    tr.waitT = 0;
    this.lineStat(tr.line).arr.push(this.t);
    this.stationStat(tr.dest).arr.push(this.t);
  }

  // Try to reserve the next stretch towards the train's next stop.
  advance(tr, allowRev) {
    const net = this.net, id = tr.id;
    const soft = (e) => { const r = this.resv[e]; return r && r !== id ? r : 0; };
    const hard = (e) => (this.edgeFree(e, id) ? 0 : Infinity);
    let found = false;
    for (const extra of [soft, hard]) {
      const opts = [];
      const f = net.search(tr.path[tr.path.length - 1], tr.dest, extra, tr.after);
      if (f) opts.push({ p: f, rev: false, c: f.cost });
      if (allowRev) {
        const r = net.search(tr.path[0] ^ 1, tr.dest, extra, tr.after);
        if (r) opts.push({ p: r, rev: true, c: r.cost + REV_COST });
      }
      if (!opts.length) continue;
      found = true;
      opts.sort((a, b) => a.c - b.c);
      for (const o of opts) {
        const seg = [];
        for (const d of o.p.des) {
          seg.push(d);
          if (net.sig[d] >= 0) break;
        }
        if (!seg.every((d) => this.edgeFree(d >> 1, id))) continue;
        if (o.rev) this.reverse(tr);
        this.reserve(tr, seg, seg.length === o.p.des.length);
        return "ok";
      }
    }
    return found ? "blocked" : "noroute";
  }

  reserve(tr, seg, final) {
    const net = this.net;
    for (const d of seg) {
      const prev = tr.path[tr.path.length - 1];
      const n = net.to(prev);
      if (n.sw || net.from(d).deg > 2) this.switchSet.set(n.i, [prev, d]);
      this.resv[d >> 1] = tr.id;
      tr.path.push(d);
    }
    tr.final = final;
  }

  reverse(tr) {
    const len = this.plen(tr);
    tr.path = tr.path.reverse().map((d) => d ^ 1);
    tr.head = len - tr.head + tr.len;
  }

  // Drop the edges the tail has completely left.
  trim(tr) {
    const net = this.net;
    while (tr.path.length > 1) {
      const l0 = net.len(tr.path[0]);
      if (tr.head - tr.len < l0 - 1e-6) break;
      const de = tr.path.shift();
      tr.head -= l0;
      if (!tr.path.some((d) => (d >> 1) === (de >> 1))) this.resv[de >> 1] = 0;
    }
  }

  plen(tr) {
    let s = 0;
    for (const d of tr.path) s += this.net.len(d);
    return s;
  }

  // Point at distance s along a train's path.
  pointAt(tr, s) {
    const net = this.net, p = tr.path;
    for (let i = 0; i < p.length; i++) {
      const l = net.len(p[i]);
      if (s <= l || i === p.length - 1) {
        const a = net.from(p[i]), b = net.to(p[i]);
        const t = Math.max(0, Math.min(1, s / l));
        return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
      }
      s -= l;
    }
    return [0, 0];
  }

  // Index of the path edge the head is on.
  headIndex(tr) {
    let s = tr.head;
    for (let i = 0; i < tr.path.length; i++) {
      s -= this.net.len(tr.path[i]);
      if (s <= 1e-6) return i;
    }
    return tr.path.length - 1;
  }

  status(tr) {
    const st = (id) => this.net.stations.get(id)?.name || "?";
    if (tr.state === "dwell") return "At " + st(tr.dest);
    if (tr.state === "ready") return tr.noRouteT > 0 ? "No route to " + st(tr.dest) : "Waiting to depart";
    if (tr.v === 0) return "Waiting at signal";
    return "Running to " + st(tr.dest);
  }
}

// ---------------------------------------------------------------------------
// Capacity analysis: run headless copies of the map with 1..maxN trains on a
// line and measure what comes out the other end.

export async function analyze(layout, lineId, maxN, onProgress) {
  const WARM = 90, RUN = 2 * HOUR, dt = 0.1;
  const results = [];
  for (let n = 1; n <= maxN; n++) {
    const L = JSON.parse(JSON.stringify(layout));
    const line = L.lines.find((l) => l.id === lineId);
    line.trains = n;
    const sim = new Sim(L, { headless: true });
    let steps = 0;
    while (sim.t < WARM) sim.step(dt);
    sim.resetStats();
    while (sim.t < WARM + RUN) {
      sim.step(dt);
      if (++steps % 300 === 0) {
        onProgress?.((n - 1 + steps * dt / RUN) / maxN);
        await new Promise((r) => setTimeout(r));
      }
    }
    let total = 0, wait = 0, busy = 0;
    for (const s of sim.lineStats.values()) { total += s.arr.length; wait += s.wait; busy += s.run + s.wait + s.dwell; }
    const ls = sim.lineStat(lineId);
    const lineTime = ls.run + ls.wait + ls.dwell;
    results.push({
      n,
      running: sim.trains.filter((t) => t.line === lineId).length,
      line: ls.arr.length / 2,
      total: total / 2,
      deadlocks: sim.deadlocks,
      lineWait: lineTime ? ls.wait / lineTime : 0,
      wait: busy ? wait / busy : 0,
    });
  }
  return results;
}
