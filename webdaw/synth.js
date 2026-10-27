// WebDAW audio engine: a small mixer (channel strips, reverb, delay, master
// bus), the instruments and the step scheduler. Everything is plain Web Audio
// built against the context passed in, so the same code plays live and
// renders WAV files through an OfflineAudioContext.

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const stepDur = (bpm) => 60 / bpm / 4;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const DRUMS = ["Kick", "Snare", "Clap", "Rim", "Closed Hat", "Open Hat", "Low Tom", "Hi Tom", "Cowbell", "Crash"];

// ---------------------------------------------------------------- helpers

const noiseBuffers = new WeakMap();
function noiseBuffer(ctx) {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

function noise(ctx, t, dur) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur);
  return src;
}

function osc(ctx, type, freq, t, end) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.start(t);
  if (end) o.stop(end);
  return o;
}

function gain(ctx, v = 1) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function filter(ctx, type, freq, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

// Decays use setTargetAtTime rather than ramps: a later cancelScheduledValues
// (hi-hat choke, 808 cut) then keeps the curve up to that point instead of
// dropping a ramp and holding the start value.
function decay(param, t, v, tau) {
  param.setValueAtTime(v, t);
  param.setTargetAtTime(0, t + 0.001, tau);
}

// ADSR on an AudioParam; returns release(t) -> time the tail is silent. The
// value at release is computed here because Firefox lacks cancelAndHoldAtTime.
function adsr(param, t, base, peak, { a, d, s, r }) {
  a = Math.max(a, 0.002);
  r = Math.max(r, 0.005);
  const tau = Math.max(d, 0.005) / 3;
  const sus = base + (peak - base) * s;
  param.setValueAtTime(base, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(sus, t + a, tau);
  return (tr) => {
    tr = Math.max(tr, t);
    const v = tr < t + a
      ? base + (peak - base) * (tr - t) / a
      : sus + (peak - sus) * Math.exp(-(tr - t - a) / tau);
    param.cancelScheduledValues(tr);
    param.setValueAtTime(v, tr);
    param.setTargetAtTime(base, tr, r / 4);
    return tr + r * 1.5;
  };
}

// Stops every source once; voices may be released twice (live key + cut).
function releaser(oscs, ...envs) {
  let end = null;
  return (tr) => {
    if (end !== null) return end;
    end = Math.max(...envs.map((rel) => rel(tr))) + 0.02;
    for (const o of oscs) o.stop(end);
    return end;
  };
}

function impulse(ctx, secs) {
  const len = Math.floor(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return buf;
}

function driveCurve(amount) {
  const k = 1 + amount * 14, n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1) * 2 - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}

// ---------------------------------------------------------------- 808 drums

const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

function metal(ctx, t, end, k) {
  const sum = gain(ctx, 0.3);
  for (const f of METAL) osc(ctx, "square", f * k, t, end).connect(sum);
  return sum;
}

function kick(ctx, ch, t, v, p, k) {
  const len = p.kdecay * 2.2 + 0.1;
  const o = osc(ctx, "sine", 50, t, t + len);
  o.frequency.setValueAtTime(190 * k, t);
  o.frequency.exponentialRampToValueAtTime(58 * k, t + 0.045);
  o.frequency.exponentialRampToValueAtTime(46 * k, t + len);
  const g = gain(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v * 1.1, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.012, p.kdecay / 3);
  o.connect(g).connect(ch.input);
  // a tiny click so the kick still cuts through on phone speakers
  const cg = gain(ctx, 0);
  decay(cg.gain, t, v * 0.35, 0.002);
  noise(ctx, t, 0.02).connect(filter(ctx, "lowpass", 4000)).connect(cg).connect(ch.input);
}

function snare(ctx, ch, t, v, p, k) {
  const body = gain(ctx, 0);
  decay(body.gain, t, v * 0.45, 0.045);
  for (const f of [185, 330]) osc(ctx, "triangle", f * k, t, t + 0.4).connect(body);
  body.connect(ch.input);
  const ng = gain(ctx, 0);
  decay(ng.gain, t, v * (0.3 + 0.45 * p.snap), 0.035 + 0.07 * p.snap);
  noise(ctx, t, 0.6).connect(filter(ctx, "highpass", 1400)).connect(ng).connect(ch.input);
}

function clap(ctx, ch, t, v) {
  const g = gain(ctx, 0);
  for (const dt of [0, 0.011, 0.022]) {
    g.gain.setValueAtTime(v * 1.4, t + dt);
    g.gain.setTargetAtTime(0, t + dt + 0.001, 0.004);
  }
  g.gain.setValueAtTime(v * 1.3, t + 0.033);
  g.gain.setTargetAtTime(0, t + 0.034, 0.075);
  noise(ctx, t, 0.7).connect(filter(ctx, "bandpass", 1150, 1.1)).connect(g).connect(ch.input);
}

function rim(ctx, ch, t, v, p, k) {
  const g = gain(ctx, 0), hp = filter(ctx, "highpass", 300);
  decay(g.gain, t, v * 0.5, 0.011);
  osc(ctx, "triangle", 1700 * k, t, t + 0.1).connect(hp);
  osc(ctx, "square", 455 * k, t, t + 0.1).connect(gain(ctx, 0.4)).connect(hp);
  hp.connect(g).connect(ch.input);
}

function hat(ctx, ch, t, v, tau, open) {
  const end = t + tau * 7 + 0.05, st = ch.state;
  const g = gain(ctx, 0);
  decay(g.gain, t, v * 0.6, tau);
  metal(ctx, t, end, 1)
    .connect(filter(ctx, "bandpass", 10000, 0.8))
    .connect(filter(ctx, "highpass", 7000))
    .connect(g).connect(ch.input);
  // any hat chokes a still-ringing open hat, like on the real machine
  if (st.open && st.openEnd > t) {
    st.open.gain.cancelScheduledValues(t);
    st.open.gain.setTargetAtTime(0, t, 0.006);
  }
  if (open) { st.open = g; st.openEnd = end; }
}

function tom(ctx, ch, t, v, f) {
  const o = osc(ctx, "sine", f, t, t + 0.9);
  o.frequency.setValueAtTime(f * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
  const g = gain(ctx, 0);
  decay(g.gain, t, v * 0.85, 0.14);
  o.connect(g).connect(ch.input);
}

function cowbell(ctx, ch, t, v, p, k) {
  const g = gain(ctx, 0), bp = filter(ctx, "bandpass", 820 * k, 1.2);
  g.gain.setValueAtTime(v * 0.9, t);
  g.gain.setTargetAtTime(v * 0.3, t + 0.001, 0.01);
  g.gain.setTargetAtTime(0, t + 0.03, 0.09);
  for (const f of [540, 800]) osc(ctx, "square", f * k, t, t + 0.7).connect(bp);
  bp.connect(g).connect(ch.input);
}

function crash(ctx, ch, t, v, p) {
  const tau = 0.55 * p.hat, end = t + tau * 7, hp = filter(ctx, "highpass", 4500), g = gain(ctx, 0);
  decay(g.gain, t, v * 0.5, tau);
  metal(ctx, t, end, 1.37).connect(hp);
  noise(ctx, t, end - t).connect(gain(ctx, 0.5)).connect(hp);
  hp.connect(g).connect(ch.input);
}

function playDrum(ctx, ch, t, row, v, p) {
  const k = Math.pow(2, p.tune / 12);
  switch (row) {
    case 0: kick(ctx, ch, t, v, p, k); break;
    case 1: snare(ctx, ch, t, v, p, k); break;
    case 2: clap(ctx, ch, t, v); break;
    case 3: rim(ctx, ch, t, v, p, k); break;
    case 4: hat(ctx, ch, t, v, 0.02 * p.hat, false); break;
    case 5: hat(ctx, ch, t, v, 0.13 * p.hat, true); break;
    case 6: tom(ctx, ch, t, v, 95 * k); break;
    case 7: tom(ctx, ch, t, v, 165 * k); break;
    case 8: cowbell(ctx, ch, t, v, p, k); break;
    case 9: crash(ctx, ch, t, v, p); break;
  }
  return () => t; // one-shots ignore note length
}

// ---------------------------------------------------------------- synth voices

function polyVoice(ctx, ch, t, pitch, vel, p) {
  const f = mtof(pitch);
  const flt = filter(ctx, "lowpass", p.cutoff, p.reso), amp = gain(ctx, 0);
  flt.connect(amp).connect(ch.input);
  const lfo = osc(ctx, "sine", 5.5, t), depth = gain(ctx, p.vibrato);
  lfo.connect(depth);
  const oscs = [lfo];
  const add = (type, det, level) => {
    if (level < 0.001) return;
    const o = osc(ctx, type, f, t);
    o.detune.value = det;
    depth.connect(o.detune);
    o.connect(gain(ctx, level)).connect(flt);
    oscs.push(o);
  };
  add("sawtooth", -p.detune, (1 - p.wave) * 0.5);
  add("sawtooth", p.detune, (1 - p.wave) * 0.5);
  add("square", p.detune * 0.5, p.wave * 0.5);
  const top = clamp(p.cutoff * Math.pow(2, p.envAmt), 20, 18000);
  return releaser(oscs,
    adsr(flt.frequency, t, p.cutoff, top, { a: 0.003 + p.attack * 0.3, d: p.fdecay, s: 0, r: p.release }),
    adsr(amp.gain, t, 0, vel * 0.45, { a: p.attack, d: p.decay, s: p.sustain, r: p.release }));
}

function sawVoice(ctx, ch, t, pitch, vel, p) {
  const f = mtof(pitch), n = 7;
  const hp = filter(ctx, "highpass", 90), flt = filter(ctx, "lowpass", p.cutoff, p.reso), amp = gain(ctx, 0);
  hp.connect(flt).connect(amp).connect(ch.input);
  const oscs = [];
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1) * 2 - 1; // -1..1 across the stack
    // slightly staggered starts so the saws don't begin in phase (a click)
    const o = osc(ctx, "sawtooth", f, t + Math.random() * 0.003);
    o.detune.value = s * p.detune;
    const pan = ctx.createStereoPanner();
    pan.pan.value = s * p.width;
    o.connect(gain(ctx, i === 3 ? 1 : p.mix)).connect(pan).connect(hp);
    oscs.push(o);
  }
  const level = vel * 0.38 / Math.sqrt(1 + 6 * p.mix * p.mix);
  return releaser(oscs, adsr(amp.gain, t, 0, level, { a: p.attack, d: p.decay, s: p.sustain, r: p.release }));
}

function reeseVoice(ctx, ch, t, pitch, vel, p) {
  const f = mtof(pitch);
  const flt = filter(ctx, "lowpass", p.cutoff, p.reso), amp = gain(ctx, 0);
  flt.connect(amp).connect(ch.input);
  // the LFO sweeps the filter for the classic slow "breathing" movement
  const lfo = osc(ctx, "sine", p.rate, t);
  lfo.connect(gain(ctx, p.cutoff * p.wobble * 0.9)).connect(flt.frequency);
  const oscs = [lfo];
  for (const det of [-p.detune, p.detune]) {
    const o = osc(ctx, "sawtooth", f, t);
    o.detune.value = det;
    o.connect(gain(ctx, 0.5)).connect(flt);
    oscs.push(o);
  }
  // the sub sine skips the filter so the low end stays solid
  const sub = osc(ctx, "sine", f, t);
  sub.connect(gain(ctx, p.sub * 0.9)).connect(amp);
  oscs.push(sub);
  return releaser(oscs, adsr(amp.gain, t, 0, vel * 0.3, { a: p.attack, d: 0.1, s: 1, r: p.release }));
}

// Monophonic: a new note cuts the old one and glides from its pitch when
// the notes overlap (the trap "808 slide").
function subVoice(ctx, ch, t, pitch, vel, p) {
  const st = ch.state, f = mtof(pitch), prev = st.mono;
  const slide = prev && prev.end > t + 0.001 && p.glide > 0.005;
  if (prev) prev.kill(t);
  const amp = gain(ctx, 0), oscs = [];
  amp.connect(ch.input);
  for (const [mul, level] of [[1, 1], [2, 0.12]]) {
    // the quiet 2nd harmonic makes the 808 audible on small speakers
    const o = osc(ctx, "sine", f * mul, t), fr = o.frequency;
    if (slide) {
      fr.setValueAtTime(prev.freq * mul, t);
      fr.exponentialRampToValueAtTime(f * mul, t + p.glide);
    } else {
      fr.setValueAtTime(f * mul * Math.pow(2, p.punch / 12), t);
      fr.exponentialRampToValueAtTime(f * mul, t + 0.05);
    }
    o.connect(gain(ctx, level)).connect(amp);
    oscs.push(o);
  }
  const peak = vel * 0.55, tau = p.decay / 3, t1 = t + 0.004;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t1);
  amp.gain.setTargetAtTime(0, t1, tau);
  const voice = { freq: f, end: Infinity };
  const release = releaser(oscs, (tr) => {
    tr = Math.max(tr, t1);
    voice.end = tr;
    amp.gain.cancelScheduledValues(tr);
    amp.gain.setValueAtTime(peak * Math.exp(-(tr - t1) / tau), tr);
    amp.gain.setTargetAtTime(0, tr, p.release / 4);
    return tr + p.release * 1.5;
  });
  voice.kill = (tk) => {
    if (voice.end <= tk) return;
    release(tk + 0.05);
    amp.gain.cancelScheduledValues(tk);
    amp.gain.setTargetAtTime(0, tk, 0.006);
  };
  st.mono = voice;
  return release;
}

