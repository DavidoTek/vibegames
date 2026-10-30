// Track geometry without three.js, so physics and AI can also run headless
// in Node. A closed Catmull-Rom spline through the control points is
// resampled every DS metres; everything else works on those samples.

export const DS = 2;            // sample spacing in metres

export class Track {
  constructor(def) {
    this.def = def;
    this.verge = def.verge ?? 5;
    this.build(def.points);
    this.buildRacingLine();
  }

  build(pts) {
    // Dense pass over the spline, then resample at equal arc length.
    const n = pts.length, sub = 48;
    const dense = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      for (let j = 0; j < sub; j++) {
        const t = j / sub;
        dense.push([0, 1, 2, 3].map((k) => cr(p0[k] ?? 0, p1[k] ?? 0, p2[k] ?? 0, p3[k] ?? 0, t)));
      }
    }
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    const total = cum[dense.length];
    const N = Math.round(total / DS);
    this.n = N;
    this.length = N * DS;
    const scale = total / this.length;
    this.x = new Float32Array(N); this.z = new Float32Array(N);
    this.y = new Float32Array(N); this.w = new Float32Array(N);
    let k = 0;
    for (let i = 0; i < N; i++) {
      const d = i * DS * scale;
      while (cum[k + 1] < d) k++;
      const f = (d - cum[k]) / (cum[k + 1] - cum[k] || 1);
      const a = dense[k], b = dense[(k + 1) % dense.length];
      this.x[i] = lerp(a[0], b[0], f);
      this.z[i] = lerp(a[1], b[1], f);
      this.y[i] = lerp(a[2], b[2], f);
      this.w[i] = lerp(a[3], b[3], f);
    }
    // Horizontal unit tangent (dx, dz) and side normal (nx, nz) = (-dz, dx),
    // which points to the right of the driving direction (three.js is
    // right-handed with y up). Positive curvature means a left turn.
    this.dx = new Float32Array(N); this.dz = new Float32Array(N);
    this.curv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.wrap(i - 1), b = this.wrap(i + 1);
      const tx = this.x[b] - this.x[a], tz = this.z[b] - this.z[a];
      const l = Math.hypot(tx, tz) || 1;
      this.dx[i] = tx / l; this.dz[i] = tz / l;
    }
    for (let i = 0; i < N; i++) {
      const a = this.wrap(i - 1), b = this.wrap(i + 1);
      this.curv[i] = angleDiff(Math.atan2(this.dx[a], this.dz[a]), Math.atan2(this.dx[b], this.dz[b])) / (2 * DS);
    }
  }

  wrap(i) { return ((i % this.n) + this.n) % this.n; }

  // Half width of the drivable corridor (road + verge) at sample i.
  half(i) { return this.w[i] / 2 + this.verge; }

  // Interpolated sample data at distance s.
  at(s) {
    const u = (((s % this.length) + this.length) % this.length) / DS;
    const i = Math.floor(u), j = this.wrap(i + 1), f = u - i;
    return {
      x: lerp(this.x[i], this.x[j], f), z: lerp(this.z[i], this.z[j], f),
      y: lerp(this.y[i], this.y[j], f), w: lerp(this.w[i], this.w[j], f),
      dx: lerp(this.dx[i], this.dx[j], f), dz: lerp(this.dz[i], this.dz[j], f),
      line: lerp(this.line[i], this.line[j], f),
      i,
    };
  }

  // World point at distance s with lateral offset lat (positive = right).
  point(s, lat) {
    const a = this.at(s);
    return { x: a.x - a.dz * lat, z: a.z + a.dx * lat, y: a.y };
  }

  // (x, z) -> { s, lat, i }. Searches only near hintS when given, so the
  // figure-of-eight crossing (two parts of the track at the same x/z) and
  // tight hairpins never make a car jump to the wrong part of the track.
  project(x, z, hintS) {
    let best = -1, bestD = Infinity;
    if (hintS == null) {
      for (let i = 0; i < this.n; i++) {
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    } else {
      const c = Math.round(hintS / DS);
      for (let k = -16; k <= 16; k++) {
        const i = this.wrap(c + k);
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    // Refine along the tangent of the nearest sample.
    const rx = x - this.x[best], rz = z - this.z[best];
    let along = rx * this.dx[best] + rz * this.dz[best];
    along = Math.max(-DS, Math.min(DS, along));
    const s = (((best * DS + along) % this.length) + this.length) % this.length;
    const a = this.at(s);
    const lat = (x - a.x) * -a.dz + (z - a.z) * a.dx;
    return { s, lat, i: a.i, y: a.y };
  }

  // Racing line: an elastic band pulled tight within the road, which cuts
  // corners roughly the way a driver would. Stored as a lateral offset per
  // sample, plus the speed the line allows (before the AI's pace factor).
  buildRacingLine() {
    const N = this.n;
    let lat = new Float32Array(N);
    const px = new Float32Array(N), pz = new Float32Array(N);
    for (let it = 0; it < 160; it++) {
      for (let i = 0; i < N; i++) {
        px[i] = this.x[i] - this.dz[i] * lat[i];
        pz[i] = this.z[i] + this.dx[i] * lat[i];
      }
      const next = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const a = this.wrap(i - 4), b = this.wrap(i + 4);
        const mx = (px[a] + px[b]) / 2, mz = (pz[a] + pz[b]) / 2;
        const target = (mx - this.x[i]) * -this.dz[i] + (mz - this.z[i]) * this.dx[i];
        const lim = this.w[i] / 2 - 2;
        next[i] = clamp(lerp(lat[i], target, 0.5), -lim, lim);
      }
      lat = next;
    }
    this.line = lat;
    // Curvature of the line itself.
    const lx = new Float32Array(N), lz = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      lx[i] = this.x[i] - this.dz[i] * lat[i];
      lz[i] = this.z[i] + this.dx[i] * lat[i];
    }
    this.lineCurv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.wrap(i - 3), b = this.wrap(i), c = this.wrap(i + 3);
      this.lineCurv[i] = menger(lx[a], lz[a], lx[b], lz[b], lx[c], lz[c]);
    }
  }

  // Target speed along the racing line for a car with the given limits:
  // corner speed from lateral grip, then a backward pass so braking starts
  // early enough. Computed per car spec, so it is cached by key.
  speedProfile(grip, brake, vmax) {
    const key = `${grip}|${brake}|${vmax}`;
    this._prof ??= new Map();
    if (this._prof.has(key)) return this._prof.get(key);
    const N = this.n, v = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // Smooth the curvature a little so a single noisy sample does not brake.
      let k = 0;
      for (let j = -2; j <= 2; j++) k = Math.max(k, Math.abs(this.lineCurv[this.wrap(i + j)]));
      v[i] = Math.min(vmax, Math.sqrt(grip / Math.max(k, 1e-5)));
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = N - 1; i >= 0; i--) {
        const nx = v[this.wrap(i + 1)];
        v[i] = Math.min(v[i], Math.sqrt(nx * nx + 2 * brake * DS));
      }
    }
    this._prof.set(key, v);
    return v;
  }
}

function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// Signed curvature through three points (1 / radius).
function menger(ax, az, bx, bz, cx, cz) {
  const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d = Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz) * Math.hypot(cx - ax, cz - az);
  return d ? (2 * cross) / d : 0;
}

export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Small seeded RNG (mulberry32) so host and guest build identical worlds.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
