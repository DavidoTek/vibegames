import { LEVELS, ROWS } from "./levels.js";
import * as art from "./art.js";

const { TILE, S } = art;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
const rand = (a, b) => a + Math.random() * (b - a);

// Physics in pixels and seconds, fixed 60 Hz steps. With these numbers an
// ant jumps 2.8 tiles high and just over 3 tiles far: 4-tile gaps and
// 3-tile walls need help.
const STEP = 1 / 60;
const GRAVITY = 600;
const JUMP_V = 165;
const WALK = 44;
const CLIMB = 32;
const MAX_FALL = 280;
const ACCEL_GROUND = 900, ACCEL_AIR = 600, ACCEL_LAUNCHED = 120;
const AW = 6, AH = 4, HW = AW / 2;   // ant box; x is the centre, y the feet
const COYOTE = 0.04;
const JUMP_BUFFER = 0.1;
const HOP_VX = 170, HOP_VY = 230;    // grasshopper launch
const PUSH = 16;
const DIG_TIME = 0.3;
const HOLD_TIME = 0.5;               // hold X this long to turn to stone
const SPACING = 10;                  // trail crumbs between two ants in the column
const CRUMB = 0.5;                   // px the leader moves before a new crumb
const SOLID = "#RdTS";
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

const store = {
  get(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode etc. */ }
  },
};

// ---------------------------------------------------------------- sound

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

  jump() { this.tone(420, 0.09, "square", 0.04, 720); }
  land() { this.noise(0.05, 400, 0.08, "lowpass"); }
  stone() { this.noise(0.3, 500, 0.35); this.tone(140, 0.35, "triangle", 0.18, 50); }
  clack() { this.noise(0.06, 1500, 0.2); this.tone(220, 0.06, "square", 0.04, 120); }
  dig() { this.noise(0.08, 1800 + Math.random() * 800, 0.15); }
  push() { this.noise(0.12, 220, 0.1, "lowpass"); }
  screech() { this.tone(2200, 0.25, "sawtooth", 0.05, 1300); this.tone(2000, 0.3, "sawtooth", 0.05, 1100, 0.28); }
  swoop() { this.noise(0.4, 900, 0.12); }
  eaten() { this.tone(500, 0.3, "square", 0.06, 90); this.noise(0.2, 2500, 0.15); }
  boing() { this.tone(180, 0.35, "triangle", 0.16, 900); }
  wake() { this.arp([330, 440], 0.08, "square", 0.04, 0.08); }
  smash() { this.noise(0.18, 1200, 0.3); this.tone(90, 0.15, "square", 0.08, 50); }
  charge() { this.noise(0.5, 120, 0.25, "lowpass"); }
  splash() { this.noise(0.35, 2400, 0.2); }
  chime() { this.arp([1047, 1319, 1568], 0.06, "sine", 0.08, 0.3); }
  next() { this.arp([523, 784], 0.07, "triangle", 0.1, 0.12); }
  saved() { this.tone(880 + Math.random() * 300, 0.07, "sine", 0.06); }
  win() {
    this.arp([523, 659, 784, 1047], 0.1, "square", 0.05, 0.14);
    this.tone(1047, 0.5, "triangle", 0.1, 0, 0.45);
  }
  lose() { this.arp([494, 440, 392, 330], 0.14, "triangle", 0.14, 0.2); }
}

// ---------------------------------------------------------------- world

class Boulder {
  constructor(x, y, size, weight) {
    this.x = x;
    this.y = y;
    this.w = this.h = size;
    this.weight = weight;
    this.vy = 0;
    this.grounded = true;
  }
}

class Ant {
  constructor(x, y, facing = 1) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.grounded = false;
    this.onLeaf = false;
    this.climbing = false;
    this.hang = 0;
    this.launched = false;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.dropT = 0;
    this.digT = 0;
    this.anim = 0;
  }
}

