// Pixel art. Everything is drawn with whole-pixel fillRects into small
// canvases, so it stays crisp when the low-res frame is scaled up.

export const TILE = 8;

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Stable per-cell noise for textures.
export function hash(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Sprites are rows of palette keys; "." is transparent.
function sprite(rows, pal) {
  const w = Math.max(...rows.map((r) => r.length));
  const c = makeCanvas(w, rows.length), g = c.getContext("2d");
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

// Shapes for bigger sprites: test every pixel centre, so edges stay hard.
function shape(g, w, h, color, test) {
  g.fillStyle = color;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (test(x + 0.5, y + 0.5)) g.fillRect(x, y, 1, 1);
}
const inEllipse = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

function flip(c) {
  const o = makeCanvas(c.width, c.height), g = o.getContext("2d");
  g.scale(-1, 1);
  g.drawImage(c, -c.width, 0);
  return o;
}

// Turn a right-facing sprite so its head points up (climbing).
function rotateUp(c) {
  const o = makeCanvas(c.height, c.width), g = o.getContext("2d");
  g.translate(0, c.width);
  g.rotate(-Math.PI / 2);
  g.drawImage(c, 0, 0);
  return o;
}

// ---------------------------------------------------------------- font

// 3x5 glyphs, rows top to bottom.
const GLYPHS = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110",
  E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101",
  I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100",
  Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111",
  0: "111101101101111", 1: "010110010010111", 2: "110001010100111", 3: "110001010001110",
  4: "101101111001001", 5: "111100110001110", 6: "011100111101111", 7: "111001010010010",
  8: "111101111101111", 9: "111101111001110",
  ".": "000000000000010", ",": "000000000010100", "!": "010010010000010", "?": "110001010000010",
  "'": "010010000000000", "-": "000000111000000", ":": "000010000010000", "/": "001001010100100",
  "(": "010100100100010", ")": "010001001001010", "+": "000010111010000", "=": "000111000111000",
  ">": "100010001010100", "<": "001010100010001",
};

export const LINE_H = 7;

export function wrap(text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && (line + " " + word).length > width) { lines.push(line); line = word; }
    else line = line ? line + " " + word : word;
  }
  if (line) lines.push(line);
  return lines;
}

const textCache = new Map();

