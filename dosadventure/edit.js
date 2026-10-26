// EDIT.COM: a blue full-screen text editor in the style of MS-DOS EDIT.

import { COLS } from "./screen.js";
import { DosError, has } from "./fs.js";
import { fileText } from "./shell.js";

const TOP = 2, BOTTOM = 22, LEFT = 1, WIDTH = 78;
const HEIGHT = BOTTOM - TOP + 1;
const MENU = ["New", "Open...", "Save", "Save As...", "Exit"];

export class Editor {
  constructor(sys, path, shell) {
    this.sys = sys;
    this.shell = shell;
    this.s = sys.screen;
    this.cx = 0; this.cy = 0; this.top = 0; this.left = 0;
    this.dialog = null;
    this.menu = -1;
    this.load(path);
  }

  controls() { return { set: "edit" }; }

  get music() { return "dos"; }

  start() {
    this.s.setMode("text");
    this.s.cursor.on = true;
    this.draw();
  }

  load(path) {
    this.path = path;
    this.modified = false;
    this.cx = this.cy = this.top = this.left = 0;
    let text = "";
    this.readonly = false;
    if (path) {
      const node = this.sys.fs.get(path);
      if (node && node.t === "f") {
        text = fileText(node);
        this.readonly = has(node, "R");
        this.binary = !!node.bin;
      }
    }
    this.lines = text.replace(/\n$/, "").split("\n");
  }

  get name() { return this.path ? this.path.split("\\").pop() : "Untitled"; }

  // ---- drawing ----
  draw() {
    const s = this.s;
    s.fill(0, 0, COLS, 1, " ", 0, 7);
    s.text(1, 0, " File  Edit  Search  View  Options", 0, 7);
    s.text(COLS - 6, 0, "Help ", 0, 7);
    for (const [i, x] of [[0, 2], [1, 8], [2, 14], [3, 22], [4, 28]]) s.put(x, 0, " FESVO"[i + 1], 15, 7);
    if (this.menu >= 0) s.text(1, 0, " File ", 7, 0);
    // frame
    s.fill(0, 1, COLS, 23, " ", 7, 1);
    s.put(0, 1, "┌", 7, 1); s.put(COLS - 1, 1, "┐", 7, 1);
    for (let x = 1; x < COLS - 1; x++) { s.put(x, 1, "─", 7, 1); s.put(x, 23, "─", 7, 1); }
    s.put(0, 23, "└", 7, 1); s.put(COLS - 1, 23, "┘", 7, 1);
    for (let y = 2; y < 23; y++) { s.put(0, y, "│", 7, 1); s.put(COLS - 1, y, "│", 7, 1); }
    const title = ` ${this.name}${this.readonly ? " (read-only)" : ""} `;
    s.text(Math.floor((COLS - title.length) / 2), 1, title, 1, 7);
    for (let r = 0; r < HEIGHT; r++) {
      const line = this.lines[this.top + r];
      if (line === undefined) continue;
      s.text(LEFT, TOP + r, line.slice(this.left, this.left + WIDTH), 7, 1);
    }
    // status bar
    s.fill(0, 24, COLS, 1, " ", 0, 3);
    s.text(1, 24, "Ctrl+S=Save  Esc=Exit  F10=Menu", 0, 3);
    s.text(COLS - 20, 24, `Line:${String(this.cy + 1).padEnd(4)} Col:${this.cx + 1}`, 0, 3);
    s.cursor.x = LEFT + this.cx - this.left;
    s.cursor.y = TOP + this.cy - this.top;
    s.cursor.on = !this.dialog && this.menu < 0;
    if (this.menu >= 0) this.drawMenu();
    if (this.dialog) this.drawDialog();
  }

  drawMenu() {
    const s = this.s;
    const x = 1, w = 16;
    s.put(x, 1, "┌", 0, 7); s.put(x + w - 1, 1, "┐", 0, 7);
    for (let i = 1; i < w - 1; i++) { s.put(x + i, 1, "─", 0, 7); s.put(x + i, 2 + MENU.length, "─", 0, 7); }
    s.put(x, 2 + MENU.length, "└", 0, 7); s.put(x + w - 1, 2 + MENU.length, "┘", 0, 7);
    MENU.forEach((m, i) => {
      const sel = i === this.menu;
      s.put(x, 2 + i, "│", 0, 7); s.put(x + w - 1, 2 + i, "│", 0, 7);
      s.text(x + 1, 2 + i, (" " + m).padEnd(w - 2), sel ? 15 : 0, sel ? 0 : 7);
    });
  }

