// Race state without DOM or three.js: grid, start lights, laps, finish,
// standings. The same code runs on host, guest and in headless tests.
//
// Each car's laps are "owned" by exactly one machine: a human car by its
// player's browser, AI cars by the host (or by the only browser in solo).
// Owned cars are simulated and timed here; the others ("remote") get their
// position from network snapshots and their lap/finish times from messages.

import { Car, collideCars } from "./car.js";
import { DIFFICULTY, Driver, personality } from "./ai.js";

export const LAPS = 3;
export const LIGHTS = 5;
const AFTER_LAST_HUMAN = 45;     // seconds the AI get after the last human finished

export class Race {
  // entries: [{ id, name, color, human, owned, pers? }] in grid order (front first).
  // owner: this machine decides when the race ends (solo or host).
  constructor(track, entries, { difficulty = "normal", lightDelay = 0.6, owner = true } = {}) {
    this.track = track;
    this.owner = owner;
    this.difficulty = difficulty;
    this.lightDelay = lightDelay;
    // Lights come on one per second, then all go out at time 0.
    this.time = -(LIGHTS + lightDelay + 0.5);
    this.phase = "countdown";
    this.events = [];
    this.lastHumanFinish = null;
    this.cars = entries.map((e, k) => {
      const row = Math.floor(k / 2), side = k % 2 ? 1 : -1;
      const s = track.length - 7 - row * 9 - (k % 2) * 3;
      const car = new Car(track, s, side * 3.2);
      const c = {
        ...e, car, laps: [], lapStart: 0, finish: null, best: null,
        autopilot: false, left: false, preThrottle: 0, firstThrottle: null, started: false,
        driver: null,
      };
      if (!e.human) c.driver = new Driver(car, e.pers);
      return c;
    });
    this.allCars = this.cars.map((c) => c.car);
  }

  byId(id) { return this.cars.find((c) => c.id === id); }

  // Lights currently on (0..5); 0 once the race is running.
  get lightsOn() {
    if (this.time >= 0) return 0;
    const t = this.time + LIGHTS + this.lightDelay;
    return Math.max(0, Math.min(LIGHTS, Math.floor(t) + 1));
  }