// Renders (and caches) text as a canvas: one line per entry, 4px per glyph.
export function textCanvas(lines, color, shadow = "rgba(0,0,0,0.6)") {
  const key = lines.join("\n") + color + shadow;
  let c = textCache.get(key);
  if (c) return c;
  const w = Math.max(1, ...lines.map((l) => l.length)) * 4, h = lines.length * LINE_H;
  c = makeCanvas(w + 1, h + 1);
  const g = c.getContext("2d");
  const draw = (ox, oy, col) => {
    g.fillStyle = col;
    lines.forEach((line, ly) => {
      for (let i = 0; i < line.length; i++) {
        const glyph = GLYPHS[line[i].toUpperCase()];
        if (!glyph) continue;
        for (let p = 0; p < 15; p++) if (glyph[p] === "1") g.fillRect(ox + i * 4 + (p % 3), oy + ly * LINE_H + ((p / 3) | 0), 1, 1);
      }
    });
  };
  if (shadow) draw(1, 1, shadow);
  draw(0, 0, color);
  textCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------- sprites

export const S = {};

const ANT_PAL = {
  b: "#6b2412", B: "#a8462a", t: "#5a1d10", h: "#7d2c17", e: "#f3d27a", m: "#3a1208", a: "#2c0e06", l: "#2c0e06",
};
const LEADER_PAL = { ...ANT_PAL, b: "#8a3016", B: "#d0643a", t: "#74270f", h: "#9c3a1c" };
const ANT_BODY = [
  "........aa",
  ".bB....he.",
  "bbbbtthhhm",
  ".bb..tt...",
];
const ANT_LEGS = [".l.l..l.l.", "..l.l.l..l"];

function antFrames(pal) {
  const right = ANT_LEGS.map((legs) => sprite([...ANT_BODY, legs], pal));
  return { right, left: right.map(flip), up: right.map(rotateUp) };
}

export function init() {
  S.ant = antFrames(ANT_PAL);
  S.leader = antFrames(LEADER_PAL);

  const hopper = [
    "............aa..",
    "...........a....",
    "..LL......ggg...",
    ".L..LggggggGGhh.",
    "L....gGGGGGGGhhe",
    "..gggggggggggghh",
    "L......l..l.l...",
    ".L....l..l...l..",
  ];
  const hopPal = { g: "#4f9a32", G: "#7fcf4a", h: "#3d7a26", e: "#1a1a10", a: "#2f5a1e", L: "#3d7a26", l: "#3d7a26" };
  S.hopper = sprite(hopper, hopPal);
  // Kicking: the big hind leg is stretched out backwards.
  S.hopperKick = sprite([
    "............aa..",
    "...........a....",
    "..........ggg...",
    ".....ggggggGGhh.",
    ".....gGGGGGGGhhe",
    "LLLggggggggggghh",
    ".......l..l.l...",
    "......l..l...l..",
  ], hopPal);

  const beetlePal = { s: "#24384a", S: "#4a7a9a", H: "#1a2633", h: "#2e4a60", e: "#d8e8f0", l: "#141c24" };
  const beetle = [
    "............h.",
    "...........hh.",
    "...ssssss..hh.",
    "..sSSSSSSs.HH.",
    ".sSSSsSSSSsHHe",
    ".ssssssssssHHH",
  ];
  S.beetle = [".l..l..l..l...", "..l..l..l..l.."].map((legs) => sprite([...beetle, legs], beetlePal));

  S.mushroom = sprite([
    ".ccc.",
    "cCCCc",
    "c.C.c",
    "..s..",
    "..s..",
  ], { c: "#3fb6c8", C: "#a8f4ff", s: "#d8e6d0" });

  S.firefly = [
    sprite(["w.w", ".k.", ".y."], { w: "rgba(220,240,255,0.8)", k: "#2a2a20", y: "#fff27a" }),
    sprite(["...", "wkw", ".y."], { w: "rgba(220,240,255,0.8)", k: "#2a2a20", y: "#fff27a" }),
  ];

  S.sign = sprite([
    "wwwwwww",
    "wWWWWWw",
    "wwwwwww",
    "...p...",
    "...p...",
    "...p...",
  ], { w: "#8a5a30", W: "#c8945a", p: "#6a4424" });

  S.bird = [birdFrame(true), birdFrame(false)];
  S.pebble = rockSprite(8, 8);
  S.boulder = rockSprite(16, 16);

  // Nest mound for the start: a pile of soil crumbs with a dark hole.
  const nest = makeCanvas(32, 14), ng = nest.getContext("2d");
  shape(ng, 32, 14, "#8a6038", (x, y) => inEllipse(16, 15, 16, 13)(x, y));
  shape(ng, 32, 14, "#a87a48", (x, y) => inEllipse(14, 15, 12, 10)(x, y) && hash(x | 0, y | 0, 3) > 0.35);
  shape(ng, 32, 14, "#c09060", (x, y) => inEllipse(14, 15, 12, 10)(x, y) && hash(x | 0, y | 0, 4) > 0.86);
  shape(ng, 32, 14, "#24140a", (x, y) => inEllipse(16, 14, 4, 4)(x, y));
  S.nest = nest;
}

function rockSprite(w, h) {
  const c = makeCanvas(w, h), g = c.getContext("2d");
  shape(g, w, h, "#4e4a56", (x, y) => inEllipse(w / 2, h / 2, w / 2, h / 2)(x, y) || (y > h / 2 && y < h && x > 1 && x < w - 1));
  shape(g, w, h, "#76717e", inEllipse(w / 2 - 0.6, h / 2 - 0.4, w / 2 - 1.2, h / 2 - 1.4));
  shape(g, w, h, "#a6a1ae", inEllipse(w * 0.36, h * 0.32, w * 0.16, h * 0.12));
  return c;
}

function birdFrame(wingsUp) {
  const w = 30, h = 18, c = makeCanvas(w, h), g = c.getContext("2d");
  // tail
  shape(g, w, h, "#5a3a22", (x, y) => x < 7 && y > 8 && y < 12 + (7 - x) * 0.25 && y > 9 - (7 - x) * 0.3);
  shape(g, w, h, "#7a5030", inEllipse(14, 10, 10, 4.5));
  shape(g, w, h, "#d8c098", (x, y) => inEllipse(15, 11.5, 8, 2.6)(x, y));
  shape(g, w, h, "#7a5030", inEllipse(23, 7, 4, 3.6));
  shape(g, w, h, "#5a3a22", (x, y) => inEllipse(23, 5.5, 3.5, 1.5)(x, y));
  shape(g, w, h, "#f0a020", (x, y) => x >= 26.5 && x < 29.5 && y >= 6.5 && y < 8.5 && y - 6.5 < (29.5 - x) * 0.8);
  g.fillStyle = "#101010";
  g.fillRect(24, 6, 1, 1);
  g.fillStyle = "#ffffff";
  g.fillRect(24, 5, 1, 1);
  if (wingsUp) {
    shape(g, w, h, "#5a3a22", (x, y) => y < 9 && y > 0 && x > 8 && x < 19 && y > 9 - (x - 8) * 1.1 && y > (x - 12) * 0.9);
    shape(g, w, h, "#9a6a40", (x, y) => y < 8 && y > 2 && x > 11 && x < 17 && y > 9 - (x - 8) * 1.1 + 1.5);
  } else {
    shape(g, w, h, "#5a3a22", (x, y) => y > 10 && y < 18 && x > 9 && x < 19 && y < 11 + (19 - x) * 0.9);
  }
  // legs tucked
  g.fillStyle = "#c08040";
  g.fillRect(16, 14, 1, 2);
  g.fillRect(18, 14, 1, 2);
  return c;
}

// ---------------------------------------------------------------- tiles

export const EARTH = {
  dry: { top: "#ecd59c", top2: "#d2ae70", body: "#b88a56", speck: "#cfa56e", dark: "#9a6f42", wall: "#4a3220", wallSpeck: "#5a3e28" },
  grass: { top: "#82cc4c", top2: "#4f9a32", body: "#8a5a36", speck: "#a06c42", dark: "#6e4529", wall: "#3e2818", wallSpeck: "#4c3220" },
  cave: { top: "#8a6440", top2: "#6e4c30", body: "#5e4029", speck: "#6f4d33", dark: "#4a311f", wall: "#2a1c12", wallSpeck: "#36251a" },
};

// world: { get(x,y), solid(x,y), zoneAt(x), underground(x,y) }
export function paintCell(g, world, x, y) {
  const px = x * TILE, py = y * TILE, ch = world.get(x, y);
  g.clearRect(px, py, TILE, TILE);
  const P = EARTH[world.zoneAt(x)];
  const n = (i, s) => hash(x * 8 + i, y * 8 + s, 7);

  if (!world.solid(x, y)) {
    if (world.underground(x, y)) {
      g.fillStyle = P.wall;
      g.fillRect(px, py, TILE, TILE);
      g.fillStyle = P.wallSpeck;
      for (let i = 0; i < 3; i++) g.fillRect(px + ((n(i, 1) * 7) | 0), py + ((n(i, 2) * 7) | 0), 2, 1);
      if (n(9, 9) < 0.08) { g.fillStyle = "#56391f"; g.fillRect(px + 3, py, 1, TILE); }
    }
    if (ch === "|") paintStem(g, px, py, world.get(x, y - 1) !== "|");
    else if (ch === "L") paintLeaf(g, px, py, world.get(x - 1, y) !== "L" && world.get(x - 1, y) !== "|", world.get(x + 1, y) !== "L" && world.get(x + 1, y) !== "|");
    else if (ch === "^") paintThorns(g, px, py, x, y);
    return;
  }

  const openUp = !world.solid(x, y - 1), openL = !world.solid(x - 1, y), openR = !world.solid(x + 1, y), openD = !world.solid(x, y + 1);
  if (ch === "#") {
    let depth = 0;
    while (depth < 4 && world.solid(x, y - 1 - depth)) depth++;
    g.fillStyle = P.body;
    g.fillRect(px, py, TILE, TILE);
    g.fillStyle = P.speck;
    for (let i = 0; i < 4; i++) g.fillRect(px + ((n(i, 3) * 8) | 0), py + ((n(i, 4) * 8) | 0), 1, 1);
    g.fillStyle = P.dark;
    for (let i = 0; i < 3; i++) g.fillRect(px + ((n(i, 5) * 8) | 0), py + ((n(i, 6) * 8) | 0), 1, 1);
    if (n(7, 7) < 0.12) { g.fillStyle = "#c8c0b0"; g.fillRect(px + 2 + ((n(8, 8) * 4) | 0), py + 3 + ((n(8, 9) * 3) | 0), 2, 1); }
    if (depth >= 2) { g.fillStyle = `rgba(0,0,0,${0.06 * (depth - 1)})`; g.fillRect(px, py, TILE, TILE); }
    if (openUp) {
      g.fillStyle = P.top;
      g.fillRect(px, py, TILE, 2);
      g.fillStyle = P.top2;
      g.fillRect(px, py + 2, TILE, 1);
      for (let i = 0; i < 3; i++) g.fillRect(px + ((n(i, 10) * 8) | 0), py + 3, 1, 1);
      if (world.zoneAt(x) === "dry" && n(11, 1) < 0.3) { g.fillStyle = P.dark; g.fillRect(px + ((n(11, 2) * 6) | 0), py + 1, 2, 1); }
    }
  } else if (ch === "R") {
    g.fillStyle = "#4e4a57";
    g.fillRect(px, py, TILE, TILE);
    g.fillStyle = "#625d6c";
    const ox = (n(1, 1) * 3) | 0, oy = (n(1, 2) * 3) | 0;
    g.fillRect(px + ox, py + oy, 4, 3);
    g.fillRect(px + ((ox + 4) % 6), py + ((oy + 4) % 6), 3, 3);
    g.fillStyle = "#3a3742";
    g.fillRect(px + ((n(2, 1) * 8) | 0), py + ((n(2, 2) * 8) | 0), 2, 1);
    if (openUp) { g.fillStyle = "#7a7484"; g.fillRect(px, py, TILE, 1); }
  } else if (ch === "d") {
    g.fillStyle = "#a8743f";
    g.fillRect(px, py, TILE, TILE);
    g.fillStyle = "#c8915a";
    for (let i = 0; i < 4; i++) g.fillRect(px + (i % 2) * 4 + ((n(i, 1) * 2) | 0), py + ((i / 2) | 0) * 4 + ((n(i, 2) * 2) | 0), 2, 2);
    g.fillStyle = "#7a5230";
    for (let i = 0; i < 3; i++) g.fillRect(px + ((n(i, 3) * 8) | 0), py + ((n(i, 4) * 8) | 0), 1, 1);
  } else if (ch === "T") {
    g.fillStyle = "#5e3a1e";
    g.fillRect(px, py, TILE, TILE);
    g.fillStyle = "#9a6a3c";
    g.fillRect(px, py + 1, TILE, 2);
    g.fillRect(px, py + 5, TILE, 2);
    g.fillStyle = "#c08a50";
    g.fillRect(px + ((n(1, 1) * 6) | 0), py + 1, 2, 1);
    g.fillRect(px + ((n(1, 2) * 6) | 0), py + 5, 2, 1);
    g.fillStyle = "#3e2410";
    g.fillRect(px + ((n(2, 1) * 7) | 0), py + 2, 1, 1);
  } else if (ch === "S") {
    paintStone(g, px, py, n(0, 0) < 0.5);
    return;
  }
  // Dark rims where a block meets open space, so shapes read clearly.
  g.fillStyle = "rgba(20,10,5,0.35)";
  if (openL) g.fillRect(px, py, 1, TILE);
  if (openR) g.fillRect(px + TILE - 1, py, 1, TILE);
  if (openD) g.fillRect(px, py + TILE - 1, TILE, 1);
}

// A petrified ant curled into a block.
const STONE = [
  ".kkkkkk.",
  "kHHkHHHk",
  "kHgkgHeg",
  "kggkggkg",
  "kgdkgdkg",
  "kggggggk",
  ".dkdkdk.",
  "..d.d.d.",
];
const STONE_PAL = { k: "#5c5a62", H: "#c2bfc8", g: "#908d98", d: "#46444c", e: "#2a2830" };
let stoneR, stoneL;
function paintStone(g, px, py, flipIt) {
  if (!stoneR) { stoneR = sprite(STONE, STONE_PAL); stoneL = flip(stoneR); }
  g.drawImage(flipIt ? stoneL : stoneR, px, py);
}
export function stoneSprite() { if (!stoneR) paintStone(makeCanvas(8, 8).getContext("2d"), 0, 0, false); return stoneR; }

function paintStem(g, px, py, top) {
  g.fillStyle = "#3f8a2a";
  g.fillRect(px + 3, py, 2, TILE);
  g.fillStyle = "#7fcf4a";
  g.fillRect(px + 3, py, 1, TILE);
  if (top) { g.fillStyle = "#3f8a2a"; g.fillRect(px + 2, py, 4, 1); }
  g.fillStyle = "#2e6a1e";
  g.fillRect(px + 3, py + 6, 2, 1);
}

function paintLeaf(g, px, py, startL, endR) {
  g.fillStyle = "#3b7a28";
  g.fillRect(px + (startL ? 1 : 0), py + 2, TILE - (startL ? 1 : 0) - (endR ? 1 : 0), 2);
  g.fillStyle = "#5aa83a";
  g.fillRect(px + (startL ? 1 : 0), py, TILE - (startL ? 1 : 0) - (endR ? 2 : 0), 2);
  g.fillStyle = "#8fd060";
  g.fillRect(px + (startL ? 2 : 0), py + 1, TILE - (startL ? 2 : 0) - (endR ? 3 : 0), 1);
}

function paintThorns(g, px, py, x, y) {
  g.fillStyle = "#4a3020";
  g.fillRect(px, py + 6, TILE, 2);
  g.fillStyle = "#5e3a2a";
  for (const [sx, hgt] of [[1, 4], [4, 5], [6, 3]]) {
    const h = hgt + ((hash(x, y, sx) * 2) | 0);
    for (let i = 0; i < h; i++) g.fillRect(px + sx - (i < 2 ? 1 : 0), py + 6 - i, i < 2 ? 3 : 1, 1);
    g.fillStyle = "#e8d8b0";
    g.fillRect(px + sx, py + 6 - h, 1, 1);
    g.fillStyle = "#5e3a2a";
  }
}

// ---------------------------------------------------------------- backgrounds

const SKY = {
  dry: ["#9ccbe4", "#b2d4e2", "#c8dcdc", "#dce2cc", "#ecdfb2", "#f4d89a"],
  grass: ["#6fbcec", "#86c8ee", "#9ed4ee", "#b6e0e8", "#cceade", "#dcf0d0"],
};

function band(g, colors, vw, vh) {
  const n = colors.length;
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i];
    const y0 = Math.floor((vh * i) / n), y1 = Math.floor((vh * (i + 1)) / n);
    g.fillRect(0, y0, vw, y1 - y0);
  }
}

