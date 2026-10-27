// WebDAW UI: transport, track lanes, piano roll / drum grid, on-screen
// keyboard and the instrument panel. Audio lives in synth.js.

import { INSTRUMENTS, DRUMS, Mixer, scheduleStep, stepDur, renderSong, wavBlob, audible } from "./synth.js";
import { DEMOS, BLANK } from "./demos.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const store = {
  get(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode etc. */ }
  },
};
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const COLORS = ["#ff4fd8", "#39d5ff", "#ffb547", "#7cff6b", "#a77bff", "#ff6b6b", "#3dffc5", "#ffe14f"];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (p) => NOTE_NAMES[p % 12] + (Math.floor(p / 12) - 1);
const isBlack = (p) => [1, 3, 6, 8, 10].includes(p % 12);
const LANE_H = 40;
const TOP = 108; // highest pitch row in the piano roll (C8)
const BOTTOM = 21; // A0
const coarse = matchMedia("(pointer: coarse)").matches;
const canHover = matchMedia("(hover: hover)").matches;
// physical key positions (event.code), so QWERTZ/AZERTY keep the piano shape
const PIANO_CODES = ["KeyA", "KeyW", "KeyS", "KeyE", "KeyD", "KeyF", "KeyT", "KeyG", "KeyY", "KeyH", "KeyU", "KeyJ", "KeyK", "KeyO", "KeyL", "KeyP", "Semicolon", "Quote"];
const PAD_CODES = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon"];
let keyLabels = new Map();

// ---------------------------------------------------------------- song model

let uid = 0;
const newId = () => "t" + Date.now().toString(36) + (uid++).toString(36);
const num = (v, def, lo, hi) => (v = Number(v), Number.isFinite(v) ? clamp(v, lo, hi) : def);

function makeTrack(src, i) {
  const type = INSTRUMENTS[src.type] ? src.type : "poly";
  const def = INSTRUMENTS[type];
  const preset = src.preset in def.presets ? src.preset : src.preset === "" ? "" : Object.keys(def.presets)[0];
  const base = def.presets[preset] || {};
  const params = {};
  for (const p of def.params) params[p.key] = num(src.params?.[p.key] ?? base[p.key], p.def, p.min, p.max);
  const maxP = def.drum ? DRUMS.length - 1 : TOP;
  const notes = (Array.isArray(src.notes) ? src.notes : [])
    .map((n) => ({ t: num(n.t, -1, -1, 511), p: Math.round(num(n.p, -1, -1, maxP)), d: num(n.d, 1, 0.25, 256), v: num(n.v, 0.8, 0.05, 1) }))
    .filter((n) => n.t >= 0 && n.p >= (def.drum ? 0 : BOTTOM));
  return {
    id: typeof src.id === "string" ? src.id : newId(),
    name: String(src.name || def.name).slice(0, 24),
    type, preset, params,
    color: /^#[0-9a-f]{6}$/i.test(src.color) ? src.color : COLORS[i % COLORS.length],
    vol: num(src.vol, 0.8, 0, 1), pan: num(src.pan, 0, -1, 1), drive: num(src.drive, 0, 0, 1),
    rev: num(src.rev, 0.12, 0, 1), dly: num(src.dly, 0, 0, 1),
    mute: !!src.mute, solo: !!src.solo,
    notes,
  };
}

function normalize(src) {
  return {
    name: String(src.name || "Untitled").slice(0, 40),
    bpm: Math.round(num(src.bpm, 120, 40, 240)),
    swing: num(src.swing, 0, 0, 100),
    bars: [1, 2, 4, 8, 16, 32].includes(src.bars) ? src.bars : 4,
    tracks: (Array.isArray(src.tracks) ? src.tracks : []).slice(0, 16).map(makeTrack),
  };
}

let song = null;
let sel = 0;
const undoStack = [], redoStack = [];
let lastSlider = null;
const ui = { snap: 1, len: 1, rec: false, oct: { poly: 3, supersaw: 4, reese: 1, sub808: 1 } };

const cur = () => song.tracks[sel];
const isDrum = (tr = cur()) => !!tr && !!INSTRUMENTS[tr.type].drum;
const total = () => song.bars * 16;

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set("webdaw.song", JSON.stringify(song)), 300);
  touch();
}

function snapshot() {
  undoStack.push(JSON.stringify(song));
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  lastSlider = null;
}

// Dragging a slider makes one undo step, not one per input event.
function sliderEdit(key) {
  if (lastSlider !== key) { snapshot(); lastSlider = key; }
}

function restore(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(song));
  song = normalize(JSON.parse(from.pop()));
  lastSlider = null;
  sel = clamp(sel, 0, Math.max(0, song.tracks.length - 1));
  renderAll();
  save();
}
const undo = () => restore(undoStack, redoStack);
const redo = () => restore(redoStack, undoStack);

function loadSong(src, msg) {
  if (song) snapshot();
  song = normalize(src);
  sel = 0;
  tp.step %= total();
  renderAll();
  centerRoll();
  save();
  if (msg) toast(msg);
}

// ---------------------------------------------------------------- audio & transport

let actx = null, mixer = null;

function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC({ latencyHint: "interactive" });
    mixer = new Mixer(actx);
    syncMixer();
  }
  if (actx.state === "suspended") actx.resume();
  return actx;
}

function syncMixer() {
  if (!mixer) return;
  for (const tr of song.tracks) mixer.update(tr, audible(song, tr));
  mixer.prune(new Set(song.tracks.map((t) => t.id)));
  mixer.setTempo(song.bpm);
}

const tp = { playing: false, step: 0, next: 0, timer: 0, marks: [], vis: [] };

function play() {
  audio();
  tp.playing = true;
  tp.step = 0;
  tp.next = actx.currentTime + 0.08;
  tp.marks = [];
  tick();
  tp.timer = setInterval(tick, 25);
  $("play").setAttribute("aria-pressed", "true");
}