// The tile map plus everything that lives in it. Owns the terrain canvas,
// which is repainted cell by cell whenever a tile changes.
class World {
  constructor(level) {
    this.level = level;
    this.h = level.map.length;
    this.w = level.map[0].length;
    this.cells = level.map.map((r) => r.split(""));
    this.boulders = [];
    this.hoppers = [];
    this.beetles = [];
    this.fireflies = [];
    this.mushrooms = [];
    this.signs = [];
    this.tufts = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const ch = this.cells[y][x], cx = x * TILE + 4, fy = (y + 1) * TILE;
        let clear = true;
        if (ch === "P") this.start = { x: cx, y: fy };
        else if (ch === "F") this.finish = { x: cx, y: fy };
        else if (ch === "g") this.hoppers.push({ x: cx, y: fy, kick: 0 });
        else if (ch === "B") this.beetles.push({ x: cx + 4, y: fy, dir: 1, state: "sleep", t: 0, anim: 0 });
        else if (ch === "f") this.fireflies.push({ x: cx, y: y * TILE + 4, hx: cx, hy: y * TILE + 4, attached: false, ph: Math.random() * 6 });
        else if (ch === "*") this.mushrooms.push({ x: cx, y: fy });
        else if (ch === "o") this.boulders.push(new Boulder(x * TILE, y * TILE, 8, 2));
        else if (ch === "O") {
          this.boulders.push(new Boulder(x * TILE, y * TILE, 16, 4));
          this.cells[y][x + 1] = this.cells[y + 1][x] = this.cells[y + 1][x + 1] = " ";
        } else if (ch >= "0" && ch <= "9") this.signs.push({ x: cx, y: fy, lines: art.wrap(level.signs[+ch] ?? "", 26) });
        else {
          clear = false;
          if (ch === ",") this.tufts.push({ x, y });
        }
        if (clear) this.cells[y][x] = " ";
      }
    }
    // Top of the original ground per column: everything below counts as
    // underground (earthy back wall, darkness in the cave).
    this.colTop = [];
    for (let x = 0; x < this.w; x++) {
      let y = 0;
      while (y < this.h && !SOLID.includes(this.cells[y][x])) y++;
      this.colTop.push(y);
    }
    // Darkness starts two rows above the first underground hollow, so the
    // outside of a hill stays lit; solid columns borrow from a neighbour.
    const raw = this.colTop.map((top, x) => {
      for (let y = top + 1; y < this.h; y++) if (!SOLID.includes(this.cells[y][x])) return Math.max(top, y - 2);
      return null;
    });
    this.darkTop = raw.map((v, x) => {
      for (let d = 0; d <= 3 && v === null; d++) v = raw[x - d] ?? raw[x + d] ?? null;
      return v ?? this.h;
    });
    this.terrain = art.makeCanvas(this.w * TILE, this.h * TILE);
    this.tg = this.terrain.getContext("2d");
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) art.paintCell(this.tg, this, x, y);
    this.findWater();
  }

  get(x, y) {
    if (x < 0 || x >= this.w) return "R";
    if (y < 0) return " ";
    if (y >= this.h) return "#";
    return this.cells[y][x];
  }
  solid(x, y) { return SOLID.includes(this.get(x, y)); }
  zoneAt(x) { const z = this.level.zones; return x >= z.cave ? "cave" : x >= z.grass ? "grass" : "dry"; }
  underground(x, y) { return y > this.colTop[clamp(x, 0, this.w - 1)]; }

  set(x, y, ch) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const old = this.cells[y][x];
    this.cells[y][x] = ch;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx, py = y + dy;
      if (px >= 0 && px < this.w && py >= 0 && py < this.h) art.paintCell(this.tg, this, px, py);
    }
    if (old === "~" || ch === "~") this.findWater();
  }

  findWater() {
    this.water = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.cells[y][x] === "~") this.water.push({ x, y });
  }

  boulderHit(l, t, r, b, except = null) {
    for (const bo of this.boulders) {
      if (bo !== except && r > bo.x && l < bo.x + bo.w && b > bo.y && t < bo.y + bo.h) return bo;
    }
    return null;
  }
  boulderAt(tx, ty) { return this.boulderHit(tx * TILE + 0.5, ty * TILE + 0.5, tx * TILE + 7.5, ty * TILE + 7.5); }
  solidOrBoulder(tx, ty) { return this.solid(tx, ty) || !!this.boulderAt(tx, ty); }

  hitsTiles(l, t, r, b) {
    for (let ty = Math.floor(t / TILE); ty <= Math.floor((b - 0.01) / TILE); ty++) {
      for (let tx = Math.floor(l / TILE); tx <= Math.floor((r - 0.01) / TILE); tx++) if (this.solid(tx, ty)) return true;
    }
    return false;
  }

  // Ant moves never exceed a tile per step, so checking the leading column is enough.
  moveAntX(a, dx) {
    if (!dx) return null;
    a.x += dx;
    const t = a.y - AH, b = a.y;
    const tx = Math.floor((dx > 0 ? a.x + HW - 0.01 : a.x - HW) / TILE);
    // Feet a hair below a ledge top still count as level with it.
    for (let ty = Math.floor(t / TILE); ty <= Math.floor((b - 0.1) / TILE); ty++) {
      if (this.solid(tx, ty)) {
        a.x = dx > 0 ? tx * TILE - HW : (tx + 1) * TILE + HW;
        return { tx, ty };
      }
    }
    const bo = this.boulderHit(a.x - HW, t, a.x + HW, b);
    if (bo) {
      a.x = dx > 0 ? bo.x - HW : bo.x + bo.w + HW;
      return { boulder: bo };
    }
    return null;
  }

  moveAntY(a, dy) {
    const prev = a.y;
    a.y += dy;
    a.grounded = false;
    a.onLeaf = false;
    const l = a.x - HW, r = a.x + HW - 0.01;
    if (dy > 0) {
      const ty = Math.floor((a.y - 0.01) / TILE);
      for (let tx = Math.floor(l / TILE); tx <= Math.floor(r / TILE); tx++) {
        const ch = this.get(tx, ty);
        const leaf = ch === "L" && prev <= ty * TILE + 0.01 && a.dropT <= 0;
        if (SOLID.includes(ch) || leaf) {
          a.y = ty * TILE;
          a.vy = 0;
          a.grounded = true;
          a.onLeaf = leaf;
        }
      }
      const bo = this.boulderHit(l, a.y - AH, r, a.y);
      if (bo && prev <= bo.y + 0.5) { a.y = bo.y; a.vy = 0; a.grounded = true; }
    } else if (dy < 0) {
      const ty = Math.floor((a.y - AH) / TILE);
      for (let tx = Math.floor(l / TILE); tx <= Math.floor(r / TILE); tx++) {
        if (this.solid(tx, ty)) { a.y = (ty + 1) * TILE + AH; a.vy = 0; }
      }
      const bo = this.boulderHit(l, a.y - AH, r, a.y);
      if (bo) { a.y = bo.y + bo.h + AH; a.vy = 0; }
    }
  }

  antStuck(a) { return this.hitsTiles(a.x - HW, a.y - AH, a.x + HW, a.y) || !!this.boulderHit(a.x - HW, a.y - AH, a.x + HW, a.y); }

  moveBoulderX(bo, dx) {
    const nx = bo.x + dx;
    if (this.hitsTiles(nx, bo.y, nx + bo.w, bo.y + bo.h) || this.boulderHit(nx, bo.y, nx + bo.w, bo.y + bo.h, bo)) return 0;
    bo.x = nx;
    return dx;
  }

  // A stone ant stays put when something is below it, or when it can grip a
  // solid neighbour: that is what lets ants build bridges over gaps.
  stoneHolds(x, r) {
    if (r + 1 >= this.h) return true;
    return this.solidOrBoulder(x, r + 1) || this.get(x, r + 1) === "L" || this.solidOrBoulder(x - 1, r) || this.solidOrBoulder(x + 1, r);
  }

  stoneLanding(x, y) {
    let r = y;
    while ((this.solidOrBoulder(x, r)) && r > 0) r--;
    while (r < this.h && !this.stoneHolds(x, r)) r++;
    return r;
  }

  covered(px, py) {
    const col = Math.floor(px / TILE), row = Math.floor((py - 2) / TILE);
    if (this.get(col, row) === "," || this.get(col, row - 1) === ",") return true;
    for (let r = row - 1; r >= Math.max(0, row - 18); r--) {
      const ch = this.get(col, r);
      if (SOLID.includes(ch) || ch === "L") return true;
    }
    return !!this.boulderHit(px - 1, 0, px + 1, py - AH);
  }
}

// ---------------------------------------------------------------- game

class Game {
  constructor() {
    this.canvas = $("scene");
    this.ctx = this.canvas.getContext("2d");
    this.low = art.makeCanvas(1, 1);
    this.lg = this.low.getContext("2d");
    this.dark = art.makeCanvas(1, 1);
    this.dg = this.dark.getContext("2d");
    this.sounds = new Sounds();
    this.sounds.muted = store.get("antcolony.muted", "0") === "1";
    $("mute").setAttribute("aria-pressed", String(this.sounds.muted));
    this.keys = new Set();
    this.held = new Map();
    this.jumpPressed = false;
    this.touch = false;
    this.state = "title";
    this.levelIndex = clamp(+store.get("antcolony.level", "0") || 0, 0, LEVELS.length - 1);
    this.time = 0;
    this.acc = 0;
    art.init();
    this.bindInput();
    this.resize();
    addEventListener("resize", () => this.resize());
    this.load(0);
    this.cam.x = this.world.start.x + 60;
    this.showTitle();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
    this.canvas.width = W;
    this.canvas.height = H;
    // Integer scale so every art pixel is the same size on screen. Tall
    // screens zoom in further, so the level isn't a thin strip under a huge sky.
    this.dpr = dpr;
    this.scale = Math.max(1, Math.floor(Math.min(W / 300, H / 190)), Math.ceil(H / (ROWS * TILE + 120)));
    this.vw = Math.ceil(W / this.scale);
    this.vh = Math.ceil(H / this.scale);
    this.low.width = this.dark.width = this.vw;
    this.low.height = this.dark.height = this.vh;
  }

  // ---------------------------------------------------------- level state

  load(index) {
    this.levelIndex = index;
    this.level = LEVELS[index];
    this.world = new World(this.level);
    const s = this.world.start;
    this.leader = new Ant(s.x, s.y, 1);
    this.trail = [{ x: s.x, y: s.y, f: 1, c: false }];
    // The rest of the colony waits in the nest and files out along the trail.
    this.followers = [];
    for (let i = 1; i < this.level.ants; i++) this.followers.push({ idx: -i * SPACING, step: 0, moving: false });
    this.stats = { stones: 0, eaten: 0, saved: 0 };
    this.fallingStones = [];
    this.particles = [];
    this.birds = [];
    this.birdT = this.level.birds.first;
    this.holdT = 0;
    this.actLatch = false;
    this.switchT = 0;
    this.finishing = false;
    this.endT = 0;
    this.pushInfo = null;
    this.pushSoundT = 0;
    this.hintT = 0;
    this.cam = { x: s.x, y: s.y - 20 };
    this.snapCamera();
    this.updateHud();
  }

