// Main loop: canvas handling, effect switching, beat clock and on-screen info.

import { EFFECTS } from "./effects.js";

const CROSSFADE_SECONDS = 0.8;
const HUD_SECONDS = 3.0;
const MAX_PIXELS = 2560 * 1440;

class TempoClock {
  // Keeps a running beat count; BPM can be set by tapping.
  constructor(bpm) {
    this.bpm = bpm;
    this.beat = 0;
    this.taps = [];
  }

  // Advance the clock; returns true when a new beat starts.
  advance(dt) {
    const prev = this.beat;
    this.beat += dt * this.bpm / 60;
    return Math.floor(this.beat) > Math.floor(prev);
  }

  tap() {
    const now = performance.now() / 1000;
    if (this.taps.length && now - this.taps[this.taps.length - 1] > 2) this.taps = [];
    this.taps = [...this.taps, now].slice(-8);
    if (this.taps.length >= 2) {
      const span = this.taps[this.taps.length - 1] - this.taps[0];
      this.setBpm(60 / (span / (this.taps.length - 1)));
    }
    // Re-align the phase so the next frame lands exactly on a beat.
    this.beat = Math.floor(this.beat) + 1 - 1e-6;
  }

  setBpm(bpm) {
    this.bpm = Math.max(40, Math.min(240, bpm));
  }
}

// Options can be passed in the URL, mirroring the original command line:
//   ?bpm=128&effect=3&auto=30
const params = new URLSearchParams(location.search);
const num = (key, fallback) => {
  const v = parseFloat(params.get(key));
  return Number.isFinite(v) ? v : fallback;
};

class App {
  constructor() {
    this.screen = document.getElementById("screen");
    this.sctx = this.screen.getContext("2d");
    this.canvas = document.createElement("canvas");   // persistent effect buffer (trails)
    this.ctx = this.canvas.getContext("2d");
    this.fadeFrom = document.createElement("canvas"); // snapshot of the previous effect
    this.fadeCtx = this.fadeFrom.getContext("2d");
    this.fading = false;
    this.fadeStart = 0;

    this.tempo = new TempoClock(num("bpm", 124));
    const auto = num("auto", 0);
    this.index = Math.max(0, Math.min(EFFECTS.length - 1, Math.round(num("effect", 1)) - 1));
    this.auto = auto > 0;
    this.autoInterval = auto > 0 ? auto : 30;
    this.speed = 1;
    this.t = 0;
    this.hue = 0;
    this.level = 1;          // master brightness, 0 = blackout
    this.blackout = false;
    this.hudHidden = false;
    this.showHelp = false;
    this.hudUntil = 0;
    this.lastSwitch = performance.now() / 1000;
    this.started = false;

    this.el = {
      hud: document.getElementById("hud"),
      status: document.getElementById("status"),
      help: document.getElementById("help"),
      helpList: document.getElementById("help-effects"),
      controls: document.getElementById("controls"),
      intro: document.getElementById("intro"),
      auto: document.getElementById("c-auto"),
      blackout: document.getElementById("c-blackout"),
      bpm: document.getElementById("c-bpm"),
    };
    this.buildHelp();
    this.bindInput();
    this.resize();
    this.flashHud();
  }

  // --- canvas / effect management -------------------------------------------

  resize() {
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = window.innerWidth, ch = window.innerHeight;
    if (cw * ch * dpr * dpr > MAX_PIXELS) dpr = Math.sqrt(MAX_PIXELS / (cw * ch));
    const w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    for (const c of [this.screen, this.canvas, this.fadeFrom]) {
      c.width = w;
      c.height = h;
    }
    this.fading = false;
    this.effect = new EFFECTS[this.index](w, h);
  }