function stop() {
  tp.playing = false;
  clearInterval(tp.timer);
  tp.vis = [];
  mixer?.cut();
  $("play").setAttribute("aria-pressed", "false");
  $("pos").textContent = "1.1.1";
  touch();
}

const togglePlay = () => (tp.playing ? stop() : play());

// Lookahead scheduler; a hidden tab only gets ~1 timer tick per second, so
// it schedules further ahead there.
function tick() {
  const ahead = actx.currentTime + (document.hidden ? 1.5 : 0.12);
  const sd = stepDur(song.bpm);
  while (tp.next < ahead) {
    if (tp.step >= total()) tp.step = 0;
    scheduleStep(mixer, song, tp.step, tp.next, onNote);
    tp.marks.push([tp.step, tp.next]);
    tp.next += sd;
    tp.step++;
  }
  if (tp.marks.length > 64) tp.marks.splice(0, tp.marks.length - 64);
}

function onNote(tr, n, t0, t1) {
  tp.vis.push({ id: tr.id, n, p: n.p, t0, t1: Math.max(t1, t0 + 0.1) });
}

// Song position (in steps, fractional) at an audio-clock time.
function posAt(time) {
  const sd = stepDur(song.bpm);
  for (let i = tp.marks.length - 1; i >= 0; i--) {
    const [s, t] = tp.marks[i];
    if (t <= time) return (s + Math.min(1, (time - t) / sd)) % total();
  }
  return 0;
}

// ---------------------------------------------------------------- live playing

const held = new Map(); // source ("key:KeyA", "ptr:3", "roll") -> voice info

function liveOn(src, p, vel = 0.85) {
  liveOff(src);
  const tr = cur();
  if (!tr) return;
  audio();
  const t = actx.currentTime;
  const rel = INSTRUMENTS[tr.type].noteOn(actx, mixer.channel(tr.id), t, p, vel, tr.params);
  const h = { p, rel, tr, note: null, start: 0 };
  if (ui.rec && tp.playing && src !== "roll") {
    const pos = posAt(t);
    let q = Math.round(pos / ui.snap) * ui.snap;
    if (q >= total()) q -= total();
    snapshot();
    h.note = { t: q, p, d: isDrum(tr) ? Math.min(1, ui.snap) : ui.snap, v: vel };
    h.start = pos;
    tr.notes.push(h.note);
    save();
  }
  held.set(src, h);
  touch();
}

function liveOff(src) {
  const h = held.get(src);
  if (!h) return;
  held.delete(src);
  h.rel(actx.currentTime);
  if (h.note && !isDrum(h.tr)) {
    let len = posAt(actx.currentTime) - h.start;
    if (len < 0) len += total();
    h.note.d = Math.max(ui.snap, Math.round(len / ui.snap) * ui.snap);
    save();
  }
  touch();
}

function releaseAll() {
  for (const src of [...held.keys()]) liveOff(src);
}

// short audition, e.g. when placing a note or picking a preset
function blip(p, len = 0.18) {
  const tr = cur();
  if (!tr) return;
  audio();
  const t = actx.currentTime;
  INSTRUMENTS[tr.type].noteOn(actx, mixer.channel(tr.id), t, p, 0.8, tr.params)(t + len);
}

function defaultPitch(tr = cur()) {
  return isDrum(tr) ? 0 : 12 * (ui.oct[tr.type] + 1) + 9;
}

// ---------------------------------------------------------------- toast & files

let toastTimer = 0;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const fileName = () => song.name.replace(/[^\w\- ]+/g, "").trim() || "song";

// ---------------------------------------------------------------- header

function renderHeader() {
  $("bpm").value = song.bpm;
  $("swing").value = song.swing;
  $("bars").value = String(song.bars);
  $("songName").textContent = song.name;
  $("rec").setAttribute("aria-pressed", String(ui.rec));
}

function bindHeader() {
  $("play").addEventListener("click", togglePlay);
  $("rec").addEventListener("click", () => {
    ui.rec = !ui.rec;
    renderHeader();
  });
  $("bpm").addEventListener("change", (e) => {
    sliderEdit("bpm");
    song.bpm = Math.round(num(e.target.value, song.bpm, 40, 240));
    e.target.value = song.bpm;
    syncMixer();
    save();
  });
  $("swing").addEventListener("input", (e) => {
    sliderEdit("swing");
    song.swing = Number(e.target.value);
    save();
  });
  $("bars").addEventListener("change", (e) => {
    snapshot();
    song.bars = Number(e.target.value);
    tp.step %= total();
    save();
    resizeRoll();
  });
  $("songName").parentElement.addEventListener("click", () => {
    const name = prompt("Song name", song.name);
    if (name === null || !name.trim()) return;
    snapshot();
    song.name = name.trim().slice(0, 40);
    renderHeader();
    save();
  });

  const demo = $("demo");
  DEMOS.forEach((d, i) => demo.add(new Option(d.name, String(i))));
  demo.addEventListener("change", () => {
    const d = DEMOS[Number(demo.value)];
    demo.value = "";
    if (d) loadSong(d.make(), `Loaded “${d.name}”`);
  });
  $("new").addEventListener("click", () => loadSong(BLANK(), "New song"));
  $("save").addEventListener("click", () => {
    download(new Blob([JSON.stringify(song, null, 1)], { type: "application/json" }), `${fileName()}.webdaw.json`);
  });
  $("open").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      loadSong(JSON.parse(await file.text()), `Opened “${file.name}”`);
    } catch {
      toast("That file is not a WebDAW song");
    }
  });
  $("export").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = "Rendering…";
    try {
      download(wavBlob(await renderSong(song, 2)), `${fileName()}.wav`);
      toast("WAV exported (2 loops)");
    } catch (err) {
      console.error(err);
      toast("Export failed");
    } finally {
      b.disabled = false;
      b.textContent = "WAV";
    }
  });
  $("help").addEventListener("click", () => $("helpDlg").showModal());

  const add = $("addTrack");
  for (const [k, d] of Object.entries(INSTRUMENTS)) add.add(new Option(d.name, k));
  add.addEventListener("change", () => {
    const type = add.value;
    add.value = "";
    if (!type || song.tracks.length >= 16) return;
    snapshot();
    song.tracks.push(makeTrack({ type, name: INSTRUMENTS[type].name }, song.tracks.length));
    select(song.tracks.length - 1);
    save();
  });
}