// One giant blade of grass (or dry stalk), built row by row.
function blade(g, bx, base, height, width, lean, light, dark) {
  for (let k = 0; k < height; k++) {
    const f = k / height, w = Math.max(1, Math.round(width * (1 - f * f)));
    const x = Math.round(bx + lean * f * f * height);
    g.fillStyle = dark;
    g.fillRect(x - (w >> 1), base - k, w, 1);
    if (w > 2) { g.fillStyle = light; g.fillRect(x - (w >> 1), base - k, Math.max(1, w >> 1), 1); }
  }
}

// kind: "dry" | "grass". horizon: screen y of the main ground line.
export function drawBackground(g, kind, vw, vh, camX, horizon) {
  band(g, SKY[kind], vw, vh);
  const far = Math.round(horizon * 0.35 + vh * 0.38), mid = Math.round(horizon * 0.6 + vh * 0.25);
  if (kind === "dry") {
    // Sun
    g.fillStyle = "#fff4c8";
    const sx = vw - 60 - ((camX * 0.02) % 40), sy = Math.round(vh * 0.18);
    for (let y = -14; y <= 14; y++) { const w = Math.round(Math.sqrt(196 - y * y)); g.fillRect(Math.round(sx - w), sy + y, w * 2, 1); }
  }
  // Far hills: summed sines per column.
  g.fillStyle = kind === "dry" ? "#dcc192" : "#a8d888";
  for (let x = 0; x < vw; x++) {
    const wx = x + camX * 0.15;
    const h = 18 + Math.sin(wx * 0.013) * 10 + Math.sin(wx * 0.037 + 1) * 5;
    g.fillRect(x, Math.round(far - h), 1, vh);
  }
  // Mid layer: giant stalks, the scenery of an ant's world.
  const p = 0.4, slot = 34, first = Math.floor((camX * p - 80) / slot), last = Math.ceil((camX * p + vw + 80) / slot);
  for (let i = first; i <= last; i++) {
    const r = hash(i, 0, kind === "dry" ? 11 : 12);
    if (r < 0.25) continue;
    const bx = i * slot - camX * p + hash(i, 1, 5) * 20;
    const height = 70 + hash(i, 2, 5) * 110, lean = (hash(i, 3, 5) - 0.5) * 0.5;
    if (kind === "dry") {
      blade(g, bx, mid + 30, height * 0.9, 4, lean, "#e0c486", "#c2a064");
      if (r > 0.75) {
        const tx = Math.round(bx + lean * height * 0.81), ty = Math.round(mid + 30 - height * 0.9);
        g.fillStyle = "#b08850";
        g.fillRect(tx - 3, ty - 8, 6, 9);
        g.fillStyle = "#d0a868";
        g.fillRect(tx - 2, ty - 7, 2, 7);
      }
    } else {
      blade(g, bx, mid + 30, height, 9, lean, "#78c050", "#58a03a");
      if (r > 0.9) {
        // A dandelion clock towering over everything.
        const tx = Math.round(bx + lean * height), ty = Math.round(mid + 30 - height);
        g.fillStyle = "#e8eee4";
        for (let y = -10; y <= 10; y++) { const w = Math.round(Math.sqrt(100 - y * y)); g.fillRect(tx - w, ty + y, w * 2, 1); }
        g.fillStyle = "#c4cec0";
        for (let k = 0; k < 14; k++) g.fillRect(tx + Math.round(Math.cos(k * 0.45) * 7), ty + Math.round(Math.sin(k * 0.45) * 7), 1, 1);
        g.fillStyle = "#9a8a50";
        g.fillRect(tx - 1, ty - 1, 3, 3);
      }
    }
  }
  g.fillStyle = kind === "dry" ? "#c8a46e" : "#5aa83a";
  g.fillRect(0, mid + 30, vw, vh);
}

