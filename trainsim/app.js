// Rail Dispatcher UI: canvas rendering, editing tools, panels.
// All simulation logic lives in sim.js.

import {
  Sim, TYPES, LINE_COLORS, STATION_NAMES, DX, DY, KMH, TIME_SCALE, STUCK_TIME,
  emptyLayout, dragPath, polyKeys, signalKey, lineSeq, segDist, analyze,
} from "./sim.js";
import { defaultLayout } from "./map.js";

const $ = (s) => document.querySelector(s);
const canvas = $("#view");
const ctx = canvas.getContext("2d");

const store = {
  get(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode etc. */ }
  },
};
const SAVE_KEY = "trainsim.layout.v1";
const ARROWS = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];

let layout = loadLayout() || defaultLayout();
const sim = new Sim(layout);
const undoStack = [];
const cam = { x: 50, y: 20, z: 14 };
let W = 0, H = 0, dpr = 1;
let tool = "select";
let speed = 1, paused = false;
let showUsage = false;
let selected = null;        // { kind: "train" | "station" | "signal", id } (signals by layout key)
let pickStopFor = null;     // line id while the user taps stations to add
let drag = null;
let pinch = null;
let hover = null;           // mouse position in world units
const pointers = new Map();
const analyses = new Map(); // line id -> { progress } | { results, best }
let analysisRunning = false;
let tab = "lines";

// ---------------------------------------------------------------------------
// Layout persistence and editing

function loadLayout() {
  try {
    const L = JSON.parse(store.get(SAVE_KEY, "null"));
    if (L && L.tracks && L.platforms && L.signals && L.stations && Array.isArray(L.lines)) return L;
  } catch { /* corrupt save: start fresh */ }
  return null;
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set(SAVE_KEY, JSON.stringify(layout)), 300);
}

// Drop stations without platforms and stops pointing at them.
function cleanup(L) {
  const used = new Set(Object.values(L.platforms));
  for (const k of Object.keys(L.platforms)) if (!L.tracks[k]) delete L.platforms[k];
  for (const id of Object.keys(L.stations)) if (!used.has(id)) delete L.stations[id];
  for (const l of L.lines) l.stops = l.stops.filter((id) => L.stations[id]);
}

function edit(fn, { rerender = true } = {}) {
  undoStack.push(JSON.stringify(layout));
  if (undoStack.length > 60) undoStack.shift();
  fn(layout);
  cleanup(layout);
  sim.rebuild();
  save();
  if (rerender) renderLines();
  renderInfo();
}

function setLayout(L) {
  layout = L;
  sim.L = L;
  for (const t of [...sim.trains]) sim.removeTrain(t);
  sim.rebuild();
  sim.resetStats();
  analyses.clear();
  selected = null;
  save();
  renderLines();
  renderInfo();
}

function undo() {
  const prev = undoStack.pop();
  if (!prev) return toast("Nothing to undo");
  layout = JSON.parse(prev);
  sim.L = layout;
  sim.rebuild();
  save();
  renderLines();
  renderInfo();
}

function lineById(id) {
  return layout.lines.find((l) => l.id === id);
}

function stationName(id) {
  return layout.stations[id]?.name || "?";
}

function nextStationName() {
  const used = new Set(Object.values(layout.stations).map((s) => s.name));
  return STATION_NAMES.find((n) => !used.has(n)) || "Station " + (used.size + 1);
}

// ---------------------------------------------------------------------------
// Camera

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth;
  H = innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
}

const toWorld = (sx, sy) => ({ x: (sx - W / 2) / cam.z + cam.x, y: (sy - H / 2) / cam.z + cam.y });
const toScreen = (wx, wy) => [(wx - cam.x) * cam.z + W / 2, (wy - cam.y) * cam.z + H / 2];

function isPhone() {
  return W <= 720;
}

// Visible area not covered by bars and the panel.
function viewArea() {
  const open = document.body.classList.contains("panel-open");
  const top = $("#top").getBoundingClientRect().bottom + 6, bottom = isPhone() ? 80 : 84;
  if (isPhone()) return { l: 0, r: W, t: top, b: H - bottom - (open ? H * 0.44 + 8 : 0) };
  return { l: 0, r: W - (open ? 340 : 0), t: top, b: H - bottom };
}

function fit() {
  const nodes = sim.net.nodeList;
  if (!nodes.length) { cam.x = 0; cam.y = 0; cam.z = 20; return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x);
    y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
  }
  const a = viewArea();
  // On a phone the whole map would be unreadably small: show the middle of it.
  cam.z = clamp(Math.min((a.r - a.l) / (x1 - x0 + 4), (a.b - a.t) / (y1 - y0 + 5)), isPhone() ? 9 : 4, 48);
  // Put the map's centre in the middle of the free area, not of the window.
  cam.x = (x0 + x1) / 2 - ((a.l + a.r) / 2 - W / 2) / cam.z;
  cam.y = (y0 + y1) / 2 - 0.5 - ((a.t + a.b) / 2 - H / 2) / cam.z;
}