  drawDialog() {
    const s = this.s, d = this.dialog;
    const lines = d.text.split("\n");
    const w = Math.max(30, ...lines.map((l) => l.length + 4), d.input !== undefined ? 50 : 0);
    const h = lines.length + (d.input !== undefined ? 6 : 4);
    const x = Math.floor((COLS - w) / 2), y = Math.floor((25 - h) / 2);
    s.fill(x + 1, y + 1, w, h, " ", 8, 0);
    s.fill(x, y, w, h, " ", 0, 7);
    for (let i = 1; i < w - 1; i++) { s.put(x + i, y, "─", 0, 7); s.put(x + i, y + h - 1, "─", 0, 7); }
    for (let i = 1; i < h - 1; i++) { s.put(x, y + i, "│", 0, 7); s.put(x + w - 1, y + i, "│", 0, 7); }
    s.put(x, y, "┌", 0, 7); s.put(x + w - 1, y, "┐", 0, 7); s.put(x, y + h - 1, "└", 0, 7); s.put(x + w - 1, y + h - 1, "┘", 0, 7);
    if (d.title) s.text(x + Math.floor((w - d.title.length - 2) / 2), y, ` ${d.title} `, 0, 7);
    lines.forEach((l, i) => s.text(x + 2, y + 1 + i, l, 0, 7));
    let by = y + 2 + lines.length;
    if (d.input !== undefined) {
      s.fill(x + 2, y + 2 + lines.length, w - 4, 1, " ", 15, 0);
      s.text(x + 2, y + 2 + lines.length, d.input.slice(-(w - 5)), 15, 0);
      s.cursor.on = true;
      s.cursor.x = x + 2 + Math.min(d.input.length, w - 5);
      s.cursor.y = y + 2 + lines.length;
      by += 2;
    }
    const btns = d.buttons.map((b) => `< ${b} >`).join("  ");
    s.text(x + Math.floor((w - btns.length) / 2), by, btns, 0, 7);
  }

  // ---- actions ----
  ask(dialog) { this.dialog = dialog; this.draw(); }

  message(text, title = "Error") { this.ask({ title, text, buttons: ["OK"], keys: { Enter: () => {}, Escape: () => {} } }); }

  save(then) {
    if (!this.path) return this.saveAs(then);
    try {
      const drive = this.sys.fs.resolve(this.path).drive;
      if (drive === "A" && !this.sys.floppyIn()) throw new DosError("Drive A: is not ready.\nInsert the floppy disk first.");
      this.shell.writeFile(this.path, { text: this.lines.join("\n") + "\n" });
      this.modified = false;
      this.readonly = false;
      if (then) then();
      else this.draw();
    } catch (err) {
      if (err instanceof DosError) this.message(`Path/File access error:\n${err.message}`);
      else throw err;
    }
  }

  saveAs(then) {
    this.ask({
      title: "Save As", text: "File name:", input: this.path || this.sys.fs.cwdPath() + (this.sys.fs.cwdPath().endsWith("\\") ? "" : "\\"),
      buttons: ["OK", "Cancel"],
      onInput: (v) => {
        try {
          const r = this.sys.fs.resolve(v);
          this.path = this.sys.fs.pathOf(r.drive, r.parts);
        } catch (err) { this.message(err.message); return; }
        this.save(then);
      },
    });
  }

  open() {
    this.ask({
      title: "Open", text: "File name:", input: this.sys.fs.cwdPath() + (this.sys.fs.cwdPath().endsWith("\\") ? "" : "\\"),
      buttons: ["OK", "Cancel"],
      onInput: (v) => {
        try {
          const r = this.sys.fs.resolve(v);
          const node = this.sys.fs.walk(r.drive, r.parts);
          if (!node || node.t !== "f") { this.message("File not found."); return; }
          this.load(this.sys.fs.pathOf(r.drive, r.parts));
        } catch (err) { this.message(err.message); return; }
        this.draw();
      },
    });
  }

  quit() {
    if (!this.modified) { this.sys.exit(); return; }
    this.ask({
      title: "EDIT", text: `Save changes to ${this.name}?`, buttons: ["Yes", "No", "Cancel"],
      keys: {
        y: () => this.save(() => this.sys.exit()), Enter: () => this.save(() => this.sys.exit()),
        n: () => this.sys.exit(), Escape: () => {}, c: () => {},
      },
    });
  }

  runMenu(i) {
    this.menu = -1;
    const item = MENU[i];
    if (item === "New") { this.load(null); this.draw(); }
    else if (item === "Open...") this.open();
    else if (item === "Save") this.save();
    else if (item === "Save As...") this.saveAs();
    else this.quit();
  }

