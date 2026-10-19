// Transport Racer: a pseudo-3D cargo train race on a three-track main line.
//
// Rendering is a classic "segment" racer on Canvas 2D: the track is a list of
// short segments, each with a curve and a height. Curves are faked by
// accumulating a sideways offset per segment, so anything we project (rails,
// wagons, signals) bends with the track. Wagons and locos are boxes projected
// corner by corner, which makes long trains snake through curves.
//
// Mechanics:
//   - Points & signals: tracks only connect inside junction zones. A signal
//     gantry before each zone shows which tracks are blocked further on;
//     set the points (left/right) early, the switch happens in the zone.
//   - Cargo is score but also weight: more wagons accelerate and climb slower.
//   - Lateral load: taking a curve faster than the sign says builds sway,
//     and a full sway meter throws the last wagon off the train.
//   - Cargo cranes add a wagon if you pass under them slowly enough.
//   - Slipstream behind a rival; drop a wagon to block whoever follows you.

const SEG = 200;              // segment length (world units)
const DRAW = 300;             // segments drawn ahead of the camera
const NEAR = 30;
const LANE = 1300;            // distance between track centres
const RAIL = 380;             // half gauge
const BED = LANE * 1.5 + 650; // half width of the ballast bed
const CAM_H = 1750;
const CAM_BACK = 2600;        // camera distance behind the last wagon
const U_PER_M = 180;          // world units per metre (for the HUD)
const KMH = 0.02;             // km/h per world unit per second
const LOCO_LEN = 1900;
const WAGON_LEN = 1150;
const GAP = 110;
const CAR_HW = 560;           // half width of a wagon
const MAX_WAGONS = 8;
const START_WAGONS = 4;
const ZONE_LEN = 90;          // junction zone length in segments
const SWITCH_TIME = 0.5;      // seconds to cross over one track
const PICKUP_KMH = 70;
const SAFE_LAT = 8;           // (km/h / 100)^2 * curve above this makes cargo sway
const V_MAX = 11000;
const F_MAX = 5000;
const POWER = F_MAX * 4800;   // traction is power-limited above 4800 u/s
const DRAG = POWER / V_MAX ** 3;
const GRAV = 20000;
const BRAKE = 7000;
const ROLL = 120;
const WAGON_MASS = 0.15;
const MULT = [3, 1.5, 1];
const CARGO = ["#d94b3d", "#2f7fd8", "#3aa86b", "#e0a030", "#8e5cc9", "#e86a2c", "#c8ccd4"];

// ---------------------------------------------------------------- helpers

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeIn = (a, b, p) => a + (b - a) * p * p;
const easeInOut = (a, b, p) => a + (b - a) * (0.5 - Math.cos(p * Math.PI) / 2);
const smooth = (t) => t * t * (3 - 2 * t);
const laneX = (l) => (l - 1) * LANE;
const safeKmh = (c) => 100 * Math.sqrt(SAFE_LAT / Math.abs(c));
const ordinal = (n) => ["st", "nd", "rd"][n - 1] || "th";

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(clamp(v * f, 0, 255)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const palettes = new Map();
function palette(hex) {
  if (!palettes.has(hex)) palettes.set(hex, { face: hex, side: shade(hex, 0.62), roof: shade(hex, 1.25), dark: shade(hex, 0.4) });
  return palettes.get(hex);
}

function trap(path, x1, y1, w1, x2, y2, w2) {
  path.moveTo(x1 - w1, y1);
  path.lineTo(x1 + w1, y1);
  path.lineTo(x2 + w2, y2);
  path.lineTo(x2 - w2, y2);
  path.closePath();
}

function quad(ctx, a, b, c, d, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fill();
}

const mix = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

// ---------------------------------------------------------------- track

class Track {
  constructor(seed) {
    this.rnd = mulberry32(seed);
    this.segs = [];
    this.zones = [];
    this.obstacles = [];
    this.hooks = [];
    this.signs = [];
    this.lastY = 0;
    this.straight(120);
    this.startZ = 100 * SEG;
    this.startSeg = 100;
    const sections = 15;
    for (let k = 0; k < sections; k++) {
      const s0 = this.segs.length;
      this.straight(ZONE_LEN);
      for (let i = s0; i < s0 + ZONE_LEN; i++) this.segs[i].zone = i - s0;
      this.zones.push({ s0, s1: s0 + ZONE_LEN });
      this.section(k, k === sections - 1);
    }
    this.finishSeg = this.segs.length;
    this.finishZ = this.finishSeg * SEG;
    this.straight(DRAW + 260);
    this.decorate();
  }

  push(curve, y) {
    this.segs.push({ curve, y0: this.lastY, y1: y, zone: -1, scenery: [] });
    this.lastY = y;
  }

  piece(enter, hold, leave, curve, dy) {
    const y0 = this.lastY, total = enter + hold + leave;
    for (let i = 0; i < total; i++) {
      let c = curve;
      if (i < enter) c = easeIn(0, curve, i / enter);
      else if (i >= enter + hold) c = easeInOut(curve, 0, (i - enter - hold) / leave);
      this.push(c, easeInOut(y0, y0 + dy, (i + 1) / total));
    }
  }

  straight(n) { this.piece(0, n, 0, 0, 0); }

  section(k, last) {
    const r = this.rnd, s0 = this.segs.length;
    // Sharper curves show up as the race goes on.
    const mags = [0, 2, 3, 4, 5, 6].slice(0, 3 + Math.min(3, Math.floor(k / 3)));
    const pieces = 1 + Math.floor(r() * 3);
    for (let p = 0; p < pieces; p++) {
      const enter = 15 + Math.floor(r() * 25), hold = 20 + Math.floor(r() * 70);
      const total = enter * 2 + hold;
      const curve = mags[Math.floor(r() * mags.length)] * (r() < 0.5 ? -1 : 1);
      // Hills average up to ~6% and drift back towards zero height.
      const dy = last ? -this.lastY : clamp((r() * 2 - 1) * total * SEG * 0.06 - this.lastY * 0.4, -5000, 5000);
      if (Math.abs(curve) >= 3) {
        this.signs.push({ z: (this.segs.length - 30) * SEG, kind: "speed", value: Math.floor(safeKmh(curve) / 10) * 10, side: 1 });
      }
      this.piece(enter, hold, enter, curve, dy);
    }
    const len = this.segs.length - s0;
    if (len < 160) this.straight(160 - len);
    const s1 = this.segs.length;

    let blocked = [];
    if (k >= 1 && r() < 0.85) {
      const lanes = [0, 1, 2].sort(() => r() - 0.5);
      blocked = lanes.slice(0, k >= 5 && r() < 0.35 ? 2 : 1);
    }
    for (const lane of blocked) {
      const cars = 2 + Math.floor(r() * 2);
      const z0 = Math.floor(s0 + 20 + r() * (s1 - s0 - 70)) * SEG;
      this.obstacles.push({ lane, z0, z1: z0 + cars * (WAGON_LEN + GAP), cars, color: "#8a5a3c", hit: false, kind: "rake" });
    }
    if (r() < 0.55) {
      const free = [0, 1, 2].filter((l) => !blocked.includes(l));
      const lane = free[Math.floor(r() * free.length)];
      const z = Math.floor(s0 + (s1 - s0) * (0.45 + r() * 0.3)) * SEG;
      this.hooks.push({ lane, z, used: false });
      this.signs.push({ z: z - 70 * SEG, kind: "cargo", side: lane === 0 ? -1 : 1 });
    }
  }

  decorate() {
    const r = this.rnd;
    const greens = ["#2f6b34", "#3b7a3a", "#28583a", "#4a7f2f"];
    const walls = ["#d8c8a8", "#c98e6a", "#b8b0a0", "#e0d6c0"];
    this.segs.forEach((seg, i) => {
      if (i % 16 === 0) {
        seg.scenery.push({ kind: "pole", x: -(BED + 260), s: 1 });
        seg.scenery.push({ kind: "pole", x: BED + 260, s: 1 });
      }
      if (r() < 0.24) {
        const side = r() < 0.5 ? -1 : 1;
        seg.scenery.push({ kind: "tree", x: side * (BED + 700 + r() * 7000), s: 0.8 + r() * 0.8, c: greens[Math.floor(r() * greens.length)] });
      }
      if (r() < 0.018) {
        const side = r() < 0.5 ? -1 : 1;
        seg.scenery.push({ kind: "house", x: side * (BED + 2400 + r() * 4000), s: 0.9 + r() * 0.5, c: walls[Math.floor(r() * walls.length)] });
      }
    });
  }

  segAt(i) { return this.segs[clamp(i, 0, this.segs.length - 1)]; }
  seg(z) { return this.segAt(Math.floor(z / SEG)); }
  y(z) { const s = this.seg(z); return lerp(s.y0, s.y1, (z % SEG) / SEG); }
  slope(z) { const s = this.seg(z); return (s.y1 - s.y0) / SEG; }
  inZone(z) { return this.seg(z).zone >= 0; }

  // Index of the zone the train is in or will reach next, or -1 after the last one.
  zoneAfter(z) { return this.zones.findIndex((zn) => zn.s1 * SEG > z); }

  // The stretch of track a zone's signal protects: from its end to the next zone.
  sectionRange(zi) {
    const next = this.zones[zi + 1];
    return [this.zones[zi].s1 * SEG, next ? next.s0 * SEG : this.finishZ];
  }

  blocked(lane, za, zb) {
    return this.obstacles.some((o) => !o.hit && o.lane === lane && o.z1 > za && o.z0 < zb);
  }

  hookIn(lane, za, zb) {
    return this.hooks.some((h) => !h.used && h.lane === lane && h.z >= za && h.z < zb);
  }
}

// ---------------------------------------------------------------- trains

class Train {
  constructor(opts) {
    Object.assign(this, opts);
    this.v = 0;
    this.lanePos = this.lane;
    this.target = this.lane;
    this.from = this.lane;
    this.to = this.lane;
    this.switchT = -1;
    this.stun = 0;
    this.draft = false;
    this.finished = false;
    this.puffT = 0;
    this.throttle = 0;
    this.hist = [{ z: this.z - 60000, x: laneX(this.lane) }];
  }

  get length() { return LOCO_LEN + this.wagons.length * (WAGON_LEN + GAP); }
  get tail() { return this.z - this.length; }
  get mass() { return 1 + WAGON_MASS * this.wagons.length; }

  // Lateral position the loco had when its front was at z; wagons follow it.
  xAt(z) {
    const h = this.hist, last = h[h.length - 1];
    if (z >= last.z) {
      const span = this.z - last.z;
      return span > 0 ? lerp(last.x, laneX(this.lanePos), clamp((z - last.z) / span, 0, 1)) : laneX(this.lanePos);
    }
    let lo = 0, hi = h.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (h[mid].z <= z) lo = mid; else hi = mid;
    }
    const a = h[lo], b = h[hi];
    return lerp(a.x, b.x, clamp((z - a.z) / (b.z - a.z || 1), 0, 1));
  }

  laneAt(z) { return this.xAt(z) / LANE + 1; }

  record() {
    const h = this.hist;
    if (this.z - h[h.length - 1].z >= 40) h.push({ z: this.z, x: laneX(this.lanePos) });
    while (h.length > 2 && h[1].z < this.tail - 3000) h.shift();
  }

  step(dt, track, throttle, brake, powerMul = 1) {
    if (this.stun > 0) { this.stun -= dt; throttle = 0; }
    this.throttle = throttle;
    const m = this.mass, v = this.v;
    const traction = throttle * Math.min(F_MAX, (POWER * powerMul) / Math.max(v, 1));
    const drag = DRAG * (this.draft ? 0.5 : 1) * v * v;
    const a = (traction - drag - (v > 0 ? ROLL : 0) - brake * BRAKE) / m - GRAV * track.slope(this.z - this.length / 2);
    this.v = clamp(v + a * dt, 0, V_MAX * 1.3);
    this.z += this.v * dt;
  }

  // Each car as [rearZ, frontZ, colorHex, isLoco], loco first.
  cars() {
    const out = [[this.z - LOCO_LEN, this.z, this.loco, true]];
    let front = this.z - LOCO_LEN - GAP;
    for (const w of this.wagons) {
      out.push([front - WAGON_LEN, front, w, false]);
      front -= WAGON_LEN + GAP;
    }
    return out;
  }
}

