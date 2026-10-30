// Computer driver. Follows the track's racing line with pure pursuit and
// rides a speed profile scaled by its pace. Used for the AI cars and as
// the autopilot that takes over a human car after the finish.

import { SPEC } from "./car.js";
import { angleDiff, clamp, rng } from "./track.js";

export const DIFFICULTY = {
  // pace = fraction of the profile speed; mistakes per minute; catch-up
  // strength (AI ahead of every human eases off by up to this fraction).
  easy:   { name: "Easy",   pace: [0.84, 0.89], mistakes: 3,   catchup: 0.05 },
  normal: { name: "Normal", pace: [0.9, 0.945], mistakes: 1.2, catchup: 0.03 },
  hard:   { name: "Hard",   pace: [0.955, 0.985], mistakes: 0.3, catchup: 0 },
};

// One personality per AI car, from a seed so host and guest agree.
export function personality(seed, difficulty) {
  const r = rng(seed), d = DIFFICULTY[difficulty];
  return {
    pace: d.pace[0] + r() * (d.pace[1] - d.pace[0]),
    noise: 0.4 + r() * 1.2,           // metres of wobble around the line
    noisePhase: r() * 100,
    mistakes: d.mistakes * (0.6 + r() * 0.8),
    aggression: 0.3 + r() * 0.7,
    reaction: 0.12 + r() * 0.35,      // seconds after the lights go out
    seed: Math.floor(r() * 1e9),
  };
}

export class Driver {
  constructor(car, pers) {
    this.car = car;
    this.p = pers;
    this.rand = rng(pers.seed);
    this.offset = 0;          // avoidance offset from the line, metres
    this.mistake = 0;         // seconds left of an overcooked corner
    this.stuck = 0;
    this.reverse = 0;
    this.paceScale = 1;       // set by the race (catch-up)
    this.gentle = false;      // autopilot: no mistakes, wider berth
    this.t = 0;
  }

  // Returns the same input shape a human produces.
  drive(dt, cars) {
    const c = this.car, T = c.track;
    this.t += dt;
    const v = c.fwd;
    const prof = T.speedProfile(SPEC.grip, SPEC.brake * 0.8, SPEC.vmax);

    // Unstick: if barely moving for a while, back up with opposite lock.
    if (this.reverse > 0) {
      this.reverse -= dt;
      const a = T.at(c.s);
      const err = angleDiff(c.yaw, Math.atan2(a.dx, a.dz));
      return { throttle: 0, brake: 1, steer: clamp(err * 2, -1, 1), handbrake: false };
    }
    const facing = Math.cos(angleDiff(c.yaw, Math.atan2(T.at(c.s).dx, T.at(c.s).dz)));
    this.stuck = (Math.abs(v) < 2 || facing < -0.2) ? this.stuck + dt : 0;
    if (this.stuck > 1.6) { this.stuck = 0; this.reverse = 1.1; }

    // Occasional mistake: carry too much speed into the next corner.
    if (!this.gentle && this.mistake <= 0 && this.rand() < (this.p.mistakes / 60) * dt) this.mistake = 2.2;
    this.mistake = Math.max(0, this.mistake - dt);

    // Avoidance: if a car is close ahead on our line, move over to the
    // side with more room. Aggressive drivers commit sooner.
    let want = 0;
    const range = 10 + 12 * this.p.aggression + (this.gentle ? 8 : 0);
    for (const o of cars) {
      if (o === c) continue;
      let ds = o.dist - c.dist;
      if (ds < -4 || ds > range) continue;
      const myLat = c.lat, gap = o.lat - (T.line[T.wrap(Math.round(c.s / 2))] + this.offset);
      if (Math.abs(gap) > 3.4) continue;
      const room = T.at(c.s).w / 2 - 1.5;
      const dir = o.lat > myLat ? -1 : 1;
      const canDir = Math.abs(o.lat + dir * 3.5) < room ? dir : -dir;
      want = canDir * (3.6 - Math.abs(gap) * 0.4);
    }
    const rate = 2.5 * dt;
    this.offset += clamp(want - this.offset, -rate, rate);

    // Pure pursuit to a point ahead on the (offset) line.
    const look = 7 + Math.abs(v) * 0.38;
    const sa = c.s + look;
    const wob = this.gentle ? 0 : Math.sin(this.t * 0.37 + this.p.noisePhase) * this.p.noise;
    const ahead = T.at(sa);
    const room = ahead.w / 2 - 1.2;
    const lat = clamp(ahead.line + this.offset + wob, -room, room);
    const tp = T.point(sa, lat);
    const alpha = angleDiff(c.yaw, Math.atan2(tp.x - c.x, tp.z - c.z));
    const sp = Math.max(Math.abs(v), 3);
    const yawRate = (2 * sp * Math.sin(alpha)) / look;
    const angle = 0.62 / (1 + sp / 14);
    let steer = Math.atan((yawRate * SPEC.wheelbase) / sp) / angle;
    steer = clamp(steer, -1, 1);

    // Speed: the profile a bit ahead (reaction), scaled by pace.
    let pace = (this.gentle ? 0.9 : this.p.pace) * this.paceScale;
    if (this.mistake > 0) pace *= 1.22;
    const i = T.wrap(Math.round((c.s + Math.max(4, v * 0.35)) / 2));
    const target = prof[i] * pace * (1 + 0.04 * c.draft);
    let throttle = 0, brake = 0;
    if (v < target - 0.8) throttle = 1;
    else if (v > target + 1.2) brake = clamp((v - target) / 6, 0.2, 1);
    else throttle = 0.35;
    if (c.onGrass) throttle = Math.min(throttle, 0.8);
    return { throttle, brake, steer, handbrake: false };
  }
}