// ---------------------------------------------------------------- instruments

const P = (key, label, min, max, def, unit = "", log = false) => ({ key, label, min, max, def, unit, log });
const ENV = [
  P("attack", "Attack", 0.002, 3, 0.005, "s", true),
  P("decay", "Decay", 0.02, 3, 0.3, "s", true),
  P("sustain", "Sustain", 0, 1, 0.6, "%"),
  P("release", "Release", 0.01, 4, 0.25, "s", true),
];

export const INSTRUMENTS = {
  drums: {
    name: "808 Drums", short: "808 KIT", drum: true,
    noteOn: playDrum,
    params: [
      P("tune", "Tune", -12, 12, 0, "st"),
      P("kdecay", "Kick decay", 0.1, 2, 0.6, "s", true),
      P("snap", "Snare snap", 0, 1, 0.6, "%"),
      P("hat", "Hat decay", 0.3, 3, 1, "x", true),
    ],
    presets: {
      "TR Classic": { tune: 0, kdecay: 0.6, snap: 0.6, hat: 1 },
      "Deep Boom": { tune: -3, kdecay: 1.4, snap: 0.5, hat: 1.2 },
      "Tight": { tune: 2, kdecay: 0.3, snap: 0.9, hat: 0.6 },
    },
  },
  poly: {
    name: "80s Poly", short: "80S POLY",
    noteOn: polyVoice,
    params: [
      P("wave", "Saw / Square", 0, 1, 0.3, "%"),
      P("detune", "Detune", 0, 40, 10, "ct"),
      P("vibrato", "Vibrato", 0, 40, 0, "ct"),
      P("cutoff", "Cutoff", 80, 16000, 2000, "Hz", true),
      P("reso", "Resonance", 0.1, 18, 2),
      P("envAmt", "Filter env", 0, 5, 2, "oct"),
      P("fdecay", "Filter decay", 0.02, 3, 0.4, "s", true),
      ...ENV,
    ],
    presets: {
      "Synth Bass": { wave: 0.2, detune: 6, vibrato: 0, cutoff: 240, reso: 6, envAmt: 3.2, fdecay: 0.18, attack: 0.002, decay: 0.25, sustain: 0.5, release: 0.06 },
      "Warm Pad": { wave: 0.35, detune: 14, vibrato: 6, cutoff: 900, reso: 1.5, envAmt: 1.2, fdecay: 1.6, attack: 0.9, decay: 1.5, sustain: 0.8, release: 1.6 },
      "Pluck": { wave: 0.5, detune: 8, vibrato: 0, cutoff: 600, reso: 4, envAmt: 3.5, fdecay: 0.16, attack: 0.002, decay: 0.25, sustain: 0, release: 0.2 },
      "Brass": { wave: 0.1, detune: 10, vibrato: 8, cutoff: 700, reso: 1.2, envAmt: 2.5, fdecay: 0.35, attack: 0.06, decay: 0.4, sustain: 0.75, release: 0.25 },
      "Bell": { wave: 0.9, detune: 3, vibrato: 0, cutoff: 2400, reso: 2, envAmt: 2, fdecay: 0.3, attack: 0.002, decay: 0.6, sustain: 0, release: 0.5 },
    },
  },
  supersaw: {
    name: "Super Saw", short: "SUPERSAW",
    noteOn: sawVoice,
    params: [
      P("detune", "Detune", 0, 60, 22, "ct"),
      P("mix", "Side saws", 0, 1, 0.7, "%"),
      P("width", "Stereo width", 0, 1, 0.8, "%"),
      P("cutoff", "Cutoff", 200, 16000, 6000, "Hz", true),
      P("reso", "Resonance", 0.1, 12, 1),
      ...ENV,
    ],
    presets: {
      "Anthem Lead": { detune: 24, mix: 0.7, width: 0.7, cutoff: 7000, reso: 1, attack: 0.005, decay: 0.4, sustain: 0.8, release: 0.3 },
      "Stab": { detune: 20, mix: 0.75, width: 0.9, cutoff: 4500, reso: 2, attack: 0.002, decay: 0.22, sustain: 0.1, release: 0.18 },
      "Air Pad": { detune: 30, mix: 0.8, width: 1, cutoff: 2600, reso: 0.7, attack: 1.2, decay: 1, sustain: 0.9, release: 2 },
      "Dark Pad": { detune: 18, mix: 0.6, width: 0.8, cutoff: 900, reso: 1.5, attack: 0.8, decay: 1, sustain: 0.9, release: 1.5 },
    },
  },
  reese: {
    name: "Reese Bass", short: "REESE",
    noteOn: reeseVoice,
    params: [
      P("detune", "Detune", 0, 60, 18, "ct"),
      P("sub", "Sub", 0, 1, 0.5, "%"),
      P("cutoff", "Cutoff", 60, 8000, 700, "Hz", true),
      P("reso", "Resonance", 0.1, 12, 3),
      P("wobble", "LFO depth", 0, 1, 0.4, "%"),
      P("rate", "LFO rate", 0.05, 12, 0.5, "Hz", true),
      P("attack", "Attack", 0.002, 2, 0.01, "s", true),
      P("release", "Release", 0.01, 2, 0.15, "s", true),
    ],
    presets: {
      "Classic Reese": { detune: 18, sub: 0.5, cutoff: 700, reso: 3, wobble: 0.4, rate: 0.5, attack: 0.01, release: 0.15 },
      "Growl": { detune: 26, sub: 0.4, cutoff: 500, reso: 8, wobble: 0.7, rate: 4, attack: 0.005, release: 0.1 },
      "Deep Sub": { detune: 10, sub: 0.9, cutoff: 300, reso: 1, wobble: 0.2, rate: 0.25, attack: 0.01, release: 0.2 },
    },
  },
  sub808: {
    name: "808 Bass", short: "808 BASS",
    noteOn: subVoice,
    params: [
      P("decay", "Decay", 0.1, 4, 1.2, "s", true),
      P("punch", "Punch", 0, 24, 12, "st"),
      P("glide", "Glide", 0, 0.4, 0.08, "s"),
      P("release", "Release", 0.01, 1, 0.08, "s", true),
    ],
    presets: {
      "Long 808": { decay: 2, punch: 12, glide: 0.08, release: 0.08 },
      "Short Boom": { decay: 0.4, punch: 16, glide: 0.05, release: 0.05 },
      "Slide 808": { decay: 2.5, punch: 10, glide: 0.18, release: 0.1 },
    },
  },
};

