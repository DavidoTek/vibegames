// BRIXX.EXE: breakout in VGA mode 13h (320x200, 256 colours).

import { ramp, grey } from "../screen.js";
import { awardPrize } from "../progress.js";

const BX = 4, BY = 26, BW = 12, BH = 6, COLS_N = 26;
const TOP = 15, LEFT = 4, RIGHT = 316, PY = 186, PH = 5;
const FONT = { rows: [2, 14] };
const HUE = { r: 0, o: 1, y: 2, g: 4, c: 6, b: 8, p: 10, m: 11 };

const LETTERS = {
  P: ["####", "#..#", "#..#", "####", "#...", "#...", "#..."],
  A: [".##.", "#..#", "#..#", "####", "#..#", "#..#", "#..#"],
  N: ["#..#", "##.#", "##.#", "#.##", "#.##", "#..#", "#..#"],
  E: ["####", "#...", "#...", "###.", "#...", "#...", "####"],
  S: [".###", "#...", "#...", ".##.", "...#", "...#", "###."],
};

function panesLevel() {
  const colours = { P: "r", A: "g", N: "b", E: "y", S: "w" };
  const rows = ["..........................", ".........................."];
  for (let r = 0; r < 7; r++) {
    let s = ".";
    for (const L of "PANES") s += LETTERS[L][r].replace(/#/g, colours[L]) + ".";
    rows.push(s);
  }
  rows.push("..........................");
  rows.push("..#....#....#....#....#...");
  return rows;
}

const LEVELS = [
  [
    "..........................",
    "...rrrrrrrrrrrrrrrrrrrr...",
    "...oooooooooooooooooooo...",
    "...yyyyyyyyyyyyyyyyyyyy...",
    "...gggggggggggggggggggg...",
    "...cccccccccccccccccccc...",
  ],
  [
    "....nn..............nn....",
    "...n.Pn............nP.n...",
    "...n..nnnnnnnnnnnnnn..n...",
    "..n....................n..",
    "..n...GGG........GGG...n..",
    "..n...GkG........GkG...n..",
    "..n....................n..",
    "ww.n........PP........n.ww",
    "...n.......wkkw.......n...",
    "ww..n................n..ww",
    "......nnnnnnnnnnnnnn......",
  ],
  panesLevel(),
];

const BRICK = {
  n: { c: (s) => grey(Math.round(s * 0.55) + 2) },
  w: { c: (s) => grey(Math.round(s * 0.8) + 2) },
  k: { c: (s) => grey(Math.round(s * 0.2)) },
  G: { c: (s) => ramp(4, s + 2) },
  P: { c: (s) => ramp(11, s + 3) },
  "#": { c: (s) => grey(Math.round(s * 0.65) + 3), hits: 2 },
};

function brickColour(type, shade) {
  if (BRICK[type]) return BRICK[type].c(shade);
  return ramp(HUE[type] ?? 0, shade);
}

export class Brixx {
  constructor(sys) {
    this.sys = sys;
    this.realtime = true;
    this.s = sys.screen;
    this.b = sys.screen.vga;
    this.level = 0;
    this.score = 0;
    this.phase = "intro";
    this.paused = false;
    this.t = 0;
    this.msg = null;
  }

  controls() { return { set: "brixx" }; }

  get music() { return "brixx"; }

  start() {
    this.s.setMode("vga");
    this.s.cursor.on = false;
    this.lives = 3;
    this.setup();
  }

  setup() {
    this.bricks = [];
    LEVELS[this.level].forEach((row, r) => {
      for (let c = 0; c < COLS_N; c++) {
        const t = row[c];
        if (t && t !== ".") this.bricks.push({ r, c, t, hits: (BRICK[t] && BRICK[t].hits) || 1 });
      }
    });
    this.grid = new Map(this.bricks.map((b) => [b.r * COLS_N + b.c, b]));
    this.px = 160;
    this.pw = 36;
    this.wideT = 0;
    this.slowT = 0;
    this.caps = [];
    this.speed = 120;
    this.resetBall();
  }

  resetBall() {
    this.balls = [{ x: this.px, y: PY - 3, vx: 0, vy: 0, stuck: true }];
  }

  launch() {
    for (const b of this.balls) {
      if (!b.stuck) continue;
      const a = (Math.random() - 0.5) * 0.9;
      b.vx = Math.sin(a); b.vy = -Math.cos(a); b.stuck = false;
    }
  }

  brickAt(x, y) {
    const c = Math.floor((x - BX) / BW), r = Math.floor((y - BY) / BH);
    if (c < 0 || c >= COLS_N || r < 0) return null;
    return this.grid.get(r * COLS_N + c) || null;
  }

  hit(br) {
    br.hits--;
    this.sys.audio.tone(br.hits > 0 ? 300 : 500 + br.r * 30, 0.04, { vol: 0.045 });
    if (br.hits > 0) { br.t = "w"; return; }
    this.grid.delete(br.r * COLS_N + br.c);
    this.bricks.splice(this.bricks.indexOf(br), 1);
    this.score += 10 * (this.level + 1);
    if (Math.random() < 0.12) {
      const kinds = ["W", "S", "M"];
      this.caps.push({ x: BX + br.c * BW + 1, y: BY + br.r * BH, k: kinds[Math.floor(Math.random() * 3)] });
    }
    if (!this.bricks.length) {
      this.phase = this.level === 2 ? "win" : "clear";
      this.sys.audio.tune([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.3]]);
    }
  }

  update(dt) {
    this.t += dt;
    // slow palette cycling on the border colours (248-255)
    const off = Math.floor(this.t * 6);
    for (let i = 0; i < 8; i++) {
      const v = 0.5 + 0.5 * Math.sin(((i + off) / 8) * Math.PI * 2);
      this.s.setColor(248 + i, 60 + v * 80, 70 + v * 90, 160 + v * 95);
    }
    if (this.phase !== "play" || this.paused) return;
    const held = (k) => this.sys.held(k);
    const move = (held("ArrowRight") || held("d") ? 1 : 0) - (held("ArrowLeft") || held("a") ? 1 : 0);
    this.px += move * 230 * dt;
    this.wideT = Math.max(0, this.wideT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.pw = this.wideT > 0 ? 56 : 36;
    this.px = Math.max(LEFT + this.pw / 2, Math.min(RIGHT - this.pw / 2, this.px));
    if (this.msg) { this.msg.t -= dt; if (this.msg.t <= 0) this.msg = null; }

    for (const c of this.caps) {
      c.y += 45 * dt;
      if (c.y + 6 >= PY && c.y <= PY + PH && c.x + 10 >= this.px - this.pw / 2 && c.x <= this.px + this.pw / 2) {
        c.dead = true;
        this.sys.audio.tune([[880, 0.06], [1175, 0.08]]);
        if (c.k === "W") { this.wideT = 15; this.msg = { text: "WIDE PADDLE!", t: 1.5 }; }
        if (c.k === "S") { this.slowT = 10; this.msg = { text: "SLOW BALL!", t: 1.5 }; }
        if (c.k === "M") {
          const src = this.balls.find((b) => !b.stuck) || this.balls[0];
          for (const a of [-0.5, 0.5]) {
            const ang = Math.atan2(src.vx, -src.vy) + a;
            this.balls.push({ x: src.x, y: src.y, vx: Math.sin(ang), vy: -Math.cos(ang), stuck: false });
          }
          this.msg = { text: "MULTI BALL!", t: 1.5 };
        }
      }
      if (c.y > 200) c.dead = true;
    }
    this.caps = this.caps.filter((c) => !c.dead);

    const speed = this.speed * (this.slowT > 0 ? 0.65 : 1);
    for (const b of this.balls) {
      if (b.stuck) { b.x = this.px; b.y = PY - 3; continue; }
      let dist = speed * dt;
      while (dist > 0 && !b.lost && this.phase === "play") {
        const st = Math.min(1, dist);
        dist -= st;
        b.x += b.vx * st;
        if (b.x < LEFT + 1.5) { b.x = LEFT + 1.5; b.vx = Math.abs(b.vx); }
        if (b.x > RIGHT - 1.5) { b.x = RIGHT - 1.5; b.vx = -Math.abs(b.vx); }
        let br = this.brickAt(b.x + Math.sign(b.vx) * 1.5, b.y);
        if (br) { b.x -= b.vx * st; b.vx = -b.vx; this.hit(br); }
        b.y += b.vy * st;
        if (b.y < TOP + 1.5) { b.y = TOP + 1.5; b.vy = Math.abs(b.vy); }
        br = this.brickAt(b.x, b.y + Math.sign(b.vy) * 1.5);
        if (br) { b.y -= b.vy * st; b.vy = -b.vy; this.hit(br); }
        if (b.vy > 0 && b.y + 1.5 >= PY && b.y - 1.5 <= PY + PH && Math.abs(b.x - this.px) <= this.pw / 2 + 1.5) {
          const off = Math.max(-1, Math.min(1, (b.x - this.px) / (this.pw / 2)));
          const a = off * 1.05;
          b.vx = Math.sin(a); b.vy = -Math.cos(a);
          b.y = PY - 1.6;
          this.speed = Math.min(230, this.speed + 3);
          this.sys.audio.tone(220, 0.04, { vol: 0.05 });
        }
        if (b.y > 204) b.lost = true;
      }
    }
    this.balls = this.balls.filter((b) => !b.lost);
    if (!this.balls.length && this.phase === "play") {
      this.lives--;
      this.sys.audio.tone(300, 0.6, { vol: 0.06, slide: 60 });
      if (this.lives > 0) { this.phase = "lost"; this.resetBall(); this.caps = []; this.wideT = this.slowT = 0; }
      else this.phase = "over";
    }
  }

  proceed() {
    switch (this.phase) {
      case "intro": this.phase = "play"; break;
      case "lost": this.phase = "play"; break;
      case "over": this.lives = 3; this.setup(); this.phase = "play"; break;
      case "clear": this.level++; this.lives++; this.setup(); this.phase = "play"; break;
      case "win": {
        const lines = awardPrize(this.sys.fs, "C:\\GAMES\\BRIXX", "COLORS.PAL", "COLORS.PAL - colour palette for PANES 1.0");
        this.sys.exit({ lines: [`You beat BRIXX with ${this.score} points!`, ...lines] });
        break;
      }
      case "play": this.launch(); break;
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
    if (k === "Escape") { this.paused = true; return; }
    if (this.phase === "play") { if (k === " " || k === "Enter" || k === "ArrowUp" || k === "w") this.launch(); return; }
    if (k.length === 1 || k === "Enter") this.proceed();
  }

  pointer(ev) {
    const x = ev.x / 2;
    if (ev.type === "down") {
      this.drag = { x, px: this.px, moved: false };
      if (ev.pointerType === "mouse") this.px = x;
    }
    if (ev.type === "move") {
      if (ev.pointerType === "mouse" && ev.inside) this.px = x;
      else if (this.drag) {
        this.px = this.drag.px + (x - this.drag.x) * 1.3;
        if (Math.abs(x - this.drag.x) > 3) this.drag.moved = true;
      }
    }
    if (ev.type === "up") {
      const tap = !this.drag || !this.drag.moved;
      this.drag = null;
      if (!tap) return;
      if (this.paused) this.paused = false;
      else this.proceed();
    }
  }

  draw() {
    const g = this.b;
    g.clear(grey(1));
    // backdrop: faint dithered grid
    for (let y = TOP; y < 200; y += 8) for (let x = LEFT; x < RIGHT; x += 8) g.pix(x, y, grey(3));
    // walls with colour cycling
    for (let y = TOP - 3; y < 200; y++) {
      const c = 248 + ((y >> 2) & 7);
      g.rect(0, y, LEFT, 1, c);
      g.rect(RIGHT, y, 320 - RIGHT, 1, c);
    }
    for (let x = 0; x < 320; x++) g.rect(x, TOP - 3, 1, 3, 248 + ((x >> 2) & 7));
    // bricks
    for (const br of this.bricks) {
      const x = BX + br.c * BW, y = BY + br.r * BH;
      g.rect(x, y, BW - 1, BH - 1, brickColour(br.t, 11));
      g.rect(x, y, BW - 1, 1, brickColour(br.t, 16));
      g.rect(x, y + BH - 2, BW - 1, 1, brickColour(br.t, 6));
      g.rect(x + BW - 2, y, 1, BH - 1, brickColour(br.t, 7));
    }
    // capsules
    for (const c of this.caps) {
      const hue = { W: 8, S: 4, M: 0 }[c.k];
      g.rect(c.x, c.y, 10, 5, ramp(hue, 13));
      g.rect(c.x + 1, c.y + 1, 8, 1, ramp(hue, 17));
      g.rect(c.x + 4, c.y + 2, 2, 2, grey(15));
    }
    // paddle
    const pl = Math.round(this.px - this.pw / 2);
    g.rect(pl, PY, this.pw, PH, ramp(6, 12));
    g.rect(pl, PY, this.pw, 1, ramp(6, 17));
    g.rect(pl, PY + PH - 1, this.pw, 1, ramp(6, 5));
    g.rect(pl, PY, 3, PH, ramp(0, 12));
    g.rect(pl + this.pw - 3, PY, 3, PH, ramp(0, 12));
    // balls
    for (const b of this.balls) {
      g.rect(Math.round(b.x) - 1, Math.round(b.y) - 1, 3, 3, grey(15));
      g.pix(Math.round(b.x) - 1, Math.round(b.y) - 1, grey(10));
    }
    // HUD
    g.rect(0, 0, 320, TOP - 3, grey(0));
    g.text(2, 0, "BRIXX", ramp(2, 16), FONT);
    g.text(56, 0, `LEVEL ${this.level + 1}/3`, grey(13), FONT);
    g.text(152, 0, `SCORE ${String(this.score).padStart(5, "0")}`, grey(13), FONT);
    g.text(264, 0, "♥".repeat(Math.min(6, this.lives)), ramp(0, 15), FONT);
    if (this.msg) this.center([this.msg.text], 150, false);
    const msgs = {
      intro: ["B R I X X", "", "Break every brick", "in 3 levels.", "", "Move: mouse, drag,", "or arrow keys", "Launch: Space / tap", "", "Press any key"],
      lost: ["Ball lost!", "", `${this.lives} left`, "", "Press any key"],
      over: ["GAME OVER", "", "Try this level again.", "", "Press any key"],
      clear: [`LEVEL ${this.level + 1} CLEARED!`, "", "Extra ball!", "", "Press any key"],
      win: ["YOU BEAT BRIXX!", "", `Score: ${this.score}`, "", "Prize: COLORS.PAL", "", "Press any key"],
    }[this.phase];
    if (this.paused) this.center(["Quit to DOS?", "(Y/N)"], 80);
    else if (msgs) this.center(msgs, 100);
    else if (this.balls.some((b) => b.stuck)) this.center(["Space / tap to launch"], 150, false);
    this.s.dirty = true;
  }

  center(lines, cy, box = true) {
    const g = this.b;
    const w = Math.max(...lines.map((l) => l.length)) * 8 + 16, h = lines.length * 12 + 10;
    const x = Math.round(160 - w / 2), y = Math.round(cy - h / 2);
    if (box) {
      g.rect(x, y, w, h, ramp(8, 3));
      g.frame(x, y, w, h, ramp(8, 14));
    }
    lines.forEach((l, i) => g.text(Math.round(160 - (l.length * 8) / 2), y + 5 + i * 12, l, i === 0 ? ramp(2, 17) : grey(15), FONT));
  }
}
