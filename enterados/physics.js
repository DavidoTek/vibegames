// Collision for a box world. No DOM and no three.js, so it also runs in Node.
//
// Colliders ("solids") come from level.js:
//   box   { k: "box",  x0, x1, y0, y1, z0, z1 }
//   ramp  { k: "ramp", x0, x1, y0, ya, yb, z0, z1 }   top goes from ya (at x0) to yb (at x1)
//   cyl   { k: "cyl",  x, z, r, y0, y1 }
// Optional flags: nocol (visual only), dyn (may move, kept out of the grid),
// off (switched off, e.g. an open gate), spin (rad/s around its centre; a
// body standing on it is carried round).
//
// A body is a vertical cylinder: { x, y, z, vy, r, h, onGround, ground, yaw },
// with y at the feet.

export const GRAVITY = 22;
export const STEP = 0.4;          // ledges up to this height are walked up
const CELL = 8;
const MAX_FALL = 30;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Physics {
  constructor(solids) {
    this.grid = new Map();
    this.dyn = [];
    this.found = [];
    for (const c of solids) {
      if (c.nocol) continue;
      if (c.dyn) { this.dyn.push(c); continue; }
      const [x0, x1, z0, z1] = bounds(c);
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
          const key = cx * 1024 + cz;
          let list = this.grid.get(key);
          if (!list) this.grid.set(key, (list = []));
          list.push(c);
        }
      }
    }
  }

  // Colliders that may touch a circle. The list is reused between calls and
  // may contain a collider twice, which is harmless for the callers.
  near(x, z, r) {
    const out = this.found;
    out.length = 0;
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const list = this.grid.get(cx * 1024 + cz);
        if (list) for (const c of list) out.push(c);
      }
    }
    for (const c of this.dyn) if (!c.off) out.push(c);
    return out;
  }

  // Highest surface at (x, z) that is not above maxY, or -Infinity.
  heightAt(x, z, maxY, r = 0) {
    let best = -Infinity;
    for (const c of this.near(x, z, r)) {
      if (!touches(c, x, z, r)) continue;
      const top = topAt(c, x);
      if (top <= maxY && top > best) best = top;
    }
    return best;
  }

  groundAt(x, z, maxY, r) {
    let best = -Infinity, col = null;
    for (const c of this.near(x, z, r)) {
      if (!touches(c, x, z, r)) continue;
      const top = topAt(c, x);
      if (top <= maxY && top > best) { best = top; col = c; }
    }
    return { y: best, col };
  }

  solidAt(x, y, z) {
    for (const c of this.near(x, z, 0)) {
      if (touches(c, x, z, 0) && y > c.y0 && y < topAt(c, x)) return true;
    }
    return false;
  }

  // Line of sight, sampled every half unit.
  rayClear(ax, ay, az, bx, by, bz) {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const n = Math.ceil(len / 0.5);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.solidAt(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  // Moves a body by a horizontal velocity for dt, with gravity.
  move(b, vx, vz, dt) {
    const g = b.ground;
    if (g && g.spin && !g.off) {
      // Carried round by a turning platform (rotation about +y).
      const a = g.spin * dt, s = Math.sin(a), c = Math.cos(a);
      const dx = b.x - g.x, dz = b.z - g.z;
      b.x = g.x + dx * c + dz * s;
      b.z = g.z - dx * s + dz * c;
      if (b.yaw !== undefined) b.yaw += a;
    }

    const dist = Math.hypot(vx, vz) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.25));
    for (let i = 0; i < n; i++) {
      b.x += (vx * dt) / n;
      b.z += (vz * dt) / n;
      this.pushOut(b);
    }

    b.vy = Math.max(b.vy - GRAVITY * dt, -MAX_FALL);
    const feet = b.y;
    const ny = feet + b.vy * dt;
    const { y: ground, col } = this.groundAt(b.x, b.z, feet + STEP, b.r * 0.6);
    const snap = b.onGround && ground >= feet - STEP - 0.01;
    if (b.vy <= 0 && (ny <= ground || snap)) {
      b.y = ground;
      b.vy = 0;
      b.onGround = true;
      b.ground = col;
    } else {
      b.y = ny;
      b.onGround = false;
      b.ground = null;
    }
  }

  pushOut(b) {
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.near(b.x, b.z, b.r)) {
        if (c.y0 >= b.y + b.h) continue;                 // above the head
        if (c.k === "cyl") {
          if (c.y1 <= b.y + STEP) continue;              // a floor, not a wall
          const dx = b.x - c.x, dz = b.z - c.z;
          const d = Math.hypot(dx, dz), min = c.r + b.r;
          if (d >= min) continue;
          if (d < 1e-6) { b.x += min; continue; }
          b.x = c.x + (dx / d) * min;
          b.z = c.z + (dz / d) * min;
          continue;
        }
        const px = clamp(b.x, c.x0, c.x1), pz = clamp(b.z, c.z0, c.z1);
        if (topAt(c, px) <= b.y + STEP) continue;
        const dx = b.x - px, dz = b.z - pz;
        const d = Math.hypot(dx, dz);
        if (d >= b.r) continue;
        if (d > 1e-6) {
          b.x = px + (dx / d) * b.r;
          b.z = pz + (dz / d) * b.r;
          continue;
        }
        // Centre is inside: leave through the nearest side.
        const l = b.x - c.x0, r = c.x1 - b.x, n = b.z - c.z0, s = c.z1 - b.z;
        const m = Math.min(l, r, n, s);
        if (m === l) b.x = c.x0 - b.r;
        else if (m === r) b.x = c.x1 + b.r;
        else if (m === n) b.z = c.z0 - b.r;
        else b.z = c.z1 + b.r;
      }
    }
  }
}

function bounds(c) {
  return c.k === "cyl" ? [c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r] : [c.x0, c.x1, c.z0, c.z1];
}

function touches(c, x, z, r) {
  if (c.k === "cyl") return Math.hypot(x - c.x, z - c.z) <= c.r + r;
  return x >= c.x0 - r && x <= c.x1 + r && z >= c.z0 - r && z <= c.z1 + r;
}

export function topAt(c, x) {
  if (c.k !== "ramp") return c.y1;
  const t = clamp((x - c.x0) / (c.x1 - c.x0), 0, 1);
  return c.ya + (c.yb - c.ya) * t;
}