  play(index) {
    this.load(index);
    store.set("antcolony.level", String(index));
    this.state = "play";
    this.hidePanel();
    $("hud").hidden = false;
    this.flash(`${this.level.name}`);
  }

  alive() { return (this.leader ? 1 : 0) + this.followers.length; }

  // ---------------------------------------------------------- update

  frame(t) {
    const dt = Math.min((t - this.last) / 1000, 1 / 20);
    this.last = t;
    this.time += dt;
    if (this.state === "play") {
      this.acc += dt;
      while (this.acc >= STEP) {
        this.step(STEP);
        this.acc -= STEP;
        this.jumpPressed = false;
      }
    } else if (this.state === "title") {
      // Slow pan over the first level behind the menu.
      this.cam.x += dt * 14;
      if (this.cam.x > this.world.w * TILE - this.vw / 2) this.cam.x = this.vw / 2;
      this.updateCamera(dt, true);
    }
    this.render();
    requestAnimationFrame((tt) => this.frame(tt));
  }

  input() {
    const LEFT = ["a", "arrowleft"], RIGHT = ["d", "arrowright"], UP = ["w", "arrowup"], DOWN = ["s", "arrowdown"];
    const JUMP = [" ", "k", "z"], ACT = ["x", "e", "j"];
    return {
      left: this.holding("left", LEFT),
      right: this.holding("right", RIGHT),
      up: this.holding("up", UP),
      down: this.holding("down", DOWN),
      jump: this.holding("jump", JUMP) || this.holding("up", UP),
      act: this.holding("act", ACT),
    };
  }

  step(dt) {
    const inp = this.input();
    if (this.leader) this.updateLeader(dt, inp);
    else if (!this.finishing && this.switchT > 0) {
      this.switchT -= dt;
      if (this.switchT <= 0) this.nextLeader();
    }
    this.updateFollowers();
    this.updateBoulders(dt);
    this.updateStones(dt);
    this.updateHelpers(dt);
    this.updateBirds(dt);
    this.updateParticles(dt);
    this.updateCamera(dt);
    if (this.endT > 0) {
      this.endT -= dt;
      if (this.endT <= 0) this.finishFinish();
    }
  }

  updateLeader(dt, inp) {
    const a = this.leader, w = this.world;
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (dir && !a.launched) a.facing = dir;
    a.anim += dt;
    this.pushInfo = null;
    a.jumpBuf = this.jumpPressed ? JUMP_BUFFER : a.jumpBuf - dt;
    a.dropT -= dt;
    a.coyote -= dt;
    const col = Math.floor(a.x / TILE);
    const stemAt = () => w.get(col, Math.floor(a.y / TILE)) === "|" || w.get(col, Math.floor((a.y - 1) / TILE)) === "|";

    let moved = false;
    if (!a.climbing && inp.up && stemAt()) {
      a.climbing = true;
      a.vx = a.vy = 0;
      a.jumpBuf = 0;
    }

    if (a.climbing) {
      a.x = approach(a.x, col * TILE + 4, 60 * dt);
      if (this.jumpPressed && !inp.up) {
        a.climbing = false;
        a.vy = -JUMP_V * 0.85;
        a.vx = dir * WALK;
        a.jumpBuf = a.coyote = 0;
        this.sounds.jump();
      } else if (dir) {
        // Float for a moment so the ant can step from the stem onto the ledge.
        a.climbing = false;
        a.vy = 0;
        a.vx = dir * WALK;
        a.hang = 0.12;
      } else {
        if (inp.up) {
          let r = w.get(col, Math.floor(a.y / TILE)) === "|" ? Math.floor(a.y / TILE) : Math.floor((a.y - 1) / TILE);
          while (w.get(col, r - 1) === "|") r--;
          w.moveAntY(a, Math.max(a.y - CLIMB * dt, r * TILE) - a.y);
        } else if (inp.down) {
          w.moveAntY(a, CLIMB * dt);
          if (a.grounded) a.climbing = false;
        }
        a.vy = 0;
        if (!stemAt()) a.climbing = false;
        moved = true;
      }
    }

    if (!moved) this.walkLeader(a, dir, inp, dt);

    const hazard = this.hazardAt(a);
    if (hazard) { this.killLeader(hazard.cause, hazard); return; }
    if (a.y > w.h * TILE + 16) { this.killLeader("fell", null); return; }

    // Hold X: become a stone where it helps most.
    if (inp.act && !this.actLatch) {
      this.holdT += dt;
      if (this.holdT >= HOLD_TIME) {
        this.actLatch = true;
        this.killLeader("stone", this.stoneCell(a));
        return;
      }
    } else if (!inp.act) {
      this.holdT = 0;
      this.actLatch = false;
    }

    const last = this.trail[this.trail.length - 1];
    if (Math.hypot(a.x - last.x, a.y - last.y) >= CRUMB) this.trail.push({ x: a.x, y: a.y, f: a.facing, c: a.climbing });

    const f = w.finish;
    if (Math.abs(a.x - f.x) < 7 && Math.abs(a.y - f.y) < 6) this.reachFinish();
  }

  walkLeader(a, dir, inp, dt) {
    const w = this.world;
    // Pushing: the ants right behind the leader push too.
    let bo = null;
    if (a.grounded && dir) {
      const front = a.x + dir * HW;
      bo = w.boulderHit(Math.min(front, front + dir * 0.8), a.y - AH + 0.5, Math.max(front, front + dir * 0.8), a.y - 0.5);
    }
    if (bo) {
      const have = this.pushers(), need = bo.weight;
      this.pushInfo = { bo, have, need };
      a.vx = 0;
      if (have >= need && bo.grounded) {
        const m = w.moveBoulderX(bo, dir * PUSH * dt);
        if (m) {
          w.moveAntX(a, m);
          this.pushSoundT -= dt;
          if (this.pushSoundT <= 0) { this.sounds.push(); this.pushSoundT = 0.3; }
        }
      }
    } else {
      if (a.launched && (dir === 0 || dir === Math.sign(a.vx))) {
        // Keep the grasshopper's momentum; only steering against it slows down.
      } else {
        const acc = a.grounded ? ACCEL_GROUND : a.launched ? ACCEL_LAUNCHED : ACCEL_AIR;
        a.vx = approach(a.vx, dir * WALK, acc * dt);
      }
      const hit = w.moveAntX(a, a.vx * dt);
      if (hit) {
        if (hit.tx !== undefined && dir && w.get(hit.tx, hit.ty) === "d") {
          a.digT += dt;
          if (a.digT >= DIG_TIME) {
            for (let ty = Math.floor((a.y - AH) / TILE); ty <= Math.floor((a.y - 0.01) / TILE); ty++) {
              if (w.get(hit.tx, ty) === "d") this.dig(hit.tx, ty);
            }
            a.digT = 0;
          }
        } else a.digT = 0;
        a.vx = 0;
        a.launched = false;
      }
    }

    const col = Math.floor(a.x / TILE), below = Math.floor(a.y / TILE);
    if (inp.down && a.grounded) {
      if (a.onLeaf) { a.dropT = 0.2; a.grounded = false; }
      else if (w.get(col, below) === "d") {
        a.digT += dt;
        if (a.digT >= DIG_TIME) { this.dig(col, below); a.digT = 0; }
      }
    } else if (!dir) a.digT = 0;

    if (a.grounded) { a.coyote = COYOTE; a.launched = false; }
    if (a.jumpBuf > 0) {
      const hop = w.hoppers.find((h) => Math.abs(a.x - h.x) < 9 && Math.abs(a.y - h.y) < 6);
      if (hop) {
        a.vx = HOP_VX;
        a.vy = -HOP_VY;
        a.facing = 1;
        a.launched = true;
        a.grounded = false;
        a.jumpBuf = a.coyote = 0;
        hop.kick = 0.35;
        this.sounds.boing();
        this.dust(hop.x - 6, hop.y, 6, "#9ad070");
      } else if (a.grounded || a.coyote > 0) {
        a.vy = -JUMP_V;
        a.jumpBuf = a.coyote = 0;
        a.grounded = false;
        this.sounds.jump();
      }
    }
    // Let go early for a smaller hop.
    if (!inp.jump && !a.launched && a.vy < -JUMP_V * 0.45) a.vy = -JUMP_V * 0.45;

    const wasAir = !a.grounded, fall = a.vy;
    if (a.hang > 0) { a.hang -= dt; a.vy = 0.6; }
    else a.vy = Math.min(a.vy + GRAVITY * dt, MAX_FALL);
    w.moveAntY(a, a.vy * dt);
    if (a.grounded && wasAir && fall > 140) { this.sounds.land(); this.dust(a.x, a.y, 3, "#d8c8a0"); }
  }

