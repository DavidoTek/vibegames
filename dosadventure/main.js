// DOS Adventure: wires the desk (monitor, case, floppy, printer, sticky note,
// cat) to the emulated PC: screen, CRT shader, audio, file system, the shell
// and whatever program is running. Also input routing, touch controls, saving.

import { Screen } from "./screen.js";
import { CRT } from "./crt.js";
import { Audio } from "./audio.js";
import { FS } from "./fs.js";
import { makeDisk } from "./disk.js";
import { Shell } from "./shell.js";
import { check } from "./progress.js";

const SAVE_KEY = "dosadventure.save.v1";
const SETTINGS_KEY = "dosadventure.settings";
const $ = (id) => document.getElementById(id);

const store = {
  get(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode etc. */ }
  },
  del(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

function newState() {
  return {
    v: 1, drives: makeDisk(), floppyIn: false, boot: null, path: "C:\\DOS;C:\\UTILS",
    quest: null, secrets: {}, hints: {}, printouts: [], won: false, bootCount: 0,
    stats: { played: 0, commands: 0, hints: 0, questMoves: 0 },
  };
}

function loadState() {
  try {
    const s = JSON.parse(store.get(SAVE_KEY, "null"));
    if (s && s.v === 1 && s.drives && s.drives.C && s.drives.A) return { ...newState(), ...s, stats: { ...newState().stats, ...s.stats } };
  } catch { /* corrupt save: start over */ }
  return newState();
}

const settings = { crt: "full", sound: true, music: true, clicks: true, touch: "auto", zoom: false };
try { Object.assign(settings, JSON.parse(store.get(SETTINGS_KEY, "{}"))); } catch { /* defaults */ }
const saveSettings = () => store.set(SETTINGS_KEY, JSON.stringify(settings));

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = matchMedia("(pointer: coarse)").matches;

let state = loadState();
let fs = new FS(state.drives);
const screen = new Screen();
const crt = new CRT($("crt"), screen.canvas);
const audio = new Audio();
audio.setMuted(!settings.sound);
audio.clicks = settings.clicks;
crt.roll = reduceMotion ? 0 : 1;
document.body.classList.toggle("crt-2d", !crt.webgl);

let on = false;
let shell = null;
let active = null;
let runResolve = null;
const held = new Set();
let stickVec = null;

// ---------------------------------------------------------------- sys

const sys = {
  screen, audio,
  get fs() { return fs; },
  get state() { return state; },
  get active() { return active; },
  run(prog) {
    active = prog;
    held.clear();
    if (prog.start) prog.start();
    refreshControls();
    return new Promise((resolve) => { runResolve = resolve; });
  },
  exit(result) {
    if (active && active.stop) active.stop();
    sys.unlockPointer();
    active = shell;
    held.clear();
    refreshControls();
    const r = runResolve;
    runResolve = null;
    if (r) r(result);
  },
  save: debounce(() => saveNow(), 400),
  refresh: () => refreshNote(),
  refreshControls: () => refreshControls(),
  print: (title, text) => print(title, text),
  floppyIn: () => state.floppyIn,
  diskAccess,
  reboot: () => { sys.unlockPointer(); bootShell(); },
  shutdown: () => { state.shutdown = true; saveNow(); },
  secret(id) {
    if (state.secrets[id]) return;
    state.secrets[id] = true;
    toast(`Secret found! (${Object.keys(state.secrets).length}/3)`);
    saveNow();
  },
  catWalk,
  held: (k) => held.has(k),
  stick: () => stickVec,
  lockPointer() { try { $("crt").requestPointerLock(); } catch { /* not supported */ } },
  unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); },
};

function debounce(fn, ms) {
  let id = 0;
  return () => { clearTimeout(id); id = setTimeout(fn, ms); };
}

function saveNow() { store.set(SAVE_KEY, JSON.stringify(state)); }

// ---------------------------------------------------------------- power

