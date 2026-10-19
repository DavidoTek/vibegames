import * as THREE from "./vendor/three.module.js";
import { LEVELS } from "./levels.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

// Tuned so a jump clears about 3 tiles up and 6 across; level maps rely on that.
const GRAVITY = 38;
const JUMP_V = 15;
const SPRING_V = 26;
const STOMP_V = 11;
const RUN_SPEED = 8;
const ACCEL_GROUND = 70;
const ACCEL_AIR = 40;
const FRICTION = 55;
const MAX_FALL = 22;
const COYOTE = 0.1;
const JUMP_BUFFER = 0.13;
const PW = 0.7, PH = 0.9;          // player box (x is the centre, y the feet)
const EW = 0.8, EH = 0.7;          // enemy box
const ENEMY_SPEED = 1.8;
const MAX_HEARTS = 3;
const INVULN = 1.6;
const EPS = 1e-4;
const SOLID = "#B?U";              // U = used bonus block
const GEM_COLORS = [0xff4d6d, 0x3ddc84, 0x4da3ff];
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
  },
};

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

// ---------------------------------------------------------------- audio

class Sounds {
  constructor() {
    this.ctx = null;
    this.muted = false;
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
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate / 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  tone(freq, dur, type = "square", vol = 0.08, slideTo = 0, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, freq, vol, type = "bandpass", delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  arp(freqs, step, type = "triangle", vol = 0.1, dur = 0.14) {
    freqs.forEach((f, i) => this.tone(f, dur, type, vol, 0, i * step));
  }

  jump() { this.tone(300, 0.16, "square", 0.05, 620); }
  coin() { this.tone(988, 0.07, "square", 0.05); this.tone(1319, 0.2, "square", 0.05, 0, 0.07); }
  gem() { this.arp([784, 988, 1175, 1568, 1976], 0.055, "triangle", 0.12); }
  heart() { this.arp([523, 659, 784, 1047], 0.07, "sine", 0.14, 0.2); }
  spring() { this.tone(160, 0.35, "triangle", 0.16, 900); }
  stomp() { this.noise(0.12, 700, 0.35); this.tone(180, 0.12, "square", 0.07, 70); }
  bump() { this.tone(140, 0.1, "square", 0.08, 90); }
  land() { this.noise(0.06, 300, 0.12, "lowpass"); }
  hurt() { this.tone(420, 0.3, "sawtooth", 0.09, 110); this.noise(0.15, 1200, 0.15); }
  checkpoint() { this.arp([659, 784, 1047, 1319], 0.08, "triangle", 0.12, 0.18); }
  win() {
    this.arp([523, 659, 784, 1047], 0.1, "square", 0.06, 0.14);
    this.tone(784, 0.18, "square", 0.06, 0, 0.45);
    this.tone(1047, 0.5, "square", 0.06, 0, 0.6);
  }
  lose() { this.arp([494, 440, 392, 330], 0.14, "triangle", 0.14, 0.2); this.tone(165, 0.6, "triangle", 0.14, 82, 0.56); }
}

// ---------------------------------------------------------------- shared assets

// Geometries and materials used by every level; level teardown skips these.
function shared(x) { x.userData.shared = true; return x; }
const lambert = (color, extra = {}) => shared(new THREE.MeshLambertMaterial({ color, ...extra }));

function questionTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#ffb627";
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = "#c97a00";
  g.lineWidth = 6;
  g.strokeRect(3, 3, 58, 58);
  g.fillStyle = "#7a4300";
  for (const [x, y] of [[10, 10], [54, 10], [10, 54], [54, 54]]) g.fillRect(x - 2, y - 2, 4, 4);
  g.font = "bold 44px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#7a4300";
  g.fillText("?", 34, 36);
  g.fillStyle = "#fff6d8";
  g.fillText("?", 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function heartGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.25);
  s.bezierCurveTo(0, 0.3, -0.05, 0.4, -0.2, 0.4);
  s.bezierCurveTo(-0.45, 0.4, -0.45, 0.12, -0.45, 0.12);
  s.bezierCurveTo(-0.45, -0.05, -0.3, -0.2, 0, -0.4);
  s.bezierCurveTo(0.3, -0.2, 0.45, -0.05, 0.45, 0.12);
  s.bezierCurveTo(0.45, 0.12, 0.45, 0.4, 0.2, 0.4);
  s.bezierCurveTo(0.05, 0.4, 0, 0.3, 0, 0.25);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 10 });
  geo.center();
  return geo;
}

function makeAssets() {
  const qTex = shared(questionTexture());
  const A = {
    box: shared(new THREE.BoxGeometry(1, 1, 1)),
    sphere: shared(new THREE.SphereGeometry(1, 18, 12)),
    lowSphere: shared(new THREE.SphereGeometry(1, 10, 7)),
    coin: shared(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 24).rotateX(Math.PI / 2)),
    gem: shared(new THREE.OctahedronGeometry(0.34).scale(1, 1.3, 1)),
    heart: shared(heartGeometry()),
    cone: shared(new THREE.ConeGeometry(0.14, 0.5, 6).translate(0, 0.25, 0)),
    cyl: shared(new THREE.CylinderGeometry(1, 1, 1, 14)),
    coinMat: lambert(0xffcc33, { emissive: 0x6a4200 }),
    heartMat: lambert(0xff4d6d, { emissive: 0x5a0a1a }),
    gemMats: GEM_COLORS.map((c) => shared(new THREE.MeshPhongMaterial({ color: c, emissive: new THREE.Color(c).multiplyScalar(0.3), shininess: 90, flatShading: true }))),
    white: lambert(0xffffff),
    black: lambert(0x1a1420),
    metal: lambert(0x9aa3ad),
    dark: lambert(0x3a3f4a),
    red: lambert(0xe8443a),
    enemy: lambert(0x8a4fd8),
    moverTop: lambert(0xe9e2d0),
    moverRail: lambert(0xff9f43),
    cloud: lambert(0xffffff, { emissive: 0x30343a }),
    qMat: shared(new THREE.MeshLambertMaterial({ map: qTex })),
    usedMat: lambert(0x9a6a40),
    lampOff: lambert(0x6a6f7a),
    lampOn: lambert(0xffe066, { emissive: 0xffb000 }),
    flagMat: lambert(0xff4d6d, { side: THREE.DoubleSide }),
  };
  return A;
}

// ---------------------------------------------------------------- world

// Everything built from one level map: the tile grid for collisions plus the
// three.js objects. Static tiles are InstancedMeshes; things that move or
// disappear get their own meshes.
class World {
  constructor(level, A) {
    this.level = level;
    this.A = A;
    this.theme = level.theme;
    this.root = new THREE.Group();
    this.H = level.map.length;
    this.W = level.map[0].length;
    this.grid = Array.from({ length: this.H }, () => Array(this.W).fill("."));
    this.coins = [];
    this.gems = [];
    this.hearts = [];
    this.enemies = [];
    this.movers = [];
    this.springs = [];
    this.bonus = [];
    this.checkpoints = [];
    this.clouds = [];
    this.fx = [];
    this.flag = null;
    this.start = { x: 1.5, y: 2 };
    this.t = 0;
    this.parse();
    this.buildTiles();
    this.buildDecor();
    this.buildBackdrop();
  }

  tile(tx, ty) {
    if (tx < 0 || tx >= this.W) return "#";
    if (ty < 0 || ty >= this.H) return ".";
    return this.grid[ty][tx];
  }

