// Sudoku 3D - a sudoku played on a floating, tilting 3D board.
// Browser port of the pygame original: Canvas 2D with a hand-rolled perspective
// camera, painter's-algorithm tiles, additive glow particles and WebAudio synth sounds.

const TILE = 0.86;      // tile footprint inside a 1x1 cell
const BOX_GAP = 0.16;   // extra gap between 3x3 boxes
const PLATE = 5.0;      // half-size of the base plate
const DIFFICULTIES = { Easy: 40, Medium: 32, Hard: 26 };

const BG_TOP = [10, 8, 30];
const BG_BOTTOM = [44, 14, 62];
const PLATE_COL = [26, 24, 52];
const NEON = [90, 200, 255];
const EMPTY_COL = [54, 60, 104];
const GIVEN_COL = [78, 88, 158];
const USER_COL = [36, 140, 168];
const WRONG_COL = [150, 40, 70];
const SELECT_COL = [255, 196, 70];
const SAME_COL = [196, 90, 255];
const PEER_COL = [130, 140, 220];
const WHITE = [255, 255, 255];
const TXT_GIVEN = [236, 240, 255];
const TXT_USER = [150, 250, 255];
const TXT_WRONG = [255, 110, 130];
const TXT_SAME = [255, 225, 140];
const SPARK_COLORS = [[90, 200, 255], [255, 196, 70], [196, 90, 255], [110, 255, 170],
                      [255, 110, 160], [255, 150, 60]];

// ---------------------------------------------------------------- utils

const rand = (a, b) => a + Math.random() * (b - a);
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rad = (deg) => deg * Math.PI / 180;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function mix(a, b, t) {
  t = clamp(t, 0, 1);
  return [a[0] + (b[0] - a[0]) * t | 0, a[1] + (b[1] - a[1]) * t | 0, a[2] + (b[2] - a[2]) * t | 0];
}

function shade(c, s) {
  return [Math.min(255, c[0] * s | 0), Math.min(255, c[1] * s | 0), Math.min(255, c[2] * s | 0)];
}

const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function cellCenter(r, c) {
  const x = (c - 4) + (Math.floor(c / 3) - 1) * BOX_GAP;
  const z = (4 - r) - (Math.floor(r / 3) - 1) * BOX_GAP;
  return [x, z];
}

// Fixed world light -> per-face brightness
const L = norm([-0.35, 1.0, -0.55]);
const SH_TOP = 0.35 + 0.75 * L[1];
const SH_NZ = 0.35 + 0.75 * Math.max(0, -L[2]);
const SH_PZ = 0.35 + 0.75 * Math.max(0, L[2]);
const SH_NX = 0.35 + 0.75 * Math.max(0, -L[0]);
const SH_PX = 0.35 + 0.75 * Math.max(0, L[0]);

// ---------------------------------------------------------------- puzzle logic

function makeSolution() {
  // Random valid grid: shuffle bands/rows/stacks/cols/digits of a base pattern.
  const rb = () => shuffle([0, 1, 2]);
  const rows = rb().flatMap((g) => rb().map((r) => g * 3 + r));
  const cols = rb().flatMap((g) => rb().map((c) => g * 3 + c));
  const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  return rows.map((r) => cols.map((c) => nums[(3 * (r % 3) + Math.floor(r / 3) + c) % 9]));
}

function countSolutions(grid, limit = 2) {
  const g = grid.map((row) => row.slice());
  const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (g[r][c]) {
        const b = 1 << g[r][c];
        rows[r] |= b;
        cols[c] |= b;
        boxes[(r / 3 | 0) * 3 + (c / 3 | 0)] |= b;
      }
    }
  }
  let count = 0;

  function solve() {
    let best = null, bestOpts = null;
    outer:
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (g[r][c] === 0) {
          const used = rows[r] | cols[c] | boxes[(r / 3 | 0) * 3 + (c / 3 | 0)];
          const opts = [];
          for (let v = 1; v <= 9; v++) if (!(used & (1 << v))) opts.push(v);
          if (best === null || opts.length < bestOpts.length) {
            best = [r, c];
            bestOpts = opts;
            if (opts.length <= 1) break outer;
          }
        }
      }
    }
    if (best === null) {
      count++;
      return count >= limit;
    }
    const [r, c] = best;
    const bi = (r / 3 | 0) * 3 + (c / 3 | 0);
    for (const v of bestOpts) {
      const b = 1 << v;
      g[r][c] = v;
      rows[r] |= b;
      cols[c] |= b;
      boxes[bi] |= b;
      if (solve()) return true;
      g[r][c] = 0;
      rows[r] ^= b;
      cols[c] ^= b;
      boxes[bi] ^= b;
    }
    return false;
  }

  solve();
  return count;
}

