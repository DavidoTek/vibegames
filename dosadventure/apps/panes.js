// PANES.EXE: the finale. A loading screen, the splash with the startup chime,
// then a small 16-colour desktop with icons, draggable windows, a mouse
// pointer and the "You won!" window. Shutting down ends the game.

import { COLS, sprite } from "../screen.js";
import { COMPONENTS } from "../progress.js";

const W = 640, H = 400;
const TITLE_H = 18;

const CAT = sprite(`
...7.........7......
..777.......777.....
..7d77777777d77.....
..777777777777777...
.77777777777777777..
.777aa7777777aa777..
.777a07777777a0777..
.77777777777777777..
.7f7777777d777777f7.
ff77777777d7777777ff
.777777777777777777.
.7777777f0f7777777..
..77777777777777....
...777777777777.....
....7777777777......
`, { 7: 8, d: 13, a: 10, 0: 0, f: 15 });

const ARROW = sprite(`
0...........
00..........
0f0.........
0ff0........
0fff0.......
0ffff0......
0fffff0.....
0ffffff0....
0fffffff0...
0ffffffff0..
0fffff00000.
0ff0ff0.....
0f0.0ff0....
00..0ff0....
0....0ff0...
.....0ff0...
......00....
`, { 0: 0, f: 15 });

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export class Panes {
  constructor(sys) {
    this.sys = sys;
    this.realtime = true;
    this.s = sys.screen;
    this.g = sys.screen.gui;
    this.phase = "loading";
    this.t = 0;
    this.mx = 320; this.my = 200;
    this.windows = [];
    this.drag = null;
    this.pressed = null;
    this.step = -1;
  }

  get music() { return this.phase === "desktop" ? "panes" : null; }

  controls() { return { set: this.phase === "desktop" ? "panes" : "none" }; }

  start() {
    this.s.setMode("text");
    this.s.clear();
    this.s.cursor.on = false;
    this.sys.state.won = true;
    this.sys.save();
  }

  update(dt) {
    this.t += dt;
    if (this.phase === "loading") {
      const step = Math.floor(this.t / 0.32);
      if (step !== this.step && step <= COMPONENTS.length) {
        this.step = step;
        this.drawLoading();
        if (step < COMPONENTS.length) this.sys.audio.hdd();
      }
      if (this.t > COMPONENTS.length * 0.32 + 0.8) {
        this.phase = "splash";
        this.t = 0;
        this.s.setMode("gui");
        this.sys.audio.chime();
        this.sys.refreshControls();
      }
    } else if (this.phase === "splash" && this.t > 3.2) {
      this.phase = "desktop";
      this.t = 0;
      this.sys.refreshControls();
    } else if (this.phase === "desktop" && !this.openedWin && this.t > 0.6) {
      this.openedWin = true;
      this.openWon();
    }
  }

  drawLoading() {
    const s = this.s;
    s.clear();
    s.text(2, 2, "Loading PANES 1.0...", 15);
    const done = Math.min(this.step, COMPONENTS.length);
    s.text(2, 4, "[" + "█".repeat(done * 8).padEnd(COMPONENTS.length * 8, "░") + "]", 9);
    COMPONENTS.forEach((c, i) => {
      if (i < done) s.text(4, 6 + i, `✓ ${c.label.padEnd(18)} ${c.name}`, 10);
    });
    if (done >= COMPONENTS.length) s.text(2, 15, "Starting the graphical interface...", 7);
  }

  // ---- windows ----
  openWon() {
    const st = this.sys.state;
    const secrets = Object.keys(st.secrets || {}).length;
    const lines = [
      "Congratulations, kiddo!",
      "",
      "You put PANES back together. Uncle Mort",
      "would be proud (and a little jealous).",
      "",
      `Time played:     ${fmtTime(st.stats.played)}`,
      `Commands typed:  ${st.stats.commands}`,
      `Hints used:      ${st.stats.hints}`,
      `Quest moves:     ${st.stats.questMoves || "-"}`,
      `Secrets found:   ${secrets}/3`,
    ];
    this.open({
      id: "won", title: "You won!", w: 400, h: 262,
      draw: (g, x, y) => {
        this.trophy(g, x + 16, y + 14);
        lines.forEach((l, i) => g.text(x + 68, y + 12 + i * 17, l, i === 0 ? 1 : 0));
      },
      buttons: [
        { label: "OK", action: () => this.close("won") },
        { label: "Shut Down", action: () => this.shutdown() },
      ],
    });
  }

  open(win) {
    const old = this.windows.find((w) => w.id === win.id);
    if (old) { this.focus(old); return; }
    const n = this.windows.length;
    win.x = win.x ?? Math.round((W - win.w) / 2 + n * 16 - 30);
    win.y = win.y ?? Math.round((H - win.h) / 2 + n * 14 - 20);
    win.x = Math.max(0, Math.min(W - win.w, win.x));
    win.y = Math.max(0, Math.min(H - win.h, win.y));
    win.buttons = win.buttons || [{ label: "OK", action: () => this.close(win.id) }];
    this.windows.push(win);
    this.sys.audio.blip(880);
  }

  close(id) { this.windows = this.windows.filter((w) => w.id !== id); }
  focus(w) { this.windows = this.windows.filter((x) => x !== w); this.windows.push(w); }

  layoutButtons(w) {
    const bw = (b) => Math.max(72, b.label.length * 8 + 24);
    const total = w.buttons.reduce((a, b) => a + bw(b) + 12, -12);
    let bx = w.x + Math.round((w.w - total) / 2);
    for (const b of w.buttons) {
      b.rx = bx; b.ry = w.y + w.h - 34; b.rw = bw(b); b.rh = 24;
      bx += b.rw + 12;
    }
  }

  icons() {
    return [
      { label: "My Disk", draw: (g, x, y) => this.iconDisk(g, x, y), open: () => this.openDisk() },
      { label: "Byte.bmp", draw: (g, x, y) => this.iconCat(g, x, y), open: () => this.open({ id: "byte", title: "Byte.bmp - Paintbrush", w: 260, h: 210, draw: (g, x, y) => { g.rect(x + 8, y + 6, 238, 130, 15); g.blit(CAT, x + 67, y + 26, 6); } }) },
      { label: "Notes.txt", draw: (g, x, y) => this.iconNotes(g, x, y), open: () => this.openNotes() },
      { label: "Recycle Bin", draw: (g, x, y) => this.iconBin(g, x, y), open: () => this.open({ id: "bin", title: "Recycle Bin", w: 330, h: 120, draw: (g, x, y) => { g.text(x + 16, y + 14, "The Recycle Bin is empty.", 0); g.text(x + 16, y + 34, "(Mort never throws anything away.)", 8); } }) },
      { label: "You won!", draw: (g, x, y) => this.trophy(g, x, y), open: () => this.openWon() },
      { label: "Shut Down", draw: (g, x, y) => this.iconPower(g, x, y), open: () => this.confirmShutdown() },
    ].map((ic, i) => ({ ...ic, x: 28, y: 14 + i * 64 }));
  }

  openDisk() {
    const root = this.sys.fs.root("C");
    const names = root.kids.filter((k) => !k.attr.includes("H")).map((k) => ({ name: k.name, dir: k.t === "d" }));
    const rows = Math.ceil(names.length / 2);
    this.open({
      id: "disk", title: "My Disk (C:)", w: 340, h: rows * 20 + 84,
      draw: (g, x, y) => {
        g.rect(x + 8, y + 6, 324, rows * 20 + 12, 15);
        names.forEach((n, i) => {
          const cx = x + 18 + (i % 2) * 160, cy = y + 12 + Math.floor(i / 2) * 20;
          if (n.dir) { g.rect(cx, cy + 3, 16, 11, 14); g.rect(cx, cy + 1, 7, 3, 14); g.frame(cx, cy + 3, 16, 11, 6); }
          else { g.rect(cx + 2, cy, 12, 15, 15); g.frame(cx + 2, cy, 12, 15, 8); g.rect(cx + 4, cy + 4, 8, 1, 8); g.rect(cx + 4, cy + 7, 8, 1, 8); }
          g.text(cx + 22, cy, n.name, 0);
        });
      },
    });
  }

  openNotes() {
    const lines = ["TO DO", "[x] fix CONFIG.SYS", "[x] glue VIDEO.DRV back together", "[x] remember the MOUSE.ZIP password",
      "[x] beat my own games", "[x] finish PANES", "[ ] feed Byte", "", "Thanks for playing, kiddo.", "             - Uncle Mort"];
    this.open({
      id: "notes", title: "Notes.txt - Notepad", w: 360, h: lines.length * 17 + 66,
      draw: (g, x, y) => {
        g.rect(x + 8, y + 6, 344, lines.length * 17 + 10, 15);
        lines.forEach((l, i) => g.text(x + 16, y + 10 + i * 17, l, 0));
      },
    });
  }

  confirmShutdown() {
    this.open({
      id: "shut", title: "Exit PANES", w: 320, h: 116,
      draw: (g, x, y) => { this.iconPower(g, x + 14, y + 10); g.text(x + 64, y + 20, "Shut down the computer?", 0); },
      buttons: [{ label: "Yes", action: () => this.shutdown() }, { label: "No", action: () => this.close("shut") }],
    });
  }

  shutdown() {
    this.phase = "shutdown";
    this.windows = [];
    this.s.setMode("text");
    this.s.clear();
    this.s.cursor.on = false;
    const msg = "It's now safe to turn off your computer.";
    this.s.text(Math.floor((COLS - msg.length) / 2), 12, msg, 6);
    this.sys.audio.tune([[784, 0.2], [659, 0.2], [523, 0.2], [392, 0.5]], { type: "triangle", vol: 0.05 });
    this.sys.refreshControls();
    this.sys.shutdown();
  }

  // ---- input ----
  key(ev) {
    if (ev.type !== "down") return;
    if (this.phase === "splash" && this.t > 0.5) { this.t = 99; return; }
    if (this.phase !== "desktop") return;
    const k = ev.key;
    const top = this.windows[this.windows.length - 1];
    if (k === "Enter" && top) top.buttons[0].action();
    else if (k === "Escape" && top) this.close(top.id);
    else if (k.startsWith("Arrow")) {
      const d = 12;
      if (k === "ArrowLeft") this.mx -= d;
      if (k === "ArrowRight") this.mx += d;
      if (k === "ArrowUp") this.my -= d;
      if (k === "ArrowDown") this.my += d;
      this.mx = Math.max(0, Math.min(W - 1, this.mx));
      this.my = Math.max(0, Math.min(H - 1, this.my));
    } else if (k === " ") this.pointer({ type: "down", x: this.mx, y: this.my }), this.pointer({ type: "up", x: this.mx, y: this.my });
  }

  pointer(ev) {
    if (ev.x !== undefined && !ev.locked) { this.mx = Math.max(0, Math.min(W - 1, ev.x)); this.my = Math.max(0, Math.min(H - 1, ev.y)); }
    if (this.phase === "splash" && ev.type === "click" && this.t > 0.5) { this.t = 99; return; }
    if (this.phase !== "desktop") return;
    const { mx, my } = this;
    if (ev.type === "down") {
      for (let i = this.windows.length - 1; i >= 0; i--) {
        const w = this.windows[i];
        if (mx < w.x || my < w.y || mx >= w.x + w.w || my >= w.y + w.h) continue;
        this.focus(w);
        this.layoutButtons(w);
        if (my < w.y + TITLE_H + 3) {
          if (mx >= w.x + w.w - 22) { this.close(w.id); return; }
          this.drag = { w, ox: mx - w.x, oy: my - w.y };
          return;
        }
        const b = w.buttons.find((b) => mx >= b.rx && my >= b.ry && mx < b.rx + b.rw && my < b.ry + b.rh);
        if (b) this.pressed = b;
        return;
      }
      const ic = this.icons().find((ic) => mx >= ic.x - 16 && mx < ic.x + 48 && my >= ic.y && my < ic.y + 58);
      if (ic) ic.open();
    } else if (ev.type === "move" && this.drag) {
      const w = this.drag.w;
      w.x = Math.max(-w.w + 60, Math.min(W - 60, mx - this.drag.ox));
      w.y = Math.max(0, Math.min(H - TITLE_H, my - this.drag.oy));
    } else if (ev.type === "up") {
      this.drag = null;
      const b = this.pressed;
      this.pressed = null;
      if (b && mx >= b.rx && my >= b.ry && mx < b.rx + b.rw && my < b.ry + b.rh) b.action();
    }
  }

  // ---- drawing ----
  draw() {
    if (this.phase === "loading" || this.phase === "shutdown") return;
    const g = this.g;
    if (this.phase === "splash") return this.drawSplash();
    g.clear(3);
    for (const ic of this.icons()) {
      ic.draw(g, ic.x, ic.y);
      const lw = ic.label.length * 8;
      g.rect(ic.x + 16 - lw / 2 - 2, ic.y + 38, lw + 4, 16, 3);
      g.text(ic.x + 16 - lw / 2, ic.y + 38, ic.label, 15);
    }
    for (const w of this.windows) this.drawWindow(w, w === this.windows[this.windows.length - 1]);
    g.blit(ARROW, Math.round(this.mx), Math.round(this.my));
    this.s.dirty = true;
  }

  drawWindow(w, active) {
    const g = this.g;
    this.layoutButtons(w);
    g.rect(w.x + 4, w.y + 4, w.w, w.h, 0);
    g.rect(w.x, w.y, w.w, w.h, 7);
    g.frame(w.x, w.y, w.w, w.h, 0);
    g.frame(w.x + 1, w.y + 1, w.w - 2, w.h - 2, 15);
    g.rect(w.x + 3, w.y + 3, w.w - 6, TITLE_H, active ? 1 : 8);
    g.text(w.x + Math.round((w.w - w.title.length * 8) / 2), w.y + 4, w.title, 15);
    // close box
    g.rect(w.x + w.w - 21, w.y + 4, 16, TITLE_H - 2, 7);
    g.frame(w.x + w.w - 21, w.y + 4, 16, TITLE_H - 2, 0);
    g.text(w.x + w.w - 17, w.y + 4, "×", 0);
    w.draw(g, w.x + 3, w.y + TITLE_H + 6);
    for (const b of w.buttons) {
      const down = this.pressed === b;
      g.rect(b.rx, b.ry, b.rw, b.rh, 7);
      g.frame(b.rx, b.ry, b.rw, b.rh, 0);
      g.rect(b.rx + 1, b.ry + 1, b.rw - 2, 1, down ? 8 : 15);
      g.rect(b.rx + 1, b.ry + 1, 1, b.rh - 2, down ? 8 : 15);
      g.rect(b.rx + 1, b.ry + b.rh - 2, b.rw - 2, 1, down ? 15 : 8);
      g.rect(b.rx + b.rw - 2, b.ry + 1, 1, b.rh - 2, down ? 15 : 8);
      g.text(b.rx + Math.round((b.rw - b.label.length * 8) / 2) + (down ? 1 : 0), b.ry + 4 + (down ? 1 : 0), b.label, 0);
    }
  }

  drawSplash() {
    const g = this.g;
    g.clear(0);
    const cx = 320, cy = 130;
    g.rect(cx - 70, cy - 54, 140, 108, 15);
    const panes = [[12, -64, -48], [10, 2, -48], [9, -64, 2], [14, 2, 2]];
    for (const [c, ox, oy] of panes) g.rect(cx + ox, cy + oy, 62, 46, c);
    g.text(cx - 80, cy + 76, "PANES", 15, { scale: 4 });
    g.text(cx - 44, cy + 148, "Version 1.0", 7);
    const c = "Copyright (c) 1994 Mort Software. All rights reserved (mostly).";
    g.text(cx - (c.length * 8) / 2, cy + 200, c, 8);
    this.s.dirty = true;
  }

  // ---- icons (32x32) ----
  iconDisk(g, x, y) {
    g.rect(x, y + 6, 32, 20, 7); g.frame(x, y + 6, 32, 20, 0);
    g.rect(x + 4, y + 12, 18, 3, 0); g.rect(x + 25, y + 18, 3, 3, 10);
  }
  iconCat(g, x, y) {
    g.rect(x, y, 32, 32, 15); g.frame(x, y, 32, 32, 0);
    g.blit(CAT, x + 6, y + 8);
  }
  iconNotes(g, x, y) {
    g.rect(x + 4, y, 24, 32, 15); g.frame(x + 4, y, 24, 32, 0);
    for (let i = 0; i < 5; i++) g.rect(x + 8, y + 6 + i * 5, 16, 1, i === 0 ? 1 : 8);
  }
  iconBin(g, x, y) {
    g.rect(x + 6, y + 6, 20, 3, 8); g.rect(x + 12, y + 3, 8, 3, 8);
    g.rect(x + 8, y + 9, 16, 22, 7); g.frame(x + 8, y + 9, 16, 22, 0);
    for (let i = 0; i < 3; i++) g.rect(x + 11 + i * 4, y + 12, 1, 16, 8);
  }
  trophy(g, x, y) {
    g.rect(x + 8, y + 2, 16, 14, 14); g.rect(x + 4, y + 4, 4, 6, 14); g.rect(x + 24, y + 4, 4, 6, 14);
    g.rect(x + 10, y + 16, 12, 3, 6); g.rect(x + 14, y + 19, 4, 6, 6); g.rect(x + 9, y + 25, 14, 5, 6);
    g.rect(x + 11, y + 4, 2, 8, 15);
  }
  iconPower(g, x, y) {
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      if (a > Math.PI * 1.35 && a < Math.PI * 1.65) continue;
      g.rect(x + 16 + Math.cos(a) * 12, y + 16 + Math.sin(a) * 12, 3, 3, 4);
    }
    g.rect(x + 15, y + 1, 3, 15, 4);
  }
}
