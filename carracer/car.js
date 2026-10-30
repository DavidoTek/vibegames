// Car physics without three.js. Arcade model on the ground plane: the
// heading turns with the steering (limited by grip), and the velocity is
// pulled toward the heading by tyre friction. Whatever friction cannot
// remove is slide. Height comes from the track, so cars never leave it.

import { angleDiff, clamp } from "./track.js";

export const SPEC = {
  vmax: 70,          // m/s on tarmac (about 250 km/h)
  accel: 13,         // m/s^2 from standstill, falling linearly to 0 at vmax
  brake: 22,
  reverse: 7, vReverse: 12,
  grip: 21,          // lateral m/s^2 on tarmac
  gripGrass: 12,
  vGrass: 30,        // speed the grass drag pulls you down to
  wheelbase: 2.6,
  radius: 1.25,      // for car-to-car contact
  halfWidth: 1.0,    // keeps the body inside the barriers
};

export class Car {
  constructor(track, s, lat) {
    this.track = track;
    const p = track.point(s, lat), a = track.at(s);
    this.x = p.x; this.z = p.z; this.y = p.y;
    this.yaw = Math.atan2(a.dx, a.dz);
    this.vx = 0; this.vz = 0;
    this.steer = 0;            // -1..1 as applied (input is already smoothed)
    this.s = s; this.lat = lat;
    this.dist = s > track.length / 2 ? s - track.length : s;   // unwrapped progress
    this.onGrass = false;
    this.slip = 0;             // 0..1, for tyre sound and smoke
    this.impact = 0;           // last barrier/car hit strength, read and cleared by the game
    this.draft = 0;            // 0..1 slipstream
    this.spin = 0;             // wheelspin seconds left (bad start)
    this.boost = 0;            // launch boost seconds left (good start)
    this.wheel = 0;            // wheel rotation, for rendering
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get fwd() { return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw); }

  step(dt, inp) {
    const S = SPEC;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let vf = this.vx * fx + this.vz * fz;           // forward speed
    let vs = this.vx * fz - this.vz * fx;           // sideways speed
    const grip = this.onGrass ? S.gripGrass : S.grip;

    // Engine, brakes, reverse.
    const vmax = S.vmax * (1 + 0.04 * this.draft);
    let a = 0;
    if (inp.throttle > 0 && vf > -1) {
      let acc = S.accel * Math.max(0, 1 - vf / vmax);
      if (this.spin > 0) acc *= 0.4;
      if (this.boost > 0) acc *= 1.4;
      a += acc * inp.throttle;
    }
    if (inp.brake > 0) {
      if (vf > 0.5) a -= S.brake * inp.brake;
      else if (vf > -S.vReverse) a -= S.reverse * inp.brake;
    }
    if (inp.handbrake) a -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, 6);
    // Rolling resistance and grass drag.
    a -= vf * 0.015;
    if (this.onGrass && vf > S.vGrass) a -= (vf - S.vGrass) * 1.4;
    if (!inp.throttle && !inp.brake) a -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, 1.2);
    vf += a * dt;
    this.spin = Math.max(0, this.spin - dt);
    this.boost = Math.max(0, this.boost - dt);

    // Steering: kinematic yaw rate, capped by what the tyres can hold.
    // The handbrake lets the rear step out, which allows a bit more rotation.
    const sp = Math.abs(vf);
    const angle = 0.62 / (1 + sp / 14);
    let yawRate = (vf * Math.tan(angle * this.steer)) / S.wheelbase;
    const cap = ((inp.handbrake ? 1.5 : 1.04) * grip) / Math.max(sp, 1);
    yawRate = clamp(yawRate, -cap, cap);
    this.yaw += yawRate * dt;

    // Re-express the velocity in the new heading, then let friction eat the
    // sideways part. The lost sideways speed is what makes sliding slow.
    const nfx = Math.sin(this.yaw), nfz = Math.cos(this.yaw);
    const vx = fx * vf + fz * vs, vz = fz * vf - fx * vs;
    vf = vx * nfx + vz * nfz;
    vs = vx * nfz - vz * nfx;
    const fric = (inp.handbrake ? 0.45 : 1) * grip * 1.15 * dt;
    vs = Math.abs(vs) <= fric ? 0 : vs - Math.sign(vs) * fric;
    // Never slide more than ~25 deg (40 with handbrake), so the car does not
    // spin out from a slight overcorrection.
    const maxSlip = Math.tan(inp.handbrake ? 0.7 : 0.45) * Math.max(Math.abs(vf), 4);
    vs = clamp(vs, -maxSlip, maxSlip);
    this.slip = clamp(Math.abs(vs) / 6, 0, 1);
    this.vx = nfx * vf + nfz * vs;
    this.vz = nfz * vf - nfx * vs;

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.wheel += (vf * dt) / 0.36;
    this.follow();
  }

  // Track bookkeeping and barriers. Also used for remote cars after their
  // snapshot position has been applied.
  follow(collide = true) {
    const T = this.track;
    const p = T.project(this.x, this.z, this.s);
    let ds = p.s - this.s;
    if (ds > T.length / 2) ds -= T.length;
    if (ds < -T.length / 2) ds += T.length;
    this.dist += ds;
    this.s = p.s; this.lat = p.lat; this.y = p.y;
    const a = T.at(p.s);
    this.onGrass = Math.abs(p.lat) > a.w / 2 + 0.3;
    const lim = a.w / 2 + T.verge - SPEC.halfWidth;
    if (!collide || Math.abs(p.lat) <= lim) return;

    // Hit a barrier: put the car back, bounce the outward speed, scrub some
    // forward speed and turn the nose a little along the wall.
    const side = Math.sign(p.lat);
    const q = T.point(p.s, side * lim);
    this.x = q.x; this.z = q.z; this.lat = side * lim;
    const nx = -a.dz, nz = a.dx;
    const vn = this.vx * nx + this.vz * nz;
    const vt = this.vx * a.dx + this.vz * a.dz;
    if (vn * side > 0) {
      const hit = Math.abs(vn);
      const keep = 1 - 0.25 * Math.min(1, hit / 12);
      const vn2 = -vn * 0.3;
      this.vx = (a.dx * vt * keep) + nx * vn2;
      this.vz = (a.dz * vt * keep) + nz * vn2;
      this.impact = Math.max(this.impact, hit);
      const along = Math.atan2(a.dx * Math.sign(vt || 1), a.dz * Math.sign(vt || 1));
      this.yaw += angleDiff(this.yaw, along) * Math.min(0.5, hit / 20);
    }
  }
}

// Soft contact between two cars: push apart and swap a little speed along
// the contact normal. `onlyA` moves only the first car (online, each player
// only moves their own car).
export function collideCars(a, b, onlyA = false) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz), min = SPEC.radius * 2;
  if (d >= min || d < 1e-4 || Math.abs(a.y - b.y) > 3) return false;
  const nx = dx / d, nz = dz / d, push = min - d;
  const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (onlyA) {
    a.x -= nx * push; a.z -= nz * push;
    if (rel < 0) { a.vx += nx * rel * 0.6; a.vz += nz * rel * 0.6; }
  } else {
    a.x -= nx * push / 2; a.z -= nz * push / 2;
    b.x += nx * push / 2; b.z += nz * push / 2;
    if (rel < 0) {
      const j = rel * 0.6;
      a.vx += nx * j; a.vz += nz * j;
      b.vx -= nx * j; b.vz -= nz * j;
    }
  }
  a.impact = Math.max(a.impact, Math.abs(rel) * 0.5);
  return true;
}
