// 8-bit soundtrack: a tiny step sequencer with NES-style voices (pulse waves
// at 12.5/25/50% duty, a triangle bass and noise drums). Each program names a
// track via its `music` property; main.js switches tracks when that changes.
//
// Patterns are 16 steps per bar, one token per step:
//   "C5" note, "Bb3" / "F#4" accidentals, "-" holds the previous note, "." rest.
//   Drums: "k" kick, "s" snare, "h" hi-hat.

const TRACKS = {
  // C:\> - calm arpeggios, the melody only joins on every other loop
  dos: {
    bpm: 76,
    ch: [
      { wave: "p12", vol: 0.035, bars: [
        "A3 C4 E4 C4 A4 C4 E4 C4 A3 C4 E4 C4 A4 C4 E4 C4",
        "F3 A3 C4 A3 F4 A3 C4 A3 F3 A3 C4 A3 F4 A3 C4 A3",
        "C4 E4 G4 E4 C5 E4 G4 E4 C4 E4 G4 E4 C5 E4 G4 E4",
        "G3 B3 D4 B3 G4 B3 D4 B3 G3 B3 D4 B3 G4 B3 D4 B3",
      ] },
      { wave: "tri", vol: 0.09, bars: [
        "A2 - - - - - - - E2 - - - - - - -",
        "F2 - - - - - - - C2 - - - - - - -",
        "C2 - - - - - - - G2 - - - - - - -",
        "G2 - - - - - - - D2 - - - - - - -",
      ] },
      { wave: "p50", vol: 0.03, alternate: true, bars: [
        "E5 - - - D5 - C5 - - - B4 - C5 - - -",
        "A4 - - - - - - - C5 - - - A4 - - -",
        "G4 - - - C5 - - - E5 - - - D5 - C5 -",
        "B4 - - - - - - - D5 - - - - - - -",
      ] },
    ],
  },
  quest: {
    bpm: 96,
    ch: [
      { wave: "p25", vol: 0.04, bars: [
        "D4 - F4 - A4 - G4 F4 E4 - D4 - E4 - F4 -",
        "C4 - E4 - G4 - F4 E4 D4 - - - - - - -",
        "D4 - F4 - A4 - C5 - Bb4 - A4 - G4 - A4 -",
        "F4 - E4 - D4 - C4 - D4 - - - - - - -",
      ] },
      { wave: "tri", vol: 0.09, bars: [
        "D3 - - - A2 - - - D3 - - - A2 - - -",
        "C3 - - - G2 - - - C3 - - - G2 - - -",
        "Bb2 - - - F2 - - - G2 - - - A2 - - -",
        "D3 - - - A2 - - - D3 - A2 - D3 - - -",
      ] },
      { wave: "drums", vol: 0.5, bars: ["k . h . . . h . s . h . . . h ."] },
    ],
  },
  nibbler: {
    bpm: 132,
    ch: [
      { wave: "p25", vol: 0.04, bars: [
        "C5 . E5 . G5 . E5 . C5 . E5 . G5 - - .",
        "A4 . C5 . F5 . C5 . A4 . C5 . F5 - - .",
        "G4 . B4 . D5 . B4 . G4 . B4 . D5 . F5 .",
        "E5 . D5 . C5 . G4 . C5 - - - . . . .",
      ] },
      { wave: "tri", vol: 0.1, bars: [
        "C3 . C3 G2 C3 . C3 G2 C3 . C3 G2 C3 . G2 .",
        "F2 . F2 C3 F2 . F2 C3 F2 . F2 C3 F2 . C3 .",
        "G2 . G2 D3 G2 . G2 D3 G2 . G2 D3 G2 . D3 .",
        "C3 . C3 G2 C3 . E3 . G3 . E3 . C3 . . .",
      ] },
      { wave: "drums", vol: 0.5, bars: ["k . h . s . h . k . h . s . h h"] },
    ],
  },
  brixx: {
    bpm: 150,
    ch: [
      { wave: "p12", vol: 0.035, bars: [
        "E5 . G5 . B5 . A5 G5 F#5 . E5 . D5 . E5 .",
        "C5 . E5 . G5 . F#5 E5 D5 . C5 . B4 . . .",
        "E5 . G5 . B5 . D6 . C6 . B5 . A5 . G5 .",
        "F#5 . A5 . G5 . F#5 . E5 - - - . . . .",
      ] },
      { wave: "tri", vol: 0.1, bars: [
        "E2 E3 E2 E3 E2 E3 E2 E3 E2 E3 E2 E3 E2 E3 E2 E3",
        "C2 C3 C2 C3 C2 C3 C2 C3 G2 G3 G2 G3 G2 G3 G2 G3",
        "E2 E3 E2 E3 E2 E3 E2 E3 A2 A3 A2 A3 A2 A3 A2 A3",
        "B1 B2 B1 B2 B1 B2 B1 B2 E2 E3 E2 E3 E2 E3 E2 E3",
      ] },
      { wave: "drums", vol: 0.55, bars: ["k . h . s . h k k . h . s . h h"] },
    ],
  },
  labyrint: {
    bpm: 112,
    ch: [
      { wave: "p50", vol: 0.04, bars: [
        "A2 . A2 . C3 . A2 . A2 . A2 . D#3 . E3 .",
        "A2 . A2 . C3 . A2 . G2 . G2 . F2 . E2 .",
      ] },
      { wave: "p12", vol: 0.03, alternate: true, bars: [
        "E5 - - - - - - - D#5 - - - E5 - - -",
        "C5 - - - B4 - - - A4 - - - - - - -",
      ] },
      { wave: "drums", vol: 0.45, bars: ["k . . . h . . . k . k . h . . ."] },
    ],
  },
  panes: {
    bpm: 118,
    ch: [
      { wave: "p25", vol: 0.04, bars: [
        "C5 - E5 - G5 - - - E5 - G5 - C6 - - -",
        "A5 - G5 - F5 - E5 - D5 - E5 - F5 - - -",
        "E5 - G5 - C6 - - - B5 - A5 - G5 - - -",
        "F5 - E5 - D5 - G5 - C5 - - - - - - -",
      ] },
      { wave: "p50", vol: 0.025, bars: [
        "E4 - - - - - - - G4 - - - - - - -",
        "F4 - - - - - - - G4 - - - - - - -",
        "E4 - - - - - - - D4 - - - - - - -",
        "D4 - - - B3 - - - C4 - - - - - - -",
      ] },
      { wave: "tri", vol: 0.09, bars: [
        "C3 - G2 - C3 - G2 - C3 - G2 - C3 - G2 -",
        "F2 - C3 - F2 - C3 - G2 - D3 - G2 - D3 -",
        "C3 - G2 - C3 - G2 - E2 - B2 - E2 - B2 -",
        "F2 - C3 - G2 - D3 - C3 - G2 - C3 - - -",
      ] },
      { wave: "drums", vol: 0.45, bars: ["k . h . s . h . k . h . s . h ."] },
    ],
  },
};

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function freq(note) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(note);
  if (!m) return 0;
  const midi = 12 * (Number(m[3]) + 1) + SEMI[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  return 440 * 2 ** ((midi - 69) / 12);
}