  pushers() {
    const a = this.leader, head = this.trail.length - 1;
    let n = 1;
    for (const f of this.followers) {
      if (f.idx < 0 || f.idx < head - SPACING * 4.5) continue;
      const c = this.trail[Math.floor(f.idx)];
      if (Math.hypot(c.x - a.x, c.y - a.y) < 44) n++;
    }
    return n;
  }

  hazardAt(a) {
    const w = this.world, l = a.x - HW, r = a.x + HW, t = a.y - AH, b = a.y;
    for (let ty = Math.floor(t / TILE); ty <= Math.floor((b - 0.01) / TILE); ty++) {
      for (let tx = Math.floor(l / TILE); tx <= Math.floor((r - 0.01) / TILE); tx++) {
        if (w.get(tx, ty) === "^" && r > tx * TILE + 1 && l < tx * TILE + 7 && b > ty * TILE + 3) return { cause: "thorns", x: tx, y: ty };
      }
    }
    const cx = Math.floor(a.x / TILE), cy = Math.floor((a.y - 2) / TILE);
    if (w.get(cx, cy) === "~") return { cause: "water", x: cx, y: cy };
    return null;
  }

  // Standing at an edge, the ant curls over it to extend the ground;
  // anywhere else it becomes a block where it stands.
  stoneCell(a) {
    const w = this.world, cx = Math.floor(a.x / TILE), cy = Math.floor((a.y - 1) / TILE);
    if (a.grounded && !a.climbing) {
      const gy = Math.floor(a.y / TILE), front = a.x + a.facing * HW;
      for (let d = 1; d <= 6; d++) {
        const col = Math.floor((front + a.facing * d) / TILE);
        if (col === cx) continue;
        if (!w.solidOrBoulder(col, gy) && w.get(col, gy) !== "L" && !w.solidOrBoulder(col, gy - 1)) return { x: col, y: gy };
      }
    }
    return { x: cx, y: cy };
  }

  killLeader(cause, cell) {
    const a = this.leader;
    this.leader = null;
    this.holdT = 0;
    this.pushInfo = null;
    if (cause === "eaten") this.stats.eaten++;
    else if (cell) {
      this.stats.stones++;
      this.placeStone(cell.x, cell.y);
      this.sounds.stone();
      this.dust(a.x, a.y - 2, 10, "#b8b4c0");
    }
    if (cause === "water") { this.sounds.splash(); this.dust(a.x, a.y - 2, 8, "#a8d8ff"); }
    if (cause === "thorns") this.dust(a.x, a.y - 2, 6, "#e04040");
    this.switchT = cause === "eaten" ? 1.1 : 0.7;
    this.updateHud();
  }

  nextLeader() {
    const f = this.followers.shift();
    if (!f) { this.lose(); return; }
    const i = Math.max(0, Math.floor(f.idx)), c = this.trail[i];
    this.trail.length = i + 1;
    const a = new Ant(c.x, c.y, c.f);
    a.climbing = c.c;
    for (let k = 0; k < 24 && this.world.antStuck(a); k++) a.y -= 1;
    this.leader = a;
    this.actLatch = this.input().act;
    this.sounds.next();
    this.updateHud();
  }

  placeStone(x, y) {
    let r = y;
    while (this.world.solidOrBoulder(x, r) && r > 0) r--;
    this.fallingStones.push({ x, row: r, y: r * TILE, vy: 0 });
  }

  updateStones(dt) {
    const w = this.world;
    for (let i = this.fallingStones.length - 1; i >= 0; i--) {
      const s = this.fallingStones[i];
      if (w.stoneHolds(s.x, s.row) && !w.solidOrBoulder(s.x, s.row)) {
        w.set(s.x, s.row, "S");
        this.fallingStones.splice(i, 1);
        this.sounds.clack();
        this.dust(s.x * TILE + 4, s.row * TILE + 8, 4, "#a8a4b0");
        continue;
      }
      s.vy = Math.min(s.vy + GRAVITY * dt, MAX_FALL);
      s.y += s.vy * dt;
      while (s.row < Math.floor(s.y / TILE)) {
        s.row++;
        if (w.stoneHolds(s.x, s.row)) { s.y = s.row * TILE; break; }
      }
      if (s.row >= w.h) this.fallingStones.splice(i, 1);
    }
  }

  // Remove a tile; stone ants that lose their hold start to fall.
  removeTile(x, y) {
    const w = this.world;
    w.set(x, y, " ");
    for (const [nx, ny] of [[x, y - 1], [x - 1, y], [x + 1, y]]) {
      if (w.get(nx, ny) === "S" && !w.stoneHolds(nx, ny)) {
        w.set(nx, ny, " ");
        this.fallingStones.push({ x: nx, row: ny, y: ny * TILE, vy: 0 });
      }
    }
  }

  dig(x, y) {
    this.removeTile(x, y);
    this.sounds.dig();
    this.dust(x * TILE + 4, y * TILE + 4, 8, "#c8915a");
  }

  updateFollowers() {
    const head = this.trail.length - 1;
    // Each ant walks up to SPACING crumbs behind the one in front of it.
    let prev = this.finishing ? head + SPACING : head;
    for (const f of this.followers) {
      const target = Math.min(head, prev - SPACING);
      if (f.idx < target) {
        f.idx = Math.min(target, f.idx + (target - f.idx > SPACING ? 2 : 1));
        f.moving = true;
        f.step++;
      } else f.moving = false;
      prev = f.idx;
    }
    if (this.finishing) {
      while (this.followers.length && this.followers[0].idx >= head) {
        this.followers.shift();
        this.stats.saved++;
        this.sounds.saved();
        this.updateHud();
      }
      if (!this.followers.length && this.endT <= 0) this.endT = 1;
    }
  }

