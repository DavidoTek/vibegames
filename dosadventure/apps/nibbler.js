// NIBBLER.EXE: snake in text mode. Each 8x16 cell is split into two
// half-block pixels (▀ with fg = top, bg = bottom), giving an 80x48 field.

import { COLS } from "../screen.js";
import { awardPrize } from "../progress.js";

const FW = 80, FH = 48;
const BG = 1, WALL = 12, SNAKE = 14, HEAD = 15;
const SPEED = [10, 12, 14];
const STARTS = [{ x: 13, y: 24 }, { x: 13, y: 24 }, { x: 13, y: 40 }];

function levelWalls(n) {
  const w = new Uint8Array(FW * FH);
  const set = (x, y) => { w[y * FW + x] = 1; };
  for (let x = 0; x < FW; x++) { set(x, 0); set(x, FH - 1); }
  for (let y = 0; y < FH; y++) { set(0, y); set(FW - 1, y); }
  if (n === 1) for (let x = 20; x < 60; x++) { set(x, 15); set(x, 32); }
  if (n === 2) {
    for (let y = 0; y <= 30; y++) { set(20, y); set(60, y); }
    for (let y = 17; y < FH; y++) set(40, y);
  }
  return w;
}

export class Nibbler {
  constructor(sys) {
    this.sys = sys;
    this.realtime = true;
    this.s = sys.screen;
    this.level = 0;
    this.lives = 3;
    this.score = 0;
    this.phase = "intro";
    this.paused = false;
  }

  controls() { return { set: "dpad", swipe: true }; }

  get music() { return "nibbler"; }

  start() {
    this.s.setMode("text");
    this.s.cursor.on = false;
    this.setup(true);
  }

  setup(resetFood) {
    this.walls = levelWalls(this.level);
    const st = STARTS[this.level];
    this.snake = [];
    for (let i = 3; i >= 0; i--) this.snake.push({ x: st.x - i, y: st.y });
    this.dir = { x: 1, y: 0 };
    this.queue = [];
    this.grow = 0;
    this.t = 0;
    if (resetFood) this.next = 1;
    this.placeFood();
  }

  occupied(x, y) {
    if (this.walls[y * FW + x]) return true;
    return this.snake.some((p) => p.x === x && p.y === y);
  }

  placeFood() {
    const head = this.snake[this.snake.length - 1];
    for (let tries = 0; tries < 2000; tries++) {
      const x = 2 + Math.floor(Math.random() * (FW - 4));
      const cr = 1 + Math.floor(Math.random() * (FH / 2 - 2));
      if (this.occupied(x, cr * 2) || this.occupied(x, cr * 2 + 1)) continue;
      if (Math.abs(x - head.x) + Math.abs(cr * 2 - head.y) < 8) continue;
      this.food = { x, cr };
      return;
    }
    this.food = { x: 40, cr: 3 };
  }

  update(dt) {
    if (this.phase !== "play" || this.paused) return;
    this.t += dt;
    const step = 1 / (SPEED[this.level] + (this.next - 1) * 0.35);
    while (this.t >= step && this.phase === "play") {
      this.t -= step;
      this.step();
    }
  }

