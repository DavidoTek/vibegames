// LABYRINT.EXE: a Wolfenstein-style raycaster drawn into the 320x200 VGA
// framebuffer. DDA wall casting with thin sliding doors, a push-wall drawn as
// a moving box, billboard sprites with a z-buffer, palette colormap shading.

import { ramp, grey, defaultPalette, sprite } from "../screen.js";
import { glyph } from "../font.js";
import { awardPrize } from "../progress.js";

const MAP = [
  "#####################W##",
  "#@....#.......C....#ssT#",
  "#.....#.#####.C.##.#sss#",
  "#.....D.#...#.C..#.#MsB#",
  "#.....#.#.1.#.C.##.##P##",
  "###.###.#...#.......G..#",
  "#.....#.##D##.####.###.#",
  "#.#.#.#.......#....#...#",
  "#.#.#.#######.#.####.#.#",
  "#.#.#.......#.#......#.#",
  "#.#.#####.#.#.########.#",
  "#...#2....#.#.........G#",
  "###.#######.#.SSSSSS.###",
  "#...........#.S....S...#",
  "#.#########.#.S..K.S.#.#",
  "#.#.......#.#.SS.SSS.#.#",
  "#.#.#####.#.#........#.#",
  "#.#.#..3#.#.##########.#",
  "#.#.#.###.#............#",
  "#.#.#.....#.###L########",
  "#.#.......#.#..........#",
  "#.#.#####.#.#.###.###..#",
  "#4...G....#.#.....G....#",
  "######################X#",
];

const VW = 320, VH = 160, HORIZON = 80, WALL_H = 180;
const SOLID = "#CSDLXPWQ";
const TEX_OF = { "#": 0, C: 1, S: 2, D: 3, L: 4, X: 5, P: 6, W: 7, Q: 6 };
const FONT = { rows: [2, 14] };
const SHADES = 16;

// ---------------------------------------------------------------- assets

let colormap = null;
function buildColormap() {
  const pal = defaultPalette();
  const cm = new Uint8Array(SHADES * 256);
  for (let s = 0; s < SHADES; s++) {
    const k = 1 - s / (SHADES + 2);
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = pal[i].map((v) => v * k);
      let best = 0, bd = 1e9;
      for (let j = 0; j < 248; j++) {
        const [pr, pg, pb] = pal[j];
        const d = (pr - r) ** 2 * 0.3 + (pg - g) ** 2 * 0.59 + (pb - b) ** 2 * 0.11;
        if (d < bd) { bd = d; best = j; }
      }
      cm[s * 256 + i] = best;
    }
  }
  return cm;
}

function rng(seed) {
  return () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) / 16777216;
}

function makeTextures() {
  const T = [];
  const tex = (fn) => { const t = new Uint8Array(32 * 32); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) t[y * 32 + x] = fn(x, y); return t; };
  const r = rng(42);
  const noise = Array.from({ length: 1024 }, () => r());
  const brick = (x, y) => {
    const row = y >> 3, off = row & 1 ? 8 : 0;
    if (y % 8 === 7 || (x + off) % 16 === 15) return grey(5);
    const id = (row * 4 + (((x + off) >> 4) & 3)) % 7;
    return ramp(0, 7 + (id % 3) + (noise[y * 32 + x] > 0.8 ? 1 : 0));
  };
  T[0] = tex(brick);
  T[1] = tex((x, y) => {
    if ((x >= 6 && x <= 15 && y >= 8 && y <= 15) || (x >= 18 && x <= 27 && y >= 19 && y <= 26)) {
      return (x === 6 || x === 15 || x === 18 || x === 27) && y % 2 === 0 ? grey(11) : grey(2);
    }
    if (y === 4 || y === 29 || x === 2 || (x === 22 && y < 19) || (y === 12 && x > 15) || (x === 10 && y > 15)) return ramp(2, 13);
    return ramp(4, 5 + (noise[y * 32 + x] > 0.9 ? 1 : 0));
  });
  T[2] = tex((x, y) => {
    if (x < 2 || x > 29) return grey(3);
    if (y % 8 === 0) return grey(2);
    if (y % 8 === 3 && x > 22 && x < 27 && (x & 1)) return [ramp(4, 16), ramp(0, 15), ramp(2, 16), ramp(8, 16)][(y >> 3) & 3];
    if (y % 8 >= 2 && y % 8 <= 5 && x > 4 && x < 18) return grey(5 + ((x + y) & 1));
    return grey(7);
  });
  T[3] = tex((x, y) => {
    if (x === 0 || x === 31 || y === 0 || y === 31) return ramp(8, 3);
    if (x === 15 || x === 16) return ramp(8, 5);
    if ((x === 3 || x === 28) && y % 6 === 3) return grey(12);
    if (y >= 13 && y <= 18) return ramp(8, 12);
    return ramp(8, 8 + (noise[y * 32 + x] > 0.85 ? 1 : 0));
  });
  T[4] = tex((x, y) => {
    if (x === 0 || x === 31 || y === 0 || y === 31) return ramp(0, 3);
    if (y >= 4 && y <= 9) return ((x + y) >> 2) & 1 ? ramp(2, 15) : grey(1);
    if (x >= 14 && x <= 17 && y >= 16 && y <= 24) return y === 17 || (x >= 15 && x <= 16) ? grey(1) : ramp(0, 8);
    return ramp(0, 8 + (noise[y * 32 + x] > 0.85 ? 1 : 0));
  });
  T[5] = tex((x, y) => {
    if (x < 2 || x > 29 || y < 2 || y > 29) return grey(6);
    if (y >= 9 && y < 21) {
      const ch = "EXIT"[x >> 3];
      const g = glyph(ch);
      if (g[y - 9 + 2] & (0x80 >> (x & 7))) return ramp(4, 17);
    }
    return y % 2 ? ramp(4, 3) : ramp(4, 2);
  });
  T[6] = tex((x, y) => {
    // a little paw print in one brick: the only clue that this wall is special
    const pads = [[20, 18, 2.6], [16, 13, 1.3], [19, 12, 1.3], [22, 12, 1.3], [25, 13, 1.3]];
    for (const [px, py, pr] of pads) if (Math.hypot(x - px, y - py) <= pr) return ramp(0, 5);
    return brick(x, y);
  });
  T[7] = tex((x, y) => {
    if (x >= 3 && x <= 28 && y >= 3 && y <= 28) {
      const line = y < 16 ? "MORT" : "1994";
      const gy = (y < 16 ? y - 4 : y - 17) + 2;
      const gx = x - 0;
      if (gy >= 2 && gy < 14 && gx >= 0 && gx < 32) {
        const g = glyph(line[gx >> 3]);
        if (g[gy] & (0x80 >> (gx & 7))) return ramp(0, 6);
      }
      return ramp(2, 16);
    }
    return brick(x, y);
  });
  return T;
}