function bootShell() {
  if (active && active.stop) active.stop();
  runResolve = null;
  fs = new FS(state.drives);
  shell = new Shell(sys);
  active = shell;
  held.clear();
  refreshControls();
  shell.start();
}

function powerOn() {
  audio.unlock();
  on = true;
  document.body.classList.add("on");
  $("led-power").classList.add("on");
  $("led-pc").classList.add("on");
  audio.thunk();
  crt.power = 0.001;
  screen.clear();
  setTimeout(() => { if (on) bootShell(); }, 500);
}

function powerOff() {
  on = false;
  saveNow();
  sys.unlockPointer();
  if (active && active.stop) active.stop();
  active = null;
  shell = null;
  runResolve = null;
  crt.power = -1;
  screen.setMode("text");
  screen.clear();
  document.body.classList.remove("on");
  $("led-power").classList.remove("on");
  $("led-pc").classList.remove("on");
  audio.noise(0.15, { freq: 200, q: 0.7, vol: 0.12 });
  refreshControls();
}

function resetProgress() {
  if (on) powerOff();
  store.del(SAVE_KEY);
  state = newState();
  fs = new FS(state.drives);
  renderPrintouts();
  refreshNote();
  refreshFloppy();
  $("cat").hidden = true;
}

$("btn-power").addEventListener("click", () => {
  if (on) return powerOff();
  if (state.won) {
    return ask("Play again?", "<p class='hint-text'>You already beat DOS Adventure. Start over with a fresh disk, or boot Mort's PC as it is now?</p>", [
      { label: "Boot as is", action: () => powerOn() },
      { label: "Play again", primary: true, action: () => { resetProgress(); powerOn(); } },
    ]);
  }
  powerOn();
});

$("btn-reset").addEventListener("click", () => {
  if (!on) return;
  audio.noise(0.05, { freq: 1500, q: 2, vol: 0.12 });
  sys.reboot();
});

// ---------------------------------------------------------------- desk

function diskAccess(drive) {
  if (drive === "A") {
    blink("led-fdd", 900);
    if (!diskAccess.a || performance.now() - diskAccess.a > 1200) { audio.floppy(); diskAccess.a = performance.now(); }
  } else {
    blink("led-hdd", 160);
    if (!diskAccess.c || performance.now() - diskAccess.c > 250) { audio.hdd(); diskAccess.c = performance.now(); }
  }
}

function blink(id, ms) {
  const el = $(id);
  el.classList.add("on");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("on"), ms);
}

let toastT = 0;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove("show"), 2400);
}

// sticky note mirrors the PANES checklist
function refreshNote() {
  const res = check(fs, state.boot);
  const list = $("note-list");
  list.replaceChildren(...res.map((c) => {
    const li = document.createElement("li");
    li.textContent = c.label;
    li.classList.toggle("ok", c.ok);
    return li;
  }));
  if (state.won) list.parentElement.querySelector("i").textContent = "✓ All done! - Mort";
  else list.parentElement.querySelector("i").textContent = "- Mort";
}

function showNote() {
  const res = check(fs, state.boot);
  const items = res.map((c) => `<li class="${c.ok ? "ok" : ""}">${c.n}. ${c.label} <small>(${c.name})</small></li>`).join("");
  ask("Mort's sticky note", `<div class="note note-big"><b>PANES needs:</b><ol>${items}</ol><i>${state.won ? "✓ All done! - Mort" : "- Mort"}</i></div>
    <p class="hint-text">The ticks appear once a part is in place. Type <b>PANES</b> in DOS for details, or <b>HINT</b> if you're stuck.</p>`);
}
$("note").addEventListener("click", showNote);
$("note").addEventListener("keydown", (e) => { if (e.key === "Enter") showNote(); });
$("btn-note").addEventListener("click", showNote);

