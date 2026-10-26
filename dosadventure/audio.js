// All sounds are synthesised: a PC-speaker style square wave for beeps and
// melodies, filtered noise for the mechanical sounds (floppy, disk, printer).
// The context is created on the first user gesture (the power button).

import { Music } from "./music.js";

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.clicks = true;
    this.music = new Music(this);
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.ctx.destination);
      const n = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  get ready() { return !!this.ctx && !this.muted; }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  tone(freq, dur, { type = "square", vol = 0.06, at = 0, slide = 0, attack = 0.004 } = {}) {
    if (!this.ready) return;
    const t = this.now + at;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - 0.02));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, { freq = 1000, q = 1, vol = 0.1, at = 0, type = "bandpass", decay = true } = {}) {
    if (!this.ready) return;
    const t = this.now + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    if (decay) g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    else g.gain.setValueAtTime(0, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  // Melody as [[freq, seconds], ...]; freq 0 is a rest.
  tune(notes, { type = "square", vol = 0.05, gap = 0.012 } = {}) {
    let at = 0;
    for (const [f, d] of notes) {
      if (f) this.tone(f, Math.max(0.02, d - gap), { type, vol, at });
      at += d;
    }
    return at;
  }

  beep() { this.tone(880, 0.16, { vol: 0.05 }); }
  error() { this.tone(220, 0.2, { vol: 0.05 }); }
  blip(f = 660) { this.tone(f, 0.05, { vol: 0.04 }); }

  key() {
    if (!this.clicks) return;
    this.noise(0.025, { freq: 3200 + Math.random() * 800, q: 2, vol: 0.05 });
  }

  hdd() {
    for (let i = 0; i < 3; i++) this.noise(0.015, { freq: 2500, q: 5, vol: 0.05, at: i * 0.045 + Math.random() * 0.02 });
  }

  floppy() {
    // motor hum plus head-seek clicks
    this.tone(48, 0.7, { type: "sawtooth", vol: 0.025 });
    for (let i = 0; i < 9; i++) this.noise(0.02, { freq: 900, q: 3, vol: 0.09, at: 0.05 + i * 0.06 });
    this.noise(0.3, { freq: 400, q: 1, vol: 0.04, at: 0.6 });
  }

  floppyInsert() {
    this.noise(0.08, { freq: 600, q: 1, vol: 0.12 });
    this.noise(0.05, { freq: 1500, q: 3, vol: 0.1, at: 0.12 });
  }

  thunk() {
    this.tone(90, 0.25, { type: "sine", vol: 0.25, slide: 40 });
    this.noise(0.12, { freq: 300, q: 0.7, vol: 0.15 });
    // degauss: a 50 Hz-ish hum that dies away
    this.tone(55, 0.9, { type: "sawtooth", vol: 0.03, at: 0.05, slide: 50 });
    this.tone(15600, 1.5, { type: "sine", vol: 0.004, at: 0.1 });
  }

  printer(dur = 1.4) {
    for (let t = 0; t < dur; t += 0.032) this.noise(0.025, { freq: 1800 + Math.sin(t * 9) * 500, q: 4, vol: 0.06, at: t });
    this.noise(0.25, { freq: 500, q: 1, vol: 0.05, at: dur });
  }

  grind() {
    for (let t = 0; t < 1.8; t += 0.09) this.noise(0.12, { freq: 160 + Math.random() * 60, q: 1.5, vol: 0.12, at: t });
  }

  purr() {
    for (let t = 0; t < 1.6; t += 0.04) this.noise(0.035, { freq: 120, q: 0.8, vol: 0.12 * (0.5 + 0.5 * Math.sin(t * 2)), at: t, type: "lowpass" });
  }

  chime() {
    if (!this.ready) return;
    const chord = [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36], [783.99, 0.9], [1318.5, 1.0]];
    for (const [f, at] of chord) {
      this.tone(f, 1.8, { type: "triangle", vol: 0.06, at, attack: 0.02 });
      this.tone(f * 2, 1.2, { type: "sine", vol: 0.015, at, attack: 0.02 });
    }
  }
}