function makePuzzle(clues) {
  const solution = makeSolution();
  const puzzle = solution.map((row) => row.slice());
  let filled = 81;
  for (const i of shuffle([...Array(81).keys()])) {
    if (filled <= clues) break;
    const r = i / 9 | 0, c = i % 9;
    const v = puzzle[r][c];
    puzzle[r][c] = 0;
    if (countSolutions(puzzle) !== 1) puzzle[r][c] = v;
    else filled--;
  }
  return [puzzle, solution];
}

// ---------------------------------------------------------------- glow sprites

const glowCache = new Map();

function quant(c) {
  // Quantise a colour so the glow cache stays small.
  return [c[0] >> 4 << 4, c[1] >> 4 << 4, c[2] >> 4 << 4];
}

function glowSprite(color) {
  // Soft radial blob for additive blending, cached per colour; scaled on draw.
  const key = color.join(",");
  let s = glowCache.get(key);
  if (!s) {
    s = document.createElement("canvas");
    s.width = s.height = 128;
    const g = s.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      grad.addColorStop(t, css(shade(color, (1 - t) ** 2.2)));
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    glowCache.set(key, s);
  }
  return s;
}

// ---------------------------------------------------------------- sound

class Sounds {
  constructor() {
    this.ctx = null;
    this.buffers = null;
    this.muted = false;
  }

  unlock() {
    // Audio contexts may only start after a user gesture.
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const scale = [523.3, 587.3, 659.3, 784.0, 880.0, 1046.5, 1174.7, 1318.5, 1568.0];
      this.buffers = {
        place: scale.map((f) => this.synth([[0, f, 0.35], [0, f * 1.5, 0.3]], 0.25)),
        tick: this.synth([[0, 1400, 0.05]], 0.08),
        clear: this.synth([[0, 420, 0.12]], 0.15),
        bump: this.synth([[0, 180, 0.12]], 0.2),
        wrong: this.synth([[0, 155, 0.35], [0, 163, 0.35], [0.12, 110, 0.3]], 0.3, true),
        unit: this.synth([784, 988, 1175, 1568].map((f, i) => [i * 0.07, f, 0.35]), 0.22),
        win: this.synth([523, 659, 784, 1047, 784, 1047, 1319, 1568].map((f, i) => [i * 0.11, f, 0.6]), 0.22),
      };
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  synth(notes, vol, square = false, sr = 22050) {
    const length = Math.max(...notes.map(([s, , d]) => s + d));
    const n = Math.floor(sr * length);
    const buf = new Float32Array(n);
    for (const [start, freq, dur] of notes) {
      const i0 = Math.floor(start * sr);
      const len = Math.floor(dur * sr);
      for (let i = 0; i < len && i0 + i < n; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 9 / dur) * Math.min(1, t * 300);
        let ph = Math.sin(2 * Math.PI * freq * t);
        if (square) ph = ph > 0 ? 0.6 : -0.6;
        buf[i0 + i] += ph * env;
      }
    }
    let peak = 1;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    const ab = this.ctx.createBuffer(1, n, sr);
    const data = ab.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = vol * buf[i] / peak;
    return ab;
  }

  play(name, idx) {
    if (this.muted || !this.ctx || this.ctx.state !== "running") return;
    const b = this.buffers[name];
    const src = this.ctx.createBufferSource();
    src.buffer = idx !== undefined ? b[idx] : b;
    src.connect(this.ctx.destination);
    src.start();
  }
}

// ---------------------------------------------------------------- 3D objects

class Camera {
  constructor() {
    this.yaw = this.tyaw = 0;
    this.pitch = this.tpitch = rad(56);
    this.dist = this.tdist = 14.5;
    this.f = 860;
    this.cx = 0;
    this.cy = 0;
    this.ox = this.oy = 0;
    this.update(0, 0, 0.5, 0.5);
  }

  reset() {
    this.tyaw = Math.round(this.tyaw / (2 * Math.PI)) * 2 * Math.PI;
    this.tpitch = rad(56);
    this.tdist = 14.5;
  }

  // mx/my: pointer position normalised to 0..1, for a little parallax
  update(dt, t, mx, my) {
    const k = dt ? 1 - Math.exp(-dt * 7) : 1;
    this.yaw += (this.tyaw - this.yaw) * k;
    this.pitch += (this.tpitch - this.pitch) * k;
    this.dist += (this.tdist - this.dist) * k;
    const yaw = this.yaw + 0.05 * Math.sin(t * 0.31) + (mx - 0.5) * 0.10;
    const pitch = this.pitch + 0.025 * Math.sin(t * 0.23) - (my - 0.5) * 0.06;
    this.effPitch = pitch;
    this.effYaw = yaw;
    const cp = Math.cos(pitch);
    this.eye = [this.dist * cp * Math.sin(yaw), this.dist * Math.sin(pitch), -this.dist * cp * Math.cos(yaw)];
    this.fwd = norm([-this.eye[0], -this.eye[1], -this.eye[2]]);
    this.right = norm(cross([0, 1, 0], this.fwd));
    this.up = cross(this.fwd, this.right);
  }

