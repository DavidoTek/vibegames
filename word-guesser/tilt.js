// Tilt gestures from the device orientation sensor.
//
// Euler angles (beta/gamma) jump around when the phone is held upright in
// landscape, so we turn them into the world "up" vector in device coordinates
// (rotation order Z-X'-Y'' as in the spec), which is continuous:
//   up = (-sin(γ)·cos(β), sin(β), cos(β)·cos(γ))
// up.z is 0 while the screen is vertical, -1 when it faces the floor and +1
// when it faces the ceiling. up.x tells which long edge of the phone points up.

const RAD = Math.PI / 180;
const TRIGGER = 0.55; // ≈ 33° away from the baseline
const REARM = 0.3;
const MIN_GAP = 500; // ms between two gestures

export class Tilt {
  constructor() {
    this.available = false; // true once a real reading arrived
    this.z = 0;
    this.x = 0;
    this.base = 0;
    this.armed = false;
    this.enabled = false;
    this.lastFire = 0;
    this.onTilt = null; // callback("down" | "up")
    this.onSide = null; // callback(+1 | -1) when the "up" edge changes
    this.side = 1;
    this.samples = null;
    window.addEventListener("deviceorientation", (e) => this.handle(e));
  }

  // iOS 13+ needs an explicit permission prompt, triggered from a user gesture.
  async requestPermission() {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        return (await DOE.requestPermission()) === "granted";
      } catch {
        return false;
      }
    }
    return true;
  }

  handle(e) {
    if (e.beta == null || e.gamma == null) return;
    this.available = true;
    const b = e.beta * RAD;
    const g = e.gamma * RAD;
    this.x = -Math.sin(g) * Math.cos(b);
    this.z = Math.cos(b) * Math.cos(g);

    // Only switch sides on a clear reading, so tilting doesn't flip the text.
    if (Math.abs(this.x) > 0.6) {
      const side = Math.sign(this.x);
      if (side !== this.side) {
        this.side = side;
        this.onSide?.(side);
      }
    }

    if (this.samples) this.samples.push(this.z);
    if (!this.enabled) return;

    const d = this.z - this.base;
    if (!this.armed) {
      if (Math.abs(d) < REARM) this.armed = true;
      return;
    }
    const now = performance.now();
    if (now - this.lastFire < MIN_GAP) return;
    if (d < -TRIGGER || d > TRIGGER) {
      this.armed = false;
      this.lastFire = now;
      this.onTilt?.(d < 0 ? "down" : "up");
    }
  }

  // Collect readings during the countdown to learn how the player holds the phone.
  beginCalibration() {
    this.samples = [];
  }

  endCalibration() {
    const s = this.samples || [];
    this.samples = null;
    // Use the latest readings; the player is still settling at the start.
    const tail = s.slice(-15);
    const avg = tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : 0;
    this.base = Math.max(-0.35, Math.min(0.35, avg));
  }

  enable(on) {
    this.enabled = on;
    // Require a return to neutral first, so a tilt during the countdown
    // doesn't immediately score the first word.
    this.armed = false;
  }
}