// ---------------------------------------------------------------- lanes

const laneCv = $("laneCanvas");
let laneG = null, laneW = 0;

function renderLanes() {
  const heads = $("laneHeads");
  heads.replaceChildren();
  song.tracks.forEach((tr, i) => {
    const row = el("div", "lane" + (i === sel ? " sel" : ""));
    row.style.setProperty("--c", tr.color);
    const info = el("div", "ln");
    info.append(el("b", "", tr.name), el("small", "", INSTRUMENTS[tr.type].short));
    const vol = el("input", "vol");
    Object.assign(vol, { type: "range", min: 0, max: 1, step: 0.01, value: tr.vol, title: "Volume" });
    vol.addEventListener("input", () => {
      sliderEdit("vol" + tr.id);
      tr.vol = Number(vol.value);
      syncMixer();
      save();
      if (i === sel) renderSound();
    });
    const toggle = (cls, key, title) => {
      const b = el("button", "ms " + cls, cls.toUpperCase());
      b.type = "button";
      b.title = title;
      b.setAttribute("aria-pressed", String(tr[key]));
      b.addEventListener("click", () => {
        tr[key] = !tr[key];
        b.setAttribute("aria-pressed", String(tr[key]));
        syncMixer();
        save();
      });
      return b;
    };
    row.append(el("span", "sw"), info, vol, toggle("m", "mute", "Mute"), toggle("s", "solo", "Solo"));
    row.addEventListener("click", (e) => {
      if (!e.target.closest("button, input")) select(i);
    });
    heads.append(row);
  });
  resizeLanes();
}

function resizeLanes() {
  laneW = laneCv.clientWidth;
  const h = Math.max(1, song.tracks.length) * LANE_H;
  laneCv.style.height = h + "px";
  laneG = fitCanvas(laneCv, laneW, h);
  lanesDirty = true;
}

function drawLanes(pos) {
  const g = laneG, w = laneW, n = total();
  if (!g || !w) return;
  const h = song.tracks.length * LANE_H, sx = w / n;
  g.fillStyle = "#110e1a";
  g.fillRect(0, 0, w, Math.max(h, LANE_H));
  song.tracks.forEach((tr, i) => {
    const y0 = i * LANE_H;
    if (i === sel) {
      g.fillStyle = "#1c1829";
      g.fillRect(0, y0, w, LANE_H);
    }
    g.fillStyle = "#2b2540";
    g.fillRect(0, y0 + LANE_H - 1, w, 1);
    const drum = isDrum(tr);
    let lo = 127, hi = 0;
    for (const nt of tr.notes) { lo = Math.min(lo, nt.p); hi = Math.max(hi, nt.p); }
    if (drum) { lo = 0; hi = DRUMS.length - 1; }
    const span = Math.max(hi - lo, 12), inner = LANE_H - 12;
    g.fillStyle = tr.color;
    g.globalAlpha = tr.mute ? 0.25 : 0.85;
    for (const nt of tr.notes) {
      if (nt.t >= n) continue;
      const y = drum
        ? y0 + 6 + nt.p / (DRUMS.length - 1) * (inner - 2)
        : y0 + 6 + (1 - (nt.p - lo) / span) * (inner - 3) - (span - (hi - lo)) / span * inner / 2;
      g.fillRect(nt.t * sx, y, Math.max(1.5, nt.d * sx - 1), drum ? 2 : 3);
    }
    g.globalAlpha = 1;
  });
  for (let b = 0; b <= song.bars; b++) {
    g.fillStyle = b % 4 ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.14)";
    g.fillRect(Math.min(w - 1, b * 16 * sx), 0, 1, h);
  }
  if (pos !== null) {
    g.fillStyle = "#ff4fd8";
    g.fillRect(pos * sx, 0, 2, h);
  }
}

laneCv.addEventListener("pointerdown", (e) => {
  const r = laneCv.getBoundingClientRect();
  const i = Math.floor((e.clientY - r.top) / LANE_H);
  if (i < 0 || i >= song.tracks.length) return;
  if (i !== sel) select(i);
  // jump the editor to the clicked bar
  const step = Math.floor((e.clientX - r.left) / r.width * song.bars) * 16;
  const sw = stepW();
  if (step * sw < roll.scrollX || (step + 16) * sw > roll.scrollX + roll.w - roll.keyW) roll.scrollX = step * sw;
  rollDirty = true;
});

// ---------------------------------------------------------------- sound panel

const MIX = [
  { key: "vol", label: "Volume", min: 0, max: 1, unit: "%" },
  { key: "pan", label: "Pan", min: -1, max: 1, unit: "pan" },
  { key: "drive", label: "Drive", min: 0, max: 1, unit: "%" },
  { key: "rev", label: "Reverb", min: 0, max: 1, unit: "%" },
  { key: "dly", label: "Delay", min: 0, max: 1, unit: "%" },
];

function fmt(v, unit) {
  switch (unit) {
    case "Hz": return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
    case "s": return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
    case "%": return `${Math.round(v * 100)}%`;
    case "ct": return `${Math.round(v)} ct`;
    case "st": return `${v > 0 ? "+" : ""}${Math.round(v)} st`;
    case "oct": return `${v.toFixed(1)} oct`;
    case "x": return `${v.toFixed(2)}×`;
    case "pan": return Math.abs(v) < 0.02 ? "C" : `${v < 0 ? "L" : "R"}${Math.round(Math.abs(v) * 100)}`;
    default: return v.toFixed(1);
  }
}