// ---------------------------------------------------------------- audio

class Sounds {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.hornNodes = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Diesel drone: two detuned saws through a lowpass whose cutoff follows the throttle.
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = "lowpass";
    this.engFilter.frequency.value = 300;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter.connect(this.engGain).connect(this.master);
    this.eng = [1, 1.51].map((mul) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = 40 * mul;
      o.connect(this.engFilter);
      o.start();
      return { o, mul };
    });
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  engine(speed, throttle, on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 34 + 46 * speed + 10 * throttle;
    for (const { o, mul } of this.eng) o.frequency.setTargetAtTime(f * mul, t, 0.15);
    this.engFilter.frequency.setTargetAtTime(180 + 500 * throttle + 300 * speed, t, 0.1);
    this.engGain.gain.setTargetAtTime(on ? 0.05 + 0.07 * throttle : 0, t, 0.15);
  }

  burst(dur, freq, q, vol, type = "bandpass", delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  tone(freq, dur, type, vol, delay = 0, slideTo = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  clack(v) {
    const vol = 0.08 + 0.25 * v;
    this.burst(0.05, 2400, 4, vol);
    this.burst(0.05, 2100, 4, vol * 0.8, "bandpass", 0.07);
  }

  horn(on) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (on && !this.hornNodes) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 1400;
      f.connect(g).connect(this.master);
      const oscs = [311, 370, 466].map((fr) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = fr;
        o.connect(f);
        o.start(t);
        return o;
      });
      this.hornNodes = { g, oscs };
    } else if (!on && this.hornNodes) {
      const { g, oscs } = this.hornNodes;
      g.gain.setTargetAtTime(0.0001, t, 0.06);
      oscs.forEach((o) => o.stop(t + 0.4));
      this.hornNodes = null;
    }
  }

  beep(hi) { this.tone(hi ? 880 : 440, hi ? 0.5 : 0.22, "square", 0.12); }
  points() { this.tone(1300, 0.04, "square", 0.05); this.burst(0.08, 900, 6, 0.25, "bandpass", 0.03); }
  bump() { this.burst(0.25, 260, 1, 0.7, "lowpass"); }
  clank() { this.burst(0.35, 1500, 9, 0.6); this.tone(240, 0.4, "square", 0.08, 0, 90); }
  crash() { this.burst(0.8, 500, 0.7, 0.9, "lowpass"); this.tone(90, 0.5, "sawtooth", 0.25, 0, 30); }
  pickup() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, "triangle", 0.15, i * 0.07)); }
  fanfare() { [523, 659, 784, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.28, "square", 0.08, i * 0.13)); }
}

// ---------------------------------------------------------------- storage

const store = {
  get(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode etc. */ }
  },
};

// ---------------------------------------------------------------- game