  switchTo(index) {
    index = ((index % EFFECTS.length) + EFFECTS.length) % EFFECTS.length;
    this.fadeCtx.globalAlpha = 1;
    this.fadeCtx.drawImage(this.canvas, 0, 0);
    this.fading = true;
    this.fadeStart = performance.now() / 1000;
    this.index = index;
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.w, this.h);
    this.effect = new EFFECTS[index](this.w, this.h);
    this.lastSwitch = performance.now() / 1000;
    this.flashHud();
  }

  flashHud() {
    this.hudUntil = performance.now() / 1000 + HUD_SECONDS;
  }

  // --- input ------------------------------------------------------------------

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  async keepAwake() {
    // Keep the screen (beamer) from going to sleep while effects run.
    try {
      if (navigator.wakeLock && document.visibilityState === "visible") {
        this.wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch { /* not supported or denied */ }
  }

  start(fullscreen) {
    this.started = true;
    this.el.intro.hidden = true;
    if (fullscreen) this.toggleFullscreen();
    this.keepAwake();
    this.flashHud();
  }

  // Returns true if the key was handled.
  handleKey(ev) {
    const k = ev.key;
    if (k === "ArrowRight" || k === " " || k === "n" || k === "N") this.switchTo(this.index + 1);
    else if (k === "ArrowLeft" || k === "p" || k === "P" || k === "Backspace") this.switchTo(this.index - 1);
    else if (k >= "1" && k <= "9" && Number(k) <= EFFECTS.length) this.switchTo(Number(k) - 1);
    else if (k === "a" || k === "A") this.toggleAuto();
    else if (k === "t" || k === "T") this.tempo.tap();
    else if (k === "[") this.tempo.setBpm(Math.round(this.tempo.bpm) - 1);
    else if (k === "]") this.tempo.setBpm(Math.round(this.tempo.bpm) + 1);
    else if (k === "ArrowUp") this.speed = Math.min(4, this.speed * 1.25);
    else if (k === "ArrowDown") this.speed = Math.max(0.25, this.speed / 1.25);
    else if (k === "c" || k === "C") this.hue = (this.hue + 1 / 6) % 1;
    else if (k === "b" || k === "B") this.blackout = !this.blackout;
    else if (k === "f" || k === "F") this.toggleFullscreen();
    else if (k === "h" || k === "H") this.hudHidden = !this.hudHidden;
    else if (k === "F1" || k === "?") this.showHelp = !this.showHelp;
    else if (k === "Escape" && this.showHelp) this.showHelp = false;
    else return false;
    this.flashHud();
    return true;
  }

  toggleAuto() {
    this.auto = !this.auto;
    this.lastSwitch = performance.now() / 1000;
  }

  bindInput() {
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("visibilitychange", () => {
      if (this.started && document.visibilityState === "visible") this.keepAwake();
    });

    window.addEventListener("keydown", (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (!this.started) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          this.start(false);
        }
        return;
      }
      if (this.handleKey(ev)) {
        ev.preventDefault();
        document.activeElement?.blur?.();
      }
    });

    document.getElementById("start-full").addEventListener("click", () => this.start(true));
    document.getElementById("start-window").addEventListener("click", () => this.start(false));

    // Touch / mouse controls mirror the keyboard shortcuts.
    const actions = {
      "c-prev": () => this.switchTo(this.index - 1),
      "c-next": () => this.switchTo(this.index + 1),
      "c-tap": () => this.tempo.tap(),
      "c-auto": () => this.toggleAuto(),
      "c-color": () => { this.hue = (this.hue + 1 / 6) % 1; },
      "c-blackout": () => { this.blackout = !this.blackout; },
      "c-full": () => this.toggleFullscreen(),
      "c-help": () => { this.showHelp = !this.showHelp; },
      "help-close": () => { this.showHelp = false; },
    };
    for (const [id, fn] of Object.entries(actions)) {
      // pointerdown makes tap tempo accurate on touch screens
      const el = document.getElementById(id);
      const fire = (ev) => {
        ev.preventDefault();
        fn();
        this.flashHud();
      };
      if (id === "c-tap") el.addEventListener("pointerdown", fire);
      else el.addEventListener("click", fire);
    }

    // Any pointer activity brings back the HUD (and the cursor) for a few seconds.
    const wake = () => {
      if (this.started) this.flashHud();
    };
    window.addEventListener("pointermove", wake);
    this.screen.addEventListener("pointerdown", wake);
    this.screen.addEventListener("dblclick", () => this.toggleFullscreen());
  }

  buildHelp() {
    this.el.helpList.replaceChildren(...EFFECTS.map((E, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<kbd>${i + 1}</kbd> ${E.label}`;
      b.addEventListener("click", () => this.switchTo(i));
      li.append(b);
      return li;
    }));
  }

  // --- drawing ----------------------------------------------------------------

  updateHud(now) {
    const visible = this.started && !this.hudHidden && now <= this.hudUntil;
    document.body.classList.toggle("idle", this.started && now > this.hudUntil && !this.showHelp);
    this.el.hud.classList.toggle("show", visible && !this.showHelp);
    this.el.controls.classList.toggle("show", this.started && (now <= this.hudUntil || this.showHelp));
    this.el.help.hidden = !this.showHelp;
    const status =
      `${this.index + 1}/${EFFECTS.length}  ${EFFECTS[this.index].label}   |   ` +
      `${this.tempo.bpm.toFixed(0)} BPM   speed ${this.speed.toFixed(2)}x   ` +
      `auto ${this.auto ? "on" : "off"}${this.blackout ? "   BLACKOUT" : ""}`;
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.el.status.textContent = status;
      this.el.auto.setAttribute("aria-pressed", String(this.auto));
      this.el.blackout.setAttribute("aria-pressed", String(this.blackout));
      this.el.bpm.textContent = this.tempo.bpm.toFixed(0);
      this.el.helpList.querySelectorAll("button").forEach((b, i) =>
        b.classList.toggle("current", i === this.index));
    }
  }

  frame(dtReal) {
    const now = performance.now() / 1000;
    const beatHit = this.tempo.advance(dtReal);
    if (this.auto && beatHit && now - this.lastSwitch >= this.autoInterval && Math.floor(this.tempo.beat) % 4 === 0) {
      this.switchTo(this.index + 1);
    }

    const dt = dtReal * this.speed;
    this.t += dt;
    this.hue = (this.hue + dtReal * 0.015) % 1;
    const beat = this.tempo.beat;
    const beatPhase = beat % 1;
    const f = { t: this.t, dt, beat, beatHit, bpm: this.tempo.bpm, hue: this.hue,
                beatPhase, pulse: Math.exp(-beatPhase * 6) };
    this.effect.render(this.ctx, f);

    const s = this.sctx;
    s.globalAlpha = 1;
    s.globalCompositeOperation = "source-over";
    s.drawImage(this.canvas, 0, 0);

    if (this.fading) {
      const k = (now - this.fadeStart) / CROSSFADE_SECONDS;
      if (k >= 1) this.fading = false;
      else {
        s.globalAlpha = 1 - k;
        s.drawImage(this.fadeFrom, 0, 0);
        s.globalAlpha = 1;
      }
    }

    const target = this.blackout ? 0 : 1;
    const step = dtReal / 0.5;  // half a second to fade in/out
    this.level = this.level < target ? Math.min(target, this.level + step) : Math.max(target, this.level - step);
    if (this.level < 1) {
      s.fillStyle = `rgba(0,0,0,${1 - this.level})`;
      s.fillRect(0, 0, this.w, this.h);
    }

    this.updateHud(now);
  }
}

const app = new App();
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  app.frame(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