// floppy disk: click or drag it into the drive
function refreshFloppy() {
  $("floppy").classList.toggle("in", state.floppyIn);
  $("slot").classList.toggle("full", state.floppyIn);
  $("floppy-label").textContent = state.floppyIn ? "Eject" : "Insert";
}

function insertFloppy() {
  if (state.floppyIn) return;
  audio.unlock();
  state.floppyIn = true;
  audio.floppyInsert();
  refreshFloppy();
  toast("Floppy BACKUP 2/2 inserted into drive A:");
  saveNow();
}

function ejectFloppy() {
  if (!state.floppyIn) return;
  audio.unlock();
  state.floppyIn = false;
  audio.noise(0.08, { freq: 900, q: 2, vol: 0.12 });
  refreshFloppy();
  toast("Floppy ejected");
  saveNow();
}

$("btn-eject").addEventListener("click", ejectFloppy);
$("btn-floppy").addEventListener("click", () => (state.floppyIn ? ejectFloppy() : insertFloppy()));

(() => {
  const el = $("floppy");
  let drag = null;
  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, moved: false };
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
    if (!drag.moved) return;
    el.classList.add("dragging");
    const rig = $("rig").getBoundingClientRect();
    el.style.left = `${e.clientX - rig.left - drag.ox}px`;
    el.style.top = `${e.clientY - rig.top - drag.oy}px`;
    el.style.bottom = "auto";
    $("slot").classList.toggle("drop", overSlot(e));
  });
  const overSlot = (e) => {
    const s = $("slot").getBoundingClientRect();
    return e.clientX > s.left - 40 && e.clientX < s.right + 40 && e.clientY > s.top - 50 && e.clientY < s.bottom + 50;
  };
  const end = (e) => {
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    el.classList.remove("dragging");
    $("slot").classList.remove("drop");
    el.style.left = el.style.top = el.style.bottom = "";
    if (!wasDrag || overSlot(e)) insertFloppy();
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", () => { drag = null; el.classList.remove("dragging"); el.style.left = el.style.top = el.style.bottom = ""; });
})();

// printer: printouts slide out and pile up on the desk
function print(title, text) {
  audio.printer(1.3);
  const out = $("paper-out");
  out.classList.remove("printing");
  void out.offsetWidth;
  out.classList.add("printing");
  setTimeout(() => {
    out.classList.remove("printing");
    state.printouts.push({ id: Date.now(), title, text: text.slice(0, 8000) });
    while (state.printouts.length > 6) state.printouts.shift();
    renderPrintouts();
    saveNow();
    if (document.body.classList.contains("compact")) toast("Printed. Tap the printer button to read it.");
  }, reduceMotion ? 50 : 1400);
}

function renderPrintouts() {
  const tray = $("tray");
  tray.replaceChildren(...state.printouts.map((p, i) => {
    const el = document.createElement("div");
    el.className = "printout";
    const r = ((p.id % 7) - 3) * 1.5;
    el.style.setProperty("--r", `${r}deg`);
    el.style.transform = `rotate(${r}deg)`;
    el.style.top = `${i * 14}px`;
    el.style.left = `${(i % 3) * 18}px`;
    const b = document.createElement("b");
    b.textContent = p.title;
    el.append(b, document.createTextNode(p.text.split("\n").slice(0, 16).join("\n")));
    el.addEventListener("click", () => showPrintout(p));
    return el;
  }));
  const badge = $("prints-badge");
  badge.hidden = !state.printouts.length;
  badge.textContent = state.printouts.length;
}

function showPrintout(p) {
  const pre = document.createElement("pre");
  pre.textContent = p.text;
  ask(p.title, pre, [
    { label: "Crumple", danger: true, action: () => { state.printouts = state.printouts.filter((x) => x !== p); renderPrintouts(); saveNow(); } },
    { label: "Close", primary: true },
  ]);
}