  // ---- input ----
  key(ev) {
    if (ev.type !== "down") return;
    const k = ev.key;
    if (this.dialog) return this.dialogKey(ev);
    if (this.menu >= 0) {
      if (k === "ArrowDown") this.menu = (this.menu + 1) % MENU.length;
      else if (k === "ArrowUp") this.menu = (this.menu + MENU.length - 1) % MENU.length;
      else if (k === "Enter") return this.runMenu(this.menu);
      else if (k === "Escape" || k === "F10" || k === "Alt") this.menu = -1;
      else {
        const i = MENU.findIndex((m) => m[0].toLowerCase() === k.toLowerCase());
        if (i >= 0) return this.runMenu(i);
      }
      return this.draw();
    }
    if (k === "F10" || k === "Alt" || (ev.alt && k.toLowerCase() === "f")) { this.menu = 0; return this.draw(); }
    if (ev.ctrl && k.toLowerCase() === "s") return this.save();
    if (k === "Escape") return this.quit();
    const L = this.lines;
    let line = L[this.cy];
    switch (k) {
      case "ArrowLeft":
        if (this.cx > 0) this.cx--;
        else if (this.cy > 0) { this.cy--; this.cx = L[this.cy].length; }
        break;
      case "ArrowRight":
        if (this.cx < line.length) this.cx++;
        else if (this.cy < L.length - 1) { this.cy++; this.cx = 0; }
        break;
      case "ArrowUp": if (this.cy > 0) this.cy--; break;
      case "ArrowDown": if (this.cy < L.length - 1) this.cy++; break;
      case "PageUp": this.cy = Math.max(0, this.cy - HEIGHT); break;
      case "PageDown": this.cy = Math.min(L.length - 1, this.cy + HEIGHT); break;
      case "Home": this.cx = 0; break;
      case "End": this.cx = line.length; break;
      case "Enter":
        L.splice(this.cy + 1, 0, line.slice(this.cx));
        L[this.cy] = line.slice(0, this.cx);
        this.cy++; this.cx = 0; this.modified = true;
        break;
      case "Backspace":
        if (this.cx > 0) { L[this.cy] = line.slice(0, this.cx - 1) + line.slice(this.cx); this.cx--; }
        else if (this.cy > 0) { this.cx = L[this.cy - 1].length; L[this.cy - 1] += line; L.splice(this.cy, 1); this.cy--; }
        this.modified = true;
        break;
      case "Delete":
        if (this.cx < line.length) L[this.cy] = line.slice(0, this.cx) + line.slice(this.cx + 1);
        else if (this.cy < L.length - 1) { L[this.cy] += L[this.cy + 1]; L.splice(this.cy + 1, 1); }
        this.modified = true;
        break;
      case "Tab":
        L[this.cy] = line.slice(0, this.cx) + "    " + line.slice(this.cx);
        this.cx += 4; this.modified = true;
        break;
      default:
        if (k.length === 1 && !ev.ctrl && !ev.alt) {
          L[this.cy] = line.slice(0, this.cx) + k + line.slice(this.cx);
          this.cx++; this.modified = true;
        } else return;
    }
    this.clampCursor();
    this.draw();
  }

  clampCursor() {
    this.cx = Math.min(this.cx, this.lines[this.cy].length);
    if (this.cy < this.top) this.top = this.cy;
    if (this.cy >= this.top + HEIGHT) this.top = this.cy - HEIGHT + 1;
    if (this.cx < this.left) this.left = Math.max(0, this.cx - 10);
    if (this.cx >= this.left + WIDTH) this.left = this.cx - WIDTH + 10;
  }

  dialogKey(ev) {
    const d = this.dialog, k = ev.key;
    if (d.input !== undefined) {
      if (k === "Enter") { this.dialog = null; d.onInput(d.input.trim()); if (!this.dialog) this.draw(); return; }
      if (k === "Escape") { this.dialog = null; return this.draw(); }
      if (k === "Backspace") d.input = d.input.slice(0, -1);
      else if (k.length === 1 && !ev.ctrl) d.input += k;
      return this.draw();
    }
    const fn = d.keys[k] || d.keys[k.toLowerCase()];
    if (!fn) return;
    this.dialog = null;
    fn();
    if (!this.dialog && this.sys.active === this) this.draw();
  }

  pointer(ev) {
    if (ev.type !== "click" || this.dialog || this.menu >= 0) return;
    const cx = Math.floor(ev.x / 8), cy = Math.floor(ev.y / 16);
    if (cy === 0 && cx < 8) { this.menu = 0; return this.draw(); }
    if (cy < TOP || cy > BOTTOM || cx < LEFT || cx > LEFT + WIDTH) return;
    this.cy = Math.min(this.lines.length - 1, this.top + cy - TOP);
    this.cx = this.left + cx - LEFT;
    this.clampCursor();
    this.draw();
  }

  update() {}
}
