// Disco light effects. Each effect draws onto a persistent 2D canvas, so effects
// that fade the previous frame instead of clearing it get motion trails.
//
// Every effect gets a Frame:
//   t, dt       effect time / frame time in seconds (scaled by the speed setting)
//   beat        running beat counter, e.g. 12.25 = a quarter into beat 12
//   beatHit     true on the first frame of a new beat
//   bpm, hue    tempo and a slowly drifting global colour offset in 0..1
//   beatPhase   beat % 1
//   pulse       1.0 right on the beat, decaying quickly towards 0

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- helpers

/** Colour from hue/saturation/value, all in 0..1 (hue wraps). Returns [r, g, b]. */
export function hsv(h, s = 1, v = 1) {
  h = ((h % 1) + 1) % 1 * 6;
  s = clamp(s, 0, 1);
  v = clamp(v, 0, 1);
  const i = Math.floor(h), f = h - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [r * 255 | 0, g * 255 | 0, b * 255 | 0];
}

export function dim(c, k) {
  return [clamp(c[0] * k | 0, 0, 255), clamp(c[1] * k | 0, 0, 255), clamp(c[2] * k | 0, 0, 255)];
}

export const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** Darken the canvas for motion trails; higher rate = shorter trails. */
export function fade(ctx, w, h, rate, dt) {
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0.02, 1 - Math.exp(-rate * dt))})`;
  ctx.fillRect(0, 0, w, h);
  // 8-bit alpha blending never quite reaches black (2/255 * 0.9 rounds back to 2).
  // A colour-burn with near-white subtracts ~3 levels from dark pixels and almost
  // nothing from bright ones, which removes the leftover ghost trails.
  ctx.globalCompositeOperation = "color-burn";
  ctx.fillStyle = "rgb(252,252,252)";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
}

/**
 * Full-width (or full-height) line with a soft glow.
 *
 * Drawn with max-blending ("lighten"), so it never saturates on canvases that are
 * only partially faded between frames, while crossing lines still stay visible.
 * If `prev` is given, the gap between the previous and current position is
 * filled too, so fast lines leave a continuous trail instead of stripes.
 */
export function glowLine(ctx, pos, color, { core = 3, glow = 20, vertical = false, prev = null, layers = 6 } = {}) {
  const span = vertical ? ctx.canvas.height : ctx.canvas.width;
  const band = (start, size, c) => {
    start = Math.floor(start);
    size = Math.max(1, Math.floor(size));
    ctx.fillStyle = css(c);
    if (vertical) ctx.fillRect(start, 0, size, span);
    else ctx.fillRect(0, start, span, size);
  };
  ctx.globalCompositeOperation = "lighten";
  for (let i = layers; i > 0; i--) {
    const half = core + glow * (i / layers) ** 2;
    band(pos - half, half * 2, dim(color, 0.6 * (layers - i + 1) / layers));
  }
  let lo = pos, hi = pos;
  if (prev !== null) {
    lo = Math.min(prev, pos);
    hi = Math.max(prev, pos);
  }
  band(lo - core / 2, hi - lo + core, color);
  const hot = color.map((c) => Math.min(255, c + 140));
  const thin = Math.max(1, Math.floor(core / 3));
  band(pos - thin / 2, thin, hot);
  ctx.globalCompositeOperation = "source-over";
}

/** Soft disc in the given colour fading to black at the edge (for additive blending). */
export function radialSprite(radius, color) {
  const c = document.createElement("canvas");
  c.width = c.height = radius * 2;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    grad.addColorStop(t, css(dim(color, (1 - t) ** 1.8)));
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, radius * 2, radius * 2);
  return c;
}

function line(ctx, x0, y0, x1, y1, color, width) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = css(color);
  ctx.lineWidth = width;
  ctx.stroke();
}

// ---------------------------------------------------------------- base class

export class Effect {
  static label = "Effect";

  constructor(w, h) {
    this.w = w;
    this.h = h;
    // Line widths were tuned for a 1080p beamer; keep them proportional.
    this.px = Math.max(1, Math.min(w, h) / 1080);
    this.setup();
  }

  setup() {}

  render(ctx, f) {
    throw new Error("not implemented");
  }
}

// ---------------------------------------------------------------- scan lines

export class ScanLines extends Effect {
  static label = "Scan Lines";
  static COUNT = 7;

  setup() {
    this.lines = Array.from({ length: ScanLines.COUNT }, () => this.spawn(rand(0, this.h)));
  }

  spawn(y) {
    // [y, speed in px/s, hue offset, thickness]
    return [y, rand(0.12, 0.8) * this.h, Math.random(), [2, 3, 4][Math.floor(Math.random() * 3)]];
  }

  render(ctx, f) {
    fade(ctx, this.w, this.h, 12, f.dt);
    for (const ln of this.lines) {
      let prev = ln[0];
      ln[0] += ln[1] * f.dt;
      if (ln[0] > this.h + 40) {
        ln.splice(0, 4, ...this.spawn(-40));
        prev = ln[0];
      }
      glowLine(ctx, ln[0], hsv(f.hue + ln[2] * 0.35), { core: Math.round(ln[3] * this.px), glow: this.h * 0.02, prev });
    }
    // The sweeper goes down and back up once every 4 beats, easing at the ends.
    const phase = (f.beat / 4) % 1;
    const y = (0.5 - 0.5 * Math.cos(phase * TAU)) * this.h;
    glowLine(ctx, y, hsv(f.hue + 0.5, 0.25, 0.7 + 0.3 * f.pulse), { core: Math.round(6 * this.px), glow: this.h * 0.05 });
  }
}

export class ScanGrid extends Effect {
  static label = "Scan Grid";
  static PER_AXIS = 4;

  setup() {
    this.lines = [];
    for (const vertical of [false, true]) {
      const span = vertical ? this.w : this.h;
      for (let i = 0; i < ScanGrid.PER_AXIS; i++) {
        this.lines.push({
          vertical, span,
          pos: rand(0, span),
          vel: (Math.random() < 0.5 ? -1 : 1) * rand(0.1, 0.45) * span,
          hue: Math.random(),
        });
      }
    }
  }

  render(ctx, f) {
    fade(ctx, this.w, this.h, 7, f.dt);
    if (f.beatHit) this.lines[Math.floor(Math.random() * this.lines.length)].vel *= -1;
    for (const ln of this.lines) {
      const prev = ln.pos;
      ln.pos += ln.vel * f.dt;
      if (!(ln.pos >= 0 && ln.pos <= ln.span)) {
        ln.vel *= -1;
        ln.pos = clamp(ln.pos, 0, ln.span);
      }
      const color = hsv(f.hue + ln.hue * 0.5, 0.9, 0.75 + 0.25 * f.pulse);
      glowLine(ctx, ln.pos, color, { core: Math.round(3 * this.px), glow: Math.min(this.w, this.h) * 0.03,
                                     vertical: ln.vertical, prev });
    }
  }
}

// ---------------------------------------------------------------- lasers

export class LaserFan extends Effect {
  static label = "Laser Fan";
  static BEAMS = 9;

  setup() {
    const { w, h } = this;
    // [origin x, origin y, base angle, hue offset]
    this.emitters = [
      [w * 0.5, -5, Math.PI / 2, 0.0],
      [-5, h + 5, -Math.PI / 4, 0.33],
      [w + 5, h + 5, -3 * Math.PI / 4, 0.66],
    ];
    this.reach = Math.hypot(w, h) * 1.1;
  }

  render(ctx, f) {
    fade(ctx, this.w, this.h, 14, f.dt);
    const spread = 0.25 + 0.2 * (1 + Math.sin(f.t * 0.6));
    const even = Math.floor(f.beat) % 2 === 0;
    const B = LaserFan.BEAMS, px = this.px;
    ctx.lineCap = "butt";
    this.emitters.forEach(([ox, oy, base, hueOff], e) => {
      const sweep = 0.45 * Math.sin(f.t * 1.1 + e * 2.1);
      const color = hsv(f.hue + hueOff);
      const halo = dim(color, 0.35);
      for (let i = 0; i < B; i++) {
        if ((i % 2 === 0) !== even) continue;  // alternate beam sets each beat
        const a = base + sweep + spread * (i / (B - 1) * 2 - 1);
        const ex = ox + Math.cos(a) * this.reach, ey = oy + Math.sin(a) * this.reach;
        line(ctx, ox, oy, ex, ey, halo, 9 * px);
        line(ctx, ox, oy, ex, ey, color, 3 * px);
        line(ctx, ox, oy, ex, ey, [255, 255, 255], 1 * px);
      }
    });
  }
}

// ---------------------------------------------------------------- space

export class Tunnel extends Effect {
  static label = "Tunnel";
  static RINGS = 28;
  static DEPTH = 8.0;
  static NEAR = 0.15;

  setup() {
    const { RINGS, DEPTH } = Tunnel;
    // [z, hue]
    this.rings = Array.from({ length: RINGS }, (_, i) => [DEPTH * (i + 1) / RINGS, i * 0.07]);
    this.nextHue = RINGS * 0.07;
  }

  render(ctx, f) {
    fade(ctx, this.w, this.h, 30, f.dt);
    const { w, h } = this;
    const travel = 2.0 * (1 + 1.5 * f.pulse) * f.dt;
    for (const ring of this.rings) {
      ring[0] -= travel;
      if (ring[0] <= Tunnel.NEAR) {
        ring[0] += Tunnel.DEPTH;
        ring[1] = this.nextHue;
        this.nextHue += 0.07;
      }
    }
    const baseR = Math.min(w, h) * 0.25;
    const maxR = Math.hypot(w, h);
    const sides = Math.floor(f.beat / 16) % 2 === 0 ? 4 : 6;
    ctx.lineJoin = "miter";
    for (const [z, hue] of [...this.rings].sort((a, b) => b[0] - a[0])) {
      const r = baseR / z;
      if (r > maxR) continue;
      const depth = z / Tunnel.DEPTH;
      const cx = w / 2 + Math.sin(f.t * 0.8 + z * 0.3) * w * 0.15 * depth;
      const cy = h / 2 + Math.cos(f.t * 0.6 + z * 0.3) * h * 0.15 * depth;
      const rot = f.t * 0.4 + z * 0.15;
      ctx.beginPath();
      for (let k = 0; k < sides; k++) {
        const a = rot + TAU * k / sides;
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.strokeStyle = css(hsv(f.hue + hue, 0.9, clamp(1.2 - depth, 0, 1)));
      ctx.lineWidth = clamp(Math.floor(8 / z), 1, 25) * this.px;
      ctx.stroke();
    }
  }
}

export class Starfield extends Effect {
  static label = "Warp Stars";
  static COUNT = 450;

  setup() {
    this.stars = Array.from({ length: Starfield.COUNT }, () => Starfield.spawn(rand(0.05, 1)));
  }

  static spawn(z) {
    // [x, y, z, hue]
    return [rand(-1, 1), rand(-1, 1), z, Math.random()];
  }

  render(ctx, f) {
    fade(ctx, this.w, this.h, 16, f.dt);
    const { w, h } = this;
    const cx = w / 2, cy = h / 2;
    const scale = Math.max(w, h) * 0.5;
    const dz = 0.35 * (1 + 2.5 * f.pulse) * f.dt;
    ctx.lineCap = "round";
    for (const s of this.stars) {
      const [x, y, z, hue] = s;
      const nz = z - dz;
      if (nz <= 0.01) {
        s.splice(0, 4, ...Starfield.spawn(1));
        continue;
      }
      const nx = cx + x / nz * scale, ny = cy + y / nz * scale;
      if (!(nx >= 0 && nx < w && ny >= 0 && ny < h)) {
        s.splice(0, 4, ...Starfield.spawn(1));
        continue;
      }
      s[2] = nz;
      const px = cx + x / z * scale, py = cy + y / z * scale;
      const width = nz > 0.5 ? 1 : nz > 0.2 ? 2 : 3;
      line(ctx, px, py, nx, ny, hsv(f.hue + hue * 0.3, 0.6, Math.min(1, 0.3 + (1 - nz) * 1.2)), width * this.px);
    }
  }
}

// ---------------------------------------------------------------- colour

export class Plasma extends Effect {
  static label = "Plasma";
  static RES_X = 120;

  setup() {
    const W = this.rw = Plasma.RES_X;
    const H = this.rh = Math.max(1, Math.round(Plasma.RES_X * this.h / this.w));
    // Distance table twice the render size, so a moving centre can just
    // index into it with an offset instead of recomputing distances.
    this.dist = new Int32Array(4 * W * H);
    let maxD = 0;
    for (let y = 0; y < 2 * H; y++) {
      for (let x = 0; x < 2 * W; x++) {
        const d = Math.hypot(x - W, y - H) | 0;
        this.dist[y * 2 * W + x] = d;
        if (d > maxD) maxD = d;
      }
    }
    this.maxDist = maxD + 1;
    this.small = document.createElement("canvas");
    this.small.width = W;
    this.small.height = H;
    this.sctx = this.small.getContext("2d");
    this.img = this.sctx.createImageData(W, H);
    this.pal = new Uint8Array(256 * 3);
  }

  render(ctx, f) {
    const W = this.rw, H = this.rh, t = f.t;
    const sin40 = (n, fn) => Int32Array.from({ length: n }, (_, i) => 40 * Math.sin(fn(i)) | 0);
    const sx = sin40(W, (x) => x * 0.09 + t * 1.3);
    const sy = sin40(H, (y) => y * 0.12 - t * 1.1);
    const sxy = sin40(W + H, (i) => i * 0.06 + t * 0.7);
    const sd = sin40(this.maxDist, (d) => d * 0.22 - t * 2.0);
    const c1x = W / 2 + W * 0.4 * Math.sin(t * 0.37) | 0;
    const c1y = H / 2 + H * 0.4 * Math.cos(t * 0.29) | 0;
    const c2x = W / 2 + W * 0.4 * Math.cos(t * 0.23) | 0;
    const c2y = H / 2 + H * 0.4 * Math.sin(t * 0.41) | 0;

    const bright = 0.75 + 0.25 * f.pulse;
    const pal = this.pal;
    for (let i = 0; i < 256; i++) {
      const c = hsv(f.hue + i / 256, 1, (0.55 + 0.45 * Math.sin(i / 256 * TAU * 3)) * bright);
      pal[i * 3] = c[0];
      pal[i * 3 + 1] = c[1];
      pal[i * 3 + 2] = c[2];
    }
    const shift = t * 40 | 0;
    const dist = this.dist, stride = 2 * W, data = this.img.data;
    let o = 0;
    for (let y = 0; y < H; y++) {
      const syy = sy[y] + shift;
      const o1 = (y - c1y + H) * stride - c1x + W;
      const o2 = (y - c2y + H) * stride - c2x + W;
      for (let x = 0; x < W; x++) {
        const p = ((sx[x] + syy + sxy[x + y] + sd[dist[o1 + x]] + sd[dist[o2 + x]]) & 255) * 3;
        data[o++] = pal[p];
        data[o++] = pal[p + 1];
        data[o++] = pal[p + 2];
        data[o++] = 255;
      }
    }
    this.sctx.putImageData(this.img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.small, 0, 0, this.w, this.h);
  }
}

export class MirrorBall extends Effect {
  static label = "Mirror Ball";
  static LIGHTS = 6;
  static SPARKLES = 160;

  setup() {
    this.radius = Math.floor(Math.min(this.w, this.h) * 0.3);
    this.paths = Array.from({ length: MirrorBall.LIGHTS }, () =>
      [rand(0.2, 0.5), rand(0.2, 0.5), rand(0, TAU), rand(0, TAU)]);
    // [x fraction, y, size, twinkle phase]
    this.sparkles = Array.from({ length: MirrorBall.SPARKLES }, () =>
      [Math.random(), rand(0, this.h), (2 + Math.floor(Math.random() * 4)) * this.px, rand(0, TAU)]);
    this.tinted = [];
    this.shift = 0;
  }

  retint(hue) {
    const n = MirrorBall.LIGHTS;
    this.tinted = Array.from({ length: n }, (_, i) => radialSprite(this.radius, hsv(hue + i / n * 0.5)));
  }

  render(ctx, f) {
    if (!this.tinted.length || (f.beatHit && Math.floor(f.beat) % 8 === 0)) this.retint(f.hue);
    if (f.beatHit) this.shift++;

    const { w, h, radius: r } = this;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    this.paths.forEach(([a, b, p, q], i) => {
      const x = w / 2 + Math.sin(f.t * a * 2 + p) * w * 0.38;
      const y = h / 2 + Math.sin(f.t * b * 2 + q) * h * 0.36;
      ctx.drawImage(this.tinted[(i + this.shift) % MirrorBall.LIGHTS], x - r, y - r);
    });
    ctx.globalCompositeOperation = "source-over";

    const spin = f.t * 0.06;
    for (const [fx, y, size, phase] of this.sparkles) {
      const v = 0.5 + 0.5 * Math.sin(f.t * 3 + phase);
      if (v < 0.3) continue;
      const x = ((fx + spin) % 1) * w;
      ctx.fillStyle = css(dim([255, 255, 255], v));
      ctx.fillRect(x | 0, y | 0, size, size);
    }
  }
}

export class Equalizer extends Effect {
  static label = "Equalizer";
  static BARS = 24;
  static SEGMENTS = 28;

  setup() {
    const B = Equalizer.BARS;
    this.level = new Array(B).fill(0);
    this.target = new Array(B).fill(0);
    this.peak = new Array(B).fill(0);
  }

  render(ctx, f) {
    const B = Equalizer.BARS, S = Equalizer.SEGMENTS;
    if (f.beatHit) {
      for (let i = 0; i < B; i++) {
        const bass = 1 - i / B;
        this.target[i] = Math.min(1, rand(0.3, 0.75) + 0.35 * bass * Math.random());
      }
    } else if (Math.random() < f.dt * 6) {
      const i = Math.floor(Math.random() * B);
      this.target[i] = Math.max(this.target[i], rand(0.3, 0.8));
    }

    const decay = Math.exp(-f.dt * 2.5);
    const follow = Math.min(1, f.dt * 18);
    for (let i = 0; i < B; i++) {
      this.target[i] *= decay;
      this.level[i] += (this.target[i] - this.level[i]) * follow;
      this.peak[i] = Math.max(this.peak[i] - f.dt * 0.4, this.level[i]);
    }

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.w, this.h);
    const barW = this.w / B;
    const segH = this.h * 0.9 / S;
    const bottom = this.h * 0.95;
    const colors = Array.from({ length: S }, (_, s) => css(hsv(f.hue + 0.33 - s / S * 0.33, 1, 0.55 + 0.45 * s / S)));
    const bw = Math.max(1, barW * 0.8 | 0), sh = Math.max(1, segH * 0.75 | 0);
    for (let i = 0; i < B; i++) {
      const x = i * barW + barW * 0.1 | 0;
      const n = this.level[i] * S | 0;
      for (let s = 0; s < n; s++) {
        ctx.fillStyle = colors[s];
        ctx.fillRect(x, bottom - (s + 1) * segH | 0, bw, sh);
      }
      const ps = Math.min(S - 1, this.peak[i] * S | 0);
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, bottom - (ps + 1) * segH | 0, bw, sh);
    }
  }
}

export class Strobe extends Effect {
  static label = "Beat Strobe";

  setup() {
    this.mode = 0;
    this.color = [255, 255, 255];
  }

  render(ctx, f) {
    if (f.beatHit) {
      this.mode = Math.floor(f.beat) % 4;
      this.color = this.mode === 0 ? [255, 255, 255] : hsv(f.hue + Math.random() * 0.3);
    }
    const { w, h } = this;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const v = Math.max(0, 1 - f.beatPhase * 5);  // flash lasts a fifth of a beat
    if (v <= 0) return;
    ctx.fillStyle = css(dim(this.color, v));
    const hw = w / 2 | 0, th = h / 3 | 0;
    const rect = [[0, 0, w, h], [0, 0, hw, h], [hw, 0, w - hw, h], [0, th, w, th]][this.mode];
    ctx.fillRect(...rect);
  }
}

// Order here = order of the number keys 1..9.
export const EFFECTS = [ScanLines, LaserFan, Tunnel, Starfield, Plasma, MirrorBall, Equalizer, ScanGrid, Strobe];