$("btn-prints").addEventListener("click", () => {
  if (!state.printouts.length) return ask("Printouts", "<p class='hint-text'>Nothing printed yet. In DOS, type <b>PRINT</b> and a file name, e.g. <b>PRINT README.TXT</b>.</p>");
  const list = document.createElement("div");
  list.className = "prints-list";
  for (const p of [...state.printouts].reverse()) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = p.title;
    b.addEventListener("click", () => { closeModal(); showPrintout(p); });
    list.append(b);
  }
  ask("Printouts", list);
});

// Byte the cat (easter egg): walks across the desk and naps on the monitor
function catWalk() {
  const cat = $("cat");
  cat.hidden = false;
  if (reduceMotion) return;
  cat.classList.remove("walk");
  void cat.offsetWidth;
  cat.classList.add("walk");
}
$("cat").addEventListener("click", () => {
  const cat = $("cat");
  audio.unlock();
  audio.purr();
  cat.classList.remove("love");
  void cat.offsetWidth;
  cat.classList.add("love");
});

// ---------------------------------------------------------------- modal

function ask(title, body, buttons = [{ label: "Close", primary: true }]) {
  $("modal-title").textContent = title;
  const b = $("modal-body");
  if (typeof body === "string") b.innerHTML = body;
  else b.replaceChildren(body);
  $("modal-buttons").replaceChildren(...buttons.map((btn) => {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = btn.label;
    if (btn.primary) el.className = "primary";
    if (btn.danger) el.className = "danger";
    el.addEventListener("click", () => { closeModal(); if (btn.action) btn.action(); });
    return el;
  }));
  $("modal").hidden = false;
  const first = $("modal-buttons").querySelector(".primary") || $("modal-buttons").lastChild;
  if (first) first.focus();
}
function closeModal() { $("modal").hidden = true; }
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });

function seg(name, options, value, onPick) {
  const fsEl = document.createElement("fieldset");
  const lg = document.createElement("legend");
  lg.textContent = name;
  const row = document.createElement("div");
  row.className = "seg";
  for (const [v, label] of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.setAttribute("aria-pressed", String(v === value));
    b.addEventListener("click", () => {
      row.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      onPick(v);
      saveSettings();
    });
    row.append(b);
  }
  fsEl.append(lg, row);
  return fsEl;
}

$("btn-settings").addEventListener("click", () => {
  const body = document.createElement("div");
  body.append(
    seg("CRT effect", [["full", "Full"], ["light", "Light"], ["off", "Off"]], settings.crt, (v) => { settings.crt = v; applySettings(); }),
    seg("Sound", [[true, "On"], [false, "Off"]], settings.sound, (v) => { settings.sound = v; applySettings(); }),
    seg("Music", [[true, "On"], [false, "Off"]], settings.music, (v) => { settings.music = v; applySettings(); }),
    seg("Key clicks", [[true, "On"], [false, "Off"]], settings.clicks, (v) => { settings.clicks = v; applySettings(); }),
    seg("Touch controls", [["auto", "Auto"], ["on", "On"], ["off", "Off"]], settings.touch, (v) => { settings.touch = v; applySettings(); }),
    seg("Text zoom (follows the cursor)", [[false, "Off"], [true, "2×"]], settings.zoom, (v) => { settings.zoom = v; applySettings(); }),
  );
  const p = document.createElement("p");
  p.className = "hint-text";
  p.textContent = "Progress is saved in this browser. Resetting gives you a fresh copy of Mort's disk.";
  body.append(p);
  ask("Settings", body, [
    { label: "Reset progress", danger: true, action: () => ask("Reset progress?", "<p class='hint-text'>This wipes Mort's disk, your solved puzzles and secrets.</p>", [
      { label: "Cancel" },
      { label: "Reset", danger: true, action: () => { resetProgress(); toast("Progress reset."); } },
    ]) },
    { label: "Reboot PC", action: () => { if (on) sys.reboot(); } },
    { label: "Close", primary: true },
  ]);
});