// ---------------------------------------------------------------- mixer

export class Mixer {
  constructor(ctx) {
    this.ctx = ctx;
    this.channels = new Map();
    this.master = gain(ctx, 0.85);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.75;
    this.master.connect(comp).connect(this.analyser).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx, 2.6);
    this.reverb.connect(gain(ctx, 0.8)).connect(this.master);

    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.45;
    const tone = filter(ctx, "lowpass", 3200);
    this.delay.connect(tone).connect(gain(ctx, 0.38)).connect(this.delay);
    tone.connect(this.master);
  }

  // dotted eighths, the classic 80s echo
  setTempo(bpm) {
    this.delay.delayTime.setTargetAtTime(stepDur(bpm) * 3, this.ctx.currentTime, 0.05);
  }

  channel(id) {
    let ch = this.channels.get(id);
    if (!ch) {
      const c = this.ctx;
      ch = {
        input: gain(c), shaper: c.createWaveShaper(), vol: gain(c, 0.8), pan: c.createStereoPanner(),
        rev: gain(c, 0), dly: gain(c, 0), state: {}, drive: 0,
      };
      ch.shaper.oversample = "2x";
      ch.input.connect(ch.shaper).connect(ch.vol).connect(ch.pan).connect(this.master);
      ch.pan.connect(ch.rev).connect(this.reverb);
      ch.pan.connect(ch.dly).connect(this.delay);
      this.channels.set(id, ch);
    }
    return ch;
  }

  update(track, audible) {
    const ch = this.channel(track.id), t = this.ctx.currentTime;
    ch.vol.gain.setTargetAtTime(audible ? track.vol : 0, t, 0.015);
    ch.pan.pan.setTargetAtTime(track.pan, t, 0.015);
    ch.rev.gain.setTargetAtTime(track.rev, t, 0.015);
    ch.dly.gain.setTargetAtTime(track.dly * 0.7, t, 0.015);
    if (ch.drive !== track.drive) {
      ch.drive = track.drive;
      ch.shaper.curve = track.drive > 0.001 ? driveCurve(track.drive) : null;
    }
  }

  // Stop: silence everything already scheduled by swapping each channel's
  // input node (the voices stay wired to the old one). Effect tails ring on.
  cut() {
    const t = this.ctx.currentTime;
    for (const ch of this.channels.values()) {
      const old = ch.input;
      old.gain.setTargetAtTime(0, t, 0.01);
      setTimeout(() => old.disconnect(), 150);
      ch.input = gain(this.ctx);
      ch.input.connect(ch.shaper);
      ch.state = {};
    }
  }

  prune(ids) {
    for (const [id, ch] of this.channels) {
      if (!ids.has(id)) { ch.pan.disconnect(); this.channels.delete(id); }
    }
  }
}