function slider(spec, get, set, key) {
  const label = el("label", "kn");
  const input = el("input");
  Object.assign(input, { type: "range", min: 0, max: 1000, step: 1 });
  const out = el("output");
  const toPos = (v) => spec.log
    ? Math.log(v / spec.min) / Math.log(spec.max / spec.min)
    : (v - spec.min) / (spec.max - spec.min);
  const fromPos = (x) => spec.log
    ? spec.min * Math.pow(spec.max / spec.min, x)
    : spec.min + x * (spec.max - spec.min);
  input.value = Math.round(toPos(get()) * 1000);
  out.textContent = fmt(get(), spec.unit);
  input.addEventListener("input", () => {
    sliderEdit(key);
    let v = fromPos(input.value / 1000);
    if (spec.unit === "st") v = Math.round(v);
    set(v);
    out.textContent = fmt(v, spec.unit);
    save();
  });
  label.append(el("span", "", spec.label), input, out);
  return label;
}

function renderSound() {
  const box = $("sound");
  box.replaceChildren();
  const tr = cur();
  if (!tr) {
    box.append(el("p", "", "No tracks yet. Add one with “+ Add track”."));
    return;
  }
  const def = INSTRUMENTS[tr.type];
  const head = el("div", "sh");

  const name = el("input");
  Object.assign(name, { value: tr.name, maxLength: 24, title: "Track name" });
  name.addEventListener("change", () => {
    snapshot();
    tr.name = name.value.trim() || def.name;
    renderLanes();
    renderTitle();
    save();
  });

  // drum and melodic tracks can't swap types: their notes mean different things
  const type = el("select", "btn");
  type.title = "Instrument";
  for (const [k, d] of Object.entries(INSTRUMENTS)) {
    if (!!d.drum === !!def.drum) type.add(new Option(d.name, k, false, k === tr.type));
  }
  type.disabled = !!def.drum;
  type.addEventListener("change", () => {
    snapshot();
    const d = INSTRUMENTS[type.value];
    tr.type = type.value;
    tr.preset = Object.keys(d.presets)[0];
    tr.params = makeTrack({ type: tr.type, preset: tr.preset }, sel).params;
    renderAll();
    blip(defaultPitch(), 0.3);
    save();
  });

  const preset = el("select", "btn");
  preset.title = "Preset";
  for (const k of Object.keys(def.presets)) preset.add(new Option(k, k));
  const custom = new Option("Custom", "");
  custom.disabled = true;
  preset.add(custom);
  preset.value = tr.preset;
  preset.addEventListener("change", () => {
    snapshot();
    tr.preset = preset.value;
    Object.assign(tr.params, def.presets[tr.preset]);
    renderSound();
    blip(defaultPitch(), 0.3);
    save();
  });

  const del = el("button", "btn icon", "✕");
  del.type = "button";
  del.title = "Delete track";
  del.addEventListener("click", () => {
    if (!confirm(`Delete track “${tr.name}”?`)) return;
    snapshot();
    song.tracks.splice(sel, 1);
    sel = clamp(sel, 0, Math.max(0, song.tracks.length - 1));
    renderAll();
    syncMixer();
    save();
  });
  head.append(name, type, preset, del);

  const knobs = el("div", "knobs");
  for (const p of def.params) {
    knobs.append(slider(p, () => tr.params[p.key], (v) => {
      tr.params[p.key] = v;
      if (tr.preset) { tr.preset = ""; preset.value = ""; }
    }, tr.id + p.key));
  }
  const mix = el("div", "knobs");
  for (const p of MIX) {
    mix.append(slider(p, () => tr[p.key], (v) => {
      tr[p.key] = v;
      syncMixer();
      if (p.key === "vol") $("laneHeads").children[sel].querySelector(".vol").value = v;
    }, tr.id + p.key));
  }
  box.append(head, el("h4", "", def.name), knobs, el("h4", "", "Mix"), mix);
}

// ---------------------------------------------------------------- keyboard

const keysEl = $("keys");
let keyEls = new Map(); // pitch (or drum row) -> element
let litKeys = new Set();

const octBase = (tr) => 12 * (ui.oct[tr.type] + 1);

function keyLabel(code) {
  const l = keyLabels.get?.(code);
  if (l) return l.toUpperCase();
  return code.startsWith("Key") ? code.slice(3) : ({ Semicolon: ";", Quote: "'" })[code] ?? "";
}

function renderKeys() {
  keysEl.replaceChildren();
  keyEls = new Map();
  litKeys = new Set();
  const tr = cur();
  const drum = isDrum(tr);
  $("octDown").hidden = $("octUp").hidden = drum || !tr;
  if (!tr) { $("octLabel").textContent = ""; return; }
  keysEl.style.setProperty("--c", tr.color);
  if (drum) {
    keysEl.className = "pads";
    $("octLabel").textContent = "808 pads";
    DRUMS.forEach((name, i) => {
      const pad = el("div", "pad");
      pad.dataset.p = i;
      pad.append(el("span", "", name));
      if (canHover) pad.append(el("i", "", keyLabel(PAD_CODES[i])));
      keysEl.append(pad);
      keyEls.set(i, pad);
    });
    return;
  }
  keysEl.className = "";
  const base = octBase(tr), w = keysEl.clientWidth;
  const whites = clamp(Math.floor(w / (coarse ? 40 : 34)), 7, 29), ww = w / whites;
  let p = base;
  for (let wi = 0; wi < whites; p++) {
    const black = isBlack(p);
    const k = el("div", "key " + (black ? "black" : "white"));
    k.dataset.p = p;
    k.style.left = (black ? wi * ww - ww * 0.32 : wi * ww) + "px";
    k.style.width = (black ? ww * 0.64 : ww) + "px";
    const hint = p - base < PIANO_CODES.length && canHover ? keyLabel(PIANO_CODES[p - base]) : "";
    if (hint) k.append(el("i", "", hint));
    if (p % 12 === 0) k.append(el("span", "", noteName(p)));
    keysEl.append(k);
    keyEls.set(p, k);
    if (!black) wi++;
  }
  $("octLabel").textContent = `${noteName(base)} – ${noteName(p - 1)}`;
}