function touchMode() { return settings.touch === "on" || (settings.touch === "auto" && coarse); }

function applySettings() {
  crt.strength = { full: 1, light: 0.5, off: 0 }[settings.crt] ?? 1;
  document.body.classList.toggle("crt-2d", !crt.webgl && settings.crt !== "off");
  audio.setMuted(!settings.sound);
  audio.clicks = settings.clicks;
  if (audio.music.enabled !== settings.music) audio.music.setEnabled(settings.music);
  document.body.classList.toggle("touch", touchMode());
  layout();
  refreshControls();
}

function layout() {
  const compact = innerWidth < 1100 || coarse;
  document.body.classList.toggle("compact", compact);
  requestAnimationFrame(() => crt.resize());
}

// ---------------------------------------------------------------- input

function norm(e) {
  return { key: e.key.length === 1 ? e.key : e.key, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey };
}

function heldName(k) { return k.length === 1 ? k.toLowerCase() : k; }

function send(type, ev) {
  if (!on || !active || !active.key) return;
  if (type === "down") held.add(heldName(ev.key));
  else held.delete(heldName(ev.key));
  active.key({ type, ...ev });
}

const PASS = new Set(["F5", "F11", "F12"]);
window.addEventListener("keydown", (e) => {
  if (!$("modal").hidden) { if (e.key === "Escape") closeModal(); return; }
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "Unidentified" || e.keyCode === 229 || e.isComposing) return;
  // leave reload, dev tools, tab and window shortcuts to the browser
  if (PASS.has(e.key) || ((e.ctrlKey || e.metaKey) && (e.shiftKey || /^[rlwtnq]$/i.test(e.key)))) return;
  if (!on) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("btn-power").click(); }
    return;
  }
  if (e.key === "Meta") return;
  e.preventDefault();
  if (!e.repeat && audio.clicks && e.key.length === 1) audio.key();
  else if (!e.repeat && audio.clicks && (e.key === "Enter" || e.key === "Backspace")) audio.key();
  send("down", norm(e));
});
window.addEventListener("keyup", (e) => {
  if (!on) return;
  send("up", norm(e));
});
window.addEventListener("blur", () => held.clear());

// hidden textarea: mobile soft keyboards deliver text through input events
const kbd = $("kbd");
const resetKbd = () => { kbd.value = "  "; kbd.setSelectionRange(2, 2); };
resetKbd();
kbd.addEventListener("input", (e) => {
  if (e.inputType === "deleteContentBackward") tap("Backspace");
  else if (e.inputType === "insertLineBreak") tap("Enter");
  else if (e.data) for (const ch of e.data) tap(ch);
  else {
    const v = kbd.value;
    if (v.length < 2) tap("Backspace");
    else for (const ch of v.slice(2)) tap(ch === "\n" ? "Enter" : ch);
  }
  resetKbd();
});

function tap(key, mods = {}) {
  if (audio.clicks) audio.key();
  send("down", { key, ctrl: false, alt: false, shift: false, ...mods });
  send("up", { key, ctrl: false, alt: false, shift: false, ...mods });
}

// CRT pointer events, mapped through the screen curvature
(() => {
  const cv = $("crt");
  let down = null;
  const ev = (e, type) => {
    const m = crt.map(e.clientX, e.clientY);
    return { type, x: m.x, y: m.y, inside: m.inside, pointerType: e.pointerType, locked: !!document.pointerLockElement, dx: e.movementX || 0, dy: e.movementY || 0 };
  };
  const toActive = (x) => { if (on && active && active.pointer) active.pointer(x); };
  cv.addEventListener("pointerdown", (e) => {
    if (!on) return;
    audio.unlock();
    cv.setPointerCapture(e.pointerId);
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (!document.pointerLockElement) toActive(ev(e, "down"));
  });
  cv.addEventListener("pointermove", (e) => { if (!document.pointerLockElement) toActive(ev(e, "move")); });
  cv.addEventListener("pointerup", (e) => {
    if (document.pointerLockElement) return;
    toActive(ev(e, "up"));
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12 && performance.now() - down.t < 600) toActive(ev(e, "click"));
    down = null;
  });
  cv.addEventListener("pointercancel", () => { down = null; });
  document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === cv) toActive({ type: "move", locked: true, dx: e.movementX, dy: e.movementY });
  });
  document.addEventListener("mousedown", (e) => {
    if (document.pointerLockElement === cv) toActive({ type: "click", locked: true, pointerType: "mouse", button: e.button });
  });
})();

