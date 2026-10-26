// A scrolling text terminal on part of the text screen, with a line editor
// (history, Tab completion, cursor keys) and "Press any key" paging.
// Input is promise based: `await term.readLine()` / `await term.readKey()`.

import { COLS } from "./screen.js";

export class Term {
  constructor(screen, { top = 0, bottom = 24, fg = 7, bg = 0 } = {}) {
    this.s = screen;
    this.top = top;
    this.bottom = bottom;
    this.fg = fg;
    this.bg = bg;
    this.x = 0;
    this.y = top;
    this.tags = [];          // per-row tag (e.g. a file name for tap-to-insert)
    this.lines = 0;          // lines printed since the last input, for paging
    this.paging = true;
    this.waiter = null;      // pending readKey resolver
    this.edit = null;        // active line editor state
  }

  get height() { return this.bottom - this.top + 1; }

  clear() {
    this.s.fill(0, this.top, COLS, this.height, " ", this.fg, this.bg);
    this.x = 0;
    this.y = this.top;
    this.tags = [];
    this.lines = 0;
    this.syncCursor();
  }

  syncCursor() {
    this.s.cursor.x = this.x;
    this.s.cursor.y = this.y;
  }

  newline() {
    this.x = 0;
    if (this.y >= this.bottom) {
      this.s.scroll(this.top, this.bottom, this.fg, this.bg);
      this.tags.shift();
      if (this.edit) this.edit.sy--;
    } else this.y++;
    this.lines++;
  }

  // Write text at the cursor; \n starts a new line, long lines wrap.
  write(str, fg = this.fg, bg = this.bg) {
    for (const ch of String(str)) {
      if (ch === "\n") { this.newline(); continue; }
      if (ch === "\r") { this.x = 0; continue; }
      if (this.x >= COLS) this.newline();
      this.s.put(this.x++, this.y, ch, fg, bg);
    }
    this.syncCursor();
  }

  writeln(str = "", fg, bg) {
    this.write(str, fg, bg);
    this.newline();
    this.syncCursor();
  }

  tag(t) { this.tags[this.y - this.top] = t; }

  // Print lines, pausing when a screenful has scrolled past since the last input.
  async out(text = "", { fg, tag } = {}) {
    const lines = String(text).split("\n");
    for (const line of lines) {
      if (this.paging && this.lines >= this.height - 1) {
        this.write("Press any key to continue . . .");
        await this.readKey();
        this.x = 0;
        this.s.fill(0, this.y, COLS, 1, " ", this.fg, this.bg);
        this.lines = 0;
      }
      if (tag) this.tag(tag);
      this.writeln(line, fg);
    }
  }

  readKey() {
    this.lines = 0;
    return new Promise((resolve) => { this.waiter = resolve; });
  }

  // Line editor. Options: mask (show *), history (array), complete(buf) => [candidates],
  // max length. Resolves with the string, or null on Ctrl+C.
  readLine({ mask = false, history = null, complete = null, max = 126, fg = this.fg } = {}) {
    this.lines = 0;
    return new Promise((resolve) => {
      this.edit = { buf: "", pos: 0, sx: this.x, sy: this.y, mask, history, complete, max, fg, resolve, hist: history ? history.length : 0, draft: "", shown: 0, tab: null };
      this.renderEdit();
    });
  }

  get editing() { return !!this.edit; }
  get editBuffer() { return this.edit ? this.edit.buf : ""; }

  renderEdit() {
    const e = this.edit;
    const text = e.mask ? "*".repeat(e.buf.length) : e.buf;
    const len = Math.max(text.length, e.shown);
    // make room if the line would run off the bottom
    while (e.sy + Math.floor((e.sx + len) / COLS) > this.bottom) {
      this.s.scroll(this.top, this.bottom, this.fg, this.bg);
      this.tags.shift();
      e.sy--;
    }
    for (let i = 0; i < len; i++) {
      const p = e.sx + i;
      this.s.put(p % COLS, e.sy + Math.floor(p / COLS), text[i] || " ", e.fg, this.bg);
    }
    e.shown = text.length;
    const p = e.sx + e.pos;
    this.x = p % COLS;
    this.y = e.sy + Math.floor(p / COLS);
    if (this.y > this.bottom) { this.y = this.bottom; this.x = COLS - 1; }
    this.syncCursor();
  }