const SPR_LEGEND = {
  B: ramp(8, 11), b: ramp(8, 7), s: grey(12), k: grey(1), w: grey(15), W: grey(13), y: ramp(2, 15), Y: ramp(2, 11),
  o: ramp(1, 12), O: ramp(1, 8), g: grey(8), G: grey(10), n: ramp(1, 6), N: ramp(1, 9), e: ramp(4, 16), r: ramp(0, 14), c: grey(4), t: ramp(1, 15),
};

function scaleUp(spr, f = 2) {
  const out = { w: spr.w * f, h: spr.h * f, data: new Uint8Array(spr.w * f * spr.h * f) };
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) out.data[y * out.w + x] = spr.data[Math.floor(y / f) * spr.w + Math.floor(x / f)];
  return out;
}

const art = (a) => scaleUp(sprite(a, SPR_LEGEND));

const DISK = art(`
................
..BBBBBBBBBBBB..
..BBssssssskBB..
..BBsssskssBBB..
..BBsssskssBBB..
..BBssssssssBB..
..BBBBBBBBBBBB..
..BBwwwwwwwwBB..
..BBwkkkkkkwBB..
..BBwwwwwwwwBB..
..BBwkkkkwwwBB..
..BBwwwwwwwwBB..
..bBBBBBBBBBBb..
................
................
................`);

const KEY = art(`
................
................
................
................
..YYYYYYYYYYYY..
..YyyyyyyyyyyY..
..YkkkkkkkkkkY..
..YyyyyyyyyyyY..
..YywwyyyyyyyY..
..YywwyykkkyyY..
..YyyyyyyyyyyY..
..YYYYYYYYYYYY..
................
................
................
................`);

const TUX = art(`
.....kkkkkk.....
....kkkkkkkk....
....kwkkkwkk....
....kwkkkwkk....
....kkyyyykk....
...kkkyyyykkk...
...kkwwwwwwkk...
..kkwwwwwwwwkk..
..kwwwwwwwwwwk..
.kkwwwwwwwwwwkk.
.kkwwwwwwwwwwkk.
..kwwwwwwwwwwk..
..kkwwwwwwwwkk..
...yykkkkkkyy...
..yyyy....yyyy..
................`);

const BYTE = art(`
................
................
................
................
................
................
.....g.g........
....gGgGg.......
....gkGkgggggg..
....gGGGgGGGGgg.
...ggGGGGGGGGGg.
..gGGGGGGGGGGgg.
...ggggggggggg..
.BBBBBBbbBBBBBB.
.BBwwBBbbBBwwBB.
.BBBBBBBBBBBBBB.`);

const DESK = [false, true].map((on) => art(`
................
....WWWWWWWW....
....WkkkkkkW....
....Wk${on ? "ee" : "e."}kkkW....
....WkkkkkkW....
....WWWWWWWW....
......WWWW......
.ttttttttttttt..
.nNNNNNNNNNNNn..
.n...........n..
.n...........n..
.n...........n..
.n...........n..
.n...........n..
.n...........n..
................`));

