// Synthesised sound effects – no audio files. The context is created on the
// first user gesture (browsers block audio before that).

let ctx = null;
let master = null;
let noiseBuf = null;
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
      master.gain.value = 0.65;
      // Keeps stacked sounds from clipping on small phone speakers.
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
      // One second of white noise, reused for whooshes, stamps and drums.
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
  } catch (err) {
    console.warn("Audio unavailable:", err);
  }
}

function env(g, t, vol, attack, dur) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

// One enveloped oscillator note; `glide` bends the pitch to freq * glide.
function tone(freq, start, dur, { type = "sine", vol = 0.3, attack = 0.005, glide = 1, filter = 0 } = {}) {
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glide !== 1) osc.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
  env(g, t, vol, attack, dur);
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

// Filtered noise burst; `sweep` moves the band-pass centre over the sound.
function noise(start, dur, { vol = 0.3, freq = 1000, sweep = 1, q = 1, attack = 0.01, type = "bandpass" } = {}) {
  const t = ctx.currentTime + start;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (sweep !== 1) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
  const g = ctx.createGain();
  env(g, t, vol, attack, dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

const SOUNDS = {
  click() {
    tone(900, 0, 0.05, { vol: 0.1, glide: 1.3 });
  },
  // Card turning over: airy swish plus a soft papery tap.
  flip() {
    noise(0, 0.22, { vol: 0.28, freq: 600, sweep: 5, q: 0.8 });
    tone(520, 0.12, 0.08, { type: "triangle", vol: 0.12 });
  },
  // Secret revealed: a mysterious minor shimmer.
  reveal() {
    [440, 523.3, 659.3, 830.6].forEach((f, i) =>
      tone(f, 0.06 + i * 0.07, 0.9 - i * 0.1, { type: "sine", vol: 0.13 }));
    tone(1760, 0.3, 0.6, { vol: 0.04 });
  },
  hide() {
    noise(0, 0.18, { vol: 0.25, freq: 2500, sweep: 0.25, q: 0.8 });
    tone(220, 0.05, 0.18, { type: "triangle", vol: 0.18, glide: 0.7 });
  },
  // Wax stamp on a ballot: low thump and a crack.
  stamp() {
    tone(120, 0, 0.25, { type: "sine", vol: 0.5, glide: 0.5 });
    noise(0, 0.08, { vol: 0.35, freq: 1800, q: 0.6 });
  },
  select() {
    tone(660, 0, 0.08, { type: "triangle", vol: 0.14 });
    tone(990, 0.05, 0.12, { type: "triangle", vol: 0.1 });
  },
  tick() {
    tone(1500, 0, 0.04, { type: "square", vol: 0.05, filter: 3000 });
  },
  alarm() {
    for (let i = 0; i < 3; i++) {
      tone(880, i * 0.22, 0.16, { type: "square", vol: 0.12, filter: 2500 });
      tone(660, i * 0.22 + 0.1, 0.12, { type: "square", vol: 0.1, filter: 2500 });
    }
  },
  next() {
    tone(587, 0, 0.1, { type: "triangle", vol: 0.15 });
    tone(880, 0.08, 0.2, { type: "triangle", vol: 0.15 });
  },
  // Switch event: falling-then-rising warp with a sub drop.
  warp() {
    tone(1200, 0, 0.6, { type: "sawtooth", vol: 0.1, glide: 0.15, filter: 2500 });
    tone(80, 0.5, 0.9, { type: "sine", vol: 0.5, glide: 0.5 });
    noise(0.5, 0.8, { vol: 0.25, freq: 300, sweep: 8, q: 2 });
    [392, 466, 587].forEach((f, i) => tone(f, 0.9 + i * 0.09, 0.7, { type: "triangle", vol: 0.1 }));
  },
  // Snare roll building up to the result.
  drumroll() {
    for (let i = 0; i < 26; i++) {
      noise(i * 0.06, 0.07, { vol: 0.05 + i * 0.009, freq: 2200, q: 0.7 });
    }
    tone(98, 1.6, 0.6, { type: "sine", vol: 0.5, glide: 0.6 });
    noise(1.6, 0.6, { vol: 0.3, freq: 5000, q: 0.5, type: "highpass" });
  },
  fanfare() {
    const notes = [523.3, 659.3, 784, 1046.5];
    notes.forEach((f, i) => tone(f, i * 0.12, i === 3 ? 0.9 : 0.18, { type: "triangle", vol: 0.2 }));
    [523.3, 659.3, 784].forEach((f) => tone(f, 0.36, 1, { type: "sawtooth", vol: 0.05, filter: 2000 }));
  },
  // Sly little descending tune for the hidden player's win.
  sneaky() {
    [659.3, 622.3, 587.3, 554.4, 523.3].forEach((f, i) =>
      tone(f, i * 0.13, 0.16, { type: "triangle", vol: 0.16 }));
    tone(392, 0.68, 0.7, { type: "triangle", vol: 0.2 });
    tone(196, 0.68, 0.7, { type: "sine", vol: 0.2 });
  },
  sting() {
    tone(311, 0, 0.25, { type: "square", vol: 0.12, filter: 1400 });
    tone(233, 0.25, 0.5, { type: "square", vol: 0.12, filter: 1100, glide: 0.94 });
  },
  pop() {
    tone(500 + Math.random() * 400, 0, 0.09, { vol: 0.15, glide: 2 });
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

let vibrateOn = true;
export function setVibrate(on) {
  vibrateOn = on;
}

export function vibrate(pattern) {
  if (!vibrateOn) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported (iOS) – ignore.
  }
}