function shiftOctave(d) {
  const tr = cur();
  if (!tr || isDrum(tr)) return;
  ui.oct[tr.type] = clamp(ui.oct[tr.type] + d, 0, 7);
  releaseAll();
  renderKeys();
}

function lightKeys(active) {
  for (const p of litKeys) if (!active.has(p)) keyEls.get(p)?.classList.remove("on");
  for (const p of active) if (!litKeys.has(p)) keyEls.get(p)?.classList.add("on");
  litKeys = active;
}

function bindKeyboard() {
  const at = (x, y) => {
    const k = document.elementFromPoint(x, y)?.closest?.("[data-p]");
    return k && keysEl.contains(k) ? k : null;
  };
  // lower on the key = louder, like hitting it harder
  const vel = (k, y) => {
    const r = k.getBoundingClientRect();
    return clamp(0.45 + 0.55 * (y - r.top) / r.height, 0.3, 1);
  };
  const ptrs = new Map();
  keysEl.addEventListener("pointerdown", (e) => {
    const k = at(e.clientX, e.clientY);
    if (!k) return;
    e.preventDefault();
    keysEl.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, k);
    liveOn("ptr:" + e.pointerId, Number(k.dataset.p), vel(k, e.clientY));
  });
  keysEl.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const k = at(e.clientX, e.clientY);
    if (k === ptrs.get(e.pointerId)) return;
    ptrs.set(e.pointerId, k);
    if (k) liveOn("ptr:" + e.pointerId, Number(k.dataset.p), vel(k, e.clientY));
    else liveOff("ptr:" + e.pointerId);
  });
  const up = (e) => {
    if (!ptrs.delete(e.pointerId)) return;
    liveOff("ptr:" + e.pointerId);
  };
  keysEl.addEventListener("pointerup", up);
  keysEl.addEventListener("pointercancel", up);
  keysEl.addEventListener("contextmenu", (e) => e.preventDefault());
  $("octDown").addEventListener("click", () => shiftOctave(-1));
  $("octUp").addEventListener("click", () => shiftOctave(1));

  const typing = (t) => t.closest?.("input:not([type=range]), select, textarea, dialog[open]");
  addEventListener("keydown", (e) => {
    if (typing(e.target)) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.code === "KeyZ") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (e.code === "KeyY") { e.preventDefault(); redo(); }
      return;
    }
    if (e.altKey) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) togglePlay();
      return;
    }
    const tr = cur();
    const idx = tr ? (isDrum(tr) ? PAD_CODES : PIANO_CODES).indexOf(e.code) : -1;
    if (idx >= 0) {
      e.preventDefault();
      if (!e.repeat) liveOn("key:" + e.code, isDrum(tr) ? idx : octBase(tr) + idx);
      return;
    }
    if (e.repeat) return;
    if (e.code === "KeyZ") shiftOctave(-1);
    else if (e.code === "KeyX") shiftOctave(1);
    else if (e.code === "KeyR") { ui.rec = !ui.rec; renderHeader(); }
  });
  addEventListener("keyup", (e) => {
    // keep Space from also "clicking" a focused button
    if (e.code === "Space" && !typing(e.target)) e.preventDefault();
    liveOff("key:" + e.code);
  });
  addEventListener("blur", releaseAll);
}

// ---------------------------------------------------------------- piano roll

const rollCv = $("roll");
const roll = { g: null, w: 0, h: 0, keyW: 64, rulerH: 22, scrollX: 0, scrollY: 0, zoom: 1, drag: null };
let rollDirty = true, lanesDirty = true;
const touch = () => { rollDirty = lanesDirty = true; };

const rowH = () => (isDrum() ? (coarse ? 32 : 24) : (coarse ? 22 : 15));
const rowCount = () => (isDrum() ? DRUMS.length : TOP - BOTTOM + 1);
const pitchToRow = (p) => (isDrum() ? p : TOP - p);
const rowToPitch = (r) => (isDrum() ? r : TOP - r);
function stepW() {
  const fit = (roll.w - roll.keyW) / total();
  return clamp(fit, coarse ? 14 : 9, 48) * roll.zoom;
}

function fitCanvas(cv, w, h) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

function resizeRoll() {
  const wrap = $("rollWrap");
  roll.w = wrap.clientWidth;
  roll.h = wrap.clientHeight;
  roll.keyW = isDrum() ? (coarse ? 84 : 92) : (coarse ? 44 : 56);
  roll.g = fitCanvas(rollCv, roll.w, roll.h);
  clampScroll();
  rollDirty = true;
}

function clampScroll() {
  const maxX = Math.max(0, total() * stepW() - (roll.w - roll.keyW) + 24);
  const maxY = Math.max(0, rowCount() * rowH() - (roll.h - roll.rulerH));
  roll.scrollX = clamp(roll.scrollX, 0, maxX);
  roll.scrollY = clamp(roll.scrollY, 0, maxY);
}

function centerRoll() {
  const tr = cur();
  roll.keyW = isDrum() ? (coarse ? 84 : 92) : (coarse ? 44 : 56);
  if (!tr || isDrum(tr)) {
    roll.scrollY = 0;
  } else {
    const ps = tr.notes.map((n) => n.p);
    const mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : defaultPitch(tr);
    roll.scrollY = (TOP - mid) * rowH() - (roll.h - roll.rulerH) / 2;
  }
  clampScroll();
  rollDirty = true;
}