// ---------------------------------------------------------------- touch controls

const KEYS = {
  up: ["↑", "ArrowUp"], down: ["↓", "ArrowDown"], left: ["←", "ArrowLeft"], right: ["→", "ArrowRight"],
  enter: ["⏎", "Enter"], esc: ["Esc", "Escape"], tab: ["Tab", "Tab"], space: ["Space", " "],
};

function keyBtn(label, key, cls = "", mods = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `key ${cls}`;
  b.textContent = label;
  const downH = (e) => {
    e.preventDefault();
    b.classList.add("on");
    audio.unlock();
    if (audio.clicks) audio.key();
    send("down", { key, ctrl: !!mods.ctrl, alt: false, shift: false });
  };
  const upH = () => {
    if (!b.classList.contains("on")) return;
    b.classList.remove("on");
    send("up", { key, ctrl: !!mods.ctrl, alt: false, shift: false });
  };
  b.addEventListener("pointerdown", downH);
  b.addEventListener("pointerup", upH);
  b.addEventListener("pointercancel", upH);
  b.addEventListener("pointerleave", upH);
  return b;
}

function actionBtn(label, fn, cls = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `key ${cls}`;
  b.textContent = label;
  b.addEventListener("pointerdown", (e) => { e.preventDefault(); audio.unlock(); fn(); });
  return b;
}

function chip(text) {
  return actionBtn(text.trim(), () => {
    if (!on || !active) return;
    for (const ch of text) tap(ch);
  }, "small");
}

const kbdBtn = () => actionBtn("ABC", () => { resetKbd(); kbd.focus(); });
const zoomBtn = () => actionBtn("🔍", () => { settings.zoom = !settings.zoom; saveSettings(); toast(settings.zoom ? "Text zoom on" : "Text zoom off"); });

function dpad() {
  const g = document.createElement("div");
  g.className = "dpad";
  const cells = [null, "up", null, "left", null, "right", null, "down", null];
  for (const c of cells) {
    if (!c) { g.append(document.createElement("span")); continue; }
    g.append(keyBtn(KEYS[c][0], KEYS[c][1]));
  }
  return g;
}

function stick() {
  const el = document.createElement("div");
  el.className = "stick";
  const knob = document.createElement("span");
  el.append(knob);
  let id = null;
  const move = (e) => {
    const r = el.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    stickVec = { x: Math.abs(x) < 0.15 ? 0 : x, y: Math.abs(y) < 0.15 ? 0 : y };
    knob.style.transform = `translate(${x * 38}px, ${y * 38}px)`;
  };
  el.addEventListener("pointerdown", (e) => { id = e.pointerId; el.setPointerCapture(id); move(e); });
  el.addEventListener("pointermove", (e) => { if (e.pointerId === id) move(e); });
  const end = () => { id = null; stickVec = null; knob.style.transform = ""; };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  return el;
}

