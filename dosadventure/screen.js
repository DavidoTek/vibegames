// The "video card": text mode (80x25 cells, 16 CGA colours), VGA mode 13h
// (320x200, 256-colour palette) and a 640x400 16-colour GUI mode. Whatever is
// active gets rasterised into a 640x400 "signal" canvas that the CRT shows.

import { glyph } from "./font.js";

export const W = 640;
export const H = 400;
export const COLS = 80;
export const ROWS = 25;

export const CGA = [
  [0, 0, 0], [0, 0, 170], [0, 170, 0], [0, 170, 170],
  [170, 0, 0], [170, 0, 170], [170, 85, 0], [170, 170, 170],
  [85, 85, 85], [85, 85, 255], [85, 255, 85], [85, 255, 255],
  [255, 85, 85], [255, 85, 255], [255, 255, 85], [255, 255, 255],
];

// Colour names for readable call sites.
export const C = {
  black: 0, blue: 1, green: 2, cyan: 3, red: 4, magenta: 5, brown: 6, gray: 7,
  dark: 8, lblue: 9, lgreen: 10, lcyan: 11, lred: 12, lmagenta: 13, yellow: 14, white: 15,
};

const pack = (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
const CGA32 = CGA.map(([r, g, b]) => pack(r, g, b));

function hsv(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)].map((x) => Math.round(x * 255));
}

// Shared 256-colour palette for VGA programs:
// 0-15 CGA, 16-31 grey ramp, 32-247 twelve hues x 18 shades, 248-255 free
// (programs use them for colour cycling).
export const HUES = 12;
export const SHADES = 18;
export function ramp(hue, shade) { return 32 + hue * SHADES + Math.max(0, Math.min(SHADES - 1, shade)); }
export function grey(level) { return 16 + Math.max(0, Math.min(15, level)); }

export function defaultPalette() {
  const pal = [];
  for (const c of CGA) pal.push(c);
  for (let i = 0; i < 16; i++) { const v = Math.round((i / 15) * 255); pal.push([v, v, v]); }
  for (let h = 0; h < HUES; h++) {
    for (let s = 0; s < SHADES; s++) {
      const t = s / (SHADES - 1);
      // dark shades are saturated, the brightest ones wash out a little
      pal.push(hsv(h * 30, t > 0.75 ? 1 - (t - 0.75) * 1.6 : 0.95, 0.08 + t * 0.92));
    }
  }
  while (pal.length < 256) pal.push([0, 0, 0]);
  return pal;
}

// An indexed-colour bitmap with a few drawing helpers (used for VGA and GUI).
export class Bitmap {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h);
  }
  clear(c = 0) { this.data.fill(c); }
  pix(x, y, c) {
    x |= 0; y |= 0;
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = c;
  }
  get(x, y) {
    x |= 0; y |= 0;
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.data[y * this.w + x] : 0;
  }
  rect(x, y, w, h, c) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(this.w, (x + w) | 0), y1 = Math.min(this.h, (y + h) | 0);
    for (let yy = y0; yy < y1; yy++) this.data.fill(c, yy * this.w + x0, yy * this.w + x1);
  }
  frame(x, y, w, h, c) {
    this.rect(x, y, w, 1, c); this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y, 1, h, c); this.rect(x + w - 1, y, 1, h, c);
  }
  line(x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.pix(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }
  // Text with the 8x16 font. rows = [first, last) glyph rows to use, so VGA
  // programs can use a compact 8x12 version (rows 2-14). scale enlarges it.
  text(x, y, str, c, { bg = -1, rows = [0, 16], scale = 1 } = {}) {
    const [r0, r1] = rows;
    for (const ch of String(str)) {
      const g = glyph(ch);
      for (let gy = r0; gy < r1; gy++) {
        const bits = g[gy];
        for (let gx = 0; gx < 8; gx++) {
          const on = bits & (0x80 >> gx);
          if (!on && bg < 0) continue;
          const col = on ? c : bg;
          if (scale === 1) this.pix(x + gx, y + gy - r0, col);
          else this.rect(x + gx * scale, y + (gy - r0) * scale, scale, scale, col);
        }
      }
      x += 8 * scale;
    }
    return x;
  }
  // Blit a sprite {w, h, data}; index 255 is transparent.
  blit(spr, x, y, scale = 1) {
    for (let sy = 0; sy < spr.h; sy++) {
      for (let sx = 0; sx < spr.w; sx++) {
        const c = spr.data[sy * spr.w + sx];
        if (c === 255) continue;
        if (scale === 1) this.pix(x + sx, y + sy, c);
        else this.rect(x + sx * scale, y + sy * scale, scale, scale, c);
      }
    }
  }
}

// Build a sprite from ASCII art and a legend { char: colourIndex }.
export function sprite(art, legend) {
  const rows = art.trim().split("\n").map((r) => r.trim());
  const w = Math.max(...rows.map((r) => r.length));
  const spr = { w, h: rows.length, data: new Uint8Array(w * rows.length).fill(255) };
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const c = legend[r[x]];
      if (c !== undefined) spr.data[y * w + x] = c;
    }
  });
  return spr;
}

