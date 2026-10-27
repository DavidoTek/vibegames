// Demo songs. Positions and lengths are in 16th steps; drum notes use the
// row index from DRUMS as pitch.

const [KICK, SNARE, CLAP, RIM, CHAT, OHAT, LTOM, HTOM, COWBELL, CRASH] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// "C#4", "Bb1" -> MIDI note number
function midi(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + SEMI[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

// Drum pattern: one char per 16th, "x" accent, "o" normal, "g" ghost.
const VEL = { x: 1, o: 0.75, g: 0.45 };
function beat(row, pattern, bar = 0) {
  const out = [];
  [...pattern].forEach((c, i) => {
    if (VEL[c]) out.push({ t: bar * 16 + i, p: row, d: 1, v: VEL[c] });
  });
  return out;
}

// 1/32 roll from step `from` to `to` with a rising velocity
function roll(row, from, to) {
  const out = [];
  for (let t = from; t < to; t += 0.5) out.push({ t, p: row, d: 0.5, v: 0.4 + 0.5 * (t - from) / (to - from) });
  return out;
}

// Melody: "A4:2 C5+E5:4 -:2", tokens are note(s):length, "-" is a rest.
function mel(str, start = 0, v = 0.8) {
  const out = [];
  let t = start;
  for (const tok of str.trim().split(/\s+/)) {
    const [names, len = "1"] = tok.split(":");
    if (names !== "-") for (const n of names.split("+")) out.push({ t, p: midi(n), d: Number(len), v });
    t += Number(len);
  }
  return out;
}

const n = (t, p, d, v = 0.9) => ({ t, p, d, v });

// ---------------------------------------------------------------- Midnight Drive

function midnightDrive() {
  const roots = [33, 29, 36, 31]; // A1 F1 C2 G1
  const pads = ["A3+C4+E4", "A3+C4+F4", "G3+C4+E4", "G3+B3+D4"];
  const arps = [[69, 72, 76, 81], [69, 72, 77, 81], [67, 72, 76, 79], [67, 71, 74, 79]];
  const drums = [], bass = [], pad = [], arp = [];
  for (let b = 0; b < 8; b++) {
    const c = b % 4, last = b === 7;
    drums.push(...beat(KICK, b % 2 ? "x.......x.....o." : "x.......x.......", b));
    drums.push(...beat(SNARE, last ? "....x.......x.xo" : "....x.......x...", b));
    if (b >= 4) drums.push(...beat(CLAP, "....o.......o...", b));
    if (last) drums.push(...beat(LTOM, "........o.o.....", b), ...beat(HTOM, "............x...", b));
    else drums.push(...beat(CHAT, b < 4 ? "o.o.o.o.o.o.o..." : "ogogogogogogog..", b), ...beat(OHAT, "..............o.", b));
    for (let i = 0; i < 8; i++) bass.push(n(b * 16 + i * 2, roots[c] + (i % 2 ? 12 : 0), 1.5, i % 2 ? 0.65 : 0.9));
    pad.push(...mel(`${pads[c]}:16`, b * 16, 0.6));
    for (let i = 0; i < 16; i++) arp.push(n(b * 16 + i, arps[c][[0, 1, 2, 3, 2, 1][i % 6]], 1, i % 4 ? 0.5 : 0.75));
  }
  drums.push(...beat(CRASH, "x", 0), ...beat(CRASH, "x", 4));
  const lead = mel(`
    A4:2 C5:2 E5:4 D5:2 C5:2 B4:2 C5:2
    A4:6 C5:2 F5:4 E5:4
    G5:4 E5:2 C5:2 E5:6 D5:2
    D5:4 B4:4 G4:4 B4:2 D5:2`, 64, 0.85);
  return {
    name: "Midnight Drive", bpm: 100, swing: 0, bars: 8,
    tracks: [
      { name: "Drums", type: "drums", preset: "TR Classic", vol: 0.85, rev: 0.12, notes: drums },
      { name: "Bass", type: "poly", preset: "Synth Bass", vol: 0.75, drive: 0.2, rev: 0, notes: bass },
      { name: "Pad", type: "poly", preset: "Warm Pad", vol: 0.55, rev: 0.4, pan: -0.15, notes: pad },
      { name: "Arp", type: "poly", preset: "Pluck", vol: 0.6, dly: 0.35, rev: 0.2, pan: 0.2, notes: arp },
      { name: "Lead", type: "supersaw", preset: "Anthem Lead", vol: 0.55, dly: 0.3, rev: 0.3, notes: lead },
    ],
  };
}

// ---------------------------------------------------------------- Trap Nights

function trapNights() {
  const kicks = ["x......x..x.....", "x......x.x....x.", "x......x..x.....", "x......x..x..x.."];
  const drums = [];
  kicks.forEach((k, b) => {
    drums.push(...beat(KICK, k, b), ...beat(CLAP, "........x.......", b), ...beat(SNARE, "........o.......", b));
  });
  drums.push(...beat(CHAT, "o.g.o.g.o.g.o.g.", 0), ...beat(CHAT, "o.g.o.g.o.g.", 1), ...roll(CHAT, 28, 32));
  drums.push(...beat(CHAT, "o.g.o.g.o.g.o.g.", 2), ...beat(CHAT, "o.g.o.g.o.", 3), ...roll(CHAT, 58, 62));
  drums.push(...beat(OHAT, "..............o.", 2), ...beat(CRASH, "o", 0), ...beat(RIM, "...g......g...g.", 3));
  const bass = [
    n(0, 29, 7), n(7, 29, 3), n(10, 29, 5), n(14, 41, 2),
    n(16, 29, 7), n(23, 29, 2), n(25, 32, 5), n(30, 29, 2),
    n(32, 37, 7), n(39, 37, 3), n(42, 37, 5), n(46, 49, 2),
    n(48, 36, 7), n(55, 36, 3), n(58, 36, 4), n(61, 43, 3),
  ];
  const bell = mel(`
    C5:3 Ab4:3 F4:2 C5:3 Ab4:3 G4:2
    C5:3 Ab4:3 F4:2 Eb5:3 C5:3 Bb4:2
    Db5:3 Ab4:3 F4:2 Db5:3 Ab4:3 F4:2
    C5:3 G4:3 E4:2 C5:3 G4:3 Bb4:2`, 0, 0.7);
  const pad = mel("F3+Ab3+C4:32 F3+Ab3+Db4:16 E3+G3+C4:16", 0, 0.55);
  return {
    name: "Trap Nights", bpm: 140, swing: 0, bars: 4,
    tracks: [
      { name: "Drums", type: "drums", preset: "TR Classic", vol: 0.85, rev: 0.1, notes: drums },
      { name: "808", type: "sub808", preset: "Long 808", vol: 0.6, drive: 0.35, rev: 0, notes: bass },
      { name: "Bell", type: "poly", preset: "Bell", vol: 0.7, rev: 0.35, dly: 0.3, notes: bell },
      { name: "Pad", type: "supersaw", preset: "Dark Pad", vol: 0.35, rev: 0.45, notes: pad },
    ],
  };
}

// ---------------------------------------------------------------- Reese Tunnel

// 32 bars: intro (1-4), build (5-8), main (9-16), breakdown (17-20),
// drop (21-28), outro (29-32). Each section repeats the Dm-Bb-Gm-A loop.
function reeseTunnel() {
  const chords = ["D4+F4+A4", "D4+F4+Bb4", "D4+G4+Bb4", "C#4+E4+A4"];
  const roots = ["D2", "Bb1", "G1", "A1"], uppers = ["D3", "Bb2", "G2", "A2"];
  const reeseLine = "D2:10 -:2 D2:2 F2:2 Bb1:12 -:2 A1:2 G1:10 -:2 G1:2 Bb1:2 A1:16";
  const leadLine = `
    A4:6 F4:2 D5:4 C5:4
    D5:6 C5:2 Bb4:4 A4:4
    G4:6 Bb4:2 D5:4 C5:2 Bb4:2
    A4:8 C#5:4 E5:4`;
  const stab = (c, b, v = 0.7) => {
    const up = c.replace(/4/g, "5");
    return mel(`-:6 ${up}:1 -:7 ${up}:1`, b * 16, v);
  };
  const twoStep = (b) => [
    ...beat(KICK, b % 2 ? "x.........x..x.." : "x.........x.....", b),
    ...beat(SNARE, b % 2 ? "....x..g....x..." : "....x.......x..g", b),
  ];
  // snare build into the next section: 8ths, then 16ths, then a 1/32 roll
  const build = (b) => [...beat(SNARE, "o...o...o.o.o.o.", b), ...roll(SNARE, b * 16 + 12, b * 16 + 16)];

  const drums = [], reese = [], growl = [], pad = [], stabs = [], lead = [];
  for (let b = 0; b < 32; b++) {
    const c = b % 4;
    pad.push(...mel(`${chords[c]}:16`, b * 16, b >= 20 && b < 28 ? 0.45 : 0.6));
    if (b < 4) {
      // intro: pad and a lone stab, hats creep in on the last bar
      stabs.push(...mel(`-:6 ${chords[c].replace(/4/g, "5")}:1 -:9`, b * 16, 0.55));
      if (b === 3) drums.push(...beat(CHAT, "g.g.g.g.g.g.g.g.", b));
    } else if (b < 8) {
      // build: rim and hats over a quiet reese, snare roll into the main part
      drums.push(...beat(CHAT, "o.g.o.g.o.g.o.g.", b), ...beat(KICK, "x...............", b));
      drums.push(...(b === 7 ? build(b) : beat(RIM, "....o.......o...", b)));
      stabs.push(...stab(chords[c], b, 0.6));
    } else if (b < 16) {
      // main: full two-step groove
      drums.push(...twoStep(b), ...beat(CHAT, "o.g.o.g.o.g.o.g.", b));
      if (b % 4 === 3) drums.push(...beat(OHAT, "..............o.", b));
      stabs.push(...stab(chords[c], b));
    } else if (b < 20) {
      // breakdown: drums out, the lead takes the melody
      if (b === 19) drums.push(...build(b));
    } else if (b < 28) {
      // drop: growl bass, busier hats, clap on the backbeat
      drums.push(...twoStep(b), ...beat(CLAP, "....x.......x...", b));
      drums.push(...beat(CHAT, "ogogogogogogog..", b), ...beat(OHAT, "..............o.", b));
      growl.push(...mel(`${roots[c]}:6 -:2 ${roots[c]}:2 ${uppers[c]}:2 ${roots[c]}:4`, b * 16, 0.95));
      stabs.push(...stab(chords[c], b, 0.8));
    } else {
      // outro: groove thins out bar by bar
      if (b < 30) drums.push(...twoStep(b));
      if (b < 31) drums.push(...beat(CHAT, "o.g.o.g.o.g.o.g.", b));
    }
  }
  for (const b of [0, 8, 20, 28]) drums.push(...beat(CRASH, "x", b));
  for (const start of [4, 8, 12]) reese.push(...mel(reeseLine, start * 16, start === 4 ? 0.4 : 0.9));
  reese.push(...mel("D2:10 -:2 D2:2 F2:2 Bb1:12", 28 * 16, 0.6)); // fades out with the outro
  for (const start of [16, 20, 24]) lead.push(...mel(leadLine, start * 16, start === 16 ? 0.7 : 0.85));
  return {
    name: "Reese Tunnel", bpm: 172, swing: 0, bars: 32,
    tracks: [
      { name: "Drums", type: "drums", preset: "Tight", vol: 0.85, rev: 0.15, notes: drums },
      { name: "Reese", type: "reese", preset: "Classic Reese", vol: 0.7, drive: 0.3, notes: reese },
      { name: "Growl", type: "reese", preset: "Growl", vol: 0.65, drive: 0.45, notes: growl },
      { name: "Pad", type: "supersaw", preset: "Air Pad", vol: 0.35, rev: 0.5, notes: pad },
      { name: "Stabs", type: "poly", preset: "Pluck", vol: 0.65, dly: 0.4, rev: 0.25, pan: 0.25, notes: stabs },
      { name: "Lead", type: "supersaw", preset: "Anthem Lead", vol: 0.45, dly: 0.3, rev: 0.35, notes: lead },
    ],
  };
}

// ---------------------------------------------------------------- Sunrise Anthem

function sunriseAnthem() {
  const roots = [41, 43, 40, 45]; // F2 G2 E2 A2
  const chords = ["F4+A4+C5", "G4+B4+D5", "E4+G4+B4", "E4+A4+C5"];
  const drums = [], bass = [], stabs = [];
  for (let b = 0; b < 4; b++) {
    drums.push(...beat(KICK, "x...x...x...x...", b), ...beat(OHAT, "..o...o...o...o.", b));
    drums.push(...beat(CHAT, "gg.ggg.ggg.ggg.g", b));
    drums.push(...beat(CLAP, "....x.......x...", b));
    for (let i = 0; i < 16; i++) if (i % 4) bass.push(n(b * 16 + i, roots[b], 1, i % 4 === 2 ? 0.9 : 0.65));
    stabs.push(...mel(`-:2 ${chords[b]}:2 -:2 ${chords[b]}:2 -:2 ${chords[b]}:2 -:2 ${chords[b]}:2`, b * 16, 0.7));
  }
  drums.push(...beat(SNARE, "........gogoxoxx", 3), ...beat(CRASH, "x", 0));
  const lead = mel(`
    A5:4 C6:4 A5:2 G5:2 F5:4
    G5:4 B5:4 D6:4 B5:4
    B5:6 G5:2 E5:4 G5:4
    A5:6 E5:2 A5:4 C6:4`, 0, 0.75);
  return {
    name: "Sunrise Anthem", bpm: 138, swing: 0, bars: 4,
    tracks: [
      { name: "Drums", type: "drums", preset: "TR Classic", vol: 0.85, rev: 0.1, notes: drums },
      { name: "Bass", type: "poly", preset: "Synth Bass", vol: 0.7, drive: 0.15, notes: bass },
      { name: "Stabs", type: "supersaw", preset: "Stab", vol: 0.5, dly: 0.35, rev: 0.3, notes: stabs },
      { name: "Lead", type: "supersaw", preset: "Anthem Lead", vol: 0.5, dly: 0.3, rev: 0.4, notes: lead },
    ],
  };
}

function blank() {
  return {
    name: "Untitled", bpm: 120, swing: 0, bars: 4,
    tracks: [
      { name: "Drums", type: "drums", preset: "TR Classic", notes: [] },
      { name: "808", type: "sub808", preset: "Long 808", drive: 0.3, rev: 0, notes: [] },
      { name: "Reese", type: "reese", preset: "Classic Reese", notes: [] },
      { name: "Keys", type: "poly", preset: "Brass", rev: 0.25, notes: [] },
      { name: "Lead", type: "supersaw", preset: "Anthem Lead", dly: 0.25, rev: 0.3, notes: [] },
    ],
  };
}

export const DEMOS = [
  { name: "Midnight Drive", make: midnightDrive },
  { name: "Trap Nights", make: trapNights },
  { name: "Reese Tunnel", make: reeseTunnel },
  { name: "Sunrise Anthem", make: sunriseAnthem },
];
export const BLANK = blank;