function glitchFrames() {
  const frames = [];
  for (let f = 0; f < 3; f++) {
    const r = rng(100 + f * 17);
    const s = { w: 32, h: 32, data: new Uint8Array(1024).fill(255) };
    for (let by = 0; by < 8; by++) for (let bx = 0; bx < 8; bx++) {
      const d = Math.hypot(bx - 3.5, by - 4) + r() * 1.5;
      if (d > 4) continue;
      const c = [ramp(10, 14), ramp(6, 15), ramp(0, 13), ramp(4, 15), grey(15)][Math.floor(r() * 5)];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) s.data[(by * 4 + y) * 32 + bx * 4 + x] = c;
    }
    for (const ex of [10, 20]) for (let y = 12; y < 16; y++) for (let x = ex; x < ex + 3; x++) s.data[y * 32 + x] = grey(0);
    frames.push(s);
  }
  return frames;
}

function frozenFrame(fr) {
  const s = { w: 32, h: 32, data: fr.data.map((c) => (c === 255 ? 255 : c === grey(0) ? c : ramp(7, 10))) };
  return s;
}

// ---------------------------------------------------------------- game

export class Labyrint {
  constructor(sys) {
    this.sys = sys;
    this.realtime = true;
    this.s = sys.screen;
    this.g = sys.screen.vga;
    if (!colormap) colormap = buildColormap();
    this.tex = makeTextures();
    this.gfr = glitchFrames();
    this.gfrz = this.gfr.map(frozenFrame);
    this.zbuf = new Float32Array(VW);
    this.phase = "intro";
    this.paused = false;
    this.t = 0;
    this.showMap = false;
    this.msg = null;
    this.load();
  }

  controls() { return { set: "labyrint" }; }

  get music() { return this.phase === "gpf" ? null : "labyrint"; }

  start() {
    this.s.setMode("vga");
    this.s.cursor.on = false;
  }

  stop() { this.sys.unlockPointer(); }

  load() {
    this.map = MAP.map((r) => [...r]);
    this.items = [];
    this.glitches = [];
    this.statics = [];
    this.map.forEach((row, y) => row.forEach((c, x) => {
      const at = { x: x + 0.5, y: y + 0.5 };
      if (c === "@") { this.spawn = at; row[x] = "."; }
      else if (/[1-4]/.test(c)) { this.items.push({ ...at, kind: "disk" }); row[x] = "."; }
      else if (c === "K") { this.items.push({ ...at, kind: "key" }); row[x] = "."; }
      else if (c === "G") { this.glitches.push({ ...at, sx: at.x, sy: at.y, dir: Math.floor(Math.random() * 4), frozen: 0, cool: 0 }); row[x] = "."; }
      else if (c === "T") { this.statics.push({ ...at, spr: TUX, size: 0.75 }); row[x] = "s"; }
      else if (c === "B") { this.statics.push({ ...at, spr: BYTE, size: 0.55 }); row[x] = "s"; }
      else if (c === "M") { this.statics.push({ ...at, spr: DESK, size: 0.7, anim: true }); row[x] = "s"; }
      else if (c === "P") this.push = { x, y, dx: 0, dy: 0, off: 0, moving: false };
    }));
    this.doors = new Map();
    this.map.forEach((row, y) => row.forEach((c, x) => {
      if (c === "D" || c === "L") {
        const horiz = SOLID.includes(this.map[y][x - 1]) && SOLID.includes(this.map[y][x + 1]);
        this.doors.set(y * 24 + x, { open: 0, opening: false, horiz, locked: c === "L" });
      }
    }));
    this.disks = 0;
    this.hasKey = false;
    this.secret = false;
    this.health = 100;
    this.hurt = 0;
    this.zapCool = 0;
    this.beam = 0;
    this.resetPlayer();
  }

  resetPlayer() {
    this.px = this.spawn.x; this.py = this.spawn.y; this.ang = 0;
    this.health = 100;
    for (const gl of this.glitches) { gl.x = gl.sx; gl.y = gl.sy; gl.frozen = 0; gl.cool = 1; }
  }

  cell(x, y) { return (this.map[y | 0] || [])[x | 0] || "#"; }

  solidAt(x, y) {
    const c = this.cell(x, y);
    if (c === "D" || c === "L") return this.doors.get((y | 0) * 24 + (x | 0)).open < 0.85;
    if (SOLID.includes(c)) return true;
    const p = this.push;
    if (p && p.moving) {
      const bx = p.x + p.dx * p.off, by = p.y + p.dy * p.off;
      if (x >= bx && x < bx + 1 && y >= by && y < by + 1) return true;
    }
    return false;
  }

  free(x, y, r = 0.22) {
    return !this.solidAt(x - r, y - r) && !this.solidAt(x + r, y - r) && !this.solidAt(x - r, y + r) && !this.solidAt(x + r, y + r);
  }

