// Synthesised sound effects (no audio files). The context is created lazily and
// resumed on the first user gesture, because browsers block audio before that.

let ctx = null;
let master = null;
let enabled = true;

export function setSoundEnabled(on) {
  enabled = on;
}

export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.7;
      // A gentle compressor keeps stacked sounds from clipping on phone speakers.
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
  } catch (err) {
    console.warn("Audio unavailable:", err);
  }
}

// One enveloped oscillator note. `glide` bends the pitch towards freq * glide.
function tone(freq, start, dur, { type = "sine", vol = 0.3, attack = 0.005, glide = 1, filter = 0 } = {}) {
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glide !== 1) osc.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = osc.connect(g);
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = filter;
    node = node.connect(f);
  }
  node.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

const SOUNDS = {
  // Bright two-note bell "pl-ing".
  correct() {
    tone(1318.5, 0, 0.18, { vol: 0.25 });
    tone(1975.5, 0.07, 0.6, { vol: 0.3 });
    tone(3951, 0.07, 0.35, { vol: 0.06 });
  },
  // Low, falling "dö-dö".
  wrong() {
    tone(311, 0, 0.2, { type: "square", vol: 0.16, filter: 1400 });
    tone(233, 0.22, 0.42, { type: "square", vol: 0.16, filter: 1100, glide: 0.94 });
  },
  tick() {
    tone(1600, 0, 0.05, { type: "triangle", vol: 0.12 });
  },
  count() {
    tone(660, 0, 0.18, { type: "triangle", vol: 0.25 });
  },
  go() {
    tone(990, 0, 0.12, { type: "triangle", vol: 0.25 });
    tone(1320, 0.1, 0.4, { type: "triangle", vol: 0.25 });
  },
  timeUp() {
    tone(196, 0, 0.9, { type: "sawtooth", vol: 0.2, filter: 900 });
    tone(147, 0, 0.9, { type: "sawtooth", vol: 0.2, filter: 900 });
  },
  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone(f, i * 0.11, i === 3 ? 0.6 : 0.16, { type: "triangle", vol: 0.22 }));
  },
  click() {
    tone(880, 0, 0.06, { vol: 0.12, glide: 1.4 });
  },
};

export function play(name) {
  if (!enabled || !ctx || ctx.state !== "running") return;
  try {
    SOUNDS[name]?.();
  } catch (err) {
    console.warn(err);
  }
}

export function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported (iOS) – ignore.
  }
}