for (const t of Object.values(TRACKS)) for (const c of t.ch) c.steps = c.bars.join(" ").split(/\s+/);

export class Music {
  constructor(audio) {
    this.a = audio;
    this.enabled = true;
    this.want = null;      // track the active program asks for
    this.name = null;      // track actually playing
    this.timer = 0;
    this.waves = null;
  }

  // Pulse waves with a given duty cycle, built from their Fourier series.
  pulse(duty) {
    const ctx = this.a.ctx, n = 32;
    const real = new Float32Array(n), imag = new Float32Array(n);
    for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return ctx.createPeriodicWave(real, imag);
  }

  setEnabled(on) {
    this.enabled = on;
    const w = this.want;
    this.want = null;
    this.stop();
    this.play(w);
  }

  play(name) {
    this.want = name || null;
    const target = this.enabled && this.a.ctx && !this.a.muted ? this.want : null;
    if (target === this.name) return;
    this.stop();
    if (!target || !TRACKS[target]) return;
    const ctx = this.a.ctx;
    if (!this.waves) this.waves = { p12: this.pulse(0.125), p25: this.pulse(0.25), p50: this.pulse(0.5) };
    this.name = target;
    this.track = TRACKS[target];
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.9;
    this.bus.connect(this.a.master);
    this.step = 0;
    this.next = ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
    if (this.bus) {
      const bus = this.bus, t = this.a.ctx.currentTime;
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0, t + 0.15);
      setTimeout(() => bus.disconnect(), 400);
      this.bus = null;
    }
    this.name = null;
  }

  tick() {
    const ctx = this.a.ctx;
    const spb = 60 / this.track.bpm / 4;
    // after the tab was in the background, skip ahead instead of bursting
    if (this.next < ctx.currentTime - 0.05) this.next = ctx.currentTime + 0.05;
    while (this.next < ctx.currentTime + 0.12) {
      for (const c of this.track.ch) this.schedule(c, this.step, this.next, spb);
      this.step++;
      this.next += spb;
    }
  }

  schedule(c, step, t, spb) {
    const n = c.steps.length;
    const i = step % n;
    if (c.alternate && Math.floor(step / n) % 2 === 1) return;
    const tok = c.steps[i];
    if (tok === "." || tok === "-") return;
    if (c.wave === "drums") return this.drum(tok, t, c.vol);
    let len = 1;
    while (c.steps[(i + len) % n] === "-" && len < n) len++;
    this.voice(c.wave, freq(tok), t, len * spb * 0.92, c.vol);
  }

  voice(wave, f, t, dur, vol) {
    if (!f) return;
    const ctx = this.a.ctx;
    const o = ctx.createOscillator();
    if (wave === "tri") o.type = "triangle";
    else o.setPeriodicWave(this.waves[wave]);
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.linearRampToValueAtTime(vol * 0.7, t + Math.min(0.08, dur * 0.5));
    g.gain.setValueAtTime(vol * 0.7, t + Math.max(0.01, dur - 0.03));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  drum(kind, t, vol) {
    const ctx = this.a.ctx;
    if (kind === "k") {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(vol * 0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(g).connect(this.bus);
      o.start(t);
      o.stop(t + 0.15);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.a.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = kind === "s" ? 1200 : 7000;
    const g = ctx.createGain();
    const d = kind === "s" ? 0.12 : 0.03;
    g.gain.setValueAtTime(vol * (kind === "s" ? 0.22 : 0.08), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    src.connect(f).connect(g).connect(this.bus);
    src.start(t, Math.random());
    src.stop(t + d + 0.02);
  }
}