  finishEdit(value) {
    const e = this.edit;
    const end = e.sx + e.buf.length;
    this.edit = null;
    this.y = e.sy + Math.floor(end / COLS);
    this.x = end % COLS;
    this.newline();
    this.lines = 0;
    this.syncCursor();
    e.resolve(value);
  }

  setBuffer(s) {
    const e = this.edit;
    e.buf = s.slice(0, e.max);
    e.pos = e.buf.length;
    this.renderEdit();
  }

  insertText(s) {
    const e = this.edit;
    if (!e) return;
    e.buf = (e.buf.slice(0, e.pos) + s + e.buf.slice(e.pos)).slice(0, e.max);
    e.pos = Math.min(e.buf.length, e.pos + s.length);
    e.tab = null;
    this.renderEdit();
  }

  key(ev) {
    if (ev.type !== "down") return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(ev);
      return;
    }
    const e = this.edit;
    if (!e) return;
    const k = ev.key;
    if (k !== "Tab") e.tab = null;
    if (ev.ctrl && (k === "c" || k === "C")) {
      this.write("^C");
      e.buf = "";
      this.finishEdit(null);
      return;
    }
    if ((ev.ctrl && (k === "z" || k === "Z")) || k === "F6") { this.insertText("^Z"); return; }
    switch (k) {
      case "Enter": {
        const v = e.buf;
        if (e.history && v.trim() && e.history[e.history.length - 1] !== v) {
          e.history.push(v);
          if (e.history.length > 32) e.history.shift();
        }
        this.finishEdit(v);
        return;
      }
      case "Backspace":
        if (e.pos > 0) { e.buf = e.buf.slice(0, e.pos - 1) + e.buf.slice(e.pos); e.pos--; }
        break;
      case "Delete":
        e.buf = e.buf.slice(0, e.pos) + e.buf.slice(e.pos + 1);
        break;
      case "ArrowLeft": e.pos = Math.max(0, e.pos - 1); break;
      case "ArrowRight": e.pos = Math.min(e.buf.length, e.pos + 1); break;
      case "Home": e.pos = 0; break;
      case "End": e.pos = e.buf.length; break;
      case "Escape": e.buf = ""; e.pos = 0; break;
      case "ArrowUp":
      case "ArrowDown":
        if (e.history && e.history.length) {
          if (e.hist === e.history.length) e.draft = e.buf;
          e.hist = Math.max(0, Math.min(e.history.length, e.hist + (k === "ArrowUp" ? -1 : 1)));
          e.buf = e.hist === e.history.length ? e.draft : e.history[e.hist];
          e.pos = e.buf.length;
        }
        break;
      case "F3":
        if (e.history && e.history.length) { e.buf = e.history[e.history.length - 1]; e.pos = e.buf.length; }
        break;
      case "Tab":
        if (e.complete) {
          if (!e.tab) e.tab = { list: e.complete(e.buf), i: -1 };
          if (e.tab.list.length) {
            e.tab.i = (e.tab.i + 1) % e.tab.list.length;
            e.buf = e.tab.list[e.tab.i];
            e.pos = e.buf.length;
          }
        }
        break;
      default:
        if (k.length === 1 && !ev.ctrl && !ev.alt && e.buf.length < e.max) {
          e.buf = e.buf.slice(0, e.pos) + k + e.buf.slice(e.pos);
          e.pos++;
        }
    }
    this.renderEdit();
  }

  // The word under a text cell, or the row's tag if it has one (e.g. a file name in DIR output).
  wordAt(cx, cy) {
    const tag = this.tags[cy - this.top];
    if (tag) return tag;
    const row = this.s.rowText(cy);
    const ok = (c) => /[A-Za-z0-9_.\\:~\-$!#&@^()]/.test(c);
    if (!ok(row[cx])) return "";
    let a = cx, b = cx;
    while (a > 0 && ok(row[a - 1])) a--;
    while (b < COLS - 1 && ok(row[b + 1])) b++;
    return row.slice(a, b + 1).replace(/^[.:]+|[.:,]+$/g, "");
  }
}