function drawRoll(pos, active, activeP) {
  const { g, w, h, keyW, rulerH } = roll;
  const tr = cur();
  if (!g) return;
  g.fillStyle = "#0c0a14";
  g.fillRect(0, 0, w, h);
  if (!tr) {
    g.fillStyle = "#9a93b8";
    g.font = "14px system-ui, sans-serif";
    g.fillText("Add a track to start.", 20, 40);
    return;
  }
  clampScroll();
  const drum = isDrum(tr), sw = stepW(), rh = rowH(), rows = rowCount(), n = total();
  const sx = roll.scrollX, sy = roll.scrollY;
  const r0 = Math.max(0, Math.floor(sy / rh)), r1 = Math.min(rows - 1, Math.ceil((sy + h - rulerH) / rh));
  const s0 = Math.max(0, Math.floor(sx / sw)), s1 = Math.ceil((sx + w - keyW) / sw);
  const X = (s) => keyW + s * sw - sx;
  const Y = (r) => rulerH + r * rh - sy;

  // grid
  g.save();
  g.beginPath();
  g.rect(keyW, rulerH, w - keyW, h - rulerH);
  g.clip();
  for (let r = r0; r <= r1; r++) {
    const p = rowToPitch(r);
    g.fillStyle = drum ? (r % 2 ? "#14111e" : "#181424") : isBlack(p) ? "#110e1a" : "#181424";
    g.fillRect(keyW, Y(r), w - keyW, rh);
    if (!drum && p % 12 === 0) {
      g.fillStyle = "#2b2540";
      g.fillRect(keyW, Y(r) + rh - 1, w - keyW, 1);
    }
  }
  for (let b = Math.floor(s0 / 16); b * 16 <= s1; b++) {
    if (b % 2) {
      g.fillStyle = "rgba(255,255,255,0.018)";
      g.fillRect(X(b * 16), rulerH, 16 * sw, h);
    }
  }
  for (let s = s0; s <= s1; s++) {
    if (s % 16 === 0) g.fillStyle = "rgba(255,255,255,0.2)";
    else if (s % 4 === 0) g.fillStyle = "rgba(255,255,255,0.09)";
    else if (sw >= 9) g.fillStyle = "rgba(255,255,255,0.035)";
    else continue;
    g.fillRect(Math.round(X(s)), rulerH, 1, h);
  }
  const endX = X(n);
  if (endX < w) {
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(endX, rulerH, w - endX, h);
  }

  // notes
  g.font = "600 10px system-ui, sans-serif";
  g.textBaseline = "middle";
  for (const nt of tr.notes) {
    const r = pitchToRow(nt.p);
    if (r < r0 || r > r1) continue;
    const x = X(nt.t), nw = Math.max(4, nt.d * sw - 1), y = Y(r);
    if (x > w || x + nw < keyW) continue;
    const on = active.has(nt);
    g.globalAlpha = (nt.t >= n ? 0.3 : 1) * (0.45 + 0.55 * nt.v);
    g.fillStyle = tr.color;
    g.beginPath();
    g.roundRect(x + 0.5, y + 1.5, nw - 1, rh - 3, Math.min(4, rh / 4));
    g.fill();
    g.globalAlpha = 1;
    if (on) {
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.fill();
    }
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 1;
    g.stroke();
    // velocity bar along the bottom
    g.fillStyle = "rgba(12,10,20,0.55)";
    g.fillRect(x + 2, y + rh - 4, (nw - 4) * nt.v, 1.5);
    if (!drum && nw > 28 && rh >= 14) {
      g.fillStyle = "#160b18";
      g.fillText(noteName(nt.p), x + 4, y + rh / 2);
    }
  }
  if (pos !== null) {
    g.fillStyle = "#ff4fd8";
    g.fillRect(X(pos), rulerH, 2, h);
  }
  g.restore();

  // ruler
  g.fillStyle = "#15121f";
  g.fillRect(0, 0, w, rulerH);
  g.save();
  g.beginPath();
  g.rect(keyW, 0, w - keyW, rulerH);
  g.clip();
  g.font = "600 11px system-ui, sans-serif";
  g.textBaseline = "middle";
  for (let s = s0 - (s0 % 4); s <= Math.min(s1, n); s += 4) {
    const x = Math.round(X(s));
    g.fillStyle = s % 16 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.5)";
    g.fillRect(x, s % 16 ? rulerH - 6 : 4, 1, s % 16 ? 6 : rulerH - 4);
    if (s % 16 === 0 && s < n) {
      g.fillStyle = "#ece8ff";
      g.fillText(String(s / 16 + 1), x + 4, rulerH / 2);
    }
  }
  if (pos !== null) {
    g.fillStyle = "#ff4fd8";
    const x = X(pos) + 1;
    g.beginPath();
    g.moveTo(x - 6, 2); g.lineTo(x + 6, 2); g.lineTo(x, rulerH - 4);
    g.fill();
  }
  g.restore();
  g.fillStyle = "#2b2540";
  g.fillRect(0, rulerH - 1, w, 1);

  // key strip / drum names
  g.save();
  g.beginPath();
  g.rect(0, rulerH, keyW, h - rulerH);
  g.clip();
  g.font = drum ? "600 11px system-ui, sans-serif" : "600 9px system-ui, sans-serif";
  for (let r = r0; r <= r1; r++) {
    const p = rowToPitch(r), y = Y(r), lit = activeP.has(p);
    if (drum) {
      g.fillStyle = lit ? tr.color : r % 2 ? "#1a1626" : "#201b2e";
      g.fillRect(0, y, keyW, rh);
      g.fillStyle = lit ? "#160b18" : "#ece8ff";
      g.fillText(DRUMS[p], 8, y + rh / 2);
    } else {
      const black = isBlack(p);
      g.fillStyle = "#d8d3ea";
      g.fillRect(0, y, keyW, rh);
      if (black) {
        g.fillStyle = "#1a1626";
        g.fillRect(0, y, keyW * 0.62, rh);
      }
      if (lit) {
        g.fillStyle = tr.color;
        g.fillRect(0, y, black ? keyW * 0.62 : keyW, rh);
      }
      g.fillStyle = "#0c0a14";
      g.fillRect(0, y + rh - 1, keyW, black || (p % 12 !== 4 && p % 12 !== 11) ? 0 : 1);
      if (p % 12 === 0) {
        g.fillRect(0, y + rh - 1, keyW, 1);
        g.fillStyle = "#514a6e";
        g.fillText(noteName(p), keyW - 24, y + rh / 2);
      }
    }
  }
  g.restore();
  g.fillStyle = "#2b2540";
  g.fillRect(keyW - 1, rulerH, 1, h);
}