  solid(tx, ty) { return SOLID.includes(this.tile(tx, ty)); }

  parse() {
    const { map } = this.level;
    let gemIndex = 0;
    for (let r = 0; r < this.H; r++) {
      const ty = this.H - 1 - r;
      const row = map[r];
      for (let tx = 0; tx < this.W; tx++) {
        const c = row[tx];
        if ("#B?=^".includes(c)) this.grid[ty][tx] = c;
        if (c === "?") this.addBonus(tx, ty);
        else if (c === "o") this.addPickup(this.coins, this.A.coin, this.A.coinMat, tx, ty);
        else if (c === "*") this.addPickup(this.gems, this.A.gem, this.A.gemMats[gemIndex % 3], tx, ty).index = gemIndex++;
        else if (c === "+") this.addPickup(this.hearts, this.A.heart, this.A.heartMat, tx, ty);
        else if (c === "E") this.addEnemy(tx, ty);
        else if (c === "S") this.addSpring(tx, ty);
        else if (c === "C") this.addCheckpoint(tx, ty);
        else if (c === "F") this.addFlag(tx, ty);
        else if (c === "P") this.start = { x: tx + 0.5, y: ty };
        else if ((c === "H" || c === "V") && row[tx - 1] !== c) {
          let w = 1;
          while (row[tx + w] === c) w++;
          this.addMover(tx, ty, w, c === "H" ? "x" : "y");
        }
      }
    }
    // Every bonus block holds one coin, so they count toward the total.
    this.totalCoins = this.coins.length + this.bonus.length;
  }