function refreshControls() {
  const box = $("controls");
  const showTouch = touchMode() && on && active;
  document.body.classList.toggle("touch", touchMode());
  if (!showTouch) { box.hidden = true; box.replaceChildren(); return; }
  const spec = (active.controls && active.controls()) || { set: "none" };
  const chips = document.createElement("div");
  chips.className = "chips";
  const left = document.createElement("div");
  left.className = "pad left";
  const right = document.createElement("div");
  right.className = "pad right";
  const k = (name, cls) => keyBtn(KEYS[name][0], KEYS[name][1], cls);
  let tall = false;
  switch (spec.set) {
    case "shell":
      for (const c of ["DIR", "DIR /A", "CD ..", "CD ", "TYPE ", "PRINT ", "CLS", "HELP", "HINT", "PANES"]) chips.append(chip(c));
      left.append(kbdBtn(), k("tab"), k("esc"), keyBtn("^Z", "z", "", { ctrl: true }), zoomBtn());
      right.append(k("up"), k("down"), k("enter", "wide"));
      break;
    case "text":
      for (const c of spec.chips || []) chips.append(chip(c));
      left.append(kbdBtn(), k("esc"), zoomBtn());
      right.append(k("up"), k("down"), k("enter", "wide"));
      break;
    case "edit":
      left.append(kbdBtn(), k("esc"), keyBtn("^S", "s", "", { ctrl: true }), keyBtn("Menu", "F10"), zoomBtn());
      right.append(k("left"), k("up"), k("down"), k("right"), k("enter", "wide"));
      break;
    case "dpad":
      tall = true;
      left.append(dpad());
      right.append(k("esc"), keyBtn("OK", "Enter", "wide"));
      break;
    case "brixx":
      left.append(keyBtn("◄", "ArrowLeft", "wide"), keyBtn("►", "ArrowRight", "wide"));
      right.append(k("esc"), keyBtn("Launch", " ", "wide"));
      break;
    case "labyrint":
      tall = true;
      left.append(stick());
      right.append(k("esc"), keyBtn("Map", "m"), keyBtn("Zap", "f", "wide"), keyBtn("Use", " ", "wide"));
      break;
    case "panes":
      right.append(k("esc"), k("enter", "wide"));
      break;
    default:
      break;
  }
  const pads = document.createElement("div");
  pads.className = "pads";
  pads.append(left, right);
  box.replaceChildren(...(chips.children.length ? [chips] : []), pads);
  box.hidden = false;
  document.body.classList.toggle("tall-ctrl", tall);
  requestAnimationFrame(() => crt.resize());
}

// ---------------------------------------------------------------- loop

let last = performance.now();
let t = 0;

function updateZoom(dt) {
  const v = crt.view;
  let tz = 1, tx = 0, ty = 0;
  if (settings.zoom && screen.mode === "text") {
    tz = 0.5;
    const cx = (screen.cursor.x * 8 + 4) / 640, cy = (screen.cursor.y * 16 + 8) / 400;
    tx = Math.max(0, Math.min(0.5, cx - 0.25));
    ty = Math.max(0, Math.min(0.5, cy - 0.25));
  }
  const k = reduceMotion ? 1 : Math.min(1, dt * 8);
  v.z += (tz - v.z) * k; v.x += (tx - v.x) * k; v.y += (ty - v.y) * k;
}

function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  t += dt;
  if (on) {
    if (crt.power < 1) crt.power = Math.min(1, crt.power + dt / 0.7);
    state.stats.played += dt * 1000;
    if (active) {
      if (active.update) active.update(dt);
      if (active.realtime && active.draw) active.draw();
    }
  }
  // the running program picks the soundtrack (and can change it per phase)
  audio.music.play(on && !document.hidden && active ? active.music : null);
  updateZoom(dt);
  const changed = screen.render(t);
  crt.draw(t, changed);
  requestAnimationFrame(frame);
}

window.addEventListener("resize", () => { layout(); });
new ResizeObserver(() => crt.resize()).observe($("crt"));
document.addEventListener("visibilitychange", () => { if (document.hidden) { saveNow(); held.clear(); audio.music.play(null); } });
window.addEventListener("pagehide", saveNow);

applySettings();
refreshNote();
refreshFloppy();
renderPrintouts();
if (state.secrets.cat) $("cat").hidden = false;
requestAnimationFrame(frame);