export class Screen {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d");
    this.img = this.ctx.createImageData(W, H);
    this.px = new Uint32Array(this.img.data.buffer);
    this.ch = new Array(COLS * ROWS).fill(" ");
    this.fg = new Uint8Array(COLS * ROWS).fill(7);
    this.bg = new Uint8Array(COLS * ROWS);
    this.blink = new Uint8Array(COLS * ROWS);
    this.cursor = { x: 0, y: 0, on: true };
    this.vga = new Bitmap(320, 200);
    this.gui = new Bitmap(640, 400);
    this.pal = new Uint32Array(256);
    this.setPalette(defaultPalette());
    this.mode = "text";
    this.dirty = true;
    this.phase = -1;
  }

  setMode(mode) {
    this.mode = mode;
    this.dirty = true;
    if (mode === "vga") this.setPalette(defaultPalette());
  }

  setPalette(pal) {
    pal.forEach(([r, g, b], i) => { this.pal[i] = pack(r, g, b); });
    this.dirty = true;
  }

  setColor(i, r, g, b) {
    this.pal[i] = pack(r, g, b);
    this.dirty = true;
  }

  // ---- text mode ----
  put(x, y, ch, fg = 7, bg = 0, blink = 0) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return;
    const i = y * COLS + x;
    this.ch[i] = ch; this.fg[i] = fg; this.bg[i] = bg; this.blink[i] = blink;
    this.dirty = true;
  }

  text(x, y, str, fg = 7, bg = 0, blink = 0) {
    for (const ch of String(str)) this.put(x++, y, ch, fg, bg, blink);
    return x;
  }

  fill(x, y, w, h, ch = " ", fg = 7, bg = 0) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.put(xx, yy, ch, fg, bg);
  }

  clear(fg = 7, bg = 0) {
    this.ch.fill(" "); this.fg.fill(fg); this.bg.fill(bg); this.blink.fill(0);
    this.dirty = true;
  }

  // Scroll rows [top, bottom] up by one line.
  scroll(top = 0, bottom = ROWS - 1, fg = 7, bg = 0) {
    const a = top * COLS, b = (bottom + 1) * COLS;
    this.ch.copyWithin(a, a + COLS, b);
    this.fg.copyWithin(a, a + COLS, b);
    this.bg.copyWithin(a, a + COLS, b);
    this.blink.copyWithin(a, a + COLS, b);
    this.fill(0, bottom, COLS, 1, " ", fg, bg);
  }

  charAt(x, y) { return this.ch[y * COLS + x] || " "; }
  rowText(y) { return this.ch.slice(y * COLS, (y + 1) * COLS).join(""); }

  snapshot() {
    return { ch: this.ch.slice(), fg: this.fg.slice(), bg: this.bg.slice(), blink: this.blink.slice(), cursor: { ...this.cursor } };
  }

  restore(s) {
    this.ch = s.ch.slice(); this.fg = s.fg.slice(); this.bg = s.bg.slice(); this.blink = s.blink.slice();
    this.cursor = { ...s.cursor };
    this.mode = "text";
    this.dirty = true;
  }

  // ---- output ----
  render(t) {
    // Cursor and blink attribute toggle about 3.7 times a second, like real hardware.
    const phase = Math.floor(t * 3.75) & 1;
    if (this.mode === "text" && phase !== this.phase) this.dirty = true;
    this.phase = phase;
    if (!this.dirty) return false;
    this.dirty = false;
    if (this.mode === "text") this.renderText(phase);
    else if (this.mode === "vga") this.renderVga();
    else this.renderGui();
    this.ctx.putImageData(this.img, 0, 0);
    return true;
  }

  renderText(phase) {
    const px = this.px;
    for (let cy = 0; cy < ROWS; cy++) {
      for (let cx = 0; cx < COLS; cx++) {
        const i = cy * COLS + cx;
        const g = glyph(this.ch[i]);
        const fg = CGA32[this.fg[i]], bg = CGA32[this.bg[i]];
        const hide = this.blink[i] && phase === 0;
        const cur = this.cursor.on && phase === 1 && this.cursor.x === cx && this.cursor.y === cy;
        let o = cy * 16 * W + cx * 8;
        for (let gy = 0; gy < 16; gy++) {
          let bits = hide ? 0 : g[gy];
          if (cur && gy >= 14) bits = 0xff;
          for (let gx = 0; gx < 8; gx++) px[o + gx] = bits & (0x80 >> gx) ? (cur && gy >= 14 ? CGA32[this.fg[i] || 7] : fg) : bg;
          o += W;
        }
      }
    }
  }

  renderVga() {
    const px = this.px, d = this.vga.data, pal = this.pal;
    for (let y = 0; y < 200; y++) {
      const row = y * 320, o = y * 2 * W;
      for (let x = 0; x < 320; x++) {
        const c = pal[d[row + x]];
        const p = o + x * 2;
        px[p] = c; px[p + 1] = c; px[p + W] = c; px[p + W + 1] = c;
      }
    }
  }

  renderGui() {
    const px = this.px, d = this.gui.data;
    for (let i = 0; i < W * H; i++) px[i] = CGA32[d[i] & 15];
  }
}