  // inputs: Map carId -> { throttle, brake, steer, handbrake } for local humans.
  step(dt, inputs) {
    const T = this.track, prevTime = this.time;
    const lightsBefore = this.lightsOn;
    this.time += dt;
    if (this.lightsOn !== lightsBefore && this.lightsOn > 0) this.events.push({ type: "light", n: this.lightsOn });
    if (prevTime < 0 && this.time >= 0) {
      this.phase = "racing";
      this.events.push({ type: "go" });
      for (const c of this.cars) {
        if (c.human && c.owned && c.preThrottle > 0.35) {
          c.car.spin = 0.9;
          this.events.push({ type: "wheelspin", id: c.id });
        }
      }
    }
    const humans = this.cars.filter((c) => c.human);
    const allHumansDone = humans.every((c) => c.finish);
    const maxH = Math.max(...humans.map((c) => c.car.dist));
    const minH = Math.min(...humans.map((c) => c.car.dist));
    const cu = DIFFICULTY[this.difficulty].catchup;

    for (const c of this.cars) {
      if (!c.owned) continue;
      const car = c.car;
      if (this.time < 0) {
        // Holding the throttle as the lights go out means wheelspin;
        // pressing it right after "go" gives a short launch boost.
        const inp = inputs.get(c.id);
        c.preThrottle = inp?.throttle > 0 ? c.preThrottle + dt : 0;
        continue;
      }
      let inp;
      if (!c.human && !c.started) {
        if (this.time < c.pers.reaction) continue;
        c.started = true;
      }
      if (c.driver) {
        if (!c.human && !allHumansDone && cu) {
          // Gentle catch-up keeps the pack together; it never makes the AI
          // faster than its own pace by more than a little.
          if (car.dist > maxH + 20) c.driver.paceScale = 1 - cu * Math.min(1, (car.dist - maxH) / 150);
          else if (car.dist < minH - 40) c.driver.paceScale = 1 + cu * 0.6 * Math.min(1, (minH - car.dist) / 150);
          else c.driver.paceScale = 1;
        } else c.driver.paceScale = 1;
        inp = c.driver.drive(dt, this.allCars);
      } else {
        inp = inputs.get(c.id) ?? { throttle: 0, brake: 0, steer: 0, handbrake: false };
      }
      if (c.human && !c.driver && c.firstThrottle == null && inp.throttle > 0) {
        c.firstThrottle = this.time;
        if (car.spin <= 0 && this.time < 0.3) {
          car.boost = 1;
          this.events.push({ type: "goodstart", id: c.id });
        }
      }
      car.steer = inp.steer;
      const d0 = car.dist;
      car.step(dt, inp);
      this.checkLine(c, d0, dt);
    }
    if (this.time < 0) return;

    // Car-to-car contacts. A car that is not simulated here is only an
    // obstacle: the local car gets pushed, the remote one is left alone.
    const cs = this.cars;
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i], b = cs[j];
        if (a.owned && b.owned) collideCars(a.car, b.car);
        else if (a.owned) collideCars(a.car, b.car, true);
        else if (b.owned) collideCars(b.car, a.car, true);
      }
    }
    this.updateDraft();
    if (this.owner) this.checkEnd();
  }

  // The finish line is at every multiple of the track length in unwrapped
  // distance. The crossing time is interpolated inside the physics step.
  checkLine(c, d0, dt) {
    if (c.finish) return;
    const L = this.track.length, d1 = c.car.dist;
    const line = (c.laps.length + 1) * L;
    if (d0 >= line || d1 < line) return;
    const t = this.time - dt + ((line - d0) / (d1 - d0)) * dt;
    this.addLap(c, t);
    this.events.push({ type: "lap", id: c.id, lap: c.laps.length, time: t });
    if (c.laps.length >= LAPS) this.setFinish(c, t, false);
  }

  addLap(c, t) {
    const lt = t - c.lapStart;
    c.laps.push(lt);
    c.lapStart = t;
    if (c.best == null || lt < c.best) c.best = lt;
  }

  setFinish(c, time, est) {
    if (c.finish) return;
    c.finish = { time, est };
    if (c.human && !est) this.lastHumanFinish = Math.max(this.lastHumanFinish ?? 0, time);
    this.events.push({ type: "finish", id: c.id, time, est });
    if (c.owned && c.human) this.autopilot(c);
  }

  // After the finish (or when a player leaves) the computer drives this car.
  autopilot(c) {
    if (c.driver) return;
    c.driver = new Driver(c.car, personality(c.id.length * 7919 + 13, "normal"));
    c.driver.gentle = true;
    c.autopilot = true;
    c.started = true;
  }

  // Lap times from the car's owner (network).
  applyLaps(id, laps, finish) {
    const c = this.byId(id);
    if (!c || c.owned) return;
    while (c.laps.length < laps.length) {
      const lt = laps[c.laps.length];
      c.laps.push(lt);
      if (c.best == null || lt < c.best) c.best = lt;
      c.lapStart += lt;
      this.events.push({ type: "lap", id, lap: c.laps.length });
    }
    if (finish && !c.finish) this.setFinish(c, finish.time, finish.est);
  }

  // Taking over a car that used to be simulated elsewhere (a player left,
  // or the host left and the guest continues alone).
  adopt(c) {
    c.owned = true;
    c.started = true;
    if (c.human) { c.left = true; this.autopilot(c); }
    else if (!c.driver) c.driver = new Driver(c.car, c.pers);
  }

  updateDraft() {
    for (const c of this.cars) {
      const a = c.car;
      let best = 0;
      for (const o of this.cars) {
        if (o === c) continue;
        const ds = o.car.dist - a.dist;
        if (ds < 3 || ds > 28 || Math.abs(o.car.lat - a.lat) > 2.5) continue;
        best = Math.max(best, 1 - ds / 28);
      }
      // The AI only gets the tow on Hard, so humans have that edge.
      if (!c.human && this.difficulty !== "hard") best = 0;
      a.draft += (best - a.draft) * 0.05;
    }
  }

  // Only the race owner (host or solo) decides when the race is over.
  checkEnd() {
    if (this.phase === "done") return;
    const all = this.cars.every((c) => c.finish);
    const humansDone = this.cars.filter((c) => c.human).every((c) => c.finish);
    if (!all && !(humansDone && this.lastHumanFinish != null && this.time - this.lastHumanFinish > AFTER_LAST_HUMAN)) return;
    for (const c of this.cars) if (!c.finish) this.setFinish(c, this.estimate(c), true);
    this.end();
  }

  estimate(c) {
    const total = LAPS * this.track.length;
    const avg = Math.max(c.car.dist, 1) / Math.max(this.time, 1);
    return this.time + Math.max(0, total - c.car.dist) / Math.max(avg, 5);
  }

  end() {
    if (this.phase === "done") return;
    this.phase = "done";
    this.events.push({ type: "end" });
  }

  // Finished cars by time, then everyone else by distance covered.
  standings() {
    return [...this.cars].sort((a, b) => {
      if (a.finish && b.finish) return a.finish.time - b.finish.time;
      if (a.finish) return -1;
      if (b.finish) return 1;
      return b.car.dist - a.car.dist;
    });
  }

  position(id) { return this.standings().findIndex((c) => c.id === id) + 1; }
}

// Grid order: AI in front, humans further back so there is something to
// pass (4th/5th on Easy and Normal, 5th/6th on Hard).
export function makeEntries(humans, difficulty, seed, total = 6) {
  const ai = [];
  const names = ["Bolt", "Vega", "Rook", "Juno", "Pike", "Nova", "Ziggy", "Moss"];
  const colors = [0xf2c14e, 0x4ecdc4, 0x9b5de5, 0xf15bb5, 0x00bbf9, 0x8ac926, 0xff924c, 0xe0e0e0];
  for (let k = 0; ai.length < total - humans.length; k++) {
    const n = (seed + k * 3) % names.length;
    if (ai.some((a) => a.name === names[n])) continue;
    ai.push({ id: "ai" + ai.length, name: names[n], color: colors[n], human: false, pers: personality(seed * 31 + k * 977, difficulty) });
  }
  const at = difficulty === "hard" ? total - humans.length : Math.min(3, total - humans.length);
  return [...ai.slice(0, at), ...humans, ...ai.slice(at)];
}
