// All sound is synthesized: short effects, a PSU hum, and a step-sequencer
// loop that gains a layer with every POST line that turns OK. The context is
// created on the first user gesture.

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function freq(name) {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  const semi = NOTE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return 440 * 2 ** ((semi - 69) / 12);
}

export class Sounds {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate / 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Power supply hum, always there.
    const hum = ctx.createGain();
    hum.gain.value = 0.018;
    hum.connect(this.master);
    for (const f of [50, 100.4, 149]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(hum);
      o.start();
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  tone(f, dur, type = "square", vol = 0.08, slideTo = 0, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, f, vol, type = "bandpass", delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  arp(freqs, step, type = "triangle", vol = 0.1, dur = 0.14) {
    freqs.forEach((f, i) => this.tone(f, dur, type, vol, 0, i * step));
  }

  jump() { this.tone(260, 0.12, "square", 0.03, 420); }
  land() { this.noise(0.07, 260, 0.14, "lowpass"); }
  step() { this.noise(0.03, 900, 0.035); }
  zap() { this.tone(1400, 0.14, "sawtooth", 0.05, 300); }
  stun() { this.tone(520, 0.12, "square", 0.05, 260); }
  patch() { this.arp([660, 880, 1320], 0.05, "triangle", 0.1); }
  hurt() { this.tone(380, 0.3, "sawtooth", 0.08, 100); this.noise(0.15, 1200, 0.14); }
  gpf() { this.arp([392, 330, 262, 196], 0.16, "square", 0.06, 0.22); }
  click() { this.tone(900, 0.04, "square", 0.05); this.noise(0.03, 2400, 0.08); }
  dial() { this.tone(620, 0.05, "square", 0.04); }
  error() { this.tone(180, 0.28, "square", 0.07); }
  good() { this.arp([523, 659, 784], 0.07, "triangle", 0.11); }
  pick() { this.tone(440, 0.08, "triangle", 0.1, 700); }
  thud() { this.noise(0.2, 160, 0.4, "lowpass"); this.tone(90, 0.2, "sine", 0.2, 50); }
  power() { this.tone(60, 0.6, "sawtooth", 0.06, 180); this.arp([330, 440, 554], 0.1, "triangle", 0.08); }
  seek() { for (let i = 0; i < 5; i++) this.noise(0.05, 500 + i * 120, 0.2, "bandpass", i * 0.07); }
  moth() { this.tone(90, 1.2, "sawtooth", 0.09, 240); this.noise(0.8, 3000, 0.06); }
  screw() { this.tone(1568, 0.06, "square", 0.04); this.tone(2093, 0.16, "square", 0.04, 0, 0.06); }
  secret() { this.arp([784, 988, 1175, 1568, 1976], 0.06, "triangle", 0.11); }
  restore() { this.arp([523, 784], 0.09, "sine", 0.12, 0.2); }
  note() { this.noise(0.08, 3200, 0.06, "highpass"); }
  // The POST beep: one short, clean beep means "OK".
  post() { this.tone(1000, 0.22, "square", 0.07); }
  pad(i) { this.tone([262, 330, 392, 523][i], 0.5, "triangle", 0.14); }
  chime() {
    [262, 330, 392, 523, 659].forEach((f, i) => this.tone(f, 1.6, "sine", 0.1, 0, i * 0.12));
    this.tone(131, 2, "triangle", 0.1);
  }
}

// Patterns are 16 steps per bar: a note, "-" to hold, "." for a rest; drums
// use k (kick), s (snare) and h (hat). `from` is the number of POST lines
// that must be OK before the channel joins in.
const SONG = {
  bpm: 84,
  ch: [
    { wave: "triangle", vol: 0.1, from: 0, bars: [
      "A2 - - - - - - - E2 - - - - - - -",
      "F2 - - - - - - - C2 - - - - - - -",
      "D2 - - - - - - - A2 - - - - - - -",
      "E2 - - - - - - - E2 - - - B1 - - -",
    ] },
    { wave: "square", vol: 0.022, from: 1, bars: [
      "A3 C4 E4 C4 A4 C4 E4 C4 A3 C4 E4 C4 A4 C4 E4 C4",
      "F3 A3 C4 A3 F4 A3 C4 A3 F3 A3 C4 A3 F4 A3 C4 A3",
      "D3 F3 A3 F3 D4 F3 A3 F3 D3 F3 A3 F3 D4 F3 A3 F3",
      "E3 G#3 B3 G#3 E4 G#3 B3 G#3 E3 G#3 B3 G#3 E4 G#3 B3 G#3",
    ] },
    { wave: "drums", vol: 0.5, from: 2, bars: ["k . . . h . . . k . h . h . . ."] },
    { wave: "square", vol: 0.026, from: 3, bars: [
      "E5 - - - D5 - C5 - - - B4 - C5 - - -",
      "A4 - - - - - - - C5 - - - A4 - - -",
      "F4 - - - A4 - - - D5 - - - C5 - A4 -",
      "B4 - - - - - - - E5 - - - - - - -",
    ] },
    { wave: "drums", vol: 0.5, from: 9, finale: true, bars: ["k . h . s . h k k . h . s . h h"] },
    { wave: "sawtooth", vol: 0.022, from: 9, finale: true, bars: [
      "A2 A2 . A2 A2 . A2 . A2 A2 . A2 C3 . B2 .",
      "F2 F2 . F2 F2 . F2 . F2 F2 . F2 A2 . G2 .",
      "D2 D2 . D2 D2 . D2 . D2 D2 . D2 F2 . E2 .",
      "E2 E2 . E2 E2 . E2 . E2 E2 . E2 G#2 . B2 .",
    ] },
  ],
};

export class Music {
  constructor(sounds) {
    this.sounds = sounds;
    this.enabled = true;
    this.level = 0;
    this.finale = false;
    this.step = 0;
    this.next = 0;
    this.playing = false;
    this.parsed = SONG.ch.map((c) => c.bars.map((b) => b.split(" ")));
  }

  start() {
    if (!this.sounds.ctx || this.playing) return;
    this.playing = true;
    this.next = this.sounds.ctx.currentTime + 0.1;
  }

  stop() { this.playing = false; }
  setLevel(n) { this.level = n; }
  setFinale(on) { this.finale = on; }

  // Call every frame: schedules the steps of the next 0.2 s.
  tick() {
    const ctx = this.sounds.ctx;
    if (!ctx || !this.playing || !this.enabled) {
      if (ctx) this.next = ctx.currentTime + 0.1;
      return;
    }
    const spb = 60 / (this.finale ? 112 : SONG.bpm) / 4;
    if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.05;   // tab was in the background
    while (this.next < ctx.currentTime + 0.2) {
      SONG.ch.forEach((c, i) => {
        if (c.finale ? !this.finale : this.level < c.from) return;
        const bars = this.parsed[i];
        const bar = bars[Math.floor(this.step / 16) % bars.length];
        const tok = bar[this.step % 16];
        if (tok === "." || tok === "-") return;
        if (c.wave === "drums") { this.drum(tok, this.next, c.vol); return; }
        let hold = 1;
        while (hold < 16 && bar[(this.step % 16) + hold] === "-") hold++;
        this.voice(c.wave, freq(tok), this.next, hold * spb * 0.95, c.vol);
      });
      this.step++;
      this.next += spb;
    }
  }

  voice(wave, f, t, dur, vol) {
    const ctx = this.sounds.ctx;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.setValueAtTime(vol, t + Math.max(0.02, dur - 0.04));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sounds.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  drum(kind, t, vol) {
    const ctx = this.sounds.ctx, out = this.sounds.master;
    if (kind === "k") {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(vol * 0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.16);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.sounds.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = kind === "h" ? 7000 : 1800;
    const g = ctx.createGain();
    const dur = kind === "h" ? 0.04 : 0.12;
    g.gain.setValueAtTime(vol * (kind === "h" ? 0.05 : 0.12), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}