  followerPos(f) { return f.idx < 0 ? null : this.trail[Math.floor(f.idx)]; }

  updateBoulders(dt) {
    const w = this.world;
    for (const bo of w.boulders) {
      const bottom = bo.y + bo.h, cx = bo.x + bo.w / 2;
      const touching = w.hitsTiles(bo.x, bottom, bo.x + bo.w, bottom + 0.5) || w.boulderHit(bo.x, bottom, bo.x + bo.w, bottom + 0.5, bo);
      if (touching && bo.vy >= 0) {
        // Resting: it only tips over once its centre is past an edge, and
        // then it drops into the gap lined up with the grid so it fills it.
        const centre = w.hitsTiles(cx - 0.5, bottom, cx + 0.5, bottom + 0.5) || w.boulderHit(cx - 0.5, bottom, cx + 0.5, bottom + 0.5, bo);
        const free = (x) => !w.hitsTiles(x, bo.y, x + bo.w, bottom + 1) && !w.boulderHit(x, bo.y, x + bo.w, bottom + 1, bo);
        const lo = Math.floor(bo.x / TILE) * TILE, hi = lo + TILE;
        const spot = centre ? null : [lo, hi].sort((p, q) => Math.abs(p - bo.x) - Math.abs(q - bo.x)).find(free);
        if (spot === undefined || spot === null) { bo.vy = 0; bo.grounded = true; continue; }
        bo.x = spot;
      }
      bo.grounded = false;
      bo.vy = Math.min(bo.vy + GRAVITY * dt, MAX_FALL);
      let ny = bo.y + bo.vy * dt;
      if (w.hitsTiles(bo.x, ny, bo.x + bo.w, ny + bo.h) || w.boulderHit(bo.x, ny, bo.x + bo.w, ny + bo.h, bo)) {
        ny = Math.floor((ny + bo.h) / TILE) * TILE - bo.h;
        bo.vy = 0;
        bo.grounded = true;
        // Settle onto the grid so it fills a gap cleanly.
        const rx = Math.round(bo.x / TILE) * TILE;
        if (Math.abs(rx - bo.x) <= 3 && !w.hitsTiles(rx, ny, rx + bo.w, ny + bo.h)) bo.x = rx;
        let wet = false;
        for (let ty = ny / TILE; ty < (ny + bo.h) / TILE; ty++) {
          for (let tx = Math.ceil(bo.x / TILE); tx < Math.floor((bo.x + bo.w) / TILE); tx++) {
            const ch = w.get(tx, ty);
            if (ch === "~") wet = true;
            if (ch === "^" || ch === "~") w.set(tx, ty, " ");
          }
        }
        this.sounds.clack();
        if (wet) this.sounds.splash();
        this.dust(bo.x + bo.w / 2, ny + bo.h, 8, wet ? "#a8d8ff" : "#c8b890");
      }
      bo.y = ny;
    }
  }

  updateHelpers(dt) {
    const w = this.world, a = this.leader;
    for (const h of w.hoppers) h.kick = Math.max(0, h.kick - dt);
    for (const b of w.beetles) {
      b.anim += dt;
      if (b.state === "sleep") {
        if (a && Math.abs(a.x - b.x) < 11 && Math.abs(a.y - b.y) < 8) { b.state = "wake"; b.t = 0.5; this.sounds.wake(); }
      } else if (b.state === "wake") {
        b.t -= dt;
        if (b.t <= 0) { b.state = "charge"; this.sounds.charge(); }
      } else {
        const nx = b.x + b.dir * 75 * dt, col = Math.floor((nx + b.dir * 7) / TILE);
        let blocked = !w.solidOrBoulder(col, Math.floor(b.y / TILE));   // never run off an edge
        for (let r = Math.floor((b.y - 9) / TILE); r <= Math.floor((b.y - 1) / TILE); r++) {
          const ch = w.get(col, r);
          if (ch === "T") this.smash(col, r);
          else if (SOLID.includes(ch) || w.boulderAt(col, r)) blocked = true;
        }
        if (blocked) { b.state = "sleep"; this.sounds.smash(); }
        else {
          b.x = nx;
          if (Math.random() < 0.3) this.dust(b.x - b.dir * 7, b.y, 1, "#c8b890");
        }
      }
    }
    for (const f of w.fireflies) {
      f.ph += dt;
      if (!f.attached) {
        f.x = f.hx + Math.sin(f.ph * 1.3) * 4;
        f.y = f.hy + Math.sin(f.ph * 2.1) * 3;
        if (a && Math.hypot(a.x - f.x, a.y - f.y) < 40) { f.attached = true; this.sounds.chime(); }
      } else {
        const t = a ?? (this.followers[0] && this.followerPos(this.followers[0]));
        if (t) {
          f.x = damp(f.x, t.x - (t.facing ?? t.f ?? 1) * 8 + Math.sin(f.ph * 2) * 5, 3, dt);
          f.y = damp(f.y, t.y - 16 + Math.sin(f.ph * 3.1) * 3, 3, dt);
        }
      }
    }
  }

  smash(col, row) {
    const w = this.world;
    let r0 = row, r1 = row;
    while (w.get(col, r0 - 1) === "T") r0--;
    while (w.get(col, r1 + 1) === "T") r1++;
    for (let r = r0; r <= r1; r++) {
      this.removeTile(col, r);
      this.dust(col * TILE + 4, r * TILE + 4, 4, "#9a6a3c");
    }
    this.sounds.smash();
  }

  // ---------------------------------------------------------- birds