  addPickup(list, geo, mat, tx, ty) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.set(tx + 0.5, ty + 0.5, 0);
    this.root.add(mesh);
    const p = { x: tx + 0.5, y: ty + 0.5, mesh, phase: tx * 0.7 + ty * 1.3 };
    list.push(p);
    return p;
  }

  addBonus(tx, ty) {
    const mesh = new THREE.Mesh(this.A.box, this.A.qMat);
    mesh.scale.set(0.96, 0.96, 1.1);
    mesh.position.set(tx + 0.5, ty + 0.5, 0);
    mesh.castShadow = mesh.receiveShadow = true;
    this.root.add(mesh);
    this.bonus.push({ tx, ty, mesh, used: false, bump: 0 });
  }

  addEnemy(tx, ty) {
    const A = this.A;
    const mesh = new THREE.Group();
    const body = new THREE.Group();
    mesh.add(body);
    const shell = new THREE.Mesh(A.sphere, A.enemy);
    shell.scale.set(0.42, 0.34, 0.38);
    shell.position.y = 0.36;
    shell.castShadow = true;
    body.add(shell);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(A.sphere, A.white);
      eye.scale.setScalar(0.1);
      eye.position.set(s * 0.14, 0.46, 0.3);
      const pupil = new THREE.Mesh(A.sphere, A.black);
      pupil.scale.setScalar(0.05);
      pupil.position.set(s * 0.14, 0.45, 0.39);
      const brow = new THREE.Mesh(A.box, A.black);
      brow.scale.set(0.16, 0.04, 0.04);
      brow.position.set(s * 0.14, 0.58, 0.34);
      brow.rotation.z = s * -0.4;
      body.add(eye, pupil, brow);
    }
    const feet = [-1, 1].map((s) => {
      const f = new THREE.Mesh(A.sphere, A.dark);
      f.scale.set(0.12, 0.08, 0.14);
      f.position.set(s * 0.18, 0.06, 0);
      mesh.add(f);
      return f;
    });
    mesh.position.set(tx + 0.5, ty, 0);
    this.root.add(mesh);
    this.enemies.push({ x: tx + 0.5, y: ty, vy: 0, dir: -1, onGround: false, alive: true, dead: 0, mesh, body, feet, walk: tx });
  }

  addSpring(tx, ty) {
    const A = this.A;
    const mesh = new THREE.Group();
    const base = new THREE.Mesh(A.box, A.dark);
    base.scale.set(0.8, 0.12, 0.8);
    base.position.y = 0.06;
    const coil = new THREE.Mesh(A.cyl, A.metal);
    coil.scale.set(0.2, 0.3, 0.2);
    coil.position.y = 0.27;
    const pad = new THREE.Mesh(A.cyl, A.red);
    pad.scale.set(0.38, 0.1, 0.38);
    pad.position.y = 0.45;
    for (const m of [base, coil, pad]) m.castShadow = true;
    mesh.add(base, coil, pad);
    mesh.position.set(tx + 0.5, ty, 0);
    this.root.add(mesh);
    this.springs.push({ x: tx, top: ty + 0.5, coil, pad, squash: 0 });
  }

  addCheckpoint(tx, ty) {
    const A = this.A;
    const post = new THREE.Mesh(A.cyl, A.metal);
    post.scale.set(0.06, 1.4, 0.06);
    post.position.set(tx + 0.5, ty + 0.7, -0.4);
    post.castShadow = true;
    const lamp = new THREE.Mesh(A.sphere, A.lampOff);
    lamp.scale.setScalar(0.2);
    lamp.position.set(tx + 0.5, ty + 1.5, -0.4);
    this.root.add(post, lamp);
    this.checkpoints.push({ x: tx + 0.5, y: ty, lamp, active: false });
  }

  addFlag(tx, ty) {
    const A = this.A;
    const x = tx + 0.5;
    const pole = new THREE.Mesh(A.cyl, A.white);
    pole.scale.set(0.07, 4.2, 0.07);
    pole.position.set(x, ty + 2.1, 0);
    pole.castShadow = true;
    const ball = new THREE.Mesh(A.sphere, A.coinMat);
    ball.scale.setScalar(0.16);
    ball.position.set(x, ty + 4.3, 0);
    const base = new THREE.Mesh(A.box, A.dark);
    base.scale.set(0.6, 0.3, 0.6);
    base.position.set(x, ty + 0.15, 0);
    const geo = new THREE.PlaneGeometry(1.3, 0.85, 10, 4).translate(0.65, 0, 0);
    const cloth = new THREE.Mesh(geo, A.flagMat);
    cloth.position.set(x + 0.05, ty + 3.7, 0);
    cloth.castShadow = true;
    this.root.add(pole, ball, base, cloth);
    this.flag = { x, y: ty, cloth, base: geo.attributes.position.array.slice() };
  }

  addMover(tx, ty, w, axis) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(this.A.box, this.A.moverTop);
    top.scale.set(w, 0.3, 1.4);
    top.position.y = -0.15;
    const rail = new THREE.Mesh(this.A.box, this.A.moverRail);
    rail.scale.set(w - 0.2, 0.12, 1.2);
    rail.position.y = -0.36;
    top.castShadow = top.receiveShadow = rail.castShadow = true;
    g.add(top, rail);
    this.root.add(g);
    // A sideways mover sweeps +-2.5 tiles, an up/down one +-3, around its map spot.
    const m = {
      x0: tx, y0: ty + 1, w, axis,
      range: axis === "x" ? 2.5 : 3,
      speed: axis === "x" ? 1.2 : 1.0,
      phase: tx * 0.37,
      x: tx, y: ty + 1, dx: 0, dy: 0, mesh: g,
    };
    this.placeMover(m, 0);
    m.dx = m.dy = 0;
    this.movers.push(m);
  }

  placeMover(m, t) {
    const off = m.range * Math.sin(t * m.speed + m.phase);
    const nx = m.axis === "x" ? m.x0 + off : m.x0;
    const ny = m.axis === "y" ? m.y0 + off : m.y0;
    m.dx = nx - m.x;
    m.dy = ny - m.y;
    m.x = nx;
    m.y = ny;
    m.mesh.position.set(nx + m.w / 2, ny, 0);
  }

  instanced(geo, mat, items, { shadow = true, colors = false } = {}) {
    if (!items.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    items.forEach((it, i) => {
      m.compose(new THREE.Vector3(...it.p), it.q ?? q, new THREE.Vector3(...it.s));
      mesh.setMatrixAt(i, m);
      if (colors) mesh.setColorAt(i, c.set(it.c));
    });
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  buildTiles() {
    const th = this.theme;
    const r = rng(this.W * 31 + this.H);
    const dirt = [], caps = [], bricks = [], planks = [], spikes = [];
    const base = new THREE.Color();
    for (let ty = 0; ty < this.H; ty++) {
      for (let tx = 0; tx < this.W; tx++) {
        const c = this.grid[ty][tx];
        if (c === "#") {
          // Darker further below the surface, with a little per-tile noise.
          let depth = 0;
          while (this.tile(tx, ty + depth + 1) === "#") depth++;
          const k = (1 - Math.min(depth, 4) * 0.07) * (0.93 + r() * 0.1);
          dirt.push({ p: [tx + 0.5, ty + 0.5, 0], s: [1, 1, 2], c: base.set(th.dirt).multiplyScalar(k).getHex() });
          if (!this.solid(tx, ty + 1)) {
            caps.push({ p: [tx + 0.5, ty + 0.92, 0], s: [1.04, 0.2, 2.06], c: base.set(th.top).multiplyScalar(0.94 + r() * 0.1).getHex() });
          }
        } else if (c === "B") {
          bricks.push({ p: [tx + 0.5, ty + 0.5, 0], s: [0.96, 0.96, 1.5], c: base.set(th.brick).multiplyScalar(0.88 + r() * 0.2).getHex() });
        } else if (c === "=") {
          planks.push({ p: [tx + 0.5, ty + 0.87, 0], s: [1.0, 0.24, 1.4], c: base.set(th.plank).multiplyScalar(0.9 + r() * 0.15).getHex() });
        } else if (c === "^") {
          for (const sx of [0.18, 0.5, 0.82]) for (const sz of [-0.35, 0.3]) spikes.push({ p: [tx + sx, ty, sz], s: [1, 1, 1] });
        }
      }
    }
    const mat = () => new THREE.MeshLambertMaterial();
    this.instanced(this.A.box, mat(), dirt, { colors: true });
    this.instanced(this.A.box, mat(), caps, { colors: true });
    this.instanced(this.A.box, mat(), bricks, { colors: true });
    this.instanced(this.A.box, mat(), planks, { colors: true });
    this.instanced(this.A.cone, this.A.metal, spikes);
  }

  buildDecor() {
    const r = rng(this.W * 7 + 3);
    const bushes = [], stems = [], heads = [];
    const flowerColors = [0xff6b9a, 0xffe066, 0xffffff, 0xb57bff];
    const leaf = new THREE.Color(this.theme.top);
    for (let tx = 0; tx < this.W; tx++) {
      for (let ty = 0; ty < this.H - 1; ty++) {
        if (this.grid[ty][tx] !== "#" || this.solid(tx, ty + 1) || this.grid[ty + 1][tx] === "^") continue;
        const top = ty + 1;
        const roll = r();
        if (roll < 0.22) {
          const s = 0.3 + r() * 0.25;
          bushes.push({ p: [tx + r(), top + s * 0.3, -0.75 + r() * 0.15], s: [s * 1.3, s, s], c: leaf.clone().multiplyScalar(0.7 + r() * 0.2).getHex() });
        } else if (roll < 0.42) {
          const x = tx + 0.2 + r() * 0.6, z = -0.5 - r() * 0.4, h = 0.25 + r() * 0.2;
          stems.push({ p: [x, top + h / 2, z], s: [0.02, h, 0.02] });
          heads.push({ p: [x, top + h, z], s: [0.08, 0.08, 0.08], c: flowerColors[Math.floor(r() * 4)] });
        }
      }
    }
    this.instanced(this.A.lowSphere, new THREE.MeshLambertMaterial(), bushes, { colors: true, shadow: false });
    this.instanced(this.A.cyl, new THREE.MeshLambertMaterial({ color: 0x3f8a3a }), stems, { shadow: false });
    this.instanced(this.A.lowSphere, new THREE.MeshLambertMaterial(), heads, { colors: true, shadow: false });
  }

  buildBackdrop() {
    const r = rng(this.W * 13 + 5);
    const FLOOR = -7;
    // Ground resting on y = 0 continues down as a cliff, so the level doesn't float.
    const cliffs = [];
    for (let tx = 0; tx < this.W; ) {
      if (this.grid[0][tx] !== "#") { tx++; continue; }
      let w = 1;
      while (tx + w < this.W && this.grid[0][tx + w] === "#") w++;
      cliffs.push({ p: [tx + w / 2, FLOOR / 2 - 2, 0], s: [w, -FLOOR + 4, 2], c: new THREE.Color(this.theme.dirt).multiplyScalar(0.62).getHex() });
      tx += w;
    }
    this.instanced(this.A.box, new THREE.MeshLambertMaterial(), cliffs, { colors: true, shadow: false });

    // Valley floor and hills sit far behind the play plane, so the perspective camera gives parallax for free.
    const valley = new THREE.Mesh(new THREE.PlaneGeometry(this.W + 300, 140).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(this.theme.hills[1]).multiplyScalar(0.85) }));
    valley.position.set(this.W / 2, FLOOR, -71.5);
    this.root.add(valley);
    const hills = [];
    for (const [layer, z, spacing, size] of [[0, -26, 9, 9], [1, -46, 15, 16]]) {
      for (let x = -60; x < this.W + 60; x += spacing * (0.7 + r() * 0.6)) {
        const s = size * (0.7 + r() * 0.6);
        hills.push({ p: [x, FLOOR + s * 0.1, z - r() * 6], s: [s * 1.4, s, s], c: this.theme.hills[layer] });
      }
    }
    this.instanced(this.A.sphere, new THREE.MeshLambertMaterial(), hills, { colors: true, shadow: false });

    for (let x = -30; x < this.W + 30; x += 10 + r() * 12) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const puff = new THREE.Mesh(this.A.lowSphere, this.A.cloud);
        const s = 0.9 + r() * 0.9;
        puff.scale.set(s * 1.2, s, s);
        puff.position.set(i * 1.3 - n * 0.6, Math.sin(i * 2.1) * 0.3, r());
        g.add(puff);
      }
      g.position.set(x, 11 + r() * 8, -16 - r() * 18);
      this.root.add(g);
      this.clouds.push({ g, speed: 0.2 + r() * 0.4 });
    }
  }

  // Decorative animation that runs even on the title screen.
  animate(dt) {
    const t = (this.t += dt);
    for (const m of this.movers) this.placeMover(m, t);
    for (const c of this.coins) {
      c.mesh.rotation.y = t * 3 + c.phase;
      c.mesh.position.y = c.y + Math.sin(t * 2 + c.phase) * 0.05;
    }
    for (const g of this.gems) {
      g.mesh.rotation.y = t * 1.6 + g.phase;
      g.mesh.position.y = g.y + Math.sin(t * 2.4 + g.phase) * 0.1;
    }
    for (const h of this.hearts) {
      h.mesh.rotation.y = Math.sin(t * 1.5 + h.phase) * 0.6;
      h.mesh.scale.setScalar(1 + Math.max(0, Math.sin(t * 6)) * 0.12);
    }
    for (const b of this.bonus) {
      b.bump = Math.max(0, b.bump - dt * 6);
      b.mesh.position.y = b.ty + 0.5 + Math.sin(b.bump * Math.PI) * 0.25;
    }
    for (const s of this.springs) {
      s.squash = Math.max(0, s.squash - dt * 4);
      const k = 1 - Math.sin(s.squash * Math.PI) * 0.5;
      s.coil.scale.y = 0.3 * k;
      s.coil.position.y = 0.12 + 0.15 * k;
      s.pad.position.y = 0.15 + 0.3 * k;
    }
    for (const c of this.clouds) {
      c.g.position.x += c.speed * dt;
      if (c.g.position.x > this.W + 40) c.g.position.x = -40;
    }
    if (this.flag) {
      const pos = this.flag.cloth.geometry.attributes.position;
      const b = this.flag.base;
      for (let i = 0; i < pos.count; i++) {
        const x = b[i * 3];
        pos.array[i * 3 + 2] = Math.sin(x * 4 - t * 6) * 0.12 * x;
        pos.array[i * 3 + 1] = b[i * 3 + 1] - x * x * 0.04;
      }
      pos.needsUpdate = true;
      this.flag.cloth.geometry.computeVertexNormals();
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      f.vy -= 30 * dt;
      f.mesh.position.y += f.vy * dt;
      f.mesh.rotation.y += dt * 14;
      if (f.life <= 0) {
        this.root.remove(f.mesh);
        this.fx.splice(i, 1);
      }
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) if (!m.userData.shared) m.dispose();
    });
    this.root.removeFromParent();
  }
}