// ---------------------------------------------------------------- scheduling

export const audible = (song, tr) => !tr.mute && (tr.solo || !song.tracks.some((t) => t.solo));

// Plays every note that starts inside `step` (notes may sit between steps,
// e.g. 1/32 hi-hat rolls). `time` is when the unswung step begins.
export function scheduleStep(mixer, song, step, time, onNote) {
  const sd = stepDur(song.bpm);
  const swing = step % 2 ? song.swing / 100 * sd / 3 : 0;
  for (const tr of song.tracks) {
    if (!audible(song, tr)) continue;
    const inst = INSTRUMENTS[tr.type], ch = mixer.channel(tr.id);
    for (const n of tr.notes) {
      if (Math.floor(n.t) !== step) continue;
      const t0 = time + (n.t - step) * sd + swing, t1 = t0 + n.d * sd;
      inst.noteOn(mixer.ctx, ch, t0, n.p, n.v, tr.params)(t1);
      onNote?.(tr, n, t0, t1);
    }
  }
}

export async function renderSong(song, loops = 2) {
  const sd = stepDur(song.bpm), steps = song.bars * 16, sr = 44100;
  const len = steps * sd * loops + 3;
  const ctx = new OfflineAudioContext(2, Math.ceil(len * sr), sr);
  const mixer = new Mixer(ctx);
  mixer.delay.delayTime.value = sd * 3;
  for (const tr of song.tracks) mixer.update(tr, audible(song, tr));
  for (let i = 0; i < steps * loops; i++) scheduleStep(mixer, song, i % steps, 0.02 + i * sd);
  return ctx.startRendering();
}

export function wavBlob(buf) {
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const n = buf.length, bytes = n * chans.length * 2;
  const dv = new DataView(new ArrayBuffer(44 + bytes));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); dv.setUint32(4, 36 + bytes, true); str(8, "WAVE");
  str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, chans.length, true); dv.setUint32(24, buf.sampleRate, true);
  dv.setUint32(28, buf.sampleRate * chans.length * 2, true);
  dv.setUint16(32, chans.length * 2, true); dv.setUint16(34, 16, true);
  str(36, "data"); dv.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const c of chans) {
      const s = clamp(c[i], -1, 1);
      dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([dv], { type: "audio/wav" });
}