  project(x, y, z) {
    const [ex, ey, ez] = this.eye;
    const dx = x - ex, dy = y - ey, dz = z - ez;
    const [rx, , rz] = this.right;
    const [ux, uy, uz] = this.up;
    const [fx, fy, fz] = this.fwd;
    let cz = dx * fx + dy * fy + dz * fz;
    if (cz < 0.2) cz = 0.2;
    const s = this.f / cz;
    return [this.cx + this.ox + (dx * rx + dz * rz) * s,
            this.cy + this.oy - (dx * ux + dy * uy + dz * uz) * s, cz];
  }
}

class Tile {
  constructor(r, c, value, delay) {
    this.r = r;
    this.c = c;
    this.value = value;
    this.given = value !== 0;
    this.wrong = false;
    [this.x, this.z] = cellCenter(r, c);
    this.height = 0.2;
    this.heightV = 0;
    this.drop = 7 + Math.random() * 2;
    this.dropV = 0;
    this.delay = delay;
    this.landed = false;
    this.flash = 0;
    this.flashCol = WHITE;
    this.shake = 0;
    this.pop = 0;
    this.polys = [];
  }

  baseHeight() {
    if (this.given) return 0.36;
    return this.value ? 0.24 : 0.14;
  }

  // Advance animation; returns true on the frame the tile first lands.
  update(dt, target) {
    if (this.delay > 0) {
      this.delay -= dt;
      return false;
    }
    let hit = false;
    if (this.drop > 0 || this.dropV !== 0) {
      this.dropV -= 45 * dt;
      this.drop += this.dropV * dt;
      if (this.drop <= 0) {
        this.drop = 0;
        hit = !this.landed;
        this.landed = true;
        this.dropV = this.dropV < -2.5 ? -this.dropV * 0.3 : 0;
      }
    }
    const a = (target - this.height) * 140 - this.heightV * 11;
    this.heightV += a * dt;
    this.height += this.heightV * dt;
    this.flash = Math.max(0, this.flash - dt * 1.8);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.pop = Math.max(0, this.pop - dt * 3.0);
    return hit;
  }
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

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sounds = new Sounds();
    this.sounds.muted = store.get("sudoku3d.muted", "0") === "1";
    this.cam = new Camera();
    this.t = 0;
    this.difficulty = store.get("sudoku3d.difficulty", "Medium");
    if (!(this.difficulty in DIFFICULTIES)) this.difficulty = "Medium";
    this.screenShake = 0;
    this.redFlash = 0;
    this.mouse = null;          // last mouse position (null for touch / outside)
    this.hoverTile = null;
    this.pointers = new Map();  // active pointers for drag / pinch
    this.drawOrder = [];
    this.hudCache = {};
    this.makeHud();
    this.resize();
    this.makeBackground();
    this.bindInput();
    this.newGame();
  }

  // ------------------------------------------------------------ setup
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    // The board lives in whatever area the HUD panel does not cover.
    const hud = document.getElementById("hud").getBoundingClientRect();
    let ax = 0, ay = 0, aw = this.W, ah = this.H;
    if (hud.left > this.W * 0.4) aw = hud.left;
    else ah = Math.max(200, hud.top);
    // Narrow screens: let the board use more of the width.
    const scale = Math.min(aw / (aw < 600 ? 760 : 900), ah / 820);
    this.cam.f = 860 * scale;
    this.cam.cx = ax + aw / 2;
    this.cam.cy = ay + ah * (450 / 820);
    this.uiScale = Math.max(0.5, scale);
    document.documentElement.style.setProperty("--board-cx", `${this.cam.cx}px`);
    this.bgGrad = null;
  }

  makeBackground() {
    this.stars = Array.from({ length: 220 }, () =>
      [Math.random() * 2, Math.random(), rand(0.3, 1), rand(0, 6.28), rand(0.5, 2.5)]);
    this.nebulae = Array.from({ length: 4 }, () =>
      [Math.random(), Math.random(), choice([[40, 20, 70], [20, 30, 80], [60, 15, 50]]), rand(0, 6.28)]);
  }

  makeHud() {
    const numpad = document.getElementById("numpad");
    this.numpad = [];
    for (let d = 1; d <= 9; d++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.innerHTML = `<b>${d}</b><small></small>`;
      b.addEventListener("click", () => this.press(b, () => this.place(d)));
      numpad.append(b);
      this.numpad.push({ el: b, sub: b.querySelector("small") });
    }
    const diff = document.getElementById("difficulty");
    this.diffButtons = Object.keys(DIFFICULTIES).map((name) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.textContent = name;
      b.addEventListener("click", () => this.press(b, () => this.setDifficulty(name)));
      diff.append(b);
      return [name, b];
    });
    const on = (id, fn) => {
      const b = document.getElementById(id);
      b.addEventListener("click", () => this.press(b, fn));
    };
    on("btn-new", () => this.newGame());
    on("btn-hint", () => this.hint());
    on("win-new", () => this.newGame());
    this.muteBtn = document.getElementById("mute");
    this.muteBtn.addEventListener("click", () => this.toggleMute());
    this.muteBtn.setAttribute("aria-pressed", String(this.sounds.muted));
    this.el = {
      diff: document.getElementById("st-diff"),
      time: document.getElementById("st-time"),
      mistakes: document.getElementById("st-mistakes"),
      hints: document.getElementById("st-hints"),
      bar: document.getElementById("progress-bar"),
      barLabel: document.getElementById("progress-label"),
      win: document.getElementById("win"),
      winStats: document.getElementById("win-stats"),
    };
  }

  press(el, fn) {
    this.sounds.unlock();
    this.sounds.play("tick");
    el.classList.remove("pop");
    void el.offsetWidth;  // restart the pop animation
    el.classList.add("pop");
    setTimeout(() => el.classList.remove("pop"), 120);
    el.blur();
    fn();
  }

  toggleMute() {
    this.sounds.muted = !this.sounds.muted;
    this.muteBtn.setAttribute("aria-pressed", String(this.sounds.muted));
    store.set("sudoku3d.muted", this.sounds.muted ? "1" : "0");
    this.muteBtn.blur();
  }

  setDifficulty(name) {
    this.difficulty = name;
    store.set("sudoku3d.difficulty", name);
    this.newGame();
  }

  newGame() {
    const [puzzle, solution] = makePuzzle(DIFFICULTIES[this.difficulty]);
    this.solution = solution;
    this.tiles = puzzle.map((row, r) => row.map((v, c) =>
      new Tile(r, c, v, (r + c) * 0.035 + Math.random() * 0.08)));
    this.allTiles = this.tiles.flat();
    this.sel = [4, 4];
    this.mistakes = 0;
    this.hints = 0;
    this.elapsed = 0;
    this.won = false;
    this.winT = 0;
    this.fireworkTimer = 0;
    this.particles = [];
    this.events = [];
    this.el.win.hidden = true;
  }

  // ------------------------------------------------------------ effects
  burst(pos, color, { n = 24, speed = 4.0, life = 0.9, size = 0.12, grav = 9.0, up = 3.0 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, 2 * Math.PI);
      const e = rand(-0.3, 1.0);
      const sp = speed * rand(0.4, 1.0);
      const l = life * rand(0.6, 1.2);
      this.particles.push({
        x: pos[0], y: pos[1], z: pos[2],
        vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + up, vz: Math.sin(a) * Math.cos(e) * sp,
        color: color || choice(SPARK_COLORS), life: l, maxLife: l, size: size * rand(0.6, 1.4), grav,
      });
    }
  }

  firework() {
    const pos = [rand(-4, 4), rand(3.5, 6.5), rand(-3, 4)];
    const col = choice(SPARK_COLORS);
    for (let i = 0; i < 70; i++) {
      // uniform direction on a sphere
      const u = rand(-1, 1), v = rand(0, 2 * Math.PI);
      const s = Math.sqrt(1 - u * u) * 5.5;
      const l = rand(1.0, 1.6);
      this.particles.push({
        x: pos[0], y: pos[1], z: pos[2], vx: s * Math.cos(v), vy: u * 5.5, vz: s * Math.sin(v),
        color: col, life: l, maxLife: l, size: rand(0.08, 0.16), grav: 4.0,
      });
    }
  }

  topPos(tile) {
    return [tile.x, tile.drop + tile.height + 0.05, tile.z];
  }

  schedule(delay, fn) {
    this.events.push([delay, fn]);
  }

  wave(cells, origin, color, strength = 6.0) {
    const [orow, ocol] = origin;
    for (const [r, c] of cells) {
      const tile = this.tiles[r][c];
      const d = Math.hypot(r - orow, c - ocol);
      this.schedule(d * 0.05, () => {
        tile.heightV += strength;
        tile.flash = 0.9;
        tile.flashCol = color;
        this.burst(this.topPos(tile), color, { n: 5, speed: 2.0, life: 0.6, size: 0.08 });
      });
    }
  }

  // ------------------------------------------------------------ actions
  tileOk(t) {
    return t.value === this.solution[t.r][t.c] && !t.wrong;
  }

  place(d, hint = false) {
    this.sounds.unlock();
    if (this.won || !this.sel) return;
    const [r, c] = this.sel;
    const t = this.tiles[r][c];
    if (t.given) {
      t.shake = 0.5;
      this.sounds.play("bump");
      return;
    }
    if (d === 0) {
      if (t.value) {
        t.value = 0;
        t.wrong = false;
        t.heightV -= 3;
        this.burst(this.topPos(t), [120, 130, 200], { n: 8, speed: 1.5, life: 0.5, size: 0.07 });
        this.sounds.play("clear");
      }
      return;
    }
    if (t.value === d && !t.wrong) return;
    t.value = d;
    t.pop = 1.0;
    if (d === this.solution[r][c]) {
      t.wrong = false;
      t.heightV += 5;
      t.flash = 1.0;
      t.flashCol = hint ? SELECT_COL : [120, 255, 240];
      this.burst(this.topPos(t), hint ? SELECT_COL : null, { n: hint ? 30 : 22 });
      this.sounds.play("place", d - 1);
      this.checkUnits(r, c);
      if (this.allTiles.every((x) => this.tileOk(x))) this.win();
    } else {
      t.wrong = true;
      t.shake = 1.0;
      t.flash = 1.0;
      t.flashCol = [255, 40, 60];
      this.mistakes++;
      this.screenShake = 0.35;
      this.redFlash = 0.5;
      this.burst(this.topPos(t), [255, 70, 90], { n: 14, speed: 2.5, life: 0.6, size: 0.09 });
      this.sounds.play("wrong");
    }
  }

  checkUnits(r, c) {
    const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
    const idx = [...Array(9).keys()];
    const units = [idx.map((i) => [r, i]), idx.map((i) => [i, c]),
                   idx.map((i) => [br + Math.floor(i / 3), bc + i % 3])];
    const cols = [[110, 255, 170], [90, 200, 255], [196, 90, 255]];
    let any = false;
    units.forEach((u, i) => {
      if (u.every(([a, b]) => this.tileOk(this.tiles[a][b]))) {
        this.wave(u, [r, c], cols[i]);
        any = true;
      }
    });
    if (any) this.schedule(0.05, () => this.sounds.play("unit"));
  }

  hint() {
    if (this.won) return;
    if (this.sel) {
      const t = this.tiles[this.sel[0]][this.sel[1]];
      if (!t.given && !this.tileOk(t)) {
        this.hints++;
        this.place(this.solution[t.r][t.c], true);
        return;
      }
    }
    const open = this.allTiles.filter((t) => !this.tileOk(t));
    if (open.length) {
      const t = choice(open);
      this.sel = [t.r, t.c];
      this.hints++;
      this.place(this.solution[t.r][t.c], true);
    }
  }

  win() {
    this.won = true;
    this.winT = 0;
    this.sounds.play("win");
    for (const t of this.allTiles) {
      this.schedule(0.3 + (t.r + t.c) * 0.06, () => {
        t.heightV += 9;
        t.flash = 1.0;
        t.flashCol = choice(SPARK_COLORS);
        this.burst(this.topPos(t), null, { n: 4, speed: 3, life: 1.0, size: 0.08 });
      });
    }
    const m = Math.floor(this.elapsed / 60), s = Math.floor(this.elapsed % 60);
    this.el.winStats.textContent =
      `Time ${pad(m)}:${pad(s)}   Mistakes ${this.mistakes}   Hints ${this.hints}`;
    this.el.win.hidden = false;
  }

  moveSel(dr, dc) {
    const [r, c] = this.sel || [4, 4];
    this.sel = [(r + dr + 9) % 9, (c + dc + 9) % 9];
    this.tiles[this.sel[0]][this.sel[1]].heightV += 2;
    this.sounds.play("tick");
  }

  pick(x, y) {
    for (let i = this.drawOrder.length - 1; i >= 0; i--) {
      const t = this.drawOrder[i];
      for (const poly of t.polys) if (pointInPoly(x, y, poly)) return t;
    }
    return null;
  }

  // ------------------------------------------------------------ input
  bindInput() {
    window.addEventListener("resize", () => this.resize());

    window.addEventListener("keydown", (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      this.sounds.unlock();
      const k = ev.key;
      let handled = true;
      if (k >= "1" && k <= "9") this.place(Number(k));
      else if (k === "0" || k === "Backspace" || k === "Delete") this.place(0);
      else if (k === "ArrowUp" || k === "w" || k === "W") this.moveSel(-1, 0);
      else if (k === "ArrowDown" || k === "s" || k === "S") this.moveSel(1, 0);
      else if (k === "ArrowLeft" || k === "a" || k === "A") this.moveSel(0, -1);
      else if (k === "ArrowRight" || k === "d" || k === "D") this.moveSel(0, 1);
      else if (k === "h" || k === "H") this.hint();
      else if (k === "n" || k === "N") this.newGame();
      else if (k === "q" || k === "Q") this.cam.tyaw += Math.PI / 2;
      else if (k === "e" || k === "E") this.cam.tyaw -= Math.PI / 2;
      else if (k === " ") this.cam.reset();
      else if (k === "m" || k === "M") this.toggleMute();
      else handled = false;
      if (handled) ev.preventDefault();
    });

    const cv = this.canvas;
    cv.addEventListener("contextmenu", (ev) => ev.preventDefault());

    cv.addEventListener("pointerdown", (ev) => {
      this.sounds.unlock();
      cv.setPointerCapture(ev.pointerId);
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY,
                                        moved: false, button: ev.button });
      if (this.pointers.size === 2) this.pinchDist = this.pinchDistance();
    });

    cv.addEventListener("pointermove", (ev) => {
      if (ev.pointerType === "mouse") this.mouse = [ev.clientX, ev.clientY];
      const p = this.pointers.get(ev.pointerId);
      if (!p) return;
      const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
      p.x = ev.clientX;
      p.y = ev.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 6) p.moved = true;
      if (this.pointers.size === 2) {
        const d = this.pinchDistance();
        if (this.pinchDist) this.cam.tdist = clamp(this.cam.tdist * this.pinchDist / d, 9, 24);
        this.pinchDist = d;
      } else if (p.moved) {
        this.cam.tyaw -= dx * 0.006;
        this.cam.tpitch = clamp(this.cam.tpitch + dy * 0.004, rad(22), rad(84));
      }
    });

    const end = (ev) => {
      const p = this.pointers.get(ev.pointerId);
      if (!p) return;
      this.pointers.delete(ev.pointerId);
      this.pinchDist = null;
      // A click/tap that did not drag selects a tile.
      if (ev.type === "pointerup" && !p.moved && p.button === 0 && this.pointers.size === 0) {
        const t = this.pick(ev.clientX, ev.clientY);
        if (t) {
          this.sel = [t.r, t.c];
          t.heightV += 2.5;
          this.sounds.play("tick");
        }
      }
      if (this.pointers.size > 0) for (const q of this.pointers.values()) q.moved = true;
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("pointerleave", (ev) => {
      if (ev.pointerType === "mouse") this.mouse = null;
    });

    cv.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const steps = ev.deltaMode === 1 ? ev.deltaY / 3 : ev.deltaY / 100;
      this.cam.tdist = clamp(this.cam.tdist + steps * 0.8, 9, 24);
    }, { passive: false });
  }

  pinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }

  // ------------------------------------------------------------ update
  update(dt) {
    this.t += dt;
    if (!this.won && this.allTiles.every((t) => t.landed)) this.elapsed += dt;
    this.screenShake = Math.max(0, this.screenShake - dt);
    this.redFlash = Math.max(0, this.redFlash - dt * 1.5);
    const s = this.screenShake * 18;
    this.cam.ox = rand(-s, s);
    this.cam.oy = rand(-s, s);
    const [mx, my] = this.mouse ? [this.mouse[0] / this.W, this.mouse[1] / this.H] : [0.5, 0.5];
    this.cam.update(dt, this.t, mx, my);

    for (const e of this.events) e[0] -= dt;
    const due = this.events.filter((e) => e[0] <= 0);
    this.events = this.events.filter((e) => e[0] > 0);
    for (const e of due) e[1]();

    this.hoverTile = this.mouse && this.pointers.size === 0 ? this.pick(this.mouse[0], this.mouse[1]) : null;
    for (const t of this.allTiles) {
      let target = t.baseHeight();
      if (this.sel && this.sel[0] === t.r && this.sel[1] === t.c) target += 0.32 + 0.04 * Math.sin(this.t * 4);
      else if (t === this.hoverTile) target += 0.1;
      if (t.update(dt, target)) {
        this.burst([t.x, 0.05, t.z], [150, 160, 230], { n: 3, speed: 1.5, life: 0.45, size: 0.06, grav: 2, up: 0.5 });
      }
    }

    const drag = 1 - 1.2 * dt;
    this.particles = this.particles.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) return false;
      p.vy -= p.grav * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      return true;
    });

    if (this.won) {
      this.winT += dt;
      this.fireworkTimer -= dt;
      if (this.fireworkTimer <= 0) {
        this.fireworkTimer = rand(0.25, 0.6);
        this.firework();
      }
    }
  }

  // ------------------------------------------------------------ drawing
  isSel(t) {
    return this.sel && this.sel[0] === t.r && this.sel[1] === t.c;
  }

  tileColor(t) {
    let col = t.wrong ? WRONG_COL : t.given ? GIVEN_COL : t.value ? USER_COL : EMPTY_COL;
    if (this.sel) {
      const [sr, sc] = this.sel;
      const st = this.tiles[sr][sc];
      if (this.isSel(t)) col = mix(col, SELECT_COL, 0.55 + 0.1 * Math.sin(this.t * 5));
      else if (st.value && t.value === st.value && !t.wrong) col = mix(col, SAME_COL, 0.5);
      else if (t.r === sr || t.c === sc || ((t.r / 3 | 0) === (sr / 3 | 0) && (t.c / 3 | 0) === (sc / 3 | 0))) {
        col = mix(col, PEER_COL, 0.22);
      }
    }
    if (t === this.hoverTile) col = mix(col, WHITE, 0.12);
    if (t.flash > 0) col = mix(col, t.flashCol, t.flash * 0.8);
    return col;
  }

  fillPoly(poly, color) {
    const g = this.ctx;
    g.beginPath();
    g.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    // a hairline in the same colour hides anti-aliasing seams between faces
    g.strokeStyle = color;
    g.lineWidth = 0.75;
    g.stroke();
  }

  strokePoly(poly, color, width) {
    const g = this.ctx;
    g.beginPath();
    g.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
    g.closePath();
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke();
  }

  drawBox(x0, x1, y0, y1, z0, z1, col) {
    const cam = this.cam;
    const pts = [];
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) pts.push(cam.project(x, y, z));
    const [ex, ey, ez] = cam.eye;
    const polys = [];
    const faces = [[ez < z0, [0, 4, 6, 2], SH_NZ], [ez > z1, [1, 5, 7, 3], SH_PZ],
                   [ex < x0, [0, 1, 3, 2], SH_NX], [ex > x1, [4, 5, 7, 6], SH_PX]];
    for (const [vis, idx, sh] of faces) {
      if (vis) {
        const poly = idx.map((i) => pts[i]);
        this.fillPoly(poly, css(shade(col, sh)));
        polys.push(poly);
      }
    }
    let top = null;
    if (ey > y1) {
      top = [2, 6, 7, 3].map((i) => pts[i]);
      this.fillPoly(top, css(shade(col, SH_TOP)));
      polys.push(top);
    }
    return [top, polys];
  }

  drawGlow(color, x, y, r) {
    if (r < 0.5) return;
    this.ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
  }

  drawBackground() {
    const g = this.ctx, W = this.W, H = this.H;
    if (!this.bgGrad) {
      this.bgGrad = g.createLinearGradient(0, 0, 0, H);
      this.bgGrad.addColorStop(0, css(BG_TOP));
      this.bgGrad.addColorStop(1, css(BG_BOTTOM));
    }
    g.globalCompositeOperation = "source-over";
    g.fillStyle = this.bgGrad;
    g.fillRect(0, 0, W, H);

    g.globalCompositeOperation = "lighter";
    const nr = 260 * Math.max(W / 1280, H / 820);
    for (const [x, y, col, ph] of this.nebulae) {
      const nx = ((x * W + Math.sin(this.t * 0.05 + ph) * 120) % W + W) % W;
      const ny = y * H + Math.cos(this.t * 0.04 + ph) * 60;
      this.drawGlow(col, nx, ny, nr);
    }
    g.globalCompositeOperation = "source-over";
    const shift = this.cam.effYaw * 120;
    const span = W * 2;
    for (const [x, y, b, ph, sp] of this.stars) {
      const tw = 0.55 + 0.45 * Math.sin(this.t * sp + ph);
      const sx = ((x * W - shift * b) % span + span) % span;
      if (sx < W) {
        const c = 255 * b * tw | 0;
        const sy = y * H;
        if (b > 0.85) {
          g.fillStyle = css([c / 3 | 0, c / 3 | 0, c / 2 | 0]);
          g.beginPath();
          g.arc(sx, sy, 2, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = css([c, c, Math.min(255, c + 30)]);
        g.fillRect(sx | 0, sy | 0, 1, 1);
      }
    }
  }

  drawBoard() {
    const g = this.ctx, cam = this.cam;
    // base plate with glowing rim
    const [top] = this.drawBox(-PLATE, PLATE, -0.45, 0, -PLATE, PLATE, PLATE_COL);
    if (top) {
      const pulse = 0.6 + 0.4 * Math.sin(this.t * 1.5);
      g.lineJoin = "round";
      this.strokePoly(top, css(shade(NEON, 0.35 + 0.25 * pulse)), 5);
      this.strokePoly(top, css(mix(NEON, WHITE, 0.3 * pulse)), 1.2);
    }
    // neon box separators on the plate (seen through gaps between tiles)
    const e = 4.5 + BOX_GAP + 0.1;
    g.lineCap = "butt";
    for (const b of [-1.5 - BOX_GAP / 2, 1.5 + BOX_GAP / 2]) {
      for (const [a, bb] of [[[b, 0.01, -e], [b, 0.01, e]], [[-e, 0.01, b], [e, 0.01, b]]]) {
        const p0 = cam.project(...a), p1 = cam.project(...bb);
        for (const [col, w] of [[shade(NEON, 0.45), 6], [mix(NEON, WHITE, 0.5), 2]]) {
          g.beginPath();
          g.moveTo(p0[0], p0[1]);
          g.lineTo(p1[0], p1[1]);
          g.strokeStyle = css(col);
          g.lineWidth = w;
          g.stroke();
        }
      }
    }

    // tiles, far to near
    const order = this.allTiles
      .map((t) => [cam.project(t.x, 0, t.z)[2], t])
      .sort((a, b) => b[0] - a[0])
      .map((p) => p[1]);
    this.drawOrder = order;
    const sq = 0.55 + 0.45 * Math.sin(cam.effPitch);
    const selTile = this.sel ? this.tiles[this.sel[0]][this.sel[1]] : null;
    const selVal = selTile && !selTile.wrong ? selTile.value : 0;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    for (const t of order) {
      if (t.delay > 0) {
        t.polys = [];
        continue;
      }
      const hs = TILE / 2;
      const xo = Math.sin(this.t * 70) * 0.12 * t.shake;
      const y0 = t.drop, y1 = t.drop + t.height;
      const col = this.tileColor(t);
      const [ttop, polys] = this.drawBox(t.x - hs + xo, t.x + hs + xo, y0, y1, t.z - hs, t.z + hs, col);
      t.polys = polys;
      if (ttop) {
        let edge = mix(col, WHITE, 0.45);
        if (this.isSel(t)) {
          edge = mix(SELECT_COL, WHITE, 0.5 + 0.5 * Math.sin(this.t * 6));
          this.strokePoly(ttop, css(edge), 3);
        } else {
          this.strokePoly(ttop, css(edge), 1);
        }
      }
      if (t.value) {
        const [sx, sy, z] = cam.project(t.x + xo, y1 + 0.001, t.z);
        const size = cam.f / z * 0.62 * (1 + 0.45 * t.pop);
        const tc = t.wrong ? TXT_WRONG : selVal && t.value === selVal ? TXT_SAME : t.given ? TXT_GIVEN : TXT_USER;
        // Digit squashed vertically to sit "on" the tilted tile top.
        const fs = size * 0.78;
        g.save();
        g.translate(sx, sy);
        g.scale(1, sq);
        g.font = `bold ${fs.toFixed(1)}px "DejaVu Sans", "Segoe UI", system-ui, sans-serif`;
        const base = fs * 0.36;
        g.fillStyle = "rgb(10,10,30)";
        g.fillText(String(t.value), 2, base + 3 / sq);
        g.fillStyle = css(tc);
        g.fillText(String(t.value), 0, base);
        g.restore();
      }
    }

    // selection halo
    if (selTile && selTile.delay <= 0) {
      const [sx, sy, z] = cam.project(...this.topPos(selTile));
      const r = cam.f / z * (0.9 + 0.1 * Math.sin(this.t * 4));
      g.globalCompositeOperation = "lighter";
      this.drawGlow([90, 66, 20], sx, sy, r);
      g.globalCompositeOperation = "source-over";
    }
  }

  drawParticles() {
    const g = this.ctx, cam = this.cam;
    g.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      const [sx, sy, z] = cam.project(p.x, p.y, p.z);
      if (z <= 0.3) continue;
      const k = p.life / p.maxLife;
      const r = cam.f / z * p.size * (0.5 + k) * 2.2;
      if (r < 1) continue;
      this.drawGlow(quant(shade(p.color, 0.3 + 0.9 * k)), sx, sy, r);
      if (r > 2) {
        g.fillStyle = css(mix(p.color, WHITE, 0.6 * k));
        g.beginPath();
        g.arc(sx, sy, Math.max(1, r * 0.18), 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalCompositeOperation = "source-over";
  }

  draw() {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground();
    this.drawBoard();
    this.drawParticles();
    if (this.redFlash > 0) {
      const v = 90 * this.redFlash | 0;
      g.globalCompositeOperation = "lighter";
      g.fillStyle = css([v, 0, v / 6 | 0]);
      g.fillRect(0, 0, this.W, this.H);
      g.globalCompositeOperation = "source-over";
    }
    this.drawHud();
  }

  // Only touch the DOM when something actually changed.
  setText(key, el, text) {
    if (this.hudCache[key] !== text) {
      this.hudCache[key] = text;
      el.textContent = text;
    }
  }

  drawHud() {
    const m = Math.floor(this.elapsed / 60), s = Math.floor(this.elapsed % 60);
    const counts = new Array(10).fill(0);
    let filled = 0;
    for (const t of this.allTiles) {
      if (this.tileOk(t)) {
        counts[t.value]++;
        filled++;
      }
    }
    this.setText("diff", this.el.diff, this.difficulty);
    this.setText("time", this.el.time, `${pad(m)}:${pad(s)}`);
    this.setText("mistakes", this.el.mistakes, String(this.mistakes));
    this.setText("hints", this.el.hints, String(this.hints));
    this.setText("barLabel", this.el.barLabel, `${filled} / 81`);
    if (this.hudCache.filled !== filled) {
      this.hudCache.filled = filled;
      this.el.bar.style.width = `${filled / 81 * 100}%`;
      this.el.bar.style.background = css(mix(USER_COL, [110, 255, 170], filled / 81));
    }
    const selT = this.sel ? this.tiles[this.sel[0]][this.sel[1]] : null;
    this.numpad.forEach(({ el, sub }, i) => {
      const d = i + 1;
      const left = 9 - counts[d];
      this.setText(`np${d}`, sub, left ? `${left} left` : "done");
      el.classList.toggle("dim", left === 0);
      el.classList.toggle("active", !!(selT && selT.value === d));
    });
    for (const [name, b] of this.diffButtons) b.classList.toggle("active", this.difficulty === name);
  }
}

const pad = (n) => String(n).padStart(2, "0");

// ---------------------------------------------------------------- main loop

const game = new Game(document.getElementById("scene"));
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  game.update(dt);
  game.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