  step() {
    if (this.queue.length) this.dir = this.queue.shift();
    const head = this.snake[this.snake.length - 1];
    const nx = head.x + this.dir.x, ny = head.y + this.dir.y;
    const tail = this.snake[0];
    const hitsSelf = this.snake.some((p) => p.x === nx && p.y === ny && !(p === tail && this.grow === 0));
    if (nx < 0 || ny < 0 || nx >= FW || ny >= FH || this.walls[ny * FW + nx] || hitsSelf) return this.die();
    this.snake.push({ x: nx, y: ny });
    if (this.grow > 0) this.grow--;
    else this.snake.shift();
    if (nx === this.food.x && (ny >> 1) === this.food.cr) {
      this.score += this.next * 10 * (this.level + 1);
      this.grow += this.next * 2;
      this.sys.audio.tone(440 + this.next * 60, 0.06, { vol: 0.05 });
      this.sys.audio.tone(660 + this.next * 60, 0.06, { vol: 0.05, at: 0.06 });
      if (this.next === 9) {
        this.phase = this.level === 2 ? "win" : "clear";
        this.sys.audio.tune([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.25]]);
        return;
      }
      this.next++;
      this.placeFood();
    }
  }

  die() {
    this.lives--;
    this.sys.audio.tone(400, 0.5, { vol: 0.06, slide: 80 });
    this.phase = this.lives > 0 ? "dead" : "over";
  }

  turn(x, y) {
    const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
    if ((last.x === -x && last.y === -y) || (last.x === x && last.y === y)) return;
    if (this.queue.length < 2) this.queue.push({ x, y });
  }

  proceed() {
    switch (this.phase) {
      case "intro": this.phase = "play"; break;
      case "dead": this.setup(false); this.phase = "play"; break;
      case "over": this.level = 0; this.lives = 3; this.score = 0; this.setup(true); this.phase = "play"; break;
      case "clear": this.level++; this.lives = Math.min(5, this.lives + 1); this.setup(true); this.phase = "play"; break;
      case "win": {
        const lines = awardPrize(this.sys.fs, "C:\\GAMES\\NIBBLER", "KEYBOARD.DRV", "KEYBOARD.DRV - keyboard driver for PANES 1.0");
        this.sys.exit({ lines: [`You beat NIBBLER with ${this.score} points!`, ...lines] });
        break;
      }
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
    if (this.phase !== "play") {
      if (k.length === 1 || k === "Enter" || k === " ") this.proceed();
      return;
    }
    if (k === "ArrowUp" || k === "w") this.turn(0, -1);
    else if (k === "ArrowDown" || k === "s") this.turn(0, 1);
    else if (k === "ArrowLeft" || k === "a") this.turn(-1, 0);
    else if (k === "ArrowRight" || k === "d") this.turn(1, 0);
  }

  pointer(ev) {
    if (ev.type === "down") this.swipe = { x: ev.x, y: ev.y };
    if (ev.type === "up" && this.swipe) {
      const dx = ev.x - this.swipe.x, dy = (ev.y - this.swipe.y) * 1.25;
      this.swipe = null;
      if (Math.hypot(dx, dy) < 24) {
        if (this.paused) this.paused = false;
        else if (this.phase !== "play") this.proceed();
        return;
      }
      if (this.phase !== "play") return;
      if (Math.abs(dx) > Math.abs(dy)) this.turn(Math.sign(dx), 0);
      else this.turn(0, Math.sign(dy));
    }
  }

  color(x, y) {
    if (this.walls[y * FW + x]) return WALL;
    return BG;
  }

  draw() {
    const s = this.s;
    s.fill(0, 0, COLS, 1, " ", 0, 7);
    s.text(1, 0, `NIBBLER   Level ${this.level + 1}/3   Lives ${"♥".repeat(this.lives)}`, 0, 7);
    s.text(46, 0, `Next: ${this.next}   Score: ${this.score}`, 0, 7);
    s.text(COLS - 11, 0, "Esc = quit", 8, 7);
    const grid = new Uint8Array(FW * FH);
    for (let i = 0; i < grid.length; i++) grid[i] = this.walls[i] ? WALL : BG;
    this.snake.forEach((p, i) => { grid[p.y * FW + p.x] = i === this.snake.length - 1 ? HEAD : SNAKE; });
    for (let cr = 0; cr < FH / 2; cr++) {
      for (let x = 0; x < FW; x++) {
        if (this.food && x === this.food.x && cr === this.food.cr) { s.put(x, cr + 1, String(this.next), 15, 2); continue; }
        s.put(x, cr + 1, "▀", grid[cr * 2 * FW + x], grid[(cr * 2 + 1) * FW + x]);
      }
    }
    const msg = {
      intro: ["N I B B L E R", "", "Eat the numbers 1 to 9 in order.", "Don't hit the walls or yourself.", "", "Arrows/WASD or swipe to steer.", "", "Press any key to start"],
      dead: ["Ouch!", "", `${this.lives} ${this.lives === 1 ? "life" : "lives"} left`, "", "Press any key"],
      over: ["GAME OVER", "", "Back to level 1.", "", "Press any key"],
      clear: [`Level ${this.level + 1} cleared!`, "", "Bonus life!", "", "Press any key for the next level"],
      win: ["YOU BEAT NIBBLER!", "", `Score: ${this.score}`, "", "Mort's prize: KEYBOARD.DRV", "", "Press any key"],
    }[this.phase];
    if (this.paused) this.box(["Quit to DOS? (Y/N)"]);
    else if (msg) this.box(msg);
  }

  box(lines) {
    const s = this.s;
    const w = Math.max(...lines.map((l) => l.length)) + 6, h = lines.length + 2;
    const x = Math.floor((COLS - w) / 2), y = Math.floor((25 - h) / 2) + 1;
    s.fill(x, y, w, h, " ", 15, 4);
    for (let i = 1; i < w - 1; i++) { s.put(x + i, y, "═", 14, 4); s.put(x + i, y + h - 1, "═", 14, 4); }
    for (let i = 1; i < h - 1; i++) { s.put(x, y + i, "║", 14, 4); s.put(x + w - 1, y + i, "║", 14, 4); }
    s.put(x, y, "╔", 14, 4); s.put(x + w - 1, y, "╗", 14, 4); s.put(x, y + h - 1, "╚", 14, 4); s.put(x + w - 1, y + h - 1, "╝", 14, 4);
    lines.forEach((l, i) => s.text(x + Math.floor((w - l.length) / 2), y + 1 + i, l, i === 0 ? 14 : 15, 4));
  }
}