// ---------------------------------------------------------------- decor

const TUFT = { dry: ["#c8b060", "#a08a40"], grass: ["#5aa83a", "#3f8a2a"], cave: ["#6a7a3a", "#4a5a2a"] };

// Grass blades drawn over the ants, so hidden ants really look hidden.
export function drawTuft(g, sx, sy, zone, t, seed) {
  const [light, dark] = TUFT[zone];
  for (let i = 0; i < 5; i++) {
    const h = 7 + ((hash(seed, i, 2) * 6) | 0), bx = sx + i * 2 - 1 + ((hash(seed, i, 3) * 2) | 0);
    const sway = Math.sin(t * 1.8 + seed * 0.7 + i) * 1.2;
    g.fillStyle = i % 2 ? dark : light;
    for (let k = 0; k < h; k++) g.fillRect(Math.round(bx + sway * (k / h) ** 2), sy - k - 1, 1, 1);
  }
}

// The new nest: a warm hollow full of eggs.
export function drawNewNest(g, sx, sy, t) {
  g.fillStyle = "#3a2414";
  for (let y = -10; y <= 0; y++) { const w = Math.round(Math.sqrt(100 - y * y) * 1.4); g.fillRect(sx - w, sy + y - 1, w * 2, 1); }
  const eggs = [[-8, -2], [-4, -3], [0, -2], [4, -3], [8, -2], [-6, -6], [-1, -6], [4, -7]];
  for (const [ex, ey] of eggs) {
    g.fillStyle = "#f4ecd8";
    g.fillRect(sx + ex - 1, sy + ey - 2, 3, 3);
    g.fillRect(sx + ex, sy + ey - 3, 1, 5);
    g.fillStyle = "#ffffff";
    g.fillRect(sx + ex - 1, sy + ey - 2, 1, 1);
  }
  const blink = (Math.sin(t * 3) + 1) / 2;
  g.fillStyle = `rgba(255,220,120,${0.3 + blink * 0.3})`;
  g.fillRect(sx - 1, sy - 16, 3, 3);
}
