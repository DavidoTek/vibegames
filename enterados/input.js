// Keyboard, mouse (pointer lock, or drag when the lock is refused), touch
// (left half: floating stick, right half: look) and gamepad, merged into one
// state the game reads each frame.

const KEY_ACTIONS = {
  Space: "jump", KeyE: "use", Enter: "use", KeyF: "zap", KeyP: "pause", Escape: "pause",
  Tab: "post", KeyM: "mute",
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();          // actions since the last frame
    this.lookX = 0;                    // radians, already scaled per device
    this.lookY = 0;
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.lookId = null;
    this.lookLast = [0, 0];
    this.held = new Set();             // touch buttons held down
    this.locked = false;
    this.touch = false;
    this.padPrev = [];
    this.padMove = [0, 0];
    this.enabled = false;              // true while the game is being played
    this.onTouch = null;
    this.bind();
  }

  bind() {
    const c = this.canvas;
    addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const act = KEY_ACTIONS[e.code];
      if (act && !e.repeat) this.pressed.add(act);
      this.keys.add(e.code);
      if (this.enabled && (e.code === "Tab" || e.code === "Space" || e.code.startsWith("Arrow"))) e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => { this.keys.clear(); this.held.clear(); });

    document.addEventListener("pointerlockchange", () => { this.locked = document.pointerLockElement === c; });

    c.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") {
        if (!this.touch) { this.touch = true; this.onTouch?.(); }
        if (e.clientX < innerWidth / 2 && this.stick.id === null) {
          Object.assign(this.stick, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
        } else if (this.lookId === null) {
          this.lookId = e.pointerId;
          this.lookLast = [e.clientX, e.clientY];
        }
        return;
      }
      if (!this.enabled) return;
      if (this.locked) {
        if (e.button === 0) this.pressed.add("zap");
      } else {
        // Asking can fail (or be refused); dragging still turns the view then.
        try { c.requestPointerLock()?.catch?.(() => {}); } catch { /* not supported */ }
      }
    });
    c.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") {
        if (e.pointerId === this.stick.id) {
          const dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
          const len = Math.hypot(dx, dy), max = 56;
          const k = len > max ? max / len : 1;
          this.stick.x = (dx * k) / max;
          this.stick.y = (dy * k) / max;
        } else if (e.pointerId === this.lookId) {
          this.lookX += (e.clientX - this.lookLast[0]) * 0.0055;
          this.lookY += (e.clientY - this.lookLast[1]) * 0.0055;
          this.lookLast = [e.clientX, e.clientY];
        }
        return;
      }
      if (this.locked || e.buttons & 1) {
        this.lookX += e.movementX * 0.0023;
        this.lookY += e.movementY * 0.0023;
      }
    });
    const up = (e) => {
      if (e.pointerId === this.stick.id) Object.assign(this.stick, { id: null, x: 0, y: 0 });
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("contextmenu", (e) => e.preventDefault());

    const pad = document.getElementById("touch");
    pad.addEventListener("pointerdown", (e) => {
      const act = e.target.closest("button")?.dataset.act;
      if (!act) return;
      e.preventDefault();
      this.pressed.add(act);
      this.held.add(act);
      e.target.closest("button").classList.add("held");
    });
    const release = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      this.held.delete(b.dataset.act);
      b.classList.remove("held");
    };
    pad.addEventListener("pointerup", release);
    pad.addEventListener("pointercancel", release);
    pad.addEventListener("pointerleave", release, true);
    pad.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // Gamepad buttons become the same actions as keys.
  poll(dt) {
    this.padMove = [0, 0];
    const gp = navigator.getGamepads?.().find((g) => g && g.connected);
    if (gp) {
      const dead = (v) => (Math.abs(v) < 0.18 ? 0 : v);
      this.padMove = [dead(gp.axes[0] || 0), dead(gp.axes[1] || 0)];
      this.lookX += dead(gp.axes[2] || 0) * 2.6 * dt;
      this.lookY += dead(gp.axes[3] || 0) * 1.8 * dt;
      const map = { 0: "jump", 2: "use", 7: "zap", 9: "pause", 8: "post" };
      for (const [i, act] of Object.entries(map)) {
        const down = !!gp.buttons[i]?.pressed;
        if (down && !this.padPrev[i]) this.pressed.add(act);
        this.padPrev[i] = down;
      }
      this.padRun = !!gp.buttons[10]?.pressed;
    }
    // Arrow keys turn, so the game works without a mouse.
    const turn = (this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("ArrowLeft") ? 1 : 0);
    this.lookX += turn * 2.2 * dt;
  }

  // { x: right, y: forward, run }
  move() {
    const k = this.keys;
    let x = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0) + this.stick.x + this.padMove[0];
    let y = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) - this.stick.y - this.padMove[1];
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    const run = k.has("ShiftLeft") || k.has("ShiftRight") || this.padRun || Math.hypot(this.stick.x, this.stick.y) > 0.95;
    return { x, y, run };
  }

  consume(act) {
    const had = this.pressed.has(act);
    this.pressed.delete(act);
    return had;
  }

  takeLook() {
    const l = [this.lookX, this.lookY];
    this.lookX = this.lookY = 0;
    return l;
  }

  endFrame() { this.pressed.clear(); }
}