// note under a canvas point, or the empty cell
function hitTest(x, y) {
  const tr = cur(), sw = stepW(), rh = rowH();
  const step = (x - roll.keyW + roll.scrollX) / sw;
  const r = Math.floor((y - roll.rulerH + roll.scrollY) / rh);
  const p = rowToPitch(r);
  for (let i = tr.notes.length - 1; i >= 0; i--) {
    const n = tr.notes[i];
    if (n.p === p && step >= n.t && step < n.t + Math.max(n.d, 4 / sw)) {
      const right = roll.keyW + (n.t + n.d) * sw - roll.scrollX;
      return { n, edge: !isDrum(tr) && right - x < Math.min(10, n.d * sw * 0.35) };
    }
  }
  return { step, r, p };
}

function bindRoll() {
  const local = (e) => {
    const r = rollCv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  rollCv.addEventListener("pointerdown", (e) => {
    const tr = cur();
    if (!tr || e.button === 2) return;
    const { x, y } = local(e);
    rollCv.setPointerCapture(e.pointerId);
    if (y < roll.rulerH) {
      roll.drag = { mode: "pan", x0: x, y0: y, sx: roll.scrollX, sy: roll.scrollY, moved: true };
      return;
    }
    if (x < roll.keyW) {
      const r = Math.floor((y - roll.rulerH + roll.scrollY) / rowH());
      if (r >= 0 && r < rowCount()) liveOn("roll", rowToPitch(r));
      roll.drag = { mode: "key" };
      return;
    }
    const hit = hitTest(x, y);
    const mode = hit.n ? (e.shiftKey ? "vel" : hit.edge ? "size" : "move") : "pan";
    roll.drag = { mode, hit, n: hit.n, o: hit.n && { ...hit.n }, x0: x, y0: y, sx: roll.scrollX, sy: roll.scrollY, moved: false };
  });

  rollCv.addEventListener("pointermove", (e) => {
    const d = roll.drag, { x, y } = local(e);
    if (!d) {
      if (!cur() || x < roll.keyW || y < roll.rulerH) { rollCv.style.cursor = "default"; return; }
      const hit = hitTest(x, y);
      rollCv.style.cursor = !hit.n ? "cell" : hit.edge ? "ew-resize" : e.shiftKey ? "ns-resize" : "grab";
      return;
    }
    if (d.mode === "key") return;
    const dx = x - d.x0, dy = y - d.y0;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < (coarse ? 10 : 5)) return;
      d.moved = true;
      if (d.n) snapshot();
    }
    const sw = stepW(), rh = rowH(), snap = ui.snap;
    if (d.mode === "pan") {
      roll.scrollX = d.sx - dx;
      roll.scrollY = d.sy - dy;
      clampScroll();
    } else if (d.mode === "move") {
      const t = clamp(d.o.t + Math.round(dx / sw / snap) * snap, 0, total() - Math.min(snap, d.o.d));
      const r = clamp(pitchToRow(d.o.p) + Math.round(dy / rh), 0, rowCount() - 1);
      const p = rowToPitch(r);
      if (p !== d.n.p) blip(p, 0.12);
      d.n.t = t;
      d.n.p = p;
    } else if (d.mode === "size") {
      const end = Math.round((d.o.t + d.o.d + dx / sw) / snap) * snap;
      d.n.d = Math.max(snap, end - d.o.t);
      ui.len = d.n.d;
    } else if (d.mode === "vel") {
      d.n.v = clamp(d.o.v - dy / 120, 0.05, 1);
    }
    touch();
  });

  const end = () => {
    const d = roll.drag;
    roll.drag = null;
    if (!d) return;
    if (d.mode === "key") { liveOff("roll"); return; }
    const tr = cur();
    if (d.moved) {
      if (d.n) save();
      return;
    }
    if (d.n) {
      snapshot();
      tr.notes.splice(tr.notes.indexOf(d.n), 1);
      save();
    } else if (d.hit && d.hit.r >= 0 && d.hit.r < rowCount() && d.hit.step >= 0) {
      const t = Math.floor(d.hit.step / ui.snap) * ui.snap;
      if (t >= total()) return;
      snapshot();
      const len = isDrum(tr) ? Math.min(1, ui.snap) : Math.min(ui.len, total() - t);
      tr.notes.push({ t, p: d.hit.p, d: len, v: 0.8 });
      blip(d.hit.p, Math.min(0.4, len * stepDur(song.bpm)));
      save();
    }
  };
  rollCv.addEventListener("pointerup", end);
  rollCv.addEventListener("pointercancel", () => {
    if (roll.drag?.mode === "key") liveOff("roll");
    roll.drag = null;
  });

  rollCv.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const tr = cur();
    if (!tr) return;
    const { x, y } = local(e);
    const hit = hitTest(x, y);
    if (hit.n) {
      snapshot();
      tr.notes.splice(tr.notes.indexOf(hit.n), 1);
      save();
    }
  });

  rollCv.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, local(e).x);
    } else {
      roll.scrollX += e.shiftKey ? e.deltaY : e.deltaX;
      if (!e.shiftKey) roll.scrollY += e.deltaY;
      clampScroll();
    }
    rollDirty = true;
  }, { passive: false });

  $("snap").addEventListener("change", (e) => {
    ui.snap = Number(e.target.value);
    ui.len = ui.snap;
  });
  $("zoomIn").addEventListener("click", () => zoom(1.25));
  $("zoomOut").addEventListener("click", () => zoom(1 / 1.25));
  $("clear").addEventListener("click", () => {
    const tr = cur();
    if (!tr || !tr.notes.length) return;
    snapshot();
    tr.notes = [];
    save();
    toast("Cleared — Ctrl+Z to undo");
  });
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);
}

