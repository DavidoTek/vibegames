// All sounds are synthesized; nothing is loaded. The context starts on the
// first user gesture (browsers block audio before that).

const VOICES = 3;    // own engine + the two nearest other cars

export class Sounds {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.voices = [];
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
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    for (let k = 0; k < VOICES; k++) this.voices.push(this.engineVoice());
    // Tyre squeal: band-passed noise, gain follows slip.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 3;
    this.skid = ctx.createGain(); this.skid.gain.value = 0;
    src.connect(bp).connect(this.skid).connect(this.master);
    src.start();
  }

  engineVoice() {
    const ctx = this.ctx;
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.type = "sawtooth"; b.type = "square";
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    a.connect(lp); b.connect(lp);
    lp.connect(g);
    if (pan) g.connect(pan).connect(this.master); else g.connect(this.master);
    a.start(); b.start();
    return { a, b, lp, g, pan };
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  // engines: [{ speed, throttle, gain, pan }], own car first.
  update(engines, slip) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.voices.forEach((v, k) => {
      const e = engines[k];
      if (!e) { v.g.gain.setTargetAtTime(0, t, 0.1); return; }
      // Fake five-speed gearbox: rpm climbs within each gear, then drops.
      const sp = Math.abs(e.speed), gear = Math.min(4, Math.floor(sp / 15));
      const rpm = 0.25 + 0.75 * ((sp - gear * 15) / 15 + gear * 0.12) / 1.5;
      const f = 45 + rpm * 120 + (e.throttle ? 8 : 0);
      v.a.frequency.setTargetAtTime(f, t, 0.04);
      v.b.frequency.setTargetAtTime(f * 0.501, t, 0.04);
      v.lp.frequency.setTargetAtTime(500 + rpm * 1400 + e.throttle * 500, t, 0.05);
      v.g.gain.setTargetAtTime(e.gain * (0.05 + e.throttle * 0.05), t, 0.06);
      if (v.pan) v.pan.pan.setTargetAtTime(e.pan, t, 0.05);
    });
    this.skid.gain.setTargetAtTime(slip > 0.3 ? (slip - 0.3) * 0.12 : 0, t, 0.05);
  }

  silence() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this.voices) v.g.gain.setTargetAtTime(0, t, 0.1);
    this.skid.gain.setTargetAtTime(0, t, 0.05);
  }

  tone(freq, dur, type = "square", vol = 0.08, slideTo = 0, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, freq, vol, type = "lowpass") {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  light() { this.tone(440, 0.25, "square", 0.07); }
  go() { this.tone(880, 0.5, "square", 0.08); }
  hit(strength) { this.noise(0.25, 300, Math.min(0.4, strength * 0.03)); }
  lap() { this.tone(660, 0.12, "triangle", 0.1); this.tone(990, 0.2, "triangle", 0.1, 0, 0.12); }
  finish() {
    [523, 659, 784, 1047].forEach((f, k) => this.tone(f, 0.3, "triangle", 0.1, 0, k * 0.13));
  }
  click() { this.tone(1200, 0.04, "square", 0.04); }
}