  updateBirds(dt) {
    const cfg = this.level.birds, a = this.leader;
    const inZone = (x) => cfg.zones.some(([x0, x1]) => x >= x0 * TILE && x <= x1 * TILE);
    if (a && inZone(a.x) && !this.finishing) {
      this.birdT -= dt;
      if (this.birdT <= 0 && !this.birds.length) {
        this.spawnBird();
        this.birdT = rand(...cfg.every);
      }
    }
    const top = this.cam.y - this.vh / 2;
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      b.t -= dt;
      b.flap += dt;
      if (b.state === "circle") {
        b.x += b.dir * 95 * dt;
        b.y = damp(b.y, top + 22 + Math.sin(b.flap * 3) * 4, 4, dt);
        if (b.t <= 0) { b.state = "dive"; b.t = 3; b.target = this.pickTarget(); this.sounds.swoop(); }
      } else if (b.state === "dive") {
        const p = this.targetPos(b.target);
        if (!p) { b.state = "leave"; continue; }
        const dx = p.x - b.x, dy = p.y - 3 - b.y, d = Math.hypot(dx, dy) || 1;
        b.vx = (dx / d) * 220;
        b.vy = (dy / d) * 220;
        b.dir = dx < 0 ? -1 : 1;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const hidden = this.world.covered(p.x, p.y);
        if (hidden && d < 34) { b.state = "leave"; b.missed = true; }
        else if (d < 6) {
          if (b.target === "leader") this.killLeader("eaten", null);
          else {
            this.followers.splice(this.followers.indexOf(b.target), 1);
            this.stats.eaten++;
            this.updateHud();
          }
          b.carry = true;
          b.state = "leave";
          this.sounds.eaten();
          this.dust(p.x, p.y - 2, 6, "#e8d8c0");
        } else if (b.t <= 0) b.state = "leave";
      } else {
        b.vx = approach(b.vx, b.dir * 150, 400 * dt);
        b.vy = approach(b.vy, -170, 500 * dt);
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.y < top - 80) this.birds.splice(i, 1);
      }
    }
  }

  spawnBird() {
    const fromLeft = Math.random() < 0.5;
    this.birds.push({
      state: "circle", t: 1.6, flap: 0,
      x: this.cam.x + (fromLeft ? -1 : 1) * (this.vw / 2 + 30), y: this.cam.y - this.vh / 2 - 10,
      dir: fromLeft ? 1 : -1, vx: 0, vy: 0, target: null,
    });
    this.sounds.screech();
    if (this.level.id === "tutorial" && !this.warned) { this.warned = true; this.flash("A bird! Hide!"); }
  }

  // The leader is the juiciest target; covered leaders make birds look
  // for stragglers out in the open.
  pickTarget() {
    const a = this.leader;
    if (a && !this.world.covered(a.x, a.y)) return "leader";
    const open = this.followers.filter((f) => {
      const p = this.followerPos(f);
      return p && Math.abs(p.x - this.cam.x) < this.vw / 2 && !this.world.covered(p.x, p.y);
    });
    if (open.length && Math.random() < 0.6) return open[(Math.random() * open.length) | 0];
    return a ? "leader" : null;
  }

  targetPos(t) {
    if (t === "leader") return this.leader;
    if (t && this.followers.includes(t)) return this.followerPos(t);
    return null;
  }

  // ---------------------------------------------------------- finish

  reachFinish() {
    this.finishing = true;
    this.leader = null;
    this.stats.saved = 1;
    this.sounds.chime();
    this.flash("The new nest!");
    this.updateHud();
  }

  finishFinish() {
    const saved = this.stats.saved, lvl = this.level;
    const stars = saved >= lvl.stars[1] ? 3 : saved >= lvl.stars[0] ? 2 : 1;
    const key = `antcolony.best.${lvl.id}`;
    const best = +store.get(key, "0");
    if (saved > best) store.set(key, String(saved));
    this.state = "won";
    this.sounds.win();
    const next = this.levelIndex + 1 < LEVELS.length;
    this.showPanel(`
      <h2>New nest reached!</h2>
      <div class="stars big">${this.starsHtml(stars)}</div>
      <table>
        <tr><td>Ants saved</td><td>${saved} / ${lvl.ants}</td></tr>
        <tr><td>Turned to stone</td><td>${this.stats.stones}</td></tr>
        <tr><td>Taken by birds</td><td>${this.stats.eaten}</td></tr>
        <tr><td>Best</td><td class="best">${Math.max(best, saved)}</td></tr>
      </table>
      <p class="hint">${stars < 3 ? `Save ${lvl.stars[stars - 1]} ants for the next star.` : "A thriving colony. Perfect!"}</p>
      <div class="row">
        ${next ? `<button class="btn" data-do="next">Next level</button>` : ""}
        <button class="btn ${next ? "ghost" : ""}" data-do="retry">Play again</button>
        <button class="btn ghost" data-do="menu">Levels</button>
      </div>`);
  }

  lose() {
    this.state = "lost";
    this.sounds.lose();
    this.showPanel(`
      <h2>The colony is lost</h2>
      <p>No ant is left to carry on. Every stone counts: try to spend fewer ants, and keep them hidden from birds.</p>
      <div class="row">
        <button class="btn" data-do="retry">Try again</button>
        <button class="btn ghost" data-do="menu">Levels</button>
      </div>`);
  }

  // ---------------------------------------------------------- camera & fx

  snapCamera() { this.updateCamera(1, false, true); }

  updateCamera(dt, free = false, snap = false) {
    let tx = this.cam.x, ty = this.cam.y;
    if (!free) {
      const a = this.leader, f0 = this.followers[0] && this.followerPos(this.followers[0]);
      if (a) { tx = a.x + a.facing * 18; ty = a.y - 18; }
      else if (this.finishing) { tx = this.world.finish.x; ty = this.world.finish.y - 18; }
      else if (f0) { tx = f0.x; ty = f0.y - 18; }
    } else ty = this.world.start.y - 30;
    const k = snap ? 1e9 : 4;
    this.cam.x = free ? tx : damp(this.cam.x, tx, k, dt);
    this.cam.y = damp(this.cam.y, ty, k, dt);
    const W = this.world.w * TILE, H = this.world.h * TILE;
    this.cam.x = W <= this.vw ? W / 2 : clamp(this.cam.x, this.vw / 2, W - this.vw / 2);
    // Touch buttons cover the bottom of the screen; let the view scroll past
    // the level so the ants stay above them.
    const pad = this.touch ? Math.round((130 * this.dpr) / this.scale) : 0;
    const maxY = H + pad - this.vh / 2, minY = -40 + this.vh / 2;
    this.cam.y = minY > maxY ? maxY : clamp(this.cam.y, minY, maxY);
  }

  dust(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      this.particles.push({ x, y, vx: rand(-30, 30), vy: rand(-60, -10), life: rand(0.3, 0.7), color });
    }
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.vy += 200 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  // ---------------------------------------------------------- render

  render() {
    const g = this.lg, w = this.world, vw = this.vw, vh = this.vh;
    const camX = Math.round(this.cam.x - vw / 2), camY = Math.round(this.cam.y - vh / 2);
    const sx = (x) => Math.round(x - camX), sy = (y) => Math.round(y - camY);
    const t = this.time;
    const onScreen = (x, y, m = 40) => x > camX - m && x < camX + vw + m && y > camY - m && y < camY + vh + m;

    // Sky: blend from dry to green around the zone change.
    const horizon = 17 * TILE - camY;
    const blend = clamp((this.cam.x / TILE - (this.level.zones.grass - 12)) / 24, 0, 1);
    if (blend < 1) art.drawBackground(g, "dry", vw, vh, camX, horizon);
    if (blend > 0) {
      g.globalAlpha = blend;
      art.drawBackground(g, "grass", vw, vh, camX, horizon);
      g.globalAlpha = 1;
    }

    // Terrain, clipped by hand (drawImage with an out-of-range source rect is unreliable).
    const tw = w.terrain.width, th = w.terrain.height;
    const x0 = Math.max(0, camX), y0 = Math.max(0, camY), x1 = Math.min(tw, camX + vw), y1 = Math.min(th, camY + vh);
    if (camY + vh > th) { g.fillStyle = "#3a2618"; g.fillRect(0, th - camY, vw, camY + vh - th); }
    if (x1 > x0 && y1 > y0) g.drawImage(w.terrain, x0, y0, x1 - x0, y1 - y0, x0 - camX, y0 - camY, x1 - x0, y1 - y0);

    // Water
    for (const c of w.water) {
      const px = c.x * TILE, py = c.y * TILE;
      if (!onScreen(px, py, 8)) continue;
      g.fillStyle = "rgba(60,130,210,0.72)";
      g.fillRect(sx(px), sy(py), TILE, TILE);
      if (w.get(c.x, c.y - 1) !== "~") {
        g.fillStyle = "#a8dcff";
        const off = Math.floor(t * 4 + c.x * 3) % 8;
        g.fillRect(sx(px), sy(py), TILE, 1);
        g.fillStyle = "#e8f6ff";
        g.fillRect(sx(px) + off % 6, sy(py), 2, 1);
      }
    }

    // Decor behind the ants
    if (onScreen(w.start.x, w.start.y)) g.drawImage(S.nest, sx(w.start.x - 16), sy(w.start.y - 14));
    if (onScreen(w.finish.x, w.finish.y)) art.drawNewNest(g, sx(w.finish.x), sy(w.finish.y), t);
    for (const s of w.signs) if (onScreen(s.x, s.y)) g.drawImage(S.sign, sx(s.x - 3), sy(s.y - 6));
    for (const m of w.mushrooms) if (onScreen(m.x, m.y)) g.drawImage(S.mushroom, sx(m.x - 2), sy(m.y - 5));
    for (const bo of w.boulders) if (onScreen(bo.x, bo.y)) g.drawImage(bo.w > 8 ? S.boulder : S.pebble, sx(bo.x), sy(bo.y));
    for (const h of w.hoppers) if (onScreen(h.x, h.y)) g.drawImage(h.kick > 0 ? S.hopperKick : S.hopper, sx(h.x - 8), sy(h.y - 8 - (h.kick > 0.2 ? 1 : 0)));
    for (const b of w.beetles) {
      if (!onScreen(b.x, b.y)) continue;
      const fr = b.state === "charge" ? Math.floor(b.anim * 12) % 2 : 0;
      g.drawImage(S.beetle[fr], sx(b.x - 7), sy(b.y - 7));
      if (b.state === "sleep" && !REDUCED_MOTION) {
        const zt = (t * 0.8) % 1;
        g.drawImage(art.textCanvas(["Z"], "#ffffff"), sx(b.x + 4 + zt * 4), sy(b.y - 12 - zt * 8));
      }
    }

    // Ants
    for (const f of this.followers) {
      const c = this.followerPos(f);
      if (!c || !onScreen(c.x, c.y)) continue;
      this.drawAnt(g, sx(c.x), sy(c.y), c.f, f.moving ? (f.step >> 3) & 1 : 0, false, c.c);
    }
    const a = this.leader;
    if (a) {
      const fr = a.climbing ? (Math.floor(a.y / 3) & 1) : (Math.abs(a.vx) > 1 || this.pushInfo) && a.grounded ? Math.floor(a.anim * 10) & 1 : 0;
      this.drawAnt(g, sx(a.x), sy(a.y), a.facing, fr, true, a.climbing);
    }

    // Grass tufts in front of everything that hides in them.
    for (const c of w.tufts) {
      if (w.get(c.x, c.y) !== ",") continue;
      const px = c.x * TILE, py = (c.y + 1) * TILE;
      if (onScreen(px, py)) art.drawTuft(g, sx(px), sy(py), w.zoneAt(c.x), t, c.x * 31 + c.y);
    }

    for (const s of this.fallingStones) g.drawImage(art.stoneSprite(), sx(s.x * TILE), sy(s.y));
    for (const p of this.particles) {
      g.fillStyle = p.color;
      g.fillRect(sx(p.x), sy(p.y), 1, 1);
    }

    this.renderDark(g, camX, camY);

    // Things that must stay readable in the dark.
    for (const f of w.fireflies) g.drawImage(S.firefly[Math.floor(t * 8) & 1], sx(f.x - 1), sy(f.y - 1));
    for (const b of this.birds) {
      const img = S.bird[Math.floor(b.flap * (b.state === "dive" ? 4 : 9)) & 1];
      g.save();
      g.translate(sx(b.x), sy(b.y));
      if (b.state === "dive") g.rotate(Math.atan2(b.vy, Math.abs(b.vx)) * b.dir * 0.8);
      g.scale(b.dir, 1);
      g.drawImage(img, -15, -9);
      if (b.carry) g.drawImage(S.ant.up[0], 8, 4);
      g.restore();
    }
    if (a) this.drawLeaderUi(g, a, sx, sy);
    const focus = a ?? (this.followers[0] && this.followerPos(this.followers[0]));
    let near = null;
    if (focus) for (const s of w.signs) if (Math.abs(s.x - focus.x) < 72 && Math.abs(s.y - focus.y) < 64 && (!near || Math.abs(s.x - focus.x) < Math.abs(near.x - focus.x))) near = s;
    for (const s of w.signs) {
      if (!onScreen(s.x, s.y, 80)) continue;
      if (s !== near) {
        const q = art.textCanvas(["?"], "#fff4dc");
        g.fillStyle = "rgba(40,24,12,0.82)";
        g.fillRect(sx(s.x) - 3, sy(s.y) - 17, 7, 9);
        g.drawImage(q, sx(s.x) - 1, sy(s.y) - 15);
        continue;
      }
      const tc = art.textCanvas(s.lines, "#fff4dc");
      const px = clamp(sx(s.x) - (tc.width >> 1) - 3, 2, vw - tc.width - 7), py = sy(s.y) - 10 - tc.height - 4;
      g.fillStyle = "rgba(40,24,12,0.82)";
      g.fillRect(px, py, tc.width + 5, tc.height + 5);
      g.fillStyle = "#c8945a";
      g.fillRect(px, py + tc.height + 5, tc.width + 5, 1);
      g.drawImage(tc, px + 3, py + 3);
    }
    // Boulder weights, so the player can count heads.
    for (const bo of w.boulders) {
      const near = a && Math.abs(a.x - (bo.x + bo.w / 2)) < 50 && Math.abs(a.y - bo.y) < 40;
      if (!near) continue;
      const info = this.pushInfo && this.pushInfo.bo === bo ? this.pushInfo : null;
      const label = info ? `${info.have}/${bo.weight}` : `${bo.weight}`;
      const col = info ? (info.have >= bo.weight ? "#9cff8a" : "#ff8a7a") : "#ffffff";
      const tc = art.textCanvas([label], col);
      g.drawImage(tc, sx(bo.x + bo.w / 2) - (tc.width >> 1), sy(bo.y) - 8);
    }

    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.drawImage(this.low, 0, 0, vw * this.scale, vh * this.scale);
  }

  drawAnt(g, x, y, facing, frame, leader, climbing) {
    const set = leader ? S.leader : S.ant;
    if (climbing) g.drawImage(set.up[frame], x - 2, y - 10);
    else g.drawImage(facing < 0 ? set.left[frame] : set.right[frame], x - 5, y - 5);
  }

  drawLeaderUi(g, a, sx, sy) {
    const x = sx(a.x), y = sy(a.y) - (a.climbing ? 13 : 9) - (REDUCED_MOTION ? 0 : Math.round(Math.sin(this.time * 5)));
    // Golden marker
    g.fillStyle = "#ffd23a";
    g.fillRect(x - 2, y - 2, 5, 1);
    g.fillRect(x - 1, y - 1, 3, 1);
    g.fillRect(x, y, 1, 1);
    // Bird warning while one is circling.
    if (this.birds.some((b) => b.state === "circle")) {
      const hidden = this.world.covered(a.x, a.y);
      const tc = art.textCanvas([hidden ? "SAFE" : "HIDE!"], hidden ? "#9cff8a" : "#ff6a5a");
      g.drawImage(tc, x - (tc.width >> 1), y - 9);
    }
    if (this.holdT > 0) {
      // Where the stone will end up, and how long until it happens.
      const cell = this.stoneCell(a), r = this.world.stoneLanding(cell.x, cell.y);
      const px = sx(cell.x * TILE), py = sy(r * TILE);
      if (Math.floor(this.time * 8) & 1) {
        g.fillStyle = "rgba(255,255,255,0.85)";
        g.fillRect(px, py, 8, 1);
        g.fillRect(px, py + 7, 8, 1);
        g.fillRect(px, py, 1, 8);
        g.fillRect(px + 7, py, 1, 8);
      }
      const p = clamp(this.holdT / HOLD_TIME, 0, 1);
      g.fillStyle = "rgba(0,0,0,0.6)";
      g.fillRect(x - 6, y - 6, 13, 3);
      g.fillStyle = "#c2bfc8";
      g.fillRect(x - 5, y - 5, Math.round(11 * p), 1);
    }
  }

  // Underground darkness with holes cut around light sources.
  renderDark(g, camX, camY) {
    const w = this.world, caveX = this.level.zones.cave * TILE, vw = this.vw, vh = this.vh;
    if (camX + vw < caveX - 8) return;
    const d = this.dg;
    d.globalCompositeOperation = "source-over";
    d.clearRect(0, 0, vw, vh);
    for (let tx = Math.floor(camX / TILE); tx <= Math.floor((camX + vw) / TILE); tx++) {
      const wx = tx * TILE;
      if (wx < caveX || tx >= w.w) continue;
      const alpha = clamp(0.35 + (wx - caveX) / 60, 0, 1) * 0.92;
      const top = w.darkTop[tx] * TILE - camY;
      d.fillStyle = `rgba(6,4,14,${(alpha * 0.5).toFixed(2)})`;
      d.fillRect(wx - camX, top, TILE, 4);
      d.fillStyle = `rgba(6,4,14,${alpha.toFixed(2)})`;
      d.fillRect(wx - camX, top + 4, TILE, vh - top - 4);
    }
    d.globalCompositeOperation = "destination-out";
    const light = (x, y, r, k = 1) => {
      const lx = x - camX, ly = y - camY;
      if (lx < -r || lx > vw + r || ly < -r || ly > vh + r) return;
      const gr = d.createRadialGradient(lx, ly, 0, lx, ly, r);
      gr.addColorStop(0, `rgba(0,0,0,${k})`);
      gr.addColorStop(0.55, `rgba(0,0,0,${k * 0.75})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      d.fillStyle = gr;
      d.fillRect(lx - r, ly - r, r * 2, r * 2);
    };
    const flick = REDUCED_MOTION ? 0 : Math.sin(this.time * 9) * 2;
    if (this.leader) light(this.leader.x, this.leader.y - 3, 22);
    for (const f of this.followers) { const c = this.followerPos(f); if (c) light(c.x, c.y - 2, 9, 0.6); }
    for (const f of w.fireflies) light(f.x, f.y, (f.attached ? 64 : 40) + flick);
    for (const m of w.mushrooms) light(m.x, m.y - 3, 30);
    light(w.finish.x, w.finish.y - 6, 46);
    g.drawImage(this.dark, 0, 0);
  }

  // ---------------------------------------------------------- HUD & panels

  updateHud() {
    $("lvl").textContent = this.level.name;
    $("ants").textContent = this.finishing ? `${this.stats.saved} saved` : String(this.alive());
    $("stones").textContent = String(this.stats.stones);
    $("eaten").textContent = String(this.stats.eaten);
  }

  flash(text) {
    const m = $("msg");
    m.textContent = text;
    m.classList.remove("on");
    void m.offsetWidth;
    m.classList.add("on");
  }

  starsHtml(n) {
    return [1, 2, 3].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("");
  }

  showTitle() {
    this.state = "title";
    $("hud").hidden = true;
    const levels = LEVELS.map((l, i) => {
      const best = +store.get(`antcolony.best.${l.id}`, "0");
      const stars = best >= l.stars[1] ? 3 : best >= l.stars[0] ? 2 : best > 0 ? 1 : 0;
      return `<button class="level ${i === this.levelIndex ? "sel" : ""}" data-do="level" data-level="${i}">
        <b>${i + 1}</b><span class="name">${l.name}<small>${l.blurb}</small></span>
        <span class="info"><span class="stars">${this.starsHtml(stars)}</span>${best ? `${best}/${l.ants}` : ""}</span>
      </button>`;
    }).join("");
    this.showPanel(`
      <h1>Ant <span>Colony</span></h1>
      <p class="motto">“The life of the colony matters more than the life of the individual.”</p>
      <p>Lead your colony from the drying old nest to a new home underground. When an ant dies it turns to stone, so its body can become a bridge or a step for the others. Then you carry on as the next ant.</p>
      <div class="levels">${levels}</div>
      <p class="keys"><kbd>A</kbd><kbd>D</kbd> walk · <kbd>Space</kbd> jump · <kbd>W</kbd> climb · <kbd>S</kbd> dig / drop · hold <kbd>X</kbd> turn to stone · <kbd>R</kbd> restart · <kbd>P</kbd> pause</p>`);
  }

  showPause() {
    this.showPanel(`
      <h2>Paused</h2>
      <table>
        <tr><td>Walk</td><td><kbd>A</kbd> <kbd>D</kbd> / arrows</td></tr>
        <tr><td>Jump</td><td><kbd>Space</kbd> / <kbd>W</kbd></td></tr>
        <tr><td>Climb a stem</td><td><kbd>W</kbd> / <kbd>S</kbd></td></tr>
        <tr><td>Dig down, drop through a leaf</td><td><kbd>S</kbd></td></tr>
        <tr><td>Turn to stone</td><td>hold <kbd>X</kbd></td></tr>
      </table>
      <p>Ants that die turn to stone: at an edge they stretch over it as a bridge, elsewhere they become a step. Pebbles need several ants close behind you to push. Hide from birds under leaves and in grass.</p>
      <div class="row">
        <button class="btn" data-do="resume">Resume</button>
        <button class="btn ghost" data-do="retry">Restart</button>
        <button class="btn ghost" data-do="menu">Levels</button>
      </div>`);
  }

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

  panelAction(act, el) {
    this.sounds.unlock();
    if (act === "level") this.play(+el.dataset.level);
    else if (act === "next") this.play(Math.min(this.levelIndex + 1, LEVELS.length - 1));
    else if (act === "retry") this.play(this.levelIndex);
    else if (act === "resume") this.togglePause(false);
    else if (act === "menu") { this.load(this.levelIndex); this.showTitle(); }
  }

  togglePause(force) {
    const paused = this.state === "paused";
    const want = force ?? !paused;
    if (want && this.state === "play") { this.state = "paused"; this.showPause(); }
    else if (!want && paused) { this.state = "play"; this.hidePanel(); this.last = performance.now(); }
  }

  toggleMute() {
    this.sounds.unlock();
    this.sounds.setMuted(!this.sounds.muted);
    $("mute").setAttribute("aria-pressed", String(this.sounds.muted));
    store.set("antcolony.muted", this.sounds.muted ? "1" : "0");
  }

  // ---------------------------------------------------------- input

  bindInput() {
    const JUMP = [" ", "k", "z", "w", "arrowup"];
    addEventListener("keydown", (e) => {
      this.sounds.unlock();
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k) && $("panel").hidden) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (JUMP.includes(k)) this.jumpPressed = true;
      if (k === "m") this.toggleMute();
      else if (k === "p" || k === "escape") this.togglePause();
      else if (k === "r" && (this.state === "play" || this.state === "lost" || this.state === "paused")) this.play(this.levelIndex);
      else if (k === "enter" && this.state === "title") this.play(this.levelIndex);
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
      if (act === "jump" || act === "up") this.jumpPressed = true;
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
}

new Game();