// zoom around the x position (canvas px) so the spot under the cursor stays put
function zoom(f, x = roll.keyW) {
  const before = (x - roll.keyW + roll.scrollX) / stepW();
  roll.zoom = clamp(roll.zoom * f, 0.4, 6);
  roll.scrollX = before * stepW() - (x - roll.keyW);
  clampScroll();
  rollDirty = true;
}

// ---------------------------------------------------------------- scope

const scopeCv = $("scope");
let scopeG = null, scopeData = null;

function drawScope() {
  if (!scopeG || !mixer || scopeCv.clientWidth === 0) return;
  const w = scopeCv.clientWidth, h = scopeCv.clientHeight, a = mixer.analyser;
  scopeData ??= new Uint8Array(a.frequencyBinCount);
  a.getByteFrequencyData(scopeData);
  scopeG.clearRect(0, 0, w, h);
  const bars = 28, bw = w / bars;
  const grad = scopeG.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#ff4fd8");
  grad.addColorStop(1, "#39d5ff");
  scopeG.fillStyle = grad;
  for (let i = 0; i < bars; i++) {
    // log-spaced bins so bass doesn't take up just one bar
    const lo = Math.floor(Math.pow(scopeData.length, i / bars)), hi = Math.max(lo + 1, Math.floor(Math.pow(scopeData.length, (i + 1) / bars)));
    let v = 0;
    for (let j = lo; j < hi; j++) v = Math.max(v, scopeData[j]);
    const bh = Math.max(1, (v / 255) * (h - 6));
    scopeG.fillRect(i * bw + 1, h - 3 - bh, bw - 2, bh);
  }
}

// ---------------------------------------------------------------- main loop

let lastActive = 0;

function frame() {
  requestAnimationFrame(frame);
  if (!song) return;
  const now = actx ? actx.currentTime : 0;
  const pos = tp.playing ? posAt(now) : null;
  const tr = cur();
  tp.vis = tp.vis.filter((v) => v.t1 > now);
  const active = new Set(), activeP = new Set();
  for (const v of tp.vis) {
    if (v.t0 <= now && tr && v.id === tr.id) { active.add(v.n); activeP.add(v.p); }
  }
  for (const h of held.values()) if (h.tr === tr) activeP.add(h.p);

  if (rollDirty || tp.playing || activeP.size || lastActive) {
    drawRoll(pos, active, activeP);
    rollDirty = false;
  }
  if (lanesDirty || tp.playing) {
    drawLanes(pos);
    lanesDirty = false;
  }
  lastActive = activeP.size;
  lightKeys(activeP);
  if (pos !== null) {
    const s = Math.floor(pos);
    $("pos").textContent = `${Math.floor(s / 16) + 1}.${Math.floor(s / 4) % 4 + 1}.${s % 4 + 1}`;
  }
  drawScope();
}

// ---------------------------------------------------------------- wiring

function renderTitle() {
  const t = $("edTitle"), tr = cur();
  t.textContent = tr ? `${tr.name} · ${INSTRUMENTS[tr.type].name}` : "No track";
  t.style.setProperty("--c", tr ? tr.color : "#9a93b8");
}

function renderAll() {
  renderHeader();
  renderLanes();
  renderTitle();
  renderSound();
  renderKeys();
  resizeRoll();
  syncMixer();
}

function select(i) {
  releaseAll();
  sel = i;
  renderLanes();
  renderTitle();
  renderSound();
  renderKeys();
  resizeRoll();
  centerRoll();
}

function bindTabs() {
  const bottom = $("bottom");
  for (const b of bottom.querySelectorAll(".tabs button")) {
    b.addEventListener("click", () => {
      bottom.dataset.tab = b.dataset.tab;
      for (const x of bottom.querySelectorAll(".tabs button")) x.setAttribute("aria-selected", String(x === b));
      renderKeys();
    });
  }
}

function init() {
  let saved = null;
  try { saved = JSON.parse(store.get("webdaw.song", "null")); } catch { /* corrupt save */ }
  song = normalize(saved && Array.isArray(saved.tracks) ? saved : DEMOS[0].make());

  bindHeader();
  bindKeyboard();
  bindRoll();
  bindTabs();
  scopeG = fitCanvas(scopeCv, scopeCv.clientWidth, scopeCv.clientHeight);
  renderAll();
  centerRoll();

  let resizeTimer = 0;
  new ResizeObserver(() => { resizeRoll(); resizeLanes(); }).observe($("rollWrap"));
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderKeys, 80);
  }).observe(keysEl);
  new ResizeObserver(resizeLanes).observe(laneCv);

  // audio may only start after a user gesture
  const unlock = () => audio();
  addEventListener("pointerdown", unlock, { once: true });
  addEventListener("keydown", unlock, { once: true });

  navigator.keyboard?.getLayoutMap?.().then((m) => { keyLabels = m; renderKeys(); }).catch(() => {});
  requestAnimationFrame(frame);
}

init();