const $ = (id) => document.getElementById(id);

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sounds = new Sounds();
    this.sounds.muted = store.get("transport-racer.muted", "0") === "1";
    this.best = Number(store.get("transport-racer.best", "0")) || 0;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.keys = new Set();
    this.held = new Map(); // pointerId -> touch action
    this.offX = new Float64Array(DRAW + 2);
    this.offDX = new Float64Array(DRAW + 2);
    this.clipY = new Float64Array(DRAW + 2);
    this.hudCache = {};
    this.mountains = this.makeMountains();
    this.paused = false;

    this.newRace();
    this.state = "title";
    this.bindInput();
    this.showTitle();
    $("mute").setAttribute("aria-pressed", String(this.sounds.muted));

    this.resize();
    addEventListener("resize", () => this.resize());
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  makeMountains() {
    const r = mulberry32(7);
    return [0.22, 0.13].map((amp, layer) => {
      const pts = [];
      for (let i = 0; i < 48; i++) pts.push(amp * (0.35 + 0.65 * r()) * (i % 2 ? 1 : 0.6 + r() * 0.4));
      return { pts, color: layer ? "#6c4a6e" : "#4f3a62", speed: layer ? 1 : 0.5 };
    });
  }

  newRace() {
    const t = (this.track = new Track((Math.random() * 2 ** 32) >>> 0));
    const pick = () => CARGO[Math.floor(Math.random() * CARGO.length)];
    const z = t.startZ;
    this.player = new Train({ name: "You", lane: 1, z, power: 1, loco: "#ffb238", stripe: "#2a2d3e", wagons: Array.from({ length: START_WAGONS }, pick), isPlayer: true });
    this.rivals = [
      new Train({ name: "Teal Line", lane: 0, z, power: 1.0, loco: "#2ec4c4", stripe: "#0d3b4a", wagons: Array(5).fill("#7d8796") }),
      new Train({ name: "Magenta Haul", lane: 2, z, power: 1.05, loco: "#e2457f", stripe: "#4a0d2a", wagons: Array(6).fill("#8a8378") }),
    ];
    this.trains = [this.player, ...this.rivals];
    this.debris = [];
    this.puffs = [];
    this.sway = 0;
    this.swayDir = 0;
    this.shake = 0;
    this.time = 0;
    this.countdown = 3.5;
    this.dispLen = this.player.length;
    this.camX = 0;
    this.camZ = this.player.z - this.dispLen - CAM_BACK;
    this.camY = t.y(this.camZ) + CAM_H;
    this.bgOff = 0;
    this.place = 0;
    this.endTimer = 0;
    this.lastClack = z;
    this.msgTimer = 0;
  }

  hidePanel() {
    $("panel").hidden = true;
    $("touch").hidden = !this.touch;
  }

  start() {
    this.sounds.unlock();
    this.newRace();
    this.state = "countdown";
    this.hidePanel();
    $("hud").hidden = false;
    this.paused = false;
  }

  // ---------------------------------------------------------- input

  bindInput() {
    addEventListener("keydown", (e) => {
      this.sounds.unlock();
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (k === "arrowleft" || k === "a") this.setPoints(-1);
      else if (k === "arrowright" || k === "d") this.setPoints(1);
      else if (k === "x") this.dropWagon();
      else if (k === "h") this.sounds.horn(true);
      else if (k === "m") this.toggleMute();
      else if (k === "p" || k === "escape") this.togglePause();
      else if (k === "enter" && (this.state === "title" || this.state === "results")) this.start();
    });
    addEventListener("keyup", (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === "h") this.sounds.horn(false);
    });
    addEventListener("blur", () => { this.keys.clear(); this.sounds.horn(false); if (this.state === "race") this.togglePause(true); });
    document.addEventListener("visibilitychange", () => { if (document.hidden && this.state === "race") this.togglePause(true); });

    $("mute").addEventListener("click", () => this.toggleMute());
    $("pause").addEventListener("click", () => this.togglePause());

    if (matchMedia("(pointer: coarse)").matches) this.enableTouch();
    addEventListener("pointerdown", (e) => {
      this.sounds.unlock();
      if (e.pointerType === "touch") this.enableTouch();
    });
    for (const b of document.querySelectorAll("#touch button")) {
      const act = b.dataset.act;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        b.setPointerCapture?.(e.pointerId);
        this.held.set(e.pointerId, act);
        b.classList.add("held");
        if (act === "left") this.setPoints(-1);
        else if (act === "right") this.setPoints(1);
        else if (act === "drop") this.dropWagon();
        else if (act === "horn") this.sounds.horn(true);
      });
      const up = (e) => {
        this.held.delete(e.pointerId);
        b.classList.remove("held");
        if (act === "horn") this.sounds.horn(false);
      };
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    }
  }

  enableTouch() {
    if (this.touch) return;
    this.touch = true;
    document.body.classList.add("touch");
    $("touch").hidden = !$("panel").hidden;
  }

  holding(act, ...keys) {
    for (const a of this.held.values()) if (a === act) return true;
    return keys.some((k) => this.keys.has(k));
  }

  setPoints(dir) {
    if (this.state !== "race" && this.state !== "countdown") return;
    const p = this.player;
    const t = clamp(p.target + dir, 0, 2);
    if (t !== p.target) { p.target = t; this.sounds.tone(700 + t * 150, 0.05, "square", 0.05); }
  }

  dropWagon() {
    if (this.state !== "race") return;
    const p = this.player;
    if (!p.wagons.length) return;
    const rear = p.tail;
    const color = p.wagons.pop();
    const lane = clamp(Math.round(p.laneAt(rear + WAGON_LEN / 2)), 0, 2);
    // The dropped wagon stays put and becomes an obstacle for anyone behind.
    this.track.obstacles.push({ lane, z0: rear, z1: rear + WAGON_LEN, cars: 1, color, hit: false, kind: "dropped" });
    this.sounds.clank();
    this.showMsg("Wagon dropped!", "small", 1.2);
  }

  toggleMute() {
    this.sounds.unlock();
    this.sounds.setMuted(!this.sounds.muted);
    $("mute").setAttribute("aria-pressed", String(this.sounds.muted));
    store.set("transport-racer.muted", this.sounds.muted ? "1" : "0");
  }

  togglePause(force) {
    if (this.state !== "race" && this.state !== "countdown") return;
    this.paused = force ?? !this.paused;
    if (this.paused) {
      this.sounds.engine(0, 0, false);
      this.sounds.horn(false);
      this.showPanel(`
        <h2>Paused</h2>
        <div class="row">
          <button class="btn" type="button" data-do="resume">Resume</button>
          <button class="btn ghost" type="button" data-do="restart">Restart</button>
          <a class="btn ghost" href="../">All games</a>
        </div>`);
    } else {
      this.hidePanel();
    }
  }

  // ---------------------------------------------------------- panels

  showPanel(html) {
    const panel = $("panel");
    panel.innerHTML = html;
    panel.hidden = false;
    $("touch").hidden = true;
    for (const b of panel.querySelectorAll("[data-do]")) {
      b.addEventListener("click", () => {
        const what = b.dataset.do;
        if (what === "resume") this.togglePause(false);
        else this.start();
      });
    }
    panel.scrollTop = 0;
    panel.querySelector("button")?.focus({ preventScroll: true });
  }

  showTitle() {
    $("hud").hidden = true;
    this.showPanel(`
      <h1>TRANSPORT <span>RACER</span></h1>
      <p>Haul cargo down a three-track main line and beat two rival freight trains to the depot.</p>
      <ul>
        <li><b>Signals</b> above each junction show red for tracks that are blocked further on. Set the points with <kbd>&larr;</kbd> <kbd>&rarr;</kbd> in time; you can only cross over inside a junction.</li>
        <li><b>Cargo is score, but weight.</b> Every wagon makes you slower to accelerate and climb.</li>
        <li><b>Curves:</b> go faster than the speed sign and your cargo sways. A full sway meter throws the last wagon off.</li>
        <li><b>Cargo cranes:</b> pass under one at &le;${PICKUP_KMH} km/h to load an extra wagon.</li>
        <li><b>Slipstream</b> right behind a rival. <b>Drop a wagon</b> (<kbd>X</kbd>) to block whoever follows on your track.</li>
        <li>Score = wagons &times; 100 &times; place bonus (1st &times;3, 2nd &times;1.5).</li>
      </ul>
      <p class="keys"><kbd>W</kbd>/<kbd>&uarr;</kbd> power &middot; <kbd>S</kbd>/<kbd>&darr;</kbd> brake &middot; <kbd>A</kbd><kbd>D</kbd>/<kbd>&larr;</kbd><kbd>&rarr;</kbd> points &middot; <kbd>X</kbd> drop wagon &middot; <kbd>H</kbd> horn &middot; <kbd>P</kbd> pause &middot; <kbd>M</kbd> mute</p>
      <div class="row">
        <button class="btn" type="button" data-do="start">Start race</button>
        <span class="best">${this.best ? `Best score: ${this.best}` : ""}</span>
      </div>`);
  }

  showResults() {
    const p = this.player, place = this.place;
    const mult = MULT[place - 1];
    const score = Math.round(p.wagons.length * 100 * mult);
    const record = score > this.best;
    if (record) {
      this.best = score;
      store.set("transport-racer.best", String(score));
    }
    this.state = "results";
    this.showPanel(`
      <h2>${place === 1 ? "Victory!" : `${place}${ordinal(place)} place`}</h2>
      <table>
        <tr><td>Time</td><td>${this.fmtTime(this.finishTime)}</td></tr>
        <tr><td>Wagons delivered</td><td>${p.wagons.length}</td></tr>
        <tr><td>Place bonus</td><td>&times;${mult}</td></tr>
        <tr class="score"><td>Score</td><td>${score}</td></tr>
      </table>
      ${p.wagons.length ? "" : "<p>No cargo delivered: the depot pays per wagon, so keep some on board next time.</p>"}
      <p>${record ? "New best score!" : `Best score: ${this.best}`}</p>
      <div class="row">
        <button class="btn" type="button" data-do="restart">Race again</button>
        <a class="btn ghost" href="../">All games</a>
      </div>`);
  }

  showMsg(text, cls = "", dur = 1.5) {
    const m = $("msg");
    m.textContent = text;
    m.className = `msg show ${cls}`;
    this.msgTimer = dur;
  }

  fmtTime(t) {
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
  }

  // ---------------------------------------------------------- simulation

  frame(now) {
    const dt = Math.min((now - this.last) / 1000, 1 / 20);
    this.last = now;
    if (!this.paused) this.update(dt);
    this.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) $("msg").classList.remove("show");
    }
    if (this.state === "countdown") {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after > 0 && after <= 3) { this.sounds.beep(false); this.showMsg(String(after), "", 0.9); }
      if (this.countdown <= 0) {
        this.state = "race";
        this.sounds.beep(true);
        this.showMsg("GO!", "good", 1);
      }
    }
    if (this.state === "race" || this.state === "finished" || this.state === "results") this.simulate(dt);
    else if (this.state === "title") this.camZ = this.player.z - this.dispLen - CAM_BACK;
    this.updateCamera(dt);
    this.updateFx(dt);
    if (!$("hud").hidden) this.updateHud();
  }

  simulate(dt) {
    const t = this.track, p = this.player;
    const racing = this.state === "race";
    if (racing) this.time += dt;

    for (const tr of this.trains) tr.prevZ = tr.z;

    let thr = racing && this.holding("throttle", "arrowup", "w") ? 1 : 0;
    let brk = racing && this.holding("brake", "arrowdown", "s", " ") ? 1 : 0;
    if (!racing) { thr = 0; brk = 0.7; }
    p.draft = racing && this.rivals.some((r) => {
      const gap = r.tail - p.z;
      return gap > 0 && gap < 3200 && Math.abs(r.laneAt(r.tail) - p.lanePos) < 0.5;
    });
    p.step(dt, t, thr, brk);
    for (const r of this.rivals) this.ai(r, dt);

    for (const tr of this.trains) this.updateSwitch(tr, dt);
    for (const a of this.trains) for (const b of this.trains) if (a !== b) this.collideTrains(a, b);
    for (const tr of this.trains) this.collideObstacles(tr);
    for (const tr of this.trains) tr.record();

    if (racing) {
      this.updateSway(dt);
      this.checkHooks();
    }

    for (const r of this.rivals) {
      if (!r.finished && r.z >= t.finishZ) { r.finished = true; r.finishTime = this.time; }
    }
    if (racing && p.z >= t.finishZ) {
      p.finished = true;
      this.finishTime = this.time;
      this.place = 1 + this.rivals.filter((r) => r.finished).length;
      this.state = "finished";
      this.endTimer = 2.2;
      this.sounds.fanfare();
      this.showMsg(this.place === 1 ? "1st PLACE!" : `${this.place}${ordinal(this.place)} place`, this.place === 1 ? "good" : "", 2.2);
    }
    if (this.state === "finished") {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.showResults();
    }

    // Keep everyone on the generated track after the finish.
    const zEnd = (t.segs.length - DRAW - 10) * SEG;
    for (const tr of this.trains) if (tr.z > zEnd) { tr.z = zEnd; tr.v = 0; }

    while (p.z >= this.lastClack + 3000) {
      this.lastClack += 3000;
      this.sounds.clack(p.v / V_MAX);
    }
    this.sounds.engine(p.v / V_MAX, thr, true);
    this.bgOff += t.seg(p.z).curve * (p.z - p.prevZ) / SEG * 0.0012;
  }

  ai(r, dt) {
    const t = this.track, p = this.player;
    let target = r.finished ? 0 : V_MAX * 1.1;
    const decel = (BRAKE / r.mass) * 0.6;
    const i0 = Math.floor(r.z / SEG);
    for (let i = 0; i < 100; i++) {
      const c = Math.abs(t.segAt(i0 + i).curve);
      if (c < 1.5) continue;
      const vs = (safeKmh(c) * 0.93) / KMH;
      const d = Math.max(0, i * SEG - (r.z % SEG));
      target = Math.min(target, Math.sqrt(vs * vs + 2 * decel * d));
    }
    // Brake for a slower train ahead on our track instead of ramming it.
    const ahead = this.trainAhead(r, r.target === r.lane ? r.lane : r.lanePos, 9000);
    if (ahead) {
      const gap = Math.max(0, ahead.tail - r.z - 800);
      target = Math.min(target, Math.sqrt(ahead.v * ahead.v + 2 * decel * gap));
    }
    const thr = r.v < target - 150 ? 1 : r.v < target ? 0.4 : 0;
    const brk = r.v > target + 250 ? 1 : 0;
    // Mild rubber band so the race stays close in both directions.
    const band = clamp(1 + ((p.z - r.z) / 40000) * 0.15, 0.88, 1.15);
    r.step(dt, t, thr, brk, r.power * band);
    this.aiLanes(r);
  }

  trainAhead(r, lane, range) {
    let best = null;
    for (const o of this.trains) {
      const gap = o.tail - r.z;
      if (o === r || gap < -200 || gap > range || Math.abs(o.laneAt(o.tail) - lane) > 0.6) continue;
      if (!best || o.tail < best.tail) best = o;
    }
    return best;
  }

  aiLanes(r) {
    const t = this.track;
    const zi = t.zoneAfter(r.z);
    if (zi < 0) return;
    const zone = t.zones[zi];
    if (r.z < zone.s0 * SEG - 80 * SEG) return; // can't see the signal yet
    const [, b] = t.sectionRange(zi);
    const free = (l) => !t.blocked(l, r.z, b);
    if (r.decided !== zi) {
      r.decided = zi;
      // Sometimes change track for no reason, like a human would.
      if (Math.random() < 0.3) {
        const l = Math.floor(Math.random() * 3);
        if (free(l)) r.target = l;
      }
    }
    // Overtake a slower train by taking another free track.
    const slow = (l) => { const o = this.trainAhead(r, l, 12000); return o && o.v < r.v + 500; };
    if (!free(r.target) || slow(r.target)) {
      const options = [0, 1, 2].filter(free).sort((a, c) =>
        (slow(a) - slow(c)) || Math.abs(a - r.lane) - Math.abs(c - r.lane));
      if (options.length) r.target = options[0];
    }
  }

  updateSwitch(tr, dt) {
    if (tr.switchT >= 0) {
      tr.switchT = Math.min(1, tr.switchT + dt / SWITCH_TIME);
      tr.lanePos = lerp(tr.from, tr.to, smooth(tr.switchT));
      if (tr.switchT >= 1) {
        tr.lane = tr.to;
        tr.switchT = -1;
      }
      return;
    }
    tr.blockedSwitch = false;
    if (tr.target === tr.lane || !this.track.inZone(tr.z)) return;
    const next = tr.lane + Math.sign(tr.target - tr.lane);
    if (this.laneBusy(tr, next)) { tr.blockedSwitch = true; return; }
    tr.from = tr.lane;
    tr.to = next;
    tr.switchT = 0;
    if (tr.isPlayer) this.sounds.points();
  }

  // Is another train alongside us on that track? Then the points stay locked.
  laneBusy(tr, lane) {
    return this.trains.some((o) => o !== tr &&
      o.tail < tr.z + 900 && o.z > tr.tail - 300 &&
      (Math.abs(o.lanePos - lane) < 0.6 || Math.abs(o.laneAt(Math.max(o.tail, tr.tail)) - lane) < 0.6));
  }

  collideTrains(a, b) {
    if (a.z <= b.tail || a.z >= b.z) return;
    if (a.prevZ > b.tail + 600) return; // already alongside, not a rear-end hit
    if (Math.abs(a.lanePos - b.laneAt(a.z)) > 0.7) return;
    a.z = b.tail - 1;
    if (a.v > b.v) {
      a.v = b.v * 0.85;
      if (a.isPlayer || b.isPlayer) {
        this.sounds.bump();
        this.shake = Math.max(this.shake, 0.5);
        if (a.isPlayer) this.sway = Math.min(0.95, this.sway + 0.25);
      }
    }
  }

  collideObstacles(tr) {
    for (const o of this.track.obstacles) {
      if (o.hit || tr.prevZ >= o.z0 || tr.z < o.z0) continue;
      if (Math.abs(tr.lanePos - o.lane) > 0.7) continue;
      o.hit = true;
      tr.z = o.z0;
      tr.v *= 0.2;
      tr.stun = 1.2;
      for (let i = 0; i < o.cars; i++) {
        const z = o.z0 + i * (WAGON_LEN + GAP) + WAGON_LEN / 2;
        this.spawnDebris(z, laneX(o.lane), o.color, Math.random() < 0.5 ? -1 : 1, tr.v * 0.5);
      }
      this.sparks(o.z0, laneX(o.lane), 700, 24, "#ffcc55");
      if (tr.isPlayer) {
        this.sounds.crash();
        this.shake = 1;
        this.loseWagon(tr, Math.random() < 0.5 ? -1 : 1);
        this.showMsg("CRASH!", "bad", 1.4);
      } else if (tr.wagons.length) {
        tr.wagons.pop();
      }
    }
  }

  updateSway(dt) {
    const p = this.player;
    const c = this.track.seg(p.z).curve;
    const kmh = p.v * KMH;
    const over = ((kmh / 100) ** 2 * Math.abs(c)) / SAFE_LAT - 1;
    if (over > 0) {
      this.sway += over * 0.9 * dt;
      this.swayDir = lerp(this.swayDir, -Math.sign(c), Math.min(1, dt * 4));
    } else {
      this.sway = Math.max(0, this.sway - 0.35 * dt);
    }
    if (this.sway >= 1) {
      if (p.wagons.length) {
        this.loseWagon(p, -Math.sign(c) || 1);
        this.showMsg("Cargo lost!", "bad", 1.3);
        this.sway = 0.3;
      } else {
        this.sway = 0.99;
      }
    }
  }

  loseWagon(tr, dir) {
    if (!tr.wagons.length) return;
    const rear = tr.tail;
    const color = tr.wagons.pop();
    const mid = rear + WAGON_LEN / 2;
    this.spawnDebris(mid, tr.xAt(mid), color, dir, tr.v * 0.8);
    this.sparks(mid, tr.xAt(mid), 400, 18, "#ffcc55");
    this.sounds.clank();
  }

  checkHooks() {
    const p = this.player;
    for (const h of this.track.hooks) {
      if (h.used || p.prevZ >= h.z || p.z < h.z) continue;
      if (Math.abs(p.lanePos - h.lane) > 0.5) continue;
      if (p.v * KMH > PICKUP_KMH + 0.5) {
        this.showMsg("Too fast for pickup", "bad small", 1.3);
      } else if (p.wagons.length >= MAX_WAGONS) {
        this.showMsg("Train is full", "small", 1.2);
      } else {
        h.used = true;
        p.wagons.push(CARGO[Math.floor(Math.random() * CARGO.length)]);
        this.sounds.pickup();
        this.sparks(h.z, laneX(h.lane), 2200, 20, "#ffe066");
        this.showMsg("+1 Wagon", "good", 1.3);
      }
    }
  }

  spawnDebris(z, x, color, dir, vz) {
    this.debris.push({
      z, x, y: 200, vz,
      vx: dir * (2500 + Math.random() * 2500),
      vy: 2500 + Math.random() * 2500,
      rot: 0, vrot: dir * (3 + Math.random() * 4),
      color, life: 3,
    });
  }

  sparks(z, x, y, n, color) {
    for (let i = 0; i < n; i++) {
      this.puffs.push({
        z: z + (Math.random() - 0.5) * 600, x: x + (Math.random() - 0.5) * 900, y,
        vx: (Math.random() - 0.5) * 5000, vy: 1500 + Math.random() * 3000, vz: (Math.random() - 0.5) * 3000,
        r: 40, grow: 0, life: 0.6 + Math.random() * 0.5, max: 1.1, color, spark: true,
      });
    }
  }

  updateFx(dt) {
    for (const d of this.debris) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      d.vy -= 9000 * dt;
      d.vz *= 1 - dt * 1.5;
      d.rot += d.vrot * dt;
      if (d.y < 0) { d.y = 0; d.vy *= -0.3; d.vx *= 0.5; d.vrot *= 0.5; }
      d.life -= dt;
    }
    this.debris = this.debris.filter((d) => d.life > 0 && d.z > this.camZ);

    // Exhaust puffs from every loco that is pulling.
    if (this.state !== "title") {
      for (const tr of this.trains) {
        tr.puffT -= dt;
        if (tr.throttle > 0.3 && tr.puffT <= 0) {
          tr.puffT = 0.05 + 0.12 * (1 - tr.v / V_MAX);
          this.puffs.push({ z: tr.z - 450, x: laneX(tr.lanePos), y: 1350, vx: 0, vy: 1200, vz: 0, r: 110, grow: 260, life: 0.8, max: 0.8, color: "#5a5560" });
        }
      }
    }
    for (const q of this.puffs) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      q.r += q.grow * dt;
      if (q.spark) q.vy -= 7000 * dt;
      q.life -= dt;
    }
    this.puffs = this.puffs.filter((q) => q.life > 0 && q.z > this.camZ + NEAR);
    this.shake = Math.max(0, this.shake - dt * 2);
  }

  updateCamera(dt) {
    const p = this.player, t = this.track;
    this.dispLen += (p.length - this.dispLen) * Math.min(1, dt * 2.5);
    this.camZ = p.z - this.dispLen - CAM_BACK;
    const tx = p.xAt(p.z - this.dispLen) * 0.75 + laneX(p.lanePos) * 0.25;
    this.camX += (tx - this.camX) * Math.min(1, dt * 3);
    const cy = Math.max(t.y(this.camZ), t.y(this.camZ + 5000)) + CAM_H;
    this.camY += (cy - this.camY) * Math.min(1, dt * 6);
  }

  // ---------------------------------------------------------- HUD

  setText(id, text) {
    if (this.hudCache[id] === text) return;
    this.hudCache[id] = text;
    $(id).textContent = text;
  }

  updateHud() {
    const p = this.player, t = this.track;
    const order = [...this.trains].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.finishTime - b.finishTime;
      return b.z - a.z;
    });
    const pos = p.finished ? this.place : order.indexOf(p) + 1;
    this.setText("pos", String(pos));
    this.setText("pos-suf", ordinal(pos));
    this.setText("time", this.fmtTime(p.finished ? this.finishTime : this.time));
    this.setText("kmh", String(Math.round(p.v * KMH)));
    $("sway").style.width = `${Math.round(this.sway * 100)}%`;
    $("draft").classList.toggle("on", p.draft);

    const span = t.finishZ - t.startZ;
    const marks = document.querySelectorAll(".progress .mark");
    [this.rivals[0], this.rivals[1], p].forEach((tr, i) => {
      marks[i].style.left = `${clamp((tr.z - t.startZ) / span, 0, 1) * 100}%`;
    });

    const wkey = p.wagons.join();
    if (this.hudCache.wagons !== wkey) {
      this.hudCache.wagons = wkey;
      const icons = [];
      for (let i = 0; i < MAX_WAGONS; i++) {
        icons.push(i < p.wagons.length ? `<i style="background:${p.wagons[i]}"></i>` : `<i class="empty"></i>`);
      }
      $("wagons").innerHTML = icons.join("");
    }

    // Points widget: current track, armed track, and what the next signal says.
    const zi = t.zoneAfter(p.z);
    let label = "Final stretch", cls = "";
    let sig = null;
    if (zi >= 0) {
      const zone = t.zones[zi];
      const dist = zone.s0 * SEG - p.z;
      const [a, b] = t.sectionRange(zi);
      if (dist < DRAW * SEG) sig = [0, 1, 2].map((l) => ({ red: t.blocked(l, Math.max(a, p.z), b), cargo: t.hookIn(l, a, b) }));
      if (dist > 0) {
        label = `Junction in ${Math.round(dist / U_PER_M)} m`;
      } else {
        label = p.blockedSwitch ? "Blocked by train!" : p.switchT >= 0 ? "Switching" : "Junction";
        cls = p.blockedSwitch ? "bad" : "hot";
      }
    }
    if (p.finished) { label = "Finished"; cls = ""; }
    this.setText("points-label", label);
    $("points-label").className = `points-label ${cls}`;
    const lanes = $("lanes").children;
    const cur = Math.round(p.lanePos);
    for (let l = 0; l < 3; l++) {
      const c = [];
      if (l === cur) c.push("cur");
      if (l === p.target && p.target !== cur) c.push("tgt");
      if (sig) c.push(sig[l].red ? "red" : "green");
      if (sig && sig[l].cargo) c.push("cargo");
      const s = c.join(" ");
      if (lanes[l].className !== s) lanes[l].className = s;
    }
  }

  // ---------------------------------------------------------- rendering

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth;
    this.h = innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.dpr = dpr;
    this.horizon = this.h * 0.38;
    this.focal = Math.min(this.w, this.h * 1.5) * 0.55;
  }

  // Curve offset (world x) of the track centre at z, relative to the camera.
  offAt(z) {
    const rel = z / SEG - this.base;
    const n = clamp(Math.floor(rel), 0, DRAW);
    return this.offX[n] + this.offDX[n] * (rel - n);
  }

  proj(x, y, z, off = this.offAt(z)) {
    const s = this.focal / Math.max(z - this.camZ, NEAR);
    return { x: this.w / 2 + (x + off - this.camX) * s, y: this.horizon - (y - this.camY) * s, s };
  }

  render() {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.save();
    if (this.shake > 0) {
      const a = this.shake * (this.reduced ? 3 : 10);
      ctx.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    }
    this.drawSky();
    this.drawTrack();
    this.drawSprites();
    if (this.player.draft && this.state === "race") this.drawSpeedLines();
    ctx.restore();
  }

  drawSky() {
    const { ctx, w, h } = this;
    const hz = this.horizon;
    const g = ctx.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, "#1d2350");
    g.addColorStop(0.55, "#a2507a");
    g.addColorStop(1, "#f6a868");
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, w + 40, hz + 21);
    ctx.fillStyle = "#ffe0a0";
    ctx.beginPath();
    ctx.arc(w * 0.68 - this.bgOff * w * 0.2, hz - h * 0.06, Math.min(w, h) * 0.07, 0, Math.PI * 2);
    ctx.fill();

    for (const m of this.mountains) {
      const period = w * 1.6;
      const off = ((this.bgOff * m.speed * w) % period + period) % period;
      const n = m.pts.length;
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.moveTo(-20, hz + 1);
      for (let rep = -1; rep <= 1; rep++) {
        for (let i = 0; i <= n; i++) {
          const x = rep * period + (i / n) * period - off;
          if (x < -period / n - 20 || x > w + period / n + 20) continue;
          ctx.lineTo(x, hz - m.pts[i % n] * h);
        }
      }
      ctx.lineTo(w + 20, hz + 1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#5c7a3e";
    ctx.fillRect(-20, hz, w + 40, h - hz + 20);
  }

  drawTrack() {
    const { ctx, w, h } = this;
    const t = this.track;
    const base = (this.base = Math.floor(this.camZ / SEG));
    const pct = (this.camZ % SEG) / SEG;
    let x = 0, dx = -(t.segAt(base).curve * pct);
    let maxy = h;
    const P = {
      grassA: new Path2D(), grassB: new Path2D(), shoulder: new Path2D(),
      bed: new Path2D(), bedZone: new Path2D(), sleeper: new Path2D(),
      rail: new Path2D(), white: new Path2D(), black: new Path2D(),
    };
    for (let n = 0; n <= DRAW; n++) {
      const i = base + n, seg = t.segAt(i);
      this.offX[n] = x;
      this.offDX[n] = dx;
      this.clipY[n] = maxy;
      const ox = x, odx = dx;
      x += dx;
      dx += seg.curve;
      const z1 = i * SEG, z2 = z1 + SEG;
      if (z1 - this.camZ < NEAR) continue;
      const p1 = this.proj(0, seg.y0, z1, ox);
      const p2 = this.proj(0, seg.y1, z2, ox + odx);
      if (p2.y >= maxy || p2.y >= p1.y) continue;
      // Cut the part hidden behind a nearer hill crest so bands never overlap.
      let q1 = p1;
      if (p1.y > maxy) {
        const k = (p1.y - maxy) / (p1.y - p2.y);
        q1 = { x: lerp(p1.x, p2.x, k), y: maxy, s: lerp(p1.s, p2.s, k) };
      }
      this.addSegment(P, q1, p2, seg, i);
      maxy = p2.y;
    }
    this.clipY[DRAW + 1] = maxy;

    const fills = [
      ["grassA", "#5f8f3e"], ["grassB", "#578638"], ["shoulder", "#6b5a48"],
      ["bed", "#8a8075"], ["bedZone", "#9a8e78"], ["sleeper", "#5b4434"],
      ["rail", "#d4d8e2"], ["white", "#f4f4f4"], ["black", "#1c1c1c"],
    ];
    for (const [k, c] of fills) {
      ctx.fillStyle = c;
      ctx.fill(P[k]);
    }

    // Haze towards the horizon hides the low-detail far end of the track.
    const hz = this.horizon;
    const g = ctx.createLinearGradient(0, hz - 30, 0, hz + (h - hz) * 0.22);
    g.addColorStop(0, "rgba(232, 160, 120, 0.85)");
    g.addColorStop(1, "rgba(232, 160, 120, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(-20, hz - 30, w + 40, (h - hz) * 0.22 + 30);
  }

  addSegment(P, p1, p2, seg, i) {
    const w = this.w;
    (Math.floor(i / 3) % 2 ? P.grassA : P.grassB).rect(-20, p2.y, w + 40, p1.y - p2.y + 0.5);
    trap(P.shoulder, p1.x, p1.y, BED * 1.14 * p1.s, p2.x, p2.y, BED * 1.14 * p2.s);
    trap(seg.zone >= 0 ? P.bedZone : P.bed, p1.x, p1.y, BED * p1.s, p2.x, p2.y, BED * p2.s);

    const tall = p1.y - p2.y > 2.2;
    const sy = lerp(p1.y, p2.y, 0.45), sx = lerp(p1.x, p2.x, 0.45), ss = lerp(p1.s, p2.s, 0.45);
    const rw1 = Math.max(0.5, 45 * p1.s), rw2 = Math.max(0.5, 45 * p2.s);
    const rails = (cx1, cx2) => {
      trap(P.rail, p1.x + (cx1 - RAIL) * p1.s, p1.y, rw1, p2.x + (cx2 - RAIL) * p2.s, p2.y, rw2);
      trap(P.rail, p1.x + (cx1 + RAIL) * p1.s, p1.y, rw1, p2.x + (cx2 + RAIL) * p2.s, p2.y, rw2);
    };
    for (let l = 0; l < 3; l++) {
      const lx = laneX(l);
      if (tall) trap(P.sleeper, p1.x + lx * p1.s, p1.y, 620 * p1.s, sx + lx * ss, sy, 620 * ss);
      rails(lx, lx);
    }
    // Crossovers inside a junction zone: diagonal rails between neighbours.
    if (seg.zone >= 0) {
      const k = seg.zone;
      const cross = [[0, 1, 8, 40], [1, 2, 8, 40], [1, 0, 48, 80], [2, 1, 48, 80]];
      for (const [a, b, k0, k1] of cross) {
        if (k < k0 || k >= k1) continue;
        const t1 = (k - k0) / (k1 - k0), t2 = (k + 1 - k0) / (k1 - k0);
        rails(lerp(laneX(a), laneX(b), t1), lerp(laneX(a), laneX(b), t2));
      }
    }
    if (i === this.track.finishSeg || i === this.track.finishSeg + 1 || i === this.track.startSeg) {
      // Chequered band across the bed.
      const cells = 12;
      for (let c = 0; c < cells; c++) {
        const u0 = -BED + (c / cells) * 2 * BED, u1 = u0 + (2 * BED) / cells;
        const path = (c + i) % 2 ? P.white : P.black;
        path.moveTo(p1.x + u0 * p1.s, p1.y);
        path.lineTo(p1.x + u1 * p1.s, p1.y);
        path.lineTo(p2.x + u1 * p2.s, p2.y);
        path.lineTo(p2.x + u0 * p2.s, p2.y);
        path.closePath();
      }
    }
  }

  drawSprites() {
    const { ctx, h } = this;
    const t = this.track;
    const zMin = this.camZ + NEAR, zMax = this.camZ + DRAW * SEG;
    const items = [];
    const add = (z, draw) => { if (z < zMax && z > zMin - WAGON_LEN * 2) items.push({ z, draw }); };

    for (let n = 1; n < DRAW; n++) {
      const i = this.base + n, seg = t.segAt(i);
      for (const sc of seg.scenery) add(i * SEG + SEG / 2, () => this.drawScenery(sc, i * SEG + SEG / 2));
    }
    t.zones.forEach((zone, zi) => { const z = zone.s0 * SEG; add(z, () => this.drawGantry(z, zi)); });
    for (const sg of t.signs) add(sg.z, () => this.drawSign(sg));
    for (const hk of t.hooks) add(hk.z, () => this.drawCrane(hk));
    for (const o of t.obstacles) {
      if (o.hit) continue;
      for (let c = 0; c < o.cars; c++) {
        const z0 = o.z0 + c * (WAGON_LEN + GAP);
        add(z0, () => this.drawObstacleCar(o, z0, c));
      }
    }
    for (const tr of this.trains) {
      const tilt = tr.isPlayer ? this.sway * this.swayDir * 260 + Math.sin(performance.now() / 90) * this.sway * 60 : 0;
      for (const [zr, zf, color, loco] of tr.cars()) {
        add(zr, () => this.drawCar(tr, zr, zf, color, loco, tilt));
      }
    }
    for (const d of this.debris) add(d.z, () => this.drawDebris(d));
    for (const q of this.puffs) add(q.z, () => this.drawPuff(q));

    items.sort((a, b) => b.z - a.z);
    const D = DRAW * SEG;
    for (const it of items) {
      const n = clamp(Math.floor(it.z / SEG) - this.base, 0, DRAW + 1);
      const clip = this.clipY[n];
      const dz = it.z - this.camZ;
      ctx.globalAlpha = clamp(1 - (dz - 0.65 * D) / (0.35 * D), 0, 1);
      if (clip < h - 1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(-50, -50, this.w + 100, clip + 50);
        ctx.clip();
        it.draw();
        ctx.restore();
      } else {
        it.draw();
      }
    }
    ctx.globalAlpha = 1;
  }

  // A box that follows the track between zRear and zFront, centred at the
  // given lateral positions. Draws visible side, roof, then the rear face.
  drawBox(zr, zf, xr, xf, hw, ht, pal, tilt, decorate) {
    const { ctx } = this;
    const t = this.track;
    const zMin = this.camZ + NEAR;
    if (zf <= zMin) return;
    if (zr < zMin) { xr = lerp(xr, xf, (zMin - zr) / (zf - zr)); zr = zMin; }
    const yr = t.y(zr) + 80, yf = t.y(zf) + 80;
    const or = this.offAt(zr), of = this.offAt(zf);
    const P = (x, y, z, off) => this.proj(x, y, z, off);
    const nl = P(xr - hw, yr, zr, or), nr = P(xr + hw, yr, zr, or);
    const nlt = P(xr - hw + tilt, yr + ht, zr, or), nrt = P(xr + hw + tilt, yr + ht, zr, or);
    const fl = P(xf - hw, yf, zf, of), fr = P(xf + hw, yf, zf, of);
    const flt = P(xf - hw + tilt, yf + ht, zf, of), frt = P(xf + hw + tilt, yf + ht, zf, of);

    if (xr + hw + or - this.camX < 0) quad(ctx, nr, fr, frt, nrt, pal.side);
    if (xr - hw + or - this.camX > 0) quad(ctx, nl, fl, flt, nlt, pal.side);
    if (yr + ht < this.camY) quad(ctx, nlt, nrt, frt, flt, pal.roof);
    quad(ctx, nl, nr, nrt, nlt, pal.face);
    if (decorate) decorate([nl, nr, nrt, nlt], [nlt, nrt, frt, flt], nl.s);
  }

  drawCar(tr, zr, zf, color, loco, tilt) {
    const { ctx } = this;
    const pal = palette(color);
    const xr = tr.xAt(zr), xf = tr.xAt(zf);
    if (loco) {
      const stripe = palette(tr.stripe);
      this.drawBox(zr, zf, xr, xf, CAR_HW + 20, 1250, pal, 0, ([bl, br, tr2, tl], roof, s) => {
        const band = (a, b, col) => quad(ctx, mix(bl, tl, a), mix(br, tr2, a), mix(br, tr2, b), mix(bl, tl, b), col);
        band(0, 0.14, "#1b1b22");
        band(0.42, 0.56, stripe.face);
        // Tail lights.
        const r = Math.max(1, 70 * s);
        ctx.fillStyle = "#ff4a3a";
        for (const u of [0.16, 0.84]) {
          const p = mix(mix(bl, br, u), mix(tl, tr2, u), 0.28);
          ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
        }
        // Roof fan grilles, only when we look down onto the roof.
        if (roof[3].y < roof[0].y) {
          const rp = (u, v) => mix(mix(roof[0], roof[1], u), mix(roof[3], roof[2], u), v);
          quad(ctx, rp(0.25, 0.15), rp(0.75, 0.15), rp(0.75, 0.45), rp(0.25, 0.45), "#2a2a30");
        }
      });
    } else {
      this.drawBox(zr, zf, xr, xf, CAR_HW, 1000, pal, tilt, ([bl, br, tr2, tl], _roof, s) => {
        quad(ctx, bl, br, mix(br, tr2, 0.13), mix(bl, tl, 0.13), "#1b1b22");
        if (s > 0.02) {
          ctx.strokeStyle = pal.dark;
          ctx.lineWidth = Math.max(1, 30 * s);
          ctx.beginPath();
          for (const u of [0.25, 0.5, 0.75]) {
            const a = mix(mix(bl, br, u), mix(tl, tr2, u), 0.2), b = mix(mix(bl, br, u), mix(tl, tr2, u), 0.92);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          }
          ctx.stroke();
        }
      });
    }
  }

  drawObstacleCar(o, z0, c) {
    const { ctx } = this;
    const pal = palette(o.color);
    const x = laneX(o.lane);
    this.drawBox(z0, z0 + WAGON_LEN, x, x, CAR_HW, 1000, pal, 0, ([bl, br, tr2, tl]) => {
      quad(ctx, bl, br, mix(br, tr2, 0.13), mix(bl, tl, 0.13), "#1b1b22");
      // Red/white warning board on the end facing approaching trains.
      if (c === 0) {
        for (let k = 0; k < 4; k++) {
          const a = 0.2 + k * 0.15;
          quad(ctx, mix(bl, tl, a), mix(br, tr2, a), mix(br, tr2, a + 0.15), mix(bl, tl, a + 0.15), k % 2 ? "#f4f4f4" : "#e03a2e");
        }
      }
    });
  }

  billboard(x, z, lift = 0) {
    return this.proj(x, this.track.y(z) + lift, z);
  }

  drawScenery(sc, z) {
    const { ctx } = this;
    const p = this.billboard(sc.x, z);
    const s = p.s * sc.s;
    if (sc.kind === "pole") {
      const ht = 3000 * s;
      ctx.fillStyle = "#4a3a30";
      ctx.fillRect(p.x - Math.max(0.6, 60 * s), p.y - ht, Math.max(1.2, 120 * s), ht);
      ctx.fillRect(p.x - 450 * s, p.y - ht + 150 * s, 900 * s, Math.max(1, 80 * s));
    } else if (sc.kind === "tree") {
      ctx.fillStyle = "#5a3e2a";
      ctx.fillRect(p.x - 130 * s, p.y - 900 * s, 260 * s, 900 * s);
      ctx.fillStyle = sc.c;
      for (let k = 0; k < 3; k++) {
        const wdt = (1700 - k * 400) * s, base = p.y - (600 + k * 800) * s, top = base - 1500 * s;
        ctx.beginPath();
        ctx.moveTo(p.x - wdt / 2, base);
        ctx.lineTo(p.x + wdt / 2, base);
        ctx.lineTo(p.x, top);
        ctx.closePath();
        ctx.fill();
      }
    } else if (sc.kind === "house") {
      const wdt = 2800 * s, ht = 1700 * s;
      ctx.fillStyle = sc.c;
      ctx.fillRect(p.x - wdt / 2, p.y - ht, wdt, ht);
      ctx.fillStyle = "#8c3b30";
      ctx.beginPath();
      ctx.moveTo(p.x - wdt * 0.58, p.y - ht);
      ctx.lineTo(p.x + wdt * 0.58, p.y - ht);
      ctx.lineTo(p.x, p.y - ht - 1100 * s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#3a4a66";
      ctx.fillRect(p.x - wdt * 0.3, p.y - ht * 0.7, wdt * 0.18, ht * 0.3);
      ctx.fillRect(p.x + wdt * 0.12, p.y - ht * 0.7, wdt * 0.18, ht * 0.3);
    }
  }

  drawGantry(z, zi) {
    const { ctx } = this;
    const t = this.track;
    const L = this.billboard(-BED + 150, z), R = this.billboard(BED - 150, z);
    const s = L.s, top = 3400 * s;
    ctx.fillStyle = "#3a3d48";
    ctx.fillRect(L.x - 70 * s, L.y - top, 140 * s, top);
    ctx.fillRect(R.x - 70 * s, R.y - top, 140 * s, top);
    ctx.fillRect(L.x, L.y - top - 160 * s, R.x - L.x, 260 * s);
    const [a, b] = t.sectionRange(zi);
    for (let l = 0; l < 3; l++) {
      const cx = lerp(L.x, R.x, (laneX(l) + BED - 150) / (2 * (BED - 150)));
      const cy = lerp(L.y, R.y, 0.5) - top + 340 * s;
      ctx.fillStyle = "#15161c";
      ctx.fillRect(cx - 280 * s, cy - 330 * s, 560 * s, 700 * s);
      const red = t.blocked(l, a, b);
      const r = Math.max(1.5, 190 * s);
      ctx.fillStyle = red ? "rgba(255, 70, 60, 0.3)" : "rgba(90, 255, 120, 0.3)";
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = red ? "#ff4a3c" : "#5dff7c";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      if (t.hookIn(l, a, b)) {
        ctx.fillStyle = "#ffd23c";
        ctx.fillRect(cx - 160 * s, cy + 210 * s, 320 * s, 120 * s);
      }
    }
  }

  drawSign(sg) {
    const { ctx } = this;
    // Cargo signs stand further out so they never hide behind a speed sign.
    const p = this.billboard(sg.side * (BED + (sg.kind === "cargo" ? 1500 : 380)), sg.z);
    const s = p.s, post = 1800 * s;
    ctx.fillStyle = "#555";
    ctx.fillRect(p.x - Math.max(0.6, 45 * s), p.y - post, Math.max(1.2, 90 * s), post);
    const cy = p.y - post - 420 * s, r = 460 * s;
    if (sg.kind === "speed") {
      ctx.fillStyle = "#e23a2e";
      ctx.beginPath();
      ctx.arc(p.x, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(p.x, cy, r * 0.78, 0, Math.PI * 2);
      ctx.fill();
      if (r > 5) {
        ctx.fillStyle = "#111";
        ctx.font = `bold ${Math.round(r * 0.8)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(sg.value), p.x, cy + r * 0.05);
      }
    } else {
      ctx.fillStyle = "#ffd23c";
      ctx.fillRect(p.x - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = "#222";
      ctx.fillRect(p.x - r * 0.6, cy - r * 0.75, r * 1.2, r * 0.6);
      if (r > 5) {
        ctx.font = `bold ${Math.round(r * 0.55)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`≤${PICKUP_KMH}`, p.x, cy + r * 0.45);
      }
    }
  }

  drawCrane(hk) {
    const { ctx } = this;
    const x = laneX(hk.lane);
    const L = this.billboard(x - 660, hk.z), R = this.billboard(x + 660, hk.z);
    const s = L.s, top = 3900 * s;
    ctx.fillStyle = "#e8b020";
    ctx.fillRect(L.x - 60 * s, L.y - top, 120 * s, top);
    ctx.fillRect(R.x - 60 * s, R.y - top, 120 * s, top);
    ctx.fillRect(L.x - 200 * s, L.y - top - 200 * s, R.x - L.x + 400 * s, 300 * s);
    if (!hk.used) {
      const cx = (L.x + R.x) / 2, by = L.y - 1900 * s;
      ctx.fillStyle = "#222";
      ctx.fillRect(cx - Math.max(0.5, 20 * s), L.y - top, Math.max(1, 40 * s), top - 2500 * s);
      ctx.fillStyle = "#e86a2c";
      ctx.fillRect(cx - 520 * s, by - 700 * s, 1040 * s, 700 * s);
      ctx.fillStyle = "#b04a1c";
      for (let k = 1; k < 5; k++) ctx.fillRect(cx - 520 * s + k * 208 * s, by - 650 * s, Math.max(0.5, 30 * s), 600 * s);
    }
  }

  drawDebris(d) {
    const { ctx } = this;
    const p = this.proj(d.x, this.track.y(d.z) + d.y, d.z);
    const w = 1150 * p.s, ht = 1000 * p.s;
    ctx.save();
    ctx.translate(p.x, p.y - ht / 2);
    ctx.rotate(d.rot);
    ctx.globalAlpha *= clamp(d.life, 0, 1);
    ctx.fillStyle = d.color;
    ctx.fillRect(-w / 2, -ht / 2, w, ht);
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fillRect(-w / 2, ht * 0.32, w, ht * 0.18);
    ctx.restore();
  }

  drawPuff(q) {
    const { ctx } = this;
    const p = this.proj(q.x, this.track.y(q.z) + q.y, q.z);
    const r = Math.max(q.spark ? 1.2 : 0.5, q.r * p.s);
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * clamp(q.life / q.max, 0, 1) * (q.spark ? 1 : 0.3);
    ctx.fillStyle = q.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = a;
  }

  drawSpeedLines() {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = this.horizon;
    ctx.strokeStyle = "rgba(200, 235, 255, 0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const now = performance.now() / 1000;
    for (let i = 0; i < 14; i++) {
      const ang = i * 2.399 + Math.floor(now * 12 + i) * 0.7;
      const r0 = Math.max(w, h) * (0.45 + ((now * 3 + i * 0.37) % 1) * 0.3);
      const dxv = Math.cos(ang), dyv = Math.sin(ang);
      ctx.moveTo(cx + dxv * r0, cy + dyv * r0);
      ctx.lineTo(cx + dxv * (r0 + 120), cy + dyv * (r0 + 120));
    }
    ctx.stroke();
  }
}

new Game($("scene"));