// ---------------------------------------------------------------- particles

class Particles {
  constructor(scene, max = 320) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.max = max;
    this.list = [];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.c = new THREE.Color();
  }

  burst(x, y, color, n, { speed = 5, life = 0.6, size = 0.12, up = 2, gravity = 18 } = {}) {
    for (let i = 0; i < n && this.list.length < this.max; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.list.push({
        x, y, z: (Math.random() - 0.5) * 0.6,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s + up, vz: (Math.random() - 0.5) * s,
        life, max: life, size: size * (0.6 + Math.random() * 0.8), color, gravity, rot: Math.random() * 6,
      });
    }
  }

  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L[i] = L[L.length - 1]; L.pop(); continue; }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += dt * 8;
    }
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      const s = p.size * Math.min(1, (p.life / p.max) * 2);
      this.q.setFromEuler(this.e.set(p.rot, p.rot * 0.7, 0));
      this.m.compose(new THREE.Vector3(p.x, p.y, p.z), this.q, new THREE.Vector3(s, s, s));
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.c.set(p.color));
    }
    this.mesh.count = L.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.list.length = 0; this.mesh.count = 0; }
}

// ---------------------------------------------------------------- game

class Game {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 200);
    this.A = makeAssets();
    this.sounds = new Sounds();
    this.sounds.muted = store.get("jumper.muted", false);
    $("mute").setAttribute("aria-pressed", String(this.sounds.muted));
    this.progress = store.get("jumper.progress", { unlocked: 0, best: [] });

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x705848, 1.6);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.particles = new Particles(this.scene);

    this.player = this.makePlayer();
    this.scene.add(this.player.mesh);

    this.keys = new Set();
    this.held = new Map();      // touch pointerId -> action
    this.jumpPressed = false;
    this.downPressed = false;
    this.touch = false;
    this.paused = false;
    this.state = "title";
    this.cam = { x: 0, y: 6, look: 0, shake: 0 };
    this.levelIndex = clamp(this.progress.unlocked, 0, LEVELS.length - 1);
    this.world = null;

    this.bindInput();
    addEventListener("resize", () => this.resize());
    this.resize();
    this.loadLevel(this.levelIndex);
    this.showTitle();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  makePlayer() {
    const A = this.A;
    const mesh = new THREE.Group();     // origin at the feet
    const body = new THREE.Group();     // squash & stretch around the feet
    mesh.add(body);
    const torso = new THREE.Mesh(shared(new THREE.CapsuleGeometry(0.34, 0.22, 6, 16)), lambert(0xff7a3d));
    torso.position.y = 0.45;
    torso.castShadow = true;
    const band = new THREE.Mesh(shared(new THREE.CylinderGeometry(0.345, 0.345, 0.09, 24, 1, true)), lambert(0x2ec4b6, { side: THREE.DoubleSide }));
    band.position.y = 0.7;
    body.add(torso, band);
    const pupils = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(A.sphere, A.white);
      eye.scale.set(0.1, 0.12, 0.08);
      eye.position.set(s * 0.12, 0.52, 0.29);
      const pupil = new THREE.Mesh(A.sphere, A.black);
      pupil.scale.set(0.05, 0.07, 0.04);
      pupil.position.set(s * 0.12, 0.52, 0.36);
      body.add(eye, pupil);
      pupils.push(pupil);
    }
    const feet = [-1, 1].map((s) => {
      const f = new THREE.Mesh(A.box, A.dark);
      f.scale.set(0.16, 0.1, 0.24);
      f.position.set(s * 0.14, 0.05, 0.02);
      f.castShadow = true;
      body.add(f);
      return f;
    });
    return {
      mesh, body, pupils, feet,
      x: 0, y: 0, vx: 0, vy: 0, prevY: 0, facing: 1, turn: 0.4,
      onGround: false, coyote: 0, buffer: 0, jumpCut: false, riding: null, drop: 0,
      invuln: 0, knock: 0, sx: 1, sy: 1, stride: 0, dead: 0,
    };
  }

  // ---------------------------------------------------------- level flow

  loadLevel(i) {
    if (this.world) this.world.dispose();
    this.levelIndex = i;
    const level = LEVELS[i];
    this.world = new World(level, this.A);
    this.scene.add(this.world.root);
    const th = level.theme;
    this.scene.background?.dispose?.();
    this.scene.background = this.skyTexture(th.sky, th.fog);
    this.scene.fog = new THREE.Fog(th.fog);
    this.fitFog();
    this.hemi.groundColor.set(th.dirt);
    this.particles.clear();

    const p = this.player;
    this.respawn = { ...this.world.start };
    Object.assign(p, { x: this.respawn.x, y: this.respawn.y, vx: 0, vy: 0, facing: 1, onGround: true, riding: null, invuln: 0, knock: 0, dead: 0, drop: 0 });
    p.mesh.rotation.set(0, 0, 0);
    p.mesh.visible = true;
    this.hearts = MAX_HEARTS;
    this.coins = 0;
    this.gemsTaken = [false, false, false];
    this.time = 0;
    this.endTimer = 0;
    this.cam.x = p.x;
    this.cam.y = p.y + 1;
    this.updateHud();
  }

  skyTexture(top, bottom) {
    const c = document.createElement("canvas");
    c.width = 2;
    c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#" + new THREE.Color(top).getHexString());
    grad.addColorStop(0.75, "#" + new THREE.Color(bottom).getHexString());
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  play(i) {
    this.sounds.unlock();
    this.loadLevel(i);
    this.state = "play";
    this.paused = false;
    this.hidePanel();
    $("hud").hidden = false;
    this.showMsg(LEVELS[i].name, "small", 1.8);
  }

  win() {
    if (this.state !== "play") return;
    this.state = "won";
    this.endTimer = 1.4;
    this.sounds.win();
    const p = this.player;
    for (let i = 0; i < 4; i++) this.particles.burst(p.x, p.y + 2 + i, [0xffe066, 0xff6b9a, 0x4da3ff, 0x3ddc84][i], 24, { speed: 7, life: 1.1, up: 4 });

    const gems = this.gemsTaken.filter(Boolean).length;
    const best = this.progress.best[this.levelIndex] ?? {};
    const rec = {
      coins: Math.max(best.coins ?? 0, this.coins),
      gems: Math.max(best.gems ?? 0, gems),
      time: Math.min(best.time ?? Infinity, this.time),
    };
    this.newBest = best.time === undefined || this.time < best.time;
    this.progress.best[this.levelIndex] = rec;
    this.progress.unlocked = Math.max(this.progress.unlocked, Math.min(this.levelIndex + 1, LEVELS.length - 1));
    store.set("jumper.progress", this.progress);
  }

  // ---------------------------------------------------------- panels

  showPanel(html) {
    $("panel").innerHTML = html;
    $("panel").hidden = false;
    $("touch").hidden = true;
  }

  hidePanel() {
    // A focused panel button would otherwise be "clicked" again by Space (jump).
    document.activeElement?.blur?.();
    $("panel").hidden = true;
    $("touch").hidden = !this.touch;
  }

  gemIcons(n, taken) {
    return GEM_COLORS.map((c, i) => {
      const on = taken ? taken[i] : i < n;
      return `<i class="gem${on ? " on" : ""}" style="--c:#${c.toString(16).padStart(6, "0")}"></i>`;
    }).join("");
  }

  showTitle() {
    this.state = "title";
    $("hud").hidden = true;
    const rows = LEVELS.map((L, i) => {
      const best = this.progress.best[i];
      const locked = i > this.progress.unlocked;
      const info = locked ? "Locked" : best ? `${this.gemIcons(best.gems)} <span>${fmtTime(best.time)}</span>` : "New";
      return `<button class="level" type="button" data-do="level" data-level="${i}" ${locked ? "disabled" : ""}>
        <b>${i + 1}</b><span class="name">${L.name}</span><span class="info">${info}</span></button>`;
    }).join("");
    this.showPanel(`
      <h1>Jum<span>per</span></h1>
      <p>Run, jump and stomp through three worlds. Grab the coins, find the three gems in each level and reach the flag.</p>
      <div class="levels">${rows}</div>
      <p class="keys"><kbd>A</kbd><kbd>D</kbd> or arrows move · <kbd>Space</kbd> jump (hold for higher) · <kbd>S</kbd> drop through planks · <kbd>R</kbd> restart · <kbd>P</kbd> pause · <kbd>M</kbd> mute</p>
      <div class="row"><a class="btn ghost" href="../">All games</a></div>`);
    const btn = $("panel").querySelector(`.level[data-level="${this.levelIndex}"]`);
    btn?.classList.add("sel");
  }

  showResults() {
    const gems = this.gemsTaken.filter(Boolean).length;
    const next = this.levelIndex + 1 < LEVELS.length;
    this.showPanel(`
      <h2>${next ? "Level clear!" : "You did it!"}</h2>
      <p>${LEVELS[this.levelIndex].name}${next ? "" : " was the last level. Thanks for playing!"}</p>
      <table>
        <tr><td>Coins</td><td>${this.coins} / ${this.world.totalCoins}</td></tr>
        <tr><td>Gems</td><td><span class="gems">${this.gemIcons(0, this.gemsTaken)}</span></td></tr>
        <tr><td>Time</td><td>${fmtTime(this.time)}${this.newBest ? ' <em class="best">best!</em>' : ""}</td></tr>
      </table>
      <p class="best">${gems === 3 && this.coins === this.world.totalCoins ? "Perfect: every coin and gem!" : ""}</p>
      <div class="row">
        ${next ? '<button class="btn" type="button" data-do="next">Next level</button>' : ""}
        <button class="btn${next ? " ghost" : ""}" type="button" data-do="restart">Replay</button>
        <button class="btn ghost" type="button" data-do="levels">Levels</button>
      </div>`);
  }

  showGameOver() {
    this.showPanel(`
      <h2>Game over</h2>
      <p>Out of hearts in ${LEVELS[this.levelIndex].name}. Checkpoints only last for one try.</p>
      <div class="row">
        <button class="btn" type="button" data-do="restart">Try again</button>
        <button class="btn ghost" type="button" data-do="levels">Levels</button>
      </div>`);
  }

  togglePause(force) {
    if (this.state !== "play") return;
    this.paused = force ?? !this.paused;
    if (this.paused) {
      this.showPanel(`
        <h2>Paused</h2>
        <div class="row">
          <button class="btn" type="button" data-do="resume">Resume</button>
          <button class="btn ghost" type="button" data-do="restart">Restart</button>
          <button class="btn ghost" type="button" data-do="levels">Levels</button>
          <a class="btn ghost" href="../">All games</a>
        </div>`);
    } else {
      this.hidePanel();
    }
  }

  panelAction(act, el) {
    if (act === "level") this.play(Number(el.dataset.level));
    else if (act === "next") this.play(this.levelIndex + 1);
    else if (act === "restart") this.play(this.levelIndex);
    else if (act === "resume") this.togglePause(false);
    else if (act === "levels") { this.paused = false; this.loadLevel(this.levelIndex); this.showTitle(); }
  }

  // ---------------------------------------------------------- HUD

  updateHud() {
    $("hearts").innerHTML = Array.from({ length: MAX_HEARTS }, (_, i) =>
      `<svg viewBox="0 0 24 24" class="${i < this.hearts ? "on" : ""}"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z"/></svg>`).join("");
    $("coins").textContent = `${this.coins}/${this.world.totalCoins}`;
    $("gems").innerHTML = this.gemIcons(0, this.gemsTaken);
  }

  showMsg(text, cls = "", dur = 1.4) {
    const m = $("msg");
    m.textContent = text;
    m.className = `msg show ${cls}`;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => m.classList.remove("show"), dur * 1000);
  }

  flashHurt() {
    const h = $("hurt");
    h.classList.remove("on");
    void h.offsetWidth;      // restart the CSS animation
    h.classList.add("on");
  }

  // ---------------------------------------------------------- input

  bindInput() {
    const LEFT = ["a", "arrowleft"], RIGHT = ["d", "arrowright"], DOWN = ["s", "arrowdown"];
    const JUMP = [" ", "w", "arrowup", "z", "k"];
    this.isLeft = () => this.holding("left", LEFT);
    this.isRight = () => this.holding("right", RIGHT);
    this.isDown = () => this.holding("down", DOWN);
    this.isJump = () => this.holding("jump", JUMP);

    addEventListener("keydown", (e) => {
      this.sounds.unlock();
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k) && $("panel").hidden) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (JUMP.includes(k)) this.jumpPressed = true;
      if (DOWN.includes(k)) this.downPressed = true;
      if (k === "m") this.toggleMute();
      else if (k === "p" || k === "escape") this.togglePause();
      else if (k === "r" && (this.state === "play" || this.state === "dead")) this.play(this.levelIndex);
      else if (k === "enter") {
        if (this.state === "title") this.play(this.levelIndex);
        else if (this.state === "won" && this.endTimer <= 0) this.play(Math.min(this.levelIndex + 1, LEVELS.length - 1));
        else if (this.state === "dead" && this.endTimer <= 0) this.play(this.levelIndex);
      }
    });
    addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener("blur", () => { this.keys.clear(); this.held.clear(); this.togglePause(true); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.togglePause(true); });

    $("mute").addEventListener("click", () => this.toggleMute());
    $("pause").addEventListener("click", () => this.togglePause());
    $("panel").addEventListener("click", (e) => {
      const b = e.target.closest("[data-do]");
      if (b) this.panelAction(b.dataset.do, b);
    });

    if (matchMedia("(pointer: coarse)").matches) this.enableTouch();
    addEventListener("pointerdown", (e) => {
      this.sounds.unlock();
      if (e.pointerType === "touch") this.enableTouch();
    });
    // Touch only counts as a user gesture on release, so audio may need a second try here.
    addEventListener("pointerup", () => this.sounds.unlock());

    // A finger can slide between buttons, so the action follows whatever is
    // under it rather than the button it first touched.
    const pad = $("touch");
    const track = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("#touch button");
      const act = el?.dataset.act ?? null;
      const prev = this.held.get(e.pointerId) ?? null;
      if (act === prev) return;
      if (act) this.held.set(e.pointerId, act); else this.held.delete(e.pointerId);
      if (act === "jump") this.jumpPressed = true;
      if (act === "down") this.downPressed = true;
      this.markHeld();
    };
    pad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pad.setPointerCapture?.(e.pointerId);
      track(e);
    });
    pad.addEventListener("pointermove", (e) => { if (this.held.has(e.pointerId) || e.buttons) track(e); });
    const up = (e) => { this.held.delete(e.pointerId); this.markHeld(); };
    pad.addEventListener("pointerup", up);
    pad.addEventListener("pointercancel", up);
    pad.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  markHeld() {
    const acts = new Set(this.held.values());
    for (const b of document.querySelectorAll("#touch button")) b.classList.toggle("held", acts.has(b.dataset.act));
  }

  holding(act, keys) {
    for (const a of this.held.values()) if (a === act) return true;
    return keys.some((k) => this.keys.has(k));
  }

  enableTouch() {
    if (this.touch) return;
    this.touch = true;
    document.body.classList.add("touch");
    $("touch").hidden = !$("panel").hidden;
  }

  toggleMute() {
    this.sounds.unlock();
    this.sounds.setMuted(!this.sounds.muted);
    $("mute").setAttribute("aria-pressed", String(this.sounds.muted));
    store.set("jumper.muted", this.sounds.muted);
  }

  // ---------------------------------------------------------- physics

  // Moves a body sideways and stops it at solid tiles. Steps are kept below
  // half a tile, so only the leading column needs checking.
  moveX(b, dx, w, h) {
    if (!dx) return false;
    const W = this.world;
    b.x += dx;
    const y0 = Math.floor(b.y + EPS), y1 = Math.floor(b.y + h - EPS);
    const tx = Math.floor(dx > 0 ? b.x + w / 2 : b.x - w / 2);
    for (let ty = y0; ty <= y1; ty++) {
      if (!W.solid(tx, ty)) continue;
      b.x = dx > 0 ? tx - w / 2 - EPS : tx + 1 + w / 2 + EPS;
      return true;
    }
    return false;
  }

  // Vertical move. Returns "floor", "ceil" or null; one-way planks, movers and
  // springs only catch the player (oneWay) while falling onto them from above.
  moveY(b, dy, w, h, oneWay) {
    const W = this.world;
    const prevY = b.y;
    b.y += dy;
    const x0 = Math.floor(b.x - w / 2 + EPS), x1 = Math.floor(b.x + w / 2 - EPS);
    if (dy < 0) {
      const ty = Math.floor(b.y);
      for (let tx = x0; tx <= x1; tx++) {
        const c = W.tile(tx, ty);
        if (SOLID.includes(c) || (c === "=" && oneWay && prevY >= ty + 1 - EPS)) {
          b.y = ty + 1;
          return "floor";
        }
      }
      if (!oneWay) return null;
      for (const m of W.movers) {
        const top = m.y;
        if (b.x + w / 2 > m.x && b.x - w / 2 < m.x + m.w && prevY >= top - Math.max(0, m.dy) - 0.05 && b.y <= top) {
          b.y = top;
          b.riding = m;
          return "floor";
        }
      }
      for (const s of W.springs) {
        if (b.x + w / 2 > s.x + 0.1 && b.x - w / 2 < s.x + 0.9 && prevY >= s.top - 0.05 && b.y <= s.top) {
          b.y = s.top;
          b.spring = s;
          return "floor";
        }
      }
    } else if (dy > 0) {
      const ty = Math.floor(b.y + h);
      let hit = null;
      for (let tx = x0; tx <= x1; tx++) {
        if (W.solid(tx, ty) && (hit === null || Math.abs(tx + 0.5 - b.x) < Math.abs(hit + 0.5 - b.x))) hit = tx;
      }
      if (hit !== null) {
        b.y = ty - h - EPS;
        b.headTile = [hit, ty];
        return "ceil";
      }
    }
    return null;
  }

  updatePlayer(dt) {
    const p = this.player, W = this.world;
    p.prevY = p.y;
    p.invuln = Math.max(0, p.invuln - dt);
    p.knock = Math.max(0, p.knock - dt);
    p.drop = Math.max(0, p.drop - dt);

    if (p.riding) {
      this.moveX(p, p.riding.dx, PW, PH);
      p.y += p.riding.dy;
    }

    const won = this.state === "won";
    let dir = won || p.knock > 0 ? 0 : (this.isRight() ? 1 : 0) - (this.isLeft() ? 1 : 0);
    const target = dir * RUN_SPEED;
    const accel = dir ? (p.onGround ? ACCEL_GROUND : ACCEL_AIR) : (p.onGround ? FRICTION : 6);
    p.vx = approach(p.vx, target, accel * dt);
    if (dir) p.facing = dir;

    // Coyote time and a jump buffer make edge jumps forgiving.
    p.coyote = p.onGround ? COYOTE : p.coyote - dt;
    p.buffer -= dt;
    if (this.jumpPressed && !won) p.buffer = JUMP_BUFFER;
    if (this.downPressed && p.onGround && this.standingOnOneWay()) p.drop = 0.25;
    this.jumpPressed = this.downPressed = false;
    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = JUMP_V;
      p.buffer = p.coyote = 0;
      p.onGround = false;
      p.riding = null;
      p.jumpCut = false;
      p.sx = 0.75; p.sy = 1.3;
      this.sounds.jump();
    }
    // Releasing jump early cuts the rise: tap for a hop, hold for full height.
    if (!this.isJump() && p.vy > 0 && !p.jumpCut) {
      p.vy *= 0.45;
      p.jumpCut = true;
    }
    p.vy = Math.max(p.vy - GRAVITY * dt, -MAX_FALL);

    const wasGround = p.onGround;
    const impact = p.vy;
    p.onGround = false;
    p.riding = null;
    p.spring = null;
    p.headTile = null;
    const steps = Math.max(1, Math.ceil((Math.max(Math.abs(p.vx), Math.abs(p.vy)) * dt) / 0.3));
    const oneWay = p.drop <= 0;
    for (let i = 0; i < steps; i++) {
      if (this.moveX(p, (p.vx * dt) / steps, PW, PH)) p.vx = 0;
      const hit = this.moveY(p, (p.vy * dt) / steps, PW, PH, oneWay);
      if (hit === "floor") { p.vy = 0; p.onGround = true; break; }
      if (hit === "ceil") { p.vy = Math.min(p.vy, 0); this.hitHead(p.headTile); break; }
    }
    // Springs are only half a tile tall, so walking into one also launches.
    if (!p.spring && p.vy <= 0) {
      p.spring = W.springs.find((s) => p.x + PW / 2 > s.x + 0.25 && p.x - PW / 2 < s.x + 0.75 && p.y < s.top && p.y > s.top - 0.6) ?? null;
      if (p.spring) p.y = p.spring.top;
    }
    if (p.spring) {
      p.spring.squash = 1;
      p.vy = SPRING_V;
      p.vx *= 0.5;          // so a walk-on launch stays near the column above the spring
      p.onGround = false;
      p.jumpCut = true;
      p.sx = 0.7; p.sy = 1.4;
      this.sounds.spring();
      this.particles.burst(p.x, p.y, 0xffffff, 8, { speed: 3, life: 0.3, up: 0 });
    } else if (p.onGround && !wasGround) {
      const k = clamp(-impact / MAX_FALL, 0.2, 1);
      p.sy = 1 - 0.3 * k; p.sx = 1 + 0.3 * k;
      if (k > 0.4) {
        this.sounds.land();
        this.particles.burst(p.x, p.y + 0.05, 0xe8dcc8, Math.round(6 * k), { speed: 3, life: 0.35, up: 1, size: 0.1 });
      }
    }

    if (this.state === "play") {
      this.checkSpikes();
      if (p.y < -3) this.fell();
    }
  }

  standingOnOneWay() {
    const p = this.player, W = this.world;
    if (p.riding) return true;
    const ty = Math.round(p.y) - 1;
    const x0 = Math.floor(p.x - PW / 2 + EPS), x1 = Math.floor(p.x + PW / 2 - EPS);
    let plank = false;
    for (let tx = x0; tx <= x1; tx++) {
      if (W.solid(tx, ty)) return false;
      if (W.tile(tx, ty) === "=") plank = true;
    }
    return plank;
  }

  hitHead([tx, ty]) {
    const W = this.world;
    const b = W.bonus.find((q) => q.tx === tx && q.ty === ty);
    if (!b) { this.sounds.bump(); return; }
    b.bump = 1;
    // Knock out any enemy standing on the block, like the classics.
    for (const e of W.enemies) {
      if (e.alive && Math.abs(e.x - (tx + 0.5)) < 0.9 && Math.abs(e.y - (ty + 1)) < 0.2) this.killEnemy(e, true);
    }
    if (b.used) { this.sounds.bump(); return; }
    b.used = true;
    W.grid[ty][tx] = "U";
    b.mesh.material = this.A.usedMat;
    const coin = new THREE.Mesh(this.A.coin, this.A.coinMat);
    coin.position.set(tx + 0.5, ty + 1.3, 0);
    W.root.add(coin);
    W.fx.push({ mesh: coin, vy: 9, life: 0.45 });
    this.addCoin(tx + 0.5, ty + 1.6);
  }

  addCoin(x, y) {
    this.coins++;
    this.sounds.coin();
    this.particles.burst(x, y, 0xffd84a, 8, { speed: 3, life: 0.4, up: 1 });
    this.updateHud();
  }

  checkSpikes() {
    const p = this.player, W = this.world;
    const x0 = Math.floor(p.x - PW / 2), x1 = Math.floor(p.x + PW / 2);
    const y0 = Math.floor(p.y), y1 = Math.floor(p.y + PH);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (W.tile(tx, ty) !== "^") continue;
        if (p.x + PW / 2 > tx + 0.12 && p.x - PW / 2 < tx + 0.88 && p.y < ty + 0.45) {
          this.hurt(tx + 0.5);
          return;
        }
      }
    }
  }

  hurt(fromX) {
    const p = this.player;
    if (p.invuln > 0 || this.state !== "play") return;
    this.hearts--;
    this.updateHud();
    this.flashHurt();
    this.shake(0.35);
    this.sounds.hurt();
    if (this.hearts <= 0) { this.die(); return; }
    p.invuln = INVULN;
    p.knock = 0.3;
    p.vy = 11;
    p.jumpCut = true;
    p.vx = (Math.sign(p.x - fromX) || -p.facing) * 7;
    p.onGround = false;
    p.riding = null;
  }

  fell() {
    this.hearts--;
    this.updateHud();
    this.flashHurt();
    this.sounds.hurt();
    if (this.hearts <= 0) { this.die(); return; }
    const p = this.player;
    Object.assign(p, { x: this.respawn.x, y: this.respawn.y, vx: 0, vy: 0, invuln: INVULN, knock: 0, riding: null });
    this.cam.x = p.x;
    this.cam.y = p.y + 1;
    this.showMsg("Ouch!", "bad small", 1);
  }

  die() {
    const p = this.player;
    this.state = "dead";
    this.endTimer = 1.5;
    p.dead = 1;
    p.vx = 0;
    p.vy = 13;
    this.sounds.lose();
  }

  shake(amount) {
    if (!REDUCED_MOTION) this.cam.shake = Math.max(this.cam.shake, amount);
  }

  killEnemy(e, flip) {
    e.alive = false;
    e.flip = flip;
    e.vy = flip ? 8 : 0;
    this.sounds.stomp();
    this.particles.burst(e.x, e.y + 0.3, 0xb98cff, 12, { speed: 4, life: 0.45 });
  }

  updateEnemies(dt) {
    const W = this.world, p = this.player;
    for (let i = W.enemies.length - 1; i >= 0; i--) {
      const e = W.enemies[i];
      if (!e.alive) {
        e.dead += dt;
        if (e.flip) {
          e.vy -= GRAVITY * dt;
          e.y += e.vy * dt;
          e.mesh.rotation.z += dt * 10;
        } else {
          e.body.scale.y = Math.max(0.25, 1 - e.dead * 8);
        }
        e.mesh.position.set(e.x, e.y, 0);
        if (e.dead > (e.flip ? 1.5 : 0.5)) {
          W.root.remove(e.mesh);
          W.enemies.splice(i, 1);
        }
        continue;
      }

      // Only simulate enemies near the camera, so they wait where the map puts them.
      if (Math.abs(e.x - this.cam.x) > this.view.halfW + 6) continue;
      if (this.moveX(e, e.dir * ENEMY_SPEED * dt, EW, EH)) e.dir = -e.dir;
      e.vy = Math.max(e.vy - GRAVITY * dt, -MAX_FALL);
      e.onGround = this.moveY(e, e.vy * dt, EW, EH, true) === "floor";
      if (e.onGround) {
        e.vy = 0;
        // Turn around at ledges and in front of spikes.
        const fx = Math.floor(e.x + e.dir * (EW / 2 + 0.05));
        const below = W.tile(fx, Math.floor(e.y - 0.1));
        if ((!SOLID.includes(below) && below !== "=") || W.tile(fx, Math.floor(e.y + 0.1)) === "^") e.dir = -e.dir;
      }
      if (e.y < -5) { W.root.remove(e.mesh); W.enemies.splice(i, 1); continue; }

      e.walk += dt * 8;
      e.mesh.position.set(e.x, e.y, 0);
      e.mesh.rotation.y = damp(e.mesh.rotation.y, e.dir * 0.7, 10, dt);
      e.body.position.y = Math.abs(Math.sin(e.walk)) * 0.05;
      e.feet[0].position.z = Math.sin(e.walk) * 0.12;
      e.feet[1].position.z = -Math.sin(e.walk) * 0.12;

      if (this.state !== "play" || p.dead) continue;
      const overlap = Math.abs(p.x - e.x) < (PW + EW) / 2 && p.y < e.y + EH && p.y + PH > e.y;
      if (!overlap) continue;
      if (p.vy < 0 && p.prevY >= e.y + EH * 0.4) {
        this.killEnemy(e, false);
        p.vy = this.isJump() ? JUMP_V : STOMP_V;
        p.jumpCut = true;
        p.y = e.y + EH;
        p.sx = 1.3; p.sy = 0.75;
        this.shake(0.12);
      } else {
        this.hurt(e.x);
      }
    }
  }

  updatePickups() {
    const p = this.player, W = this.world;
    const cx = p.x, cy = p.y + PH / 2;
    const near = (o, r) => Math.abs(o.x - cx) < r + PW / 2 && Math.abs(o.mesh.position.y - cy) < r + PH / 2;
    const take = (list, r, fn) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i];
        if (!near(o, r)) continue;
        W.root.remove(o.mesh);
        list.splice(i, 1);
        fn(o);
      }
    };
    take(W.coins, 0.25, (c) => this.addCoin(c.x, c.y));
    take(W.gems, 0.3, (g) => {
      this.gemsTaken[g.index] = true;
      this.sounds.gem();
      this.particles.burst(g.x, g.y, GEM_COLORS[g.index], 22, { speed: 6, life: 0.7, up: 2 });
      this.showMsg(`Gem ${this.gemsTaken.filter(Boolean).length}/3`, "good small", 1.2);
      this.updateHud();
    });
    take(W.hearts, 0.3, (h) => {
      this.hearts = Math.min(MAX_HEARTS, this.hearts + 1);
      this.sounds.heart();
      this.particles.burst(h.x, h.y, 0xff4d6d, 14, { speed: 4, life: 0.6 });
      this.updateHud();
    });
    for (const c of W.checkpoints) {
      if (c.active || Math.abs(p.x - c.x) > 0.7 || Math.abs(p.y - c.y) > 1.5) continue;
      for (const o of W.checkpoints) { o.active = false; o.lamp.material = this.A.lampOff; }
      c.active = true;
      c.lamp.material = this.A.lampOn;
      this.respawn = { x: c.x, y: c.y };
      this.sounds.checkpoint();
      this.particles.burst(c.x, c.y + 1.5, 0xffe066, 16, { speed: 4, life: 0.6 });
      this.showMsg("Checkpoint", "good small", 1.2);
    }
    const f = W.flag;
    if (f && Math.abs(p.x - f.x) < 0.5 && p.y > f.y - 0.5 && p.y < f.y + 4.5) this.win();
  }

  // ---------------------------------------------------------- camera & visuals

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // Pull back until at least 11 tiles high and 15 wide are visible (11 wide
    // in portrait, where 15 would make everything tiny).
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = clamp(Math.max(11 / (2 * t), (aspect < 1 ? 11 : 15) / (2 * t * aspect)), 12, 70);
    this.view = { dist, halfW: dist * t * aspect, halfH: dist * t };
    const sc = this.sun.shadow.camera;
    sc.left = -this.view.halfW - 6;
    sc.right = this.view.halfW + 6;
    sc.top = this.view.halfH + 6;
    sc.bottom = -this.view.halfH - 6;
    sc.near = 1;
    sc.far = 80;
    sc.updateProjectionMatrix();
    this.fitFog();
  }

  // Fog starts behind the play plane, which is far away on portrait screens.
  fitFog() {
    if (!this.scene.fog || !this.view) return;
    this.scene.fog.near = this.view.dist + 10;
    this.scene.fog.far = this.view.dist + 75;
  }

  updateCamera(dt) {
    const p = this.player, W = this.world, v = this.view, c = this.cam;
    let tx, ty;
    if (this.state === "title") {
      // Slow pan across the level behind the menu.
      const span = Math.max(0, W.W - 2 * v.halfW);
      tx = v.halfW + span * (0.5 - 0.5 * Math.cos(W.t * 0.06));
      ty = 6;
    } else {
      c.look = damp(c.look, p.facing * 1.5, 3, dt);
      tx = p.x + c.look;
      ty = p.y + 1;
    }
    if (W.W > 2 * v.halfW) tx = clamp(tx, v.halfW - 0.5, W.W - v.halfW + 0.5);
    else tx = W.W / 2;
    ty = Math.max(ty, v.halfH - 4);
    c.x = damp(c.x, tx, this.state === "title" ? 20 : 6, dt);
    c.y = damp(c.y, ty, 4, dt);
    c.shake = Math.max(0, c.shake - dt);
    const s = c.shake * 0.6;
    const ox = s ? (Math.random() - 0.5) * s : 0, oy = s ? (Math.random() - 0.5) * s : 0;
    // A slightly raised camera looking down shows the tops of the blocks.
    this.camera.position.set(c.x + ox, c.y + v.dist * 0.16 + oy, v.dist);
    this.camera.lookAt(c.x + ox, c.y + oy, 0);
    this.sun.position.set(c.x + 8, c.y + 18, 14);
    this.sun.target.position.set(c.x, c.y, 0);
  }

  animatePlayer(dt) {
    const p = this.player;
    const m = p.mesh;
    m.position.set(p.x, p.y, 0);
    if (p.dead) {
      m.rotation.z += dt * 8;
      m.visible = true;
      return;
    }
    p.sx = damp(p.sx, 1, 12, dt);
    p.sy = damp(p.sy, 1, 12, dt);
    p.body.scale.set(p.sx, p.sy, p.sx);
    p.turn = damp(p.turn, p.facing * 0.55, 12, dt);
    m.rotation.y = p.turn;
    m.rotation.z = damp(m.rotation.z, (-p.vx / RUN_SPEED) * 0.12, 10, dt);
    for (const pu of p.pupils) pu.position.y = 0.52 + clamp(p.vy * 0.004, -0.03, 0.03);
    // Feet swing with distance run, tucked in while airborne.
    if (p.onGround) p.stride += Math.abs(p.vx) * dt * 2.4;
    const swing = p.onGround ? Math.sin(p.stride) * Math.min(1, Math.abs(p.vx) / 3) : 0.4;
    p.feet[0].position.z = 0.02 + swing * 0.16;
    p.feet[1].position.z = 0.02 - swing * 0.16;
    p.feet[0].position.y = p.feet[1].position.y = p.onGround ? 0.05 : 0.1;
    m.visible = p.invuln <= 0 || Math.floor(p.invuln * 12) % 2 === 0;
  }

  // ---------------------------------------------------------- main loop

  frame(now) {
    const dt = Math.min((now - this.last) / 1000, 1 / 20);
    this.last = now;
    if (!this.paused) this.update(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    const p = this.player;
    this.world.animate(dt);
    if (this.state === "play" || this.state === "won") {
      if (this.state === "play") this.time += dt;
      this.updatePlayer(dt);
      this.updateEnemies(dt);
      if (this.state === "play") this.updatePickups();
      $("time").textContent = fmtTime(this.time);
    } else if (this.state === "dead") {
      p.vy -= GRAVITY * dt;
      p.y += p.vy * dt;
    }
    if (this.state === "won" || this.state === "dead") {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && $("panel").hidden) {
        if (this.state === "won") this.showResults(); else this.showGameOver();
      }
    }
    this.animatePlayer(dt);
    this.updateCamera(dt);
    this.particles.update(dt);
  }
}

new Game($("scene"));