  slide(o, dx, dy, r) {
    if (this.free(o.x + dx, o.y, r)) o.x += dx;
    if (this.free(o.x, o.y + dy, r)) o.y += dy;
  }

  los(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.2);
    for (let i = 1; i < n; i++) if (this.solidAt(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n)) return false;
    return true;
  }

  say(text, t = 2.5) { this.msg = { text, t }; }

  // ---------------------------------------------------------------- update

  update(dt) {
    this.t += dt;
    if (this.msg) { this.msg.t -= dt; if (this.msg.t <= 0) this.msg = null; }
    if (this.phase !== "play" || this.paused) return;
    const held = (k) => this.sys.held(k);
    const stick = this.sys.stick();
    let fwd = (held("ArrowUp") || held("w") ? 1 : 0) - (held("ArrowDown") || held("s") ? 1 : 0);
    let turn = (held("ArrowRight") || held("d") ? 1 : 0) - (held("ArrowLeft") || held("a") ? 1 : 0);
    const strafe = (held("e") ? 1 : 0) - (held("q") ? 1 : 0);
    if (stick) { fwd -= stick.y; turn += stick.x * 0.85; }
    this.ang += turn * 2.4 * dt;
    const ca = Math.cos(this.ang), sa = Math.sin(this.ang);
    const sp = 3 * dt;
    const me = { x: this.px, y: this.py };
    this.slide(me, (ca * fwd - sa * strafe) * sp, (sa * fwd + ca * strafe) * sp, 0.22);
    this.px = me.x; this.py = me.y;

    for (const d of this.doors.values()) if (d.opening && d.open < 1) d.open = Math.min(1, d.open + dt * 1.6);
    const p = this.push;
    if (p && p.moving) {
      p.off = Math.min(2, p.off + dt * 0.9);
      if (p.off >= 2) {
        p.moving = false;
        this.map[p.y + p.dy * 2][p.x + p.dx * 2] = "Q";
        this.push = null;
      }
    }

    for (const it of this.items) {
      if (it.got || Math.hypot(it.x - this.px, it.y - this.py) > 0.5) continue;
      it.got = true;
      if (it.kind === "disk") {
        this.disks++;
        this.say(this.disks === 4 ? "All 4 disks! Find the exit terminal." : `Floppy disk! ${this.disks}/4`);
        this.sys.audio.tune([[784, 0.07], [1047, 0.1]]);
      } else {
        this.hasKey = true;
        this.say("Key card! It opens the red door.");
        this.sys.audio.tune([[660, 0.07], [880, 0.07], [1320, 0.1]]);
      }
    }

    if (!this.secret && this.cell(this.px, this.py) === "s") {
      this.secret = true;
      this.health = 100;
      for (const gl of this.glitches) gl.frozen = Math.max(gl.frozen, 3);
      this.say("LABYRINT by Mort, 1994. Thanks for playing! (health restored)", 6);
      this.sys.audio.tune([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.12], [1319, 0.3]], { type: "triangle", vol: 0.07 });
      this.sys.secret("labyrint");
    }

    this.zapCool = Math.max(0, this.zapCool - dt);
    this.beam = Math.max(0, this.beam - dt);
    this.hurt = Math.max(0, this.hurt - dt);
    this.updateGlitches(dt);
  }

  updateGlitches(dt) {
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    for (const gl of this.glitches) {
      gl.cool = Math.max(0, gl.cool - dt);
      if (gl.frozen > 0) { gl.frozen -= dt; continue; }
      const dx = this.px - gl.x, dy = this.py - gl.y, d = Math.hypot(dx, dy);
      if (d < 7 && this.los(gl.x, gl.y, this.px, this.py)) {
        const sp = 1.7 * dt;
        this.slide(gl, (dx / d) * sp, (dy / d) * sp, 0.3);
      } else {
        const [mx, my] = dirs[gl.dir];
        const before = { x: gl.x, y: gl.y };
        this.slide(gl, mx * dt, my * dt, 0.3);
        if ((before.x === gl.x && before.y === gl.y) || Math.random() < dt * 0.3) gl.dir = Math.floor(Math.random() * 4);
      }
      if (d < 0.55 && gl.cool <= 0) {
        gl.cool = 1.4;
        this.health -= 25;
        this.hurt = 0.6;
        this.sys.audio.noise(0.25, { freq: 400, q: 0.8, vol: 0.2 });
        this.sys.audio.tone(140, 0.25, { vol: 0.06, slide: 70 });
        this.slide(gl, (-dx / (d || 1)) * 0.8, (-dy / (d || 1)) * 0.8, 0.3);
        if (this.health <= 0) { this.health = 0; this.phase = "gpf"; this.sys.audio.tone(110, 0.8, { vol: 0.07 }); }
      }
    }
  }

  // What is right in front of the player (up to ~1.6 tiles)?
  facing() {
    const ca = Math.cos(this.ang), sa = Math.sin(this.ang);
    for (let d = 0.3; d < 1.7; d += 0.1) {
      const x = this.px + ca * d, y = this.py + sa * d, c = this.cell(x, y);
      if (SOLID.includes(c)) return { c, x: x | 0, y: y | 0 };
    }
    return null;
  }

  use() {
    const f = this.facing();
    if (!f) return;
    if (f.c === "D" || f.c === "L") {
      const d = this.doors.get(f.y * 24 + f.x);
      if (d.locked && !this.hasKey) { this.say("Locked. You need a key card."); this.sys.audio.error(); return; }
      if (!d.opening) { d.opening = true; this.sys.audio.noise(0.6, { freq: 300, q: 1, vol: 0.12 }); }
    } else if (f.c === "X") {
      if (this.disks < 4) { this.say(`EXIT TERMINAL: INSERT 4 DISKS (${this.disks}/4)`); this.sys.audio.error(); return; }
      this.phase = "win";
      this.sys.unlockPointer();
      this.sys.audio.tune([[392, 0.12], [523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]]);
    } else if (f.c === "P" && this.push && !this.push.moving) {
      const ca = Math.cos(this.ang), sa = Math.sin(this.ang);
      const p = this.push;
      if (Math.abs(ca) > Math.abs(sa)) { p.dx = Math.sign(ca); p.dy = 0; } else { p.dx = 0; p.dy = Math.sign(sa); }
      if (SOLID.includes(this.cell(p.x + p.dx + 0.5, p.y + p.dy + 0.5)) || SOLID.includes(this.cell(p.x + p.dx * 2 + 0.5, p.y + p.dy * 2 + 0.5))) {
        this.say("The wall wobbles, but won't move this way.");
        return;
      }
      this.map[p.y][p.x] = ".";
      p.moving = true;
      this.sys.audio.grind();
      this.say("The wall slides back...");
    } else this.sys.audio.tone(90, 0.06, { vol: 0.05 });
  }

  zap() {
    if (this.zapCool > 0) return;
    this.zapCool = 0.7;
    this.beam = 0.14;
    this.beamTarget = null;
    this.sys.audio.tone(1400, 0.15, { type: "sawtooth", vol: 0.04, slide: 300 });
    let best = null;
    for (const gl of this.glitches) {
      const dx = gl.x - this.px, dy = gl.y - this.py, d = Math.hypot(dx, dy);
      let da = Math.atan2(dy, dx) - this.ang;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (d < 9 && Math.abs(da) < 0.16 + 0.3 / d && this.los(this.px, this.py, gl.x, gl.y) && (!best || d < best.d)) best = { gl, d };
    }
    if (best) {
      best.gl.frozen = 6;
      this.beamTarget = best.gl;
      this.sys.audio.tone(300, 0.3, { type: "square", vol: 0.04, at: 0.05, slide: 1200 });
    }
  }

  proceed() {
    if (this.phase === "intro") this.phase = "play";
    else if (this.phase === "gpf") { this.resetPlayer(); this.phase = "play"; }
    else if (this.phase === "win") {
      const lines = awardPrize(this.sys.fs, "C:\\GAMES\\LABYRINT", "PANES.KRN", "PANES.KRN - the PANES 1.0 kernel");
      this.sys.exit({ lines: ["You escaped LABYRINT!", ...lines] });
    }
  }

  key(ev) {
    if (ev.type !== "down") return;
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if (this.paused) {
      if (k === "y" || k === "Enter") this.sys.exit();
      else if (k === "n" || k === "Escape") this.paused = false;
      return;
    }
    if (k === "Escape") { this.paused = true; this.sys.unlockPointer(); return; }
    if (this.phase !== "play") { if (k.length === 1 || k === "Enter") this.proceed(); return; }
    if (k === " " || k === "Enter") this.use();
    else if (k === "f" || k === "Control") this.zap();
    else if (k === "m" || k === "Tab") this.showMap = !this.showMap;
  }

  pointer(ev) {
    if (ev.type === "move" && ev.locked) this.ang += ev.dx * 0.004;
    if (ev.type === "click") {
      if (this.paused) { this.paused = false; return; }
      if (this.phase !== "play") return this.proceed();
      if (ev.pointerType === "mouse") {
        if (!ev.locked) this.sys.lockPointer();
        else this.zap();
      }
    }
  }

  // ---------------------------------------------------------------- render

  draw() {
    const g = this.g;
    if (this.phase === "gpf") return this.drawGpf();
    this.drawView();
    this.drawHud();
    if (this.showMap) this.drawMap();
    const lines = {
      intro: ["L A B Y R I N T  3D", "", "Find the 4 floppy disks", "and reach the exit terminal.", "", "Space: use / doors", "F: zap a glitch   M: map", "", "Press any key"],
      win: ["YOU ESCAPED!", "", "Mort's prize:", "PANES.KRN", "", "Press any key"],
    }[this.phase];
    if (this.paused) this.box(["Quit to DOS?", "(Y/N)"], 70);
    else if (lines) this.box(lines, 80);
    else if (this.msg) {
      const rows = [];
      for (const word of this.msg.text.split(" ")) {
        if (rows.length && (rows[rows.length - 1] + " " + word).length <= 38) rows[rows.length - 1] += " " + word;
        else rows.push(word);
      }
      g.rect(0, 2, 320, rows.length * 12 + 2, grey(0));
      rows.forEach((r, i) => g.text(Math.max(0, Math.round(160 - (r.length * 8) / 2)), 3 + i * 12, r, ramp(2, 17), FONT));
    }
    this.s.dirty = true;
  }

  drawView() {
    const g = this.g, d = g.data;
    const ca = Math.cos(this.ang), sa = Math.sin(this.ang);
    const planeX = -sa * 0.66, planeY = ca * 0.66;
    // floor and ceiling: flat colours, distance-shaded with ordered dithering
    const bayer = [0, 0.5, 0.75, 0.25];
    const ceil = ramp(8, 6), floor = grey(9);
    for (let y = 0; y < VH; y++) {
      const dy = Math.abs(y - HORIZON + 0.5);
      const dist = WALL_H / 2 / dy;
      const s = Math.min(SHADES - 1.01, dist * 1.4);
      const lv = Math.floor(s), fr = s - lv;
      const base = y < HORIZON ? ceil : floor;
      const c0 = colormap[lv * 256 + base], c1 = colormap[Math.min(SHADES - 1, lv + 1) * 256 + base];
      const row = y * 320;
      for (let x = 0; x < VW; x++) d[row + x] = bayer[(x & 1) + ((y & 1) << 1)] < fr ? c1 : c0;
    }
    const p = this.push && this.push.moving ? this.push : null;
    for (let x = 0; x < VW; x++) {
      const cam = (2 * x) / VW - 1;
      const rdx = ca + planeX * cam, rdy = sa + planeY * cam;
      let mx = this.px | 0, my = this.py | 0;
      const ddx = Math.abs(1 / rdx), ddy = Math.abs(1 / rdy);
      const stx = rdx < 0 ? -1 : 1, sty = rdy < 0 ? -1 : 1;
      let sdx = rdx < 0 ? (this.px - mx) * ddx : (mx + 1 - this.px) * ddx;
      let sdy = rdy < 0 ? (this.py - my) * ddy : (my + 1 - this.py) * ddy;
      let dist = 30, u = 0, tex = 0, side = 0;
      for (let i = 0; i < 64; i++) {
        if (sdx < sdy) { sdx += ddx; mx += stx; side = 0; } else { sdy += ddy; my += sty; side = 1; }
        const c = this.cell(mx, my);
        if (c === "D" || c === "L") {
          const door = this.doors.get(my * 24 + mx);
          let t, along;
          if (!door.horiz) { t = (mx + 0.5 - this.px) / rdx; along = this.py + t * rdy; if ((along | 0) !== my) continue; along -= my; }
          else { t = (my + 0.5 - this.py) / rdy; along = this.px + t * rdx; if ((along | 0) !== mx) continue; along -= mx; }
          if (along < door.open) continue;
          dist = t; u = along - door.open; tex = TEX_OF[c]; side = door.horiz ? 1 : 0;
          break;
        }
        if (SOLID.includes(c)) {
          dist = side === 0 ? sdx - ddx : sdy - ddy;
          u = side === 0 ? this.py + dist * rdy : this.px + dist * rdx;
          u -= Math.floor(u);
          if ((side === 0 && rdx > 0) || (side === 1 && rdy < 0)) u = 1 - u;
          tex = TEX_OF[c];
          break;
        }
      }
      if (p) {
        // moving push-wall: intersect the ray with the block's box
        const bx0 = p.x + p.dx * p.off, by0 = p.y + p.dy * p.off;
        const tx1 = (bx0 - this.px) / rdx, tx2 = (bx0 + 1 - this.px) / rdx;
        const ty1 = (by0 - this.py) / rdy, ty2 = (by0 + 1 - this.py) / rdy;
        const tnx = Math.min(tx1, tx2), tny = Math.min(ty1, ty2);
        const tmin = Math.max(tnx, tny), tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2));
        if (tmax >= tmin && tmin > 0 && tmin < dist) {
          dist = tmin;
          side = tnx > tny ? 0 : 1;
          u = side === 0 ? this.py + tmin * rdy - by0 : this.px + tmin * rdx - bx0;
          tex = 6;
        }
      }
      this.zbuf[x] = dist;
      const lh = WALL_H / dist;
      const top = HORIZON - lh / 2;
      const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(VH, Math.ceil(HORIZON + lh / 2));
      const T = this.tex[tex];
      const tx = Math.min(31, Math.floor(u * 32));
      const shade = Math.min(SHADES - 1, Math.floor(dist * 1.4) + side * 2) * 256;
      for (let y = y0; y < y1; y++) {
        const ty = Math.min(31, Math.floor(((y - top) / lh) * 32));
        d[y * 320 + x] = colormap[shade + T[ty * 32 + tx]];
      }
    }
    this.drawSprites(ca, sa, planeX, planeY);
    // zap beam
    if (this.beam > 0) {
      let tx = 160, ty = 80;
      if (this.beamTarget) {
        const pr = this.project(this.beamTarget.x, this.beamTarget.y, ca, sa, planeX, planeY);
        if (pr) { tx = pr.sx; ty = HORIZON; }
      }
      for (let o = -1; o <= 1; o++) g.line(160 + o, VH - 1, tx + o, ty, ramp(6, 17 - Math.abs(o) * 3));
    }
    // hurt: a red frame that fades out (no full-screen flash)
    if (this.hurt > 0) {
      const w = Math.round(this.hurt * 10);
      const c = ramp(0, 12);
      g.rect(0, 0, VW, w, c); g.rect(0, VH - w, VW, w, c); g.rect(0, 0, w, VH, c); g.rect(VW - w, 0, w, VH, c);
    }
  }

  project(wx, wy, ca, sa, planeX, planeY) {
    const sx = wx - this.px, sy = wy - this.py;
    const inv = 1 / (planeX * sa - ca * planeY);
    const tX = inv * (sa * sx - ca * sy);
    const tY = inv * (-planeY * sx + planeX * sy);
    if (tY <= 0.1) return null;
    return { sx: Math.round((VW / 2) * (1 + tX / tY)), depth: tY };
  }

  drawSprites(ca, sa, planeX, planeY) {
    const list = [];
    const bob = Math.sin(this.t * 3) * 0.04;
    for (const it of this.items) if (!it.got) list.push({ x: it.x, y: it.y, spr: it.kind === "disk" ? DISK : KEY, size: 0.4, lift: 0.25 + bob });
    for (const gl of this.glitches) {
      const fr = gl.frozen > 0 ? this.gfrz[0] : this.gfr[Math.floor(this.t * 8 + gl.sx) % 3];
      list.push({ x: gl.x, y: gl.y, spr: fr, size: 0.6, lift: 0.15 + (gl.frozen > 0 ? 0 : Math.sin(this.t * 5 + gl.sx) * 0.05) });
    }
    for (const st of this.statics) list.push({ x: st.x, y: st.y, spr: st.anim ? st.spr[Math.floor(this.t * 2) & 1] : st.spr, size: st.size, lift: 0 });
    const g = this.g.data;
    const pr = list.map((o) => ({ o, p: this.project(o.x, o.y, ca, sa, planeX, planeY) })).filter((e) => e.p).sort((a, b) => b.p.depth - a.p.depth);
    for (const { o, p } of pr) {
      const lh = WALL_H / p.depth;
      const h = lh * o.size, w = h * 1.15;
      const bottom = HORIZON + lh / 2 - o.lift * lh;
      const top = bottom - h;
      const left = p.sx - w / 2;
      const shade = Math.min(SHADES - 1, Math.floor(p.depth * 1.4)) * 256;
      const x0 = Math.max(0, Math.ceil(left)), x1 = Math.min(VW, Math.ceil(left + w));
      const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(VH, Math.ceil(bottom));
      for (let x = x0; x < x1; x++) {
        if (this.zbuf[x] < p.depth) continue;
        const tx = Math.min(o.spr.w - 1, Math.floor(((x - left) / w) * o.spr.w));
        for (let y = y0; y < y1; y++) {
          const c = o.spr.data[Math.min(o.spr.h - 1, Math.floor(((y - top) / h) * o.spr.h)) * o.spr.w + tx];
          if (c !== 255) g[y * 320 + x] = colormap[shade + c];
        }
      }
    }
  }

  drawHud() {
    const g = this.g;
    g.rect(0, VH, 320, 40, grey(6));
    g.rect(0, VH, 320, 1, grey(11));
    g.rect(0, 199, 320, 1, grey(2));
    g.text(8, 164, "DISKS", grey(14), FONT);
    for (let i = 0; i < 4; i++) {
      const x = 8 + i * 13, y = 180;
      if (i < this.disks) { g.rect(x, y, 10, 11, ramp(8, 11)); g.rect(x + 2, y + 6, 6, 4, grey(15)); g.rect(x + 3, y + 1, 4, 3, grey(12)); }
      else g.frame(x, y, 10, 11, grey(3));
    }
    g.text(70, 164, "HEALTH", grey(14), FONT);
    g.rect(70, 182, 62, 8, grey(2));
    const hc = this.health > 50 ? ramp(4, 13) : this.health > 25 ? ramp(2, 14) : ramp(0, 13);
    g.rect(71, 183, Math.round(this.health * 0.6), 6, hc);
    this.drawFace(148, 165);
    g.text(186, 164, "KEY", grey(14), FONT);
    if (this.hasKey) { g.rect(188, 181, 18, 10, ramp(2, 15)); g.rect(190, 184, 14, 2, grey(1)); }
    else g.frame(188, 181, 18, 10, grey(3));
    g.text(226, 164, "ZAP", this.zapCool > 0 ? grey(3) : ramp(6, 17), FONT);
    g.rect(226, 182, 24, 8, grey(2));
    g.rect(227, 183, Math.round(22 * (1 - this.zapCool / 0.7)), 6, ramp(6, 14));
    g.text(262, 164, "M=MAP", grey(10), FONT);
    g.text(262, 180, "ESC", grey(10), FONT);
  }

  // Mort's face, Doom-style: reacts to health and damage.
  drawFace(x, y) {
    const g = this.g;
    const skin = ramp(1, 14), dark = grey(1);
    g.rect(x + 4, y, 16, 3, grey(4));               // hair
    g.rect(x + 3, y + 3, 18, 20, skin);
    g.rect(x + 2, y + 2, 20, 4, grey(4));
    g.rect(x + 1, y + 9, 2, 6, skin); g.rect(x + 21, y + 9, 2, 6, skin);
    // glasses
    g.frame(x + 5, y + 8, 6, 5, dark); g.frame(x + 13, y + 8, 6, 5, dark); g.rect(x + 11, y + 10, 2, 1, dark);
    const look = Math.floor(this.t * 0.7) % 3 - 1;
    g.rect(x + 7 + look, y + 10, 2, 2, dark); g.rect(x + 15 + look, y + 10, 2, 2, dark);
    g.rect(x + 11, y + 13, 2, 3, ramp(1, 11));
    if (this.hurt > 0) { g.rect(x + 9, y + 17, 6, 4, dark); g.rect(x + 10, y + 18, 4, 2, ramp(0, 9)); }
    else if (this.health > 50) { g.rect(x + 8, y + 18, 8, 1, dark); g.pix(x + 7, y + 17, dark); g.pix(x + 16, y + 17, dark); }
    else if (this.health > 25) g.rect(x + 8, y + 18, 8, 1, dark);
    else { g.rect(x + 8, y + 18, 8, 1, dark); g.pix(x + 7, y + 19, dark); g.pix(x + 16, y + 19, dark); }
  }

  drawMap() {
    const g = this.g;
    const S = 5, ox = 100, oy = 14;
    g.rect(ox - 4, oy - 4, 24 * S + 8, 24 * S + 8, grey(0));
    g.frame(ox - 4, oy - 4, 24 * S + 8, 24 * S + 8, grey(8));
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      let c = this.map[y][x];
      if (!this.secret && (c === "s" || c === "W")) c = "#";
      if (!this.secret && c === "P") c = "#";
      let col = null;
      if (c === "D") col = ramp(8, 10);
      else if (c === "L") col = ramp(0, 12);
      else if (c === "X") col = ramp(4, 16);
      else if (SOLID.includes(c)) col = grey(9);
      if (col !== null) g.rect(ox + x * S, oy + y * S, S, S, col);
    }
    for (const it of this.items) if (!it.got) g.rect(ox + it.x * S - 1, oy + it.y * S - 1, 3, 3, it.kind === "disk" ? ramp(8, 16) : ramp(2, 16));
    for (const gl of this.glitches) g.rect(ox + gl.x * S - 1, oy + gl.y * S - 1, 3, 3, gl.frozen > 0 ? ramp(7, 12) : ramp(10, 14));
    const px = ox + this.px * S, py = oy + this.py * S;
    g.line(px, py, px + Math.cos(this.ang) * 6, py + Math.sin(this.ang) * 6, ramp(2, 17));
    g.rect(px - 1, py - 1, 3, 3, grey(15));
  }

  drawGpf() {
    const g = this.g;
    g.clear(ramp(8, 5));
    const lines = ["", " LABYRINT", "", " A GENERAL PROTECTION FAULT", " has occurred in module", " GLITCH.DRV at 0023:1994.", "", " Your health ran out.", " Your disks are safe.", "", " Press any key to restart", " the maze."];
    g.rect(20, 36, 280, 4, grey(15));
    lines.forEach((l, i) => g.text(28, 46 + i * 12, l, grey(15), FONT));
    this.s.dirty = true;
  }

  box(lines, cy) {
    const g = this.g;
    const w = Math.max(...lines.map((l) => l.length)) * 8 + 16, h = lines.length * 12 + 10;
    const x = Math.round(160 - w / 2), y = Math.round(cy - h / 2);
    g.rect(x, y, w, h, grey(1));
    g.frame(x, y, w, h, ramp(0, 12));
    lines.forEach((l, i) => g.text(Math.round(160 - (l.length * 8) / 2), y + 5 + i * 12, l, i === 0 ? ramp(2, 17) : grey(14), FONT));
  }
}