function zoomAt(sx, sy, factor) {
  const before = toWorld(sx, sy);
  cam.z = clamp(cam.z * factor, 4, 64);
  const after = toWorld(sx, sy);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// Rendering

const cache = { net: null };

function buildCache() {
  const net = sim.net;
  cache.net = net;
  cache.track = new Path2D();
  for (const e of net.edges) {
    cache.track.moveTo(e.a.x, e.a.y);
    cache.track.lineTo(e.b.x, e.b.y);
  }
  cache.platform = new Path2D();
  for (const e of net.edges) {
    if (!e.st) continue;
    cache.platform.moveTo(e.a.x, e.a.y);
    cache.platform.lineTo(e.b.x, e.b.y);
  }
  // Buffer stops at dead ends.
  cache.buffers = new Path2D();
  for (const n of net.nodeList) {
    if (n.deg !== 1) continue;
    const d = n.adj.findIndex((j) => j >= 0);
    const l = Math.hypot(DX[d], DY[d]);
    const px = -DY[d] / l * 0.32, py = DX[d] / l * 0.32;
    cache.buffers.moveTo(n.x + px, n.y + py);
    cache.buffers.lineTo(n.x - px, n.y - py);
  }
}

function heat(u) {
  // Track usage: blue-grey when idle, then green -> yellow -> red.
  if (u < 0.03) return "#56627a";
  const t = Math.min(1, u / 0.7);
  return `hsl(${Math.round(130 - 130 * t)}, 85%, ${Math.round(52 + 6 * (1 - Math.abs(t - 0.5) * 2))}%)`;
}

function lineColor(id) {
  return lineById(id)?.color || "#ccc";
}

function signalGeom(de) {
  const net = sim.net, n = net.to(de), d = net.dirOf(de);
  const l = Math.hypot(DX[d], DY[d]);
  const ux = DX[d] / l, uy = DY[d] / l;
  const bx = n.x - ux * 0.3, by = n.y - uy * 0.3;
  // Lamp on the right-hand side of the direction of travel.
  return { bx, by, lx: bx - uy * 0.34, ly: by + ux * 0.34 };
}

function draw() {
  if (cache.net !== sim.net) buildCache();
  const net = sim.net, z = cam.z, px = 1 / z;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#11151d";
  ctx.fillRect(0, 0, W, H);

  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - cam.x * z), dpr * (H / 2 - cam.y * z));
  const tl = toWorld(0, 0), br = toWorld(W, H);

  // Grid dots, so it is clear where track can go.
  if (z >= 9) {
    ctx.fillStyle = "#232b3a";
    const s = 2 * px;
    for (let y = Math.floor(tl.y); y <= br.y; y++) {
      for (let x = Math.floor(tl.x); x <= br.x; x++) ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Platforms
  ctx.strokeStyle = "#2a3954";
  ctx.lineWidth = 0.7;
  ctx.lineCap = "butt";
  ctx.stroke(cache.platform);
  if (selected?.kind === "station" || pickStopFor) {
    ctx.strokeStyle = "rgba(255,193,69,0.35)";
    ctx.beginPath();
    for (const e of net.edges) {
      if (!e.st || (selected?.kind === "station" && !pickStopFor && e.st !== selected.id)) continue;
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
    }
    ctx.stroke();
  }
  ctx.lineCap = "round";

  // Track bed and rails
  ctx.strokeStyle = "#1b212d";
  ctx.lineWidth = 0.34;
  ctx.stroke(cache.track);
  if (showUsage) {
    ctx.lineWidth = Math.max(2.5 * px, 0.16);
    const groups = new Map();
    net.edges.forEach((e, i) => {
      const c = heat(sim.util[i]);
      if (!groups.has(c)) groups.set(c, new Path2D());
      const p = groups.get(c);
      p.moveTo(e.a.x, e.a.y);
      p.lineTo(e.b.x, e.b.y);
    });
    for (const [c, p] of groups) { ctx.strokeStyle = c; ctx.stroke(p); }
  } else {
    ctx.strokeStyle = "#8e99ad";
    ctx.lineWidth = Math.max(1.5 * px, 0.09);
    ctx.stroke(cache.track);
  }
  ctx.strokeStyle = "#e05a5a";
  ctx.lineWidth = Math.max(2 * px, 0.12);
  ctx.lineCap = "butt";
  ctx.stroke(cache.buffers);
  ctx.lineCap = "round";

  // Reservations ahead of each train
  const green = new Set();
  for (const tr of sim.trains) {
    const hi = sim.headIndex(tr);
    for (let i = hi; i < tr.path.length - 1; i++) if (net.sig[tr.path[i]] >= 0) green.add(tr.path[i]);
    if (hi >= tr.path.length - 1 && sim.plen(tr) - tr.head < 0.01) continue;
    const [hx, hy] = sim.pointAt(tr, tr.head);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    for (let i = hi; i < tr.path.length; i++) {
      const n = net.to(tr.path[i]);
      ctx.lineTo(n.x, n.y);
    }
    const sel = selected?.kind === "train" && selected.id === tr.id;
    ctx.globalAlpha = sel ? 0.75 : 0.42;
    ctx.strokeStyle = lineColor(tr.line);
    ctx.lineWidth = sel ? 0.36 : 0.26;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Switches: show which way each was last set
  if (z >= 10) {
    ctx.strokeStyle = "#f2f5fa";
    ctx.lineWidth = Math.max(1.5 * px, 0.08);
    ctx.beginPath();
    for (const [ni, [a, b]] of sim.switchSet) {
      const n = net.nodeList[ni];
      const fa = net.from(a), tb = net.to(b);
      ctx.moveTo(n.x + (fa.x - n.x) * 0.4, n.y + (fa.y - n.y) * 0.4);
      ctx.lineTo(n.x, n.y);
      ctx.lineTo(n.x + (tb.x - n.x) * 0.4, n.y + (tb.y - n.y) * 0.4);
    }
    ctx.stroke();
  }

  // Signals
  const selSig = selected?.kind === "signal" ? sigDe(selected.id) : -1;
  const lampR = Math.max(1.8 * px, 0.13);
  for (const de of net.sigList) {
    const g = signalGeom(de);
    const w = sim.sigWait[de];
    if (w > 0.03) {
      ctx.fillStyle = `rgba(255,90,95,${Math.min(0.45, w)})`;
      ctx.beginPath();
      ctx.arc(g.lx, g.ly, lampR * 2 + w * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    if (z >= 8) {
      ctx.strokeStyle = "#6c778c";
      ctx.lineWidth = Math.max(1 * px, 0.05);
      ctx.beginPath();
      ctx.moveTo(g.bx, g.by);
      ctx.lineTo(g.lx, g.ly);
      ctx.stroke();
    }
    ctx.fillStyle = green.has(de) ? "#47d18c" : "#ff4d52";
    ctx.beginPath();
    ctx.arc(g.lx, g.ly, lampR, 0, Math.PI * 2);
    ctx.fill();
    if (net.sig[de] === 1 && z >= 8) {
      ctx.strokeStyle = "#e8edf5";
      ctx.lineWidth = Math.max(1.2 * px, 0.05);
      ctx.beginPath();
      ctx.arc(g.lx, g.ly, lampR * 1.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (de === selSig) {
      ctx.strokeStyle = "#ffc145";
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.arc(g.lx, g.ly, lampR * 2.6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Trains
  for (const tr of sim.trains) drawTrain(tr, px);

  drawToolPreview(px);

  // Labels in screen space
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawStationLabels();
}

function drawTrain(tr, px) {
  const T = TYPES[tr.type];
  const gap = 0.14;
  const cl = (tr.len - gap * (T.cars - 1)) / T.cars;
  const color = lineColor(tr.line);
  const sel = selected?.kind === "train" && selected.id === tr.id;
  const segs = [];
  for (let c = 0; c < T.cars; c++) {
    const f = tr.head - c * (cl + gap);
    segs.push([sim.pointAt(tr, f - cl), sim.pointAt(tr, f)]);
  }
  ctx.lineCap = "butt";
  if (sel || tr.waitT > STUCK_TIME * 0.5) {
    ctx.strokeStyle = sel ? "rgba(255,193,69,0.8)" : "rgba(255,77,82,0.8)";
    ctx.lineWidth = 0.78;
    for (const [a, b] of segs) { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
  }
  ctx.strokeStyle = "#0b0e14";
  ctx.lineWidth = 0.56;
  for (const [a, b] of segs) { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
  ctx.strokeStyle = tr.type === "freight" ? shade(color) : color;
  ctx.lineWidth = 0.44;
  for (const [a, b] of segs) { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
  if (tr.type === "freight") {
    // Freight wagons: line colour as a stripe only.
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.14;
    for (const [a, b] of segs) { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
  }
  // Headlight at the front
  const [a, b] = segs[0];
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  ctx.fillStyle = "#fff6d0";
  ctx.beginPath();
  ctx.arc(b[0] - (b[0] - a[0]) / l * 0.1, b[1] - (b[1] - a[1]) / l * 0.1, Math.max(1.6 * px, 0.08), 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = "round";
}

function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(v * 0.35 + 30);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function drawToolPreview(px) {
  const net = sim.net;
  if (drag && (drag.kind === "track" || drag.kind === "platform") && drag.moved) {
    const keys = polyKeys(dragPath(drag.x0, drag.y0, drag.x1, drag.y1, drag.diag));
    ctx.lineWidth = drag.kind === "track" ? Math.max(3 * px, 0.14) : 0.7;
    ctx.lineCap = drag.kind === "track" ? "round" : "butt";
    for (const k of keys) {
      const [x1, y1, x2, y2] = k.split(",").map(Number);
      const exists = !!layout.tracks[k];
      if (drag.kind === "platform" && !exists) continue;
      ctx.strokeStyle = drag.kind === "platform" ? "rgba(255,193,69,0.5)" : exists ? "rgba(255,193,69,0.4)" : "#ffc145";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.lineCap = "round";
  }
  if (drag?.kind === "erase") {
    ctx.strokeStyle = "rgba(255,77,82,0.85)";
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    for (const k of drag.keys) {
      const e = net.byKey.get(k);
      if (e) { ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); }
    }
    ctx.stroke();
  }
  if (!drag && hover) {
    if (tool === "track" || tool === "platform") {
      ctx.strokeStyle = "rgba(255,193,69,0.8)";
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.arc(Math.round(hover.x), Math.round(hover.y), 0.22, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tool === "signal" || tool === "erase") {
      const e = net.nearestEdge(hover.x, hover.y, 0.5);
      if (e) {
        ctx.strokeStyle = tool === "erase" ? "rgba(255,77,82,0.7)" : "rgba(255,193,69,0.6)";
        ctx.lineWidth = 0.24;
        ctx.beginPath();
        ctx.moveTo(e.a.x, e.a.y);
        ctx.lineTo(e.b.x, e.b.y);
        ctx.stroke();
        if (tool === "signal") {
          const g = signalGeom(signalTarget(e, hover));
          ctx.fillStyle = "rgba(255,193,69,0.8)";
          ctx.beginPath();
          ctx.arc(g.lx, g.ly, 0.15, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}

function drawStationLabels() {
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  cache.labels = [];
  for (const s of sim.net.stations.values()) {
    if (!s.edges.length) continue;
    const [x, y] = toScreen(s.cx, s.top - 0.55);
    const ly = y - 12;
    const w = ctx.measureText(s.name).width + 16;
    const hl = pickStopFor || (selected?.kind === "station" && selected.id === s.id);
    ctx.fillStyle = hl ? "rgba(58,50,32,0.95)" : "rgba(20,26,38,0.88)";
    ctx.strokeStyle = hl ? "#ffc145" : "#34415a";
    ctx.lineWidth = 1;
    roundRect(x - w / 2, ly - 10, w, 20, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = hl ? "#ffc145" : "#e4e9f2";
    ctx.fillText(s.name, x, ly + 0.5);
    cache.labels.push({ id: s.id, x0: x - w / 2, x1: x + w / 2, y0: ly - 10, y1: ly + 10 });
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Hit testing

function trainAt(w) {
  let best = null, bd = 0.45;
  for (const tr of sim.trains) {
    for (let s = tr.head - tr.len; s < tr.head; s += 0.25) {
      const [x, y] = sim.pointAt(tr, s + 0.125);
      const d = Math.hypot(w.x - x, w.y - y);
      if (d < bd) { bd = d; best = tr; }
    }
  }
  return best;
}

function signalAt(w) {
  let best = -1, bd = 0.3;
  for (const de of sim.net.sigList) {
    const g = signalGeom(de);
    const d = Math.hypot(w.x - g.lx, w.y - g.ly);
    if (d < bd) { bd = d; best = de; }
  }
  return best;
}

function stationAt(w, sx, sy) {
  for (const l of cache.labels || []) {
    if (sx >= l.x0 && sx <= l.x1 && sy >= l.y0 && sy <= l.y1) return l.id;
  }
  const e = sim.net.nearestEdge(w.x, w.y, 0.55);
  return e?.st || null;
}

// Signal layout key <-> directed edge of the current net.
function sigKeyOf(de) {
  const n = sim.net.to(de);
  return signalKey(n.x, n.y, sim.net.dirOf(de));
}

function sigDe(key) {
  const [x, y, d] = key.split(",").map(Number);
  const n = sim.net.nodes.get(x + "," + y);
  const j = n ? n.adj[(d + 4) % 8] : -1;
  if (j < 0) return -1;
  const de = j * 2 + (sim.net.edges[j].b === n ? 0 : 1);
  return sim.net.sig[de] >= 0 ? de : -1;
}

// The directed edge a signal tap means: trains travelling towards the
// nearer end of the tapped track get the signal.
function signalTarget(e, w) {
  const t = ((w.x - e.a.x) * (e.b.x - e.a.x) + (w.y - e.a.y) * (e.b.y - e.a.y)) / (e.len * e.len);
  return t >= 0.5 ? e.i * 2 : e.i * 2 + 1;
}

// ---------------------------------------------------------------------------
// Tools

function tap(w, sx, sy) {
  if (pickStopFor) {
    const id = stationAt(w, sx, sy);
    const line = lineById(pickStopFor);
    if (id && line) {
      if (line.stops[line.stops.length - 1] === id) return toast("Already the last stop");
      edit((L) => L.lines.find((l) => l.id === line.id).stops.push(id));
      toast(`${stationName(id)} added to ${line.name}`);
    }
    return;
  }
  if (tool === "signal") {
    const e = sim.net.nearestEdge(w.x, w.y, 0.5);
    if (!e) return;
    const de = signalTarget(e, w);
    const n = sim.net.to(de);
    const key = signalKey(n.x, n.y, sim.net.dirOf(de));
    edit((L) => {
      const cur = L.signals[key];
      if (cur === undefined) L.signals[key] = 0;
      else if (cur === 0) L.signals[key] = 1;
      else delete L.signals[key];
    }, { rerender: false });
    const v = layout.signals[key];
    toast(v === undefined ? "Signal removed" : v ? "One-way signal" : "Signal placed");
    return;
  }
  if (tool === "erase") return;
  const tr = trainAt(w);
  if (tr) return select({ kind: "train", id: tr.id });
  const sg = signalAt(w);
  if (sg >= 0) return select({ kind: "signal", id: sigKeyOf(sg) });
  const st = stationAt(w, sx, sy);
  if (st) return select({ kind: "station", id: st });
  select(null);
}

function select(s) {
  selected = s;
  if (s) {
    setTab("info");
    if (!document.body.classList.contains("panel-open") && !isPhone()) setPanel(true);
  }
  renderInfo();
}

function applyTrack(keys) {
  const fresh = keys.filter((k) => !layout.tracks[k]);
  if (!fresh.length) return;
  edit((L) => { for (const k of fresh) L.tracks[k] = 1; }, { rerender: false });
}

function applyPlatform(keys) {
  keys = keys.filter((k) => layout.tracks[k]);
  if (!keys.length) return toast("Platforms go on existing track");
  // Dragging over platforms that already exist removes them.
  if (keys.every((k) => layout.platforms[k])) {
    edit((L) => { for (const k of keys) delete L.platforms[k]; });
    return toast("Platform removed");
  }
  // Join a station with platforms nearby, else found a new one.
  const mids = keys.map((k) => { const [a, b, c, d] = k.split(",").map(Number); return [(a + c) / 2, (b + d) / 2]; });
  const votes = new Map();
  for (const [k, st] of Object.entries(layout.platforms)) {
    const [a, b, c, d] = k.split(",").map(Number);
    const mx = (a + c) / 2, my = (b + d) / 2;
    if (mids.some(([x, y]) => Math.hypot(x - mx, y - my) <= 3)) votes.set(st, (votes.get(st) || 0) + 1);
  }
  let station = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  let name;
  edit((L) => {
    if (!station) {
      name = nextStationName();
      station = "s" + L.nextId++;
      L.stations[station] = { name };
    }
    for (const k of keys) L.platforms[k] = station;
  });
  toast(name ? `New station: ${name}` : `Platform added to ${stationName(station)}`);
}

function eraseAt(w) {
  const e = sim.net.nearestEdge(w.x, w.y, 0.45);
  if (e) drag.keys.add(e.k);
}

function applyErase(keys) {
  if (!keys.size) return;
  edit((L) => {
    for (const k of keys) {
      const [x1, y1, x2, y2] = k.split(",").map(Number);
      const d = DX.findIndex((dx, i) => dx === x2 - x1 && DY[i] === y2 - y1);
      delete L.tracks[k];
      delete L.platforms[k];
      delete L.signals[signalKey(x2, y2, d)];
      delete L.signals[signalKey(x1, y1, (d + 4) % 8)];
    }
  });
}

function setTool(t) {
  tool = t;
  for (const b of document.querySelectorAll("#tools button")) b.classList.toggle("on", b.dataset.tool === t);
}

// ---------------------------------------------------------------------------
// Pointer input

function snap(w) {
  return { x: Math.round(w.x), y: Math.round(w.y) };
}

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  closeMenu();
  if (pointers.size === 2) {
    // Second finger: switch to pinch/pan and forget the half-done edit.
    drag = null;
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    return;
  }
  if (pointers.size > 2) return;
  const sx = e.clientX, sy = e.clientY, w = toWorld(sx, sy);
  const pan = { kind: "pan", sx, sy, cx: cam.x, cy: cam.y, moved: false };
  if (e.button === 1 || e.button === 2) { drag = { ...pan, noTap: true }; return; }
  if (tool === "track" || tool === "platform") {
    const n = snap(w);
    drag = { kind: tool, x0: n.x, y0: n.y, x1: n.x, y1: n.y, diag: false, decided: false, sx, sy, moved: false };
  } else if (tool === "erase") {
    drag = { kind: "erase", keys: new Set(), sx, sy, moved: false };
    eraseAt(w);
  } else {
    drag = pan;
  }
});

canvas.addEventListener("pointermove", (e) => {
  const p = pointers.get(e.pointerId);
  if (e.pointerType === "mouse") hover = toWorld(e.clientX, e.clientY);
  if (!p) return;
  p.x = e.clientX;
  p.y = e.clientY;
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    zoomAt(pinch.cx, pinch.cy, d / pinch.d);
    cam.x -= (cx - pinch.cx) / cam.z;
    cam.y -= (cy - pinch.cy) / cam.z;
    pinch = { d, cx, cy };
    return;
  }
  if (!drag) return;
  const sx = e.clientX, sy = e.clientY;
  if (Math.hypot(sx - drag.sx, sy - drag.sy) > 6) drag.moved = true;
  const w = toWorld(sx, sy);
  if (drag.kind === "pan") {
    if (!drag.moved) return;
    cam.x = drag.cx - (sx - drag.sx) / cam.z;
    cam.y = drag.cy - (sy - drag.sy) / cam.z;
  } else if (drag.kind === "track" || drag.kind === "platform") {
    const dx = w.x - drag.x0, dy = w.y - drag.y0;
    // The first stretch of the drag decides between straight-first and
    // diagonal-first, so dragging out of a track at 45° makes a switch.
    if (!drag.decided && Math.hypot(dx, dy) > 0.8) {
      drag.decided = true;
      drag.diag = Math.min(Math.abs(dx), Math.abs(dy)) / Math.max(Math.abs(dx), Math.abs(dy)) > 0.42;
    }
    const n = snap(w);
    drag.x1 = n.x;
    drag.y1 = n.y;
  } else if (drag.kind === "erase") {
    eraseAt(w);
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pinch) {
    if (pointers.size < 2) pinch = null;
    return;
  }
  const d = drag;
  drag = null;
  if (!d || e.type === "pointercancel") return;
  const w = toWorld(e.clientX, e.clientY);
  if (d.kind === "pan") {
    if (!d.moved && !d.noTap) tap(w, e.clientX, e.clientY);
  } else if (d.kind === "track" || d.kind === "platform") {
    if (d.x0 === d.x1 && d.y0 === d.y1) return tap(w, e.clientX, e.clientY);
    const keys = polyKeys(dragPath(d.x0, d.y0, d.x1, d.y1, d.diag));
    if (d.kind === "track") applyTrack(keys); else applyPlatform(keys);
  } else if (d.kind === "erase") {
    applyErase(d.keys);
  }
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hover = null; });

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)));
}, { passive: false });

addEventListener("keydown", (e) => {
  if (e.target.closest("input, select, textarea")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tools = ["select", "track", "platform", "signal", "erase"];
  if (e.key >= "1" && e.key <= "5") setTool(tools[e.key - 1]);
  else if (e.key === " ") { e.preventDefault(); togglePause(); }
  else if (e.key === "u" || e.key === "U") toggleUsage();
  else if (e.key === "f" || e.key === "F") fit();
  else if (e.key === "+" || e.key === "=") setSpeed(Math.min(8, speed * 2));
  else if (e.key === "-") setSpeed(Math.max(1, speed / 2));
  else if (e.key === "Escape") { stopPicking(); select(null); closeMenu(); }
});

// ---------------------------------------------------------------------------
// Top bar

function togglePause() {
  paused = !paused;
  $("#play").classList.toggle("paused", paused);
}

function setSpeed(s) {
  speed = s;
  for (const b of document.querySelectorAll("#speeds button")) b.classList.toggle("on", +b.dataset.speed === s);
}

function toggleUsage() {
  showUsage = !showUsage;
  $("#usage").setAttribute("aria-pressed", showUsage);
}

function setPanel(open) {
  document.body.classList.toggle("panel-open", open);
  $("#panelBtn").setAttribute("aria-pressed", open);
}

function setTab(t) {
  tab = t;
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("on", b.dataset.tab === t);
  for (const el of document.querySelectorAll(".tab")) el.classList.toggle("on", el.id === "tab-" + t);
  if (t === "stats") renderStats();
  if (t === "info") renderInfo();
}

function closeMenu() {
  $("#menu").hidden = true;
}

$("#play").addEventListener("click", togglePause);
$("#speeds").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setSpeed(+b.dataset.speed); });
$("#usage").addEventListener("click", toggleUsage);
$("#undo").addEventListener("click", undo);
$("#fit").addEventListener("click", fit);
$("#panelBtn").addEventListener("click", () => setPanel(!document.body.classList.contains("panel-open")));
$("#menuBtn").addEventListener("click", (e) => { e.stopPropagation(); $("#menu").hidden = !$("#menu").hidden; });
$("#tools").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setTool(b.dataset.tool); });
$(".tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setTab(b.dataset.tab); });
addEventListener("click", (e) => { if (!e.target.closest("#menu, #menuBtn")) closeMenu(); });

$("#menu").addEventListener("click", (e) => {
  const act = e.target.closest("button")?.dataset.menu;
  closeMenu();
  if (act === "help") $("#help").showModal();
  else if (act === "reset") {
    if (!confirm("Replace your map with the starting map?")) return;
    undoStack.push(JSON.stringify(layout));
    setLayout(defaultLayout());
    fit();
  } else if (act === "clear") {
    if (!confirm("Remove everything and start with an empty map?")) return;
    undoStack.push(JSON.stringify(layout));
    setLayout(emptyLayout());
    cam.z = 20;
    toast("Empty map. Pick the Track tool and drag to lay track.");
  } else if (act === "export") {
    const blob = new Blob([JSON.stringify(layout, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "railmap.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } else if (act === "import") $("#file").click();
  else if (act === "resetStats") { sim.resetStats(); renderStats(); toast("Statistics reset"); }
});

$("#file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const L = JSON.parse(await f.text());
    if (!L.tracks || !L.stations || !Array.isArray(L.lines)) throw new Error("not a map");
    L.platforms ||= {};
    L.signals ||= {};
    L.nextId ||= 1000;
    undoStack.push(JSON.stringify(layout));
    setLayout(L);
    fit();
  } catch {
    toast("That file is not a Rail Dispatcher map");
  }
});

let toastTimer = 0;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// ---------------------------------------------------------------------------
// Panel: lines

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (v) => Math.round(v * 100) + "%";

function renderLines() {
  const el = $("#tab-lines");
  el.innerHTML = layout.lines.map(lineCard).join("")
    + `<button class="btn" type="button" data-act="add-line">+ New line</button>`
    + `<p class="small muted">Arrivals per game hour are measured over the last hour. Use <b>Analyze capacity</b> to find how many trains a line can take.</p>`;
  updateLines();
}

function lineCard(l) {
  const stops = l.stops.map((id, i) => (i ? `<span class="arrow">›</span>` : "")
    + `<span class="stop">${esc(stationName(id))}<button type="button" data-act="rm-stop" data-i="${i}" title="Remove stop">×</button></span>`).join("");
  const picking = pickStopFor === l.id;
  const types = Object.entries(TYPES).map(([k, t]) => `<option value="${k}"${k === l.type ? " selected" : ""}>${t.name}</option>`).join("");
  return `<div class="lineCard" data-line="${l.id}" style="--c:${l.color}">
    <div class="row">
      <button type="button" class="swatch" data-act="color" title="Change colour"></button>
      <div class="grow"><input class="lname" value="${esc(l.name)}" maxlength="16" aria-label="Line name"></div>
      <select class="btn ltype" aria-label="Train type">${types}</select>
      <button type="button" class="btn danger" data-act="del-line" title="Delete line">✕</button>
    </div>
    <div class="stops">${stops || `<span class="small muted">No stops yet</span>`}
      <button type="button" class="btn small${picking ? " on" : ""}" data-act="add-stop">${picking ? "Done" : "+ Stop"}</button></div>
    <div class="row">
      <span class="small muted">Trains</span>
      <span class="stepper"><button type="button" class="btn" data-act="tr-">−</button><b>${l.trains}</b><button type="button" class="btn" data-act="tr+">+</button></span>
      <label class="small"><input type="checkbox" class="lcirc"${l.circular ? " checked" : ""}> Circular</label>
    </div>
    <div class="row live" data-live="${l.id}"></div>
    <div class="row"><button type="button" class="btn" data-act="analyze"${analysisRunning ? " disabled" : ""}>Analyze capacity</button></div>
    <div class="analysis" data-analysis="${l.id}">${analysisHtml(l)}</div>
  </div>`;
}

function analysisHtml(l) {
  const a = analyses.get(l.id);
  if (!a) return "";
  if (a.progress !== undefined) {
    return `<div class="small muted">Simulating 2 game hours per train count…</div><div class="progress"><i style="width:${pct(a.progress)}"></i></div>`;
  }
  const max = Math.max(1, ...a.results.map((r) => r.line));
  const rows = a.results.map((r) => {
    const cls = r.n === a.best ? " best" : "";
    const warn = r.deadlocks ? ` <span class="warn" title="${r.deadlocks} deadlocks">⚠</span>` : "";
    const short = r.running < r.n ? ` <span class="muted" title="Only ${r.running} trains fit">(${r.running})</span>` : "";
    return `<span class="${cls}">${r.n}${short}</span>
      <div class="bar" title="Waiting ${pct(r.lineWait)} of the time"><i style="width:${(r.line / max) * 100}%"></i></div>
      <span class="${cls}">${r.line.toFixed(0)}/h${warn}</span>`;
  }).join("");
  const best = a.results.find((r) => r.n === a.best);
  return `<div class="bars">${rows}</div>
    <p class="small muted">Trains → arrivals per hour on ${esc(l.name)}. ${best ? `<b>${best.n}</b> train${best.n > 1 ? "s" : ""} reach${best.n > 1 ? "" : "es"} ${pct(best.line / max)} of the best result; more mostly add waiting.` : ""}</p>
    ${best && best.n !== l.trains ? `<button type="button" class="btn primary" data-act="use-best" data-n="${best.n}">Use ${best.n} train${best.n > 1 ? "s" : ""}</button>` : ""}`;
}

function updateLines() {
  for (const l of layout.lines) {
    const el = document.querySelector(`[data-live="${l.id}"]`);
    if (!el) continue;
    const s = sim.lineStat(l.id);
    const busy = s.run + s.wait + s.dwell;
    const running = sim.trains.filter((t) => t.line === l.id).length;
    let txt = `<span><b>${sim.perHour(s.arr).toFixed(0)}</b> arrivals/h</span> · <span>waiting <b>${busy ? pct(s.wait / busy) : "–"}</b></span>`;
    if (running < l.trains) txt += ` · <span class="warn">${l.trains - running} waiting for a free platform</span>`;
    if (sim.trains.some((t) => t.line === l.id && t.noRoute)) txt += ` · <span class="warn">a stop can't be reached</span>`;
    if (lineSeq(layout, l).length < 2) txt = `<span class="warn">Needs at least two stops</span>`;
    el.innerHTML = txt;
  }
}

function stopPicking() {
  if (!pickStopFor) return;
  pickStopFor = null;
  $("#hint").hidden = true;
  renderLines();
}

$("#tab-lines").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  if (act === "add-line") {
    let id;
    edit((L) => {
      id = "l" + L.nextId++;
      const n = L.lines.length + 1;
      L.lines.push({ id, name: "Line " + n, color: LINE_COLORS[(n - 1) % LINE_COLORS.length], type: "regional", stops: [], trains: 1, circular: false });
    });
    startPicking(id);
    return;
  }
  const id = b.closest("[data-line]")?.dataset.line;
  const line = lineById(id);
  if (!line) return;
  const upd = (fn) => edit((L) => fn(L.lines.find((l) => l.id === id)));
  if (act === "color") upd((l) => { l.color = LINE_COLORS[(LINE_COLORS.indexOf(l.color) + 1) % LINE_COLORS.length]; });
  else if (act === "del-line") {
    if (!confirm(`Delete line ${line.name}?`)) return;
    if (pickStopFor === id) stopPicking();
    edit((L) => { L.lines = L.lines.filter((l) => l.id !== id); });
  } else if (act === "rm-stop") upd((l) => l.stops.splice(+b.dataset.i, 1));
  else if (act === "add-stop") {
    if (pickStopFor === id) stopPicking(); else startPicking(id);
  } else if (act === "tr-") upd((l) => { l.trains = Math.max(0, l.trains - 1); });
  else if (act === "tr+") upd((l) => { l.trains = Math.min(20, l.trains + 1); });
  else if (act === "analyze") runAnalysis(id);
  else if (act === "use-best") upd((l) => { l.trains = +b.dataset.n; });
});

$("#tab-lines").addEventListener("change", (e) => {
  const id = e.target.closest("[data-line]")?.dataset.line;
  if (!lineById(id)) return;
  const upd = (fn) => edit((L) => fn(L.lines.find((l) => l.id === id)));
  if (e.target.classList.contains("lname")) upd((l) => { l.name = e.target.value.trim() || l.name; });
  else if (e.target.classList.contains("lcirc")) upd((l) => { l.circular = e.target.checked; });
  else if (e.target.classList.contains("ltype")) {
    upd((l) => { l.type = e.target.value; });
    // Running trains keep their old type; replace them.
    for (const t of sim.trains.filter((t) => t.line === id)) sim.removeTrain(t);
  }
});

function startPicking(id) {
  pickStopFor = id;
  const hint = $("#hint");
  hint.innerHTML = `Tap stations to add them to <b>${esc(lineById(id).name)}</b> <button type="button" class="btn primary">Done</button>`;
  hint.hidden = false;
  hint.querySelector("button").onclick = stopPicking;
  renderLines();
}

async function runAnalysis(id) {
  if (analysisRunning) return;
  const line = lineById(id);
  if (lineSeq(layout, line).length < 2) return toast("Give the line at least two stops first");
  analysisRunning = true;
  analyses.set(id, { progress: 0 });
  renderLines();
  const snapshot = JSON.parse(JSON.stringify(layout));
  const results = await analyze(snapshot, id, 8, (p) => {
    analyses.set(id, { progress: p });
    const bar = document.querySelector(`[data-analysis="${id}"] .progress i`);
    if (bar) bar.style.width = pct(p);
  });
  // Recommend the fewest trains that get 90% of the best throughput.
  const max = Math.max(...results.map((r) => r.line));
  const best = results.find((r) => r.line >= max * 0.9 && !r.deadlocks) || results.find((r) => r.line >= max * 0.9);
  analyses.set(id, { results, best: best?.n });
  analysisRunning = false;
  renderLines();
}

// ---------------------------------------------------------------------------
// Panel: statistics

function nearestStationName(x, y) {
  let best = null, bd = Infinity;
  for (const s of sim.net.stations.values()) {
    if (!s.edges.length) continue;
    const d = Math.hypot(s.cx - x, s.cy - y);
    if (d < bd) { bd = d; best = s; }
  }
  return best ? best.name : "open line";
}

function signalLabel(de) {
  const n = sim.net.to(de);
  return `${ARROWS[sim.net.dirOf(de)]} near ${nearestStationName(n.x, n.y)}`;
}

function renderStats() {
  if (tab !== "stats") return;
  const el = $("#tab-stats");
  let run = 0, wait = 0, dwell = 0, arr = 0;
  const lineRows = layout.lines.map((l) => {
    const s = sim.lineStat(l.id);
    run += s.run; wait += s.wait; dwell += s.dwell;
    const ph = sim.perHour(s.arr);
    arr += ph;
    const busy = s.run + s.wait + s.dwell;
    return `<tr><td><span class="dot" style="--c:${l.color}"></span>${esc(l.name)}</td>
      <td class="num">${sim.trains.filter((t) => t.line === l.id).length}</td>
      <td class="num">${ph.toFixed(0)}</td><td class="num">${busy ? pct(s.wait / busy) : "–"}</td>
      <td class="num">${s.deadlocks || 0}</td></tr>`;
  }).join("");
  const tot = run + wait + dwell || 1;
  const stations = [...sim.net.stations.values()].filter((s) => s.edges.length).map((s) => {
    const occ = s.edges.reduce((a, i) => a + sim.util[i], 0) / s.edges.length;
    return `<tr class="click" data-station="${s.id}"><td>${esc(s.name)}</td><td class="num">${s.tracks}</td>
      <td class="num">${sim.perHour(sim.stationStat(s.id).arr).toFixed(0)}</td><td class="num">${pct(occ)}</td></tr>`;
  }).join("");
  const necks = [...sim.net.sigList].filter((de) => sim.sigWait[de] > 0.02)
    .sort((a, b) => sim.sigWait[b] - sim.sigWait[a]).slice(0, 6)
    .map((de) => `<tr class="click" data-signal="${sigKeyOf(de)}"><td>${signalLabel(de)}</td><td class="num">${pct(sim.sigWait[de])}</td></tr>`).join("");
  const stuck = sim.trains.filter((t) => t.waitT > 20).length;
  el.innerHTML = `
    <h3>Network</h3>
    <div class="kv">
      <span>Trains</span><span>${sim.trains.length}</span>
      <span>Arrivals per hour</span><span>${arr.toFixed(0)}</span>
      <span>Deadlocks (towed)</span><span class="${sim.deadlocks ? "warn" : ""}">${sim.deadlocks}</span>
      ${stuck ? `<span>Stuck right now</span><span class="warn">${stuck}</span>` : ""}
    </div>
    <div class="share">
      <i style="width:${pct(run / tot)};background:#47d18c"></i>
      <i style="width:${pct(dwell / tot)};background:#3fa7ff"></i>
      <i style="width:${pct(wait / tot)};background:#ff5a5f"></i>
    </div>
    <div class="legend"><span style="--c:#47d18c">running ${pct(run / tot)}</span><span style="--c:#3fa7ff">at platforms ${pct(dwell / tot)}</span><span style="--c:#ff5a5f">waiting ${pct(wait / tot)}</span></div>
    <h3>Lines</h3>
    <table class="stats"><tr><th>Line</th><th class="num">Trains</th><th class="num">Arr/h</th><th class="num">Waiting</th><th class="num" title="Deadlocks">⚠</th></tr>${lineRows}</table>
    <h3>Bottlenecks</h3>
    ${necks ? `<table class="stats"><tr><th>Signal</th><th class="num">Train waiting</th></tr>${necks}</table>`
      : `<p class="small muted">No signal is holding trains up much. Try more trains.</p>`}
    <h3>Stations</h3>
    <table class="stats"><tr><th>Station</th><th class="num">Tracks</th><th class="num">Arr/h</th><th class="num">Platform use</th></tr>${stations}</table>
    <p class="small muted">Waiting, usage and bottleneck figures are averaged over about 10 game minutes. Turn on <b>Usage</b> to see busy track on the map.</p>`;
}

// pointerdown, not click: this tab is re-rendered every second.
$("#tab-stats").addEventListener("pointerdown", (e) => {
  const row = e.target.closest("tr.click");
  if (!row) return;
  if (row.dataset.signal) {
    const n = sim.net.to(sigDe(row.dataset.signal));
    focus(n.x, n.y);
    selected = { kind: "signal", id: row.dataset.signal };
  } else if (row.dataset.station) {
    const s = sim.net.stations.get(row.dataset.station);
    focus(s.cx, s.cy);
    selected = { kind: "station", id: s.id };
  }
});

function focus(x, y) {
  const a = viewArea();
  cam.z = Math.max(cam.z, 22);
  cam.x = x - ((a.l + a.r) / 2 - W / 2) / cam.z;
  cam.y = y - ((a.t + a.b) / 2 - H / 2) / cam.z;
}

// ---------------------------------------------------------------------------
// Panel: details of the selected object

function renderInfo() {
  const el = $("#tab-info");
  const sel = selected;
  if (sel?.kind === "train" && !sim.trains.some((t) => t.id === sel.id)) selected = null;
  if (sel?.kind === "station" && !layout.stations[sel.id]) selected = null;
  if (sel?.kind === "signal" && sigDe(sel.id) < 0) selected = null;
  if (!selected) {
    el.innerHTML = `<p class="muted">Tap a train, station or signal on the map to see its details.</p>
      <h3>Legend</h3>
      <div class="kv small">
        <span>Coloured track</span><span>reserved by a train of that line</span>
        <span>Red / green lamp</span><span>signal; ringed = one-way</span>
        <span>Red glow</span><span>trains often wait there</span>
        <span>White tick</span><span>how a switch is set</span>
        <span>Red bar</span><span>buffer stop</span>
      </div>`;
    return;
  }
  if (selected.kind === "train") {
    el.innerHTML = `<h3>Train</h3><div class="kv" id="trainInfo"></div>
      <div class="row" style="margin-top:10px"><button type="button" class="btn danger" data-act="rm-train">Remove train</button></div>`;
  } else if (selected.kind === "station") {
    const s = sim.net.stations.get(selected.id);
    const lines = layout.lines.filter((l) => l.stops.includes(selected.id));
    el.innerHTML = `<h3>Station</h3>
      <input class="name-in" id="stName" value="${esc(s.name)}" maxlength="20" aria-label="Station name">
      <div class="kv" style="margin-top:8px" id="stationInfo"></div>
      <h3>Lines</h3>
      <p>${lines.map((l) => `<span class="dot" style="--c:${l.color}"></span>${esc(l.name)}`).join(" &nbsp; ") || `<span class="muted">None. Add it as a stop in the Lines tab.</span>`}</p>
      <button type="button" class="btn danger" data-act="rm-station">Remove station</button>`;
  } else {
    const one = layout.signals[selected.id] === 1;
    el.innerHTML = `<h3>Signal</h3><div class="kv" id="signalInfo"></div>
      <p class="small muted">${one ? "One-way: trains stop at it when facing it and may not pass it from behind." : "Two-way: trains facing it stop here if the track ahead is not free; trains from behind ignore it."}</p>
      <div class="row"><button type="button" class="btn" data-act="sig-type">${one ? "Make two-way" : "Make one-way"}</button>
      <button type="button" class="btn danger" data-act="rm-signal">Remove</button></div>`;
  }
  updateInfo();
}

function updateInfo() {
  if (!selected) return;
  if (selected.kind === "train") {
    const tr = sim.trains.find((t) => t.id === selected.id);
    const el = $("#trainInfo");
    if (!tr) { selected = null; renderInfo(); return; }
    if (!el) return;
    const l = lineById(tr.line);
    el.innerHTML = `<span>Line</span><span><span class="dot" style="--c:${l?.color}"></span>${esc(l?.name || "?")}</span>
      <span>Type</span><span>${TYPES[tr.type].name}</span>
      <span>Status</span><span class="${tr.waitT > 20 ? "warn" : ""}">${sim.status(tr)}</span>
      <span>Speed</span><span>${Math.round(tr.v * KMH)} km/h</span>
      <span>Next stop</span><span>${esc(stationName(tr.dest))}</span>
      <span>Then</span><span>${esc(stationName(tr.after))}</span>
      <span>Distance</span><span>${(tr.odo * 0.05).toFixed(1)} km</span>`;
  } else if (selected.kind === "station") {
    const s = sim.net.stations.get(selected.id);
    const el = $("#stationInfo");
    if (!s || !el) return;
    const occ = s.edges.reduce((a, i) => a + sim.util[i], 0) / s.edges.length;
    const here = sim.trains.filter((t) => t.state !== "run" && t.dest === s.id).length;
    el.innerHTML = `<span>Platform tracks</span><span>${s.tracks}</span>
      <span>Trains here</span><span>${here}</span>
      <span>Arrivals per hour</span><span>${sim.perHour(sim.stationStat(s.id).arr).toFixed(0)}</span>
      <span>Platform use</span><span>${pct(occ)}</span>`;
  } else if (selected.kind === "signal") {
    const el = $("#signalInfo");
    if (!el) return;
    const de = sigDe(selected.id), n = sim.net.to(de);
    el.innerHTML = `<span>Location</span><span>${signalLabel(de)}</span>
      <span>Grid point</span><span>${n.x}, ${n.y}</span>
      <span>Trains waiting</span><span>${pct(sim.sigWait[de])} of the time</span>`;
  }
}

$("#tab-info").addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act || !selected) return;
  if (act === "rm-train") {
    const tr = sim.trains.find((t) => t.id === selected.id);
    if (!tr) return;
    // One train fewer on its line, otherwise it would just respawn.
    edit((L) => { const l = L.lines.find((x) => x.id === tr.line); if (l) l.trains = Math.max(0, l.trains - 1); });
    sim.removeTrain(tr);
    select(null);
  } else if (act === "rm-station") {
    const id = selected.id;
    edit((L) => { for (const [k, s] of Object.entries(L.platforms)) if (s === id) delete L.platforms[k]; });
    select(null);
  } else if (act === "sig-type" || act === "rm-signal") {
    const key = selected.id;
    if (act === "rm-signal") selected = null;
    edit((L) => {
      if (act === "rm-signal") delete L.signals[key];
      else L.signals[key] = L.signals[key] ? 0 : 1;
    }, { rerender: false });
  }
});

$("#tab-info").addEventListener("change", (e) => {
  if (e.target.id !== "stName" || selected?.kind !== "station") return;
  const id = selected.id, name = e.target.value.trim();
  if (name) edit((L) => { L.stations[id].name = name; });
});

// ---------------------------------------------------------------------------
// Main loop

function clock() {
  const s = 6 * 3600 + sim.t * TIME_SCALE;
  const day = Math.floor(s / 86400);
  const h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
  return (day ? `Day ${day + 1} ` : "") + `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

let uiT = 0, statsT = 0;
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  if (!paused) {
    let left = dt * speed;
    while (left > 1e-6) {
      const h = Math.min(left, 0.05);
      sim.step(h);
      left -= h;
    }
  }
  for (const ev of sim.events.splice(0)) {
    if (ev.kind === "towed") {
      toast(`Deadlock: a ${lineById(ev.train.line)?.name || ""} train got stuck and was towed away`);
      if (selected?.kind === "train" && selected.id === ev.train.id) select(null);
    }
  }
  draw();
  uiT += dt;
  statsT += dt;
  if (uiT > 0.4) {
    uiT = 0;
    $("#clock").textContent = clock();
    updateLines();
    updateInfo();
  }
  if (statsT > 1) {
    statsT = 0;
    renderStats();
  }
  requestAnimationFrame(frame);
}

addEventListener("resize", () => { resize(); });

resize();
setTool("select");
setSpeed(1);
setPanel(!isPhone());
setTab("lines");
renderLines();
fit();
if (store.get("trainsim.seenHelp", "0") !== "1") {
  store.set("trainsim.seenHelp", "1");
  $("#help").showModal();
}
requestAnimationFrame(frame);
