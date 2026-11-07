// Word Guesser: screens, settings, round logic and input.

import { store } from "./store.js";
import { loadCategories, Deck } from "./words.js";
import { Tilt } from "./tilt.js";
import { unlockAudio, play, vibrate, setSoundEnabled } from "./audio.js";
import { Fx } from "./fx.js";

const STRINGS = {
  en: {
    allGames: "All games",
    chooseLang: "Choose your language",
    howTitle: "How to play",
    how1: "One player holds the phone sideways on their forehead, screen facing the others. No peeking!",
    how2: "Everyone else describes the word without saying it (or any part of it).",
    how3: "Guessed it? Tap the screen or nod the phone down. Stuck? Tilt it up or press Skip.",
    how4: "Get as many words as you can before the time runs out, then pass the phone on!",
    cont: "Continue",
    roundLen: "Round length",
    sound: "Sound",
    tiltCtl: "Tilt",
    swap: "Swap tilt",
    cats: "Categories",
    all: "Select all",
    none: "Select none",
    language: "Language",
    start: "Start",
    pickOne: "Pick at least one category.",
    loadErr: "Could not load the words. Open the game through a web server.",
    menu: "Back to menu",
    skip: "Skip word",
    ready: "Put the phone on your forehead!",
    hintTilt: (swap) => swap ? "Tilt up = correct · nod down = skip" : "Nod down = correct · tilt up = skip",
    hintTap: "Tap = correct · Skip button = skip",
    go: "Go!",
    timeUp: "Time's up!",
    guessed: (n) => n === 1 ? "word guessed" : "words guessed",
    skipped: (n) => `${n} skipped`,
    fixHint: "Tap a word to change its result.",
    noWords: "No words this round.",
    next: "Next round",
  },
  de: {
    allGames: "Alle Spiele",
    chooseLang: "Sprache wählen",
    howTitle: "So wird gespielt",
    how1: "Eine Person hält das Handy quer an die Stirn, der Bildschirm zeigt zu den anderen. Nicht schummeln!",
    how2: "Alle anderen beschreiben den Begriff, ohne ihn (oder Teile davon) zu sagen.",
    how3: "Erraten? Auf den Bildschirm tippen oder das Handy nach unten kippen. Keine Ahnung? Nach oben kippen oder „Überspringen“.",
    how4: "Errate so viele Begriffe wie möglich, bevor die Zeit abläuft – dann ist der Nächste dran!",
    cont: "Weiter",
    roundLen: "Rundenlänge",
    sound: "Ton",
    tiltCtl: "Kippen",
    swap: "Kippen tauschen",
    cats: "Kategorien",
    all: "Alle wählen",
    none: "Keine wählen",
    language: "Sprache",
    start: "Start",
    pickOne: "Wähle mindestens eine Kategorie.",
    loadErr: "Die Wörter konnten nicht geladen werden. Öffne das Spiel über einen Webserver.",
    menu: "Zum Menü",
    skip: "Überspringen",
    ready: "Halte das Handy an deine Stirn!",
    hintTilt: (swap) => swap ? "Nach oben kippen = richtig · nach unten = überspringen" : "Nach unten kippen = richtig · nach oben = überspringen",
    hintTap: "Tippen = richtig · Taste = überspringen",
    go: "Los!",
    timeUp: "Zeit um!",
    guessed: (n) => n === 1 ? "Begriff erraten" : "Begriffe erraten",
    skipped: (n) => `${n} übersprungen`,
    fixHint: "Tippe auf einen Begriff, um das Ergebnis zu ändern.",
    noWords: "Keine Begriffe in dieser Runde.",
    next: "Nächste Runde",
  },
};

const TIMES = [[30, "0:30"], [60, "1:00"], [90, "1:30"], [120, "2:00"], [180, "3:00"]];
const CONFETTI = ["#ffcf33", "#ff4fd8", "#2ec4b6", "#21d07a", "#ff9f1c", "#9b5cff", "#ffffff"];
const MIN_ANSWER_GAP = 350; // ms, so one tap can't count twice

const $ = (id) => document.getElementById(id);

const settings = {
  lang: (navigator.language || "en").toLowerCase().startsWith("de") ? "de" : "en",
  cats: null,
  time: 60,
  tilt: true,
  swap: false,
  sound: true,
  ...store.get("settings", {}),
};
if (!STRINGS[settings.lang]) settings.lang = "en";

const saveSettings = () => store.set("settings", settings);

function t(key, ...args) {
  const s = STRINGS[settings.lang][key] ?? STRINGS.en[key];
  return typeof s === "function" ? s(...args) : s;
}

let categories = [];
let activeScreen = "";
const tilt = new Tilt();
const playFx = new Fx($("play-fx"));
const resFx = new Fx($("res-fx"));

let round = newRound(null);

function newRound(deck) {
  return {
    deck,
    phase: "idle", // idle | countdown | playing | over
    results: [],
    current: null,
    elapsed: 0,
    lastFrame: 0,
    lastSec: -1,
    lastAnswer: 0,
    timers: [],
  };
}

// setTimeout that is cancelled when the round is aborted.
function later(fn, ms) {
  round.timers.push(setTimeout(fn, ms));
}

/* ---------- Screens & i18n ---------- */

function show(id) {
  activeScreen = id;
  document.querySelectorAll("[data-screen]").forEach((el) => el.classList.toggle("active", el.id === id));
  if (id === "play") {
    // A focused button would swallow Space/Enter meant for "correct".
    document.activeElement?.blur?.();
    layoutStage();
  }
}

function catById(id) {
  return categories.find((c) => c.id === id);
}

function catName(c) {
  return c ? c.name[settings.lang] || c.name.en : "";
}

function applyLang() {
  document.documentElement.lang = settings.lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nLabel));
    el.title = t(el.dataset.i18nLabel);
  });
  document.querySelectorAll(".lang").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.lang === settings.lang)));
  renderCats();
  updateSetup();
}

/* ---------- Setup screen ---------- */

function renderTimes() {
  $("times").replaceChildren(...TIMES.map(([sec, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(sec === settings.time));
    b.textContent = label;
    b.addEventListener("click", () => {
      settings.time = sec;
      saveSettings();
      play("click");
      $("times").querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    });
    return b;
  }));
}

function renderCats() {
  $("cats").replaceChildren(...categories.map((c, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cat";
    b.style.setProperty("--c", c.color);
    b.style.setProperty("--delay", `${i * 25}ms`);
    b.setAttribute("aria-pressed", String(settings.cats.includes(c.id)));
    b.innerHTML = `<span class="check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
      <svg aria-hidden="true"><use href="img/icons.svg#${c.id}"></use></svg>
      <span class="cat-name"></span>`;
    b.querySelector(".cat-name").textContent = catName(c);
    b.addEventListener("click", () => {
      const on = !settings.cats.includes(c.id);
      settings.cats = on ? [...settings.cats, c.id] : settings.cats.filter((x) => x !== c.id);
      b.setAttribute("aria-pressed", String(on));
      play("click");
      saveSettings();
      updateSetup();
    });
    return b;
  }));
}

function updateSetup() {
  const allOn = categories.length && settings.cats.length === categories.length;
  $("toggle-all").textContent = allOn ? t("none") : t("all");
  $("start").disabled = !settings.cats.length;
  $("setup-msg").textContent = categories.length && !settings.cats.length ? t("pickOne") : "";
  setPressed("opt-sound", settings.sound);
  setPressed("opt-tilt", settings.tilt);
  setPressed("opt-swap", settings.swap);
  $("opt-swap").disabled = !settings.tilt;
  setSoundEnabled(settings.sound);
}

function setPressed(id, on) {
  $(id).setAttribute("aria-pressed", String(on));
}

function bindOption(id, key) {
  $(id).addEventListener("click", () => {
    settings[key] = !settings[key];
    saveSettings();
    updateSetup();
    play("click");
  });
}

/* ---------- Fullscreen, orientation, wake lock ---------- */

// Android: fullscreen + orientation lock. Both are optional and fail silently
// (iPhones have neither); layoutStage() rotates the play layer instead.
function enterFullscreen() {
  if (!matchMedia("(pointer: coarse)").matches) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return;
  try {
    Promise.resolve(req.call(el, { navigationUI: "hide" }))
      .then(() => window.screen.orientation?.lock?.("landscape"))
      .catch(() => {});
  } catch {
    // ignore
  }
}

function exitFullscreen() {
  try {
    window.screen.orientation?.unlock?.();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
  } catch {
    // ignore
  }
}

let wakeLock = null;

async function acquireWakeLock() {
  try {
    wakeLock = (await navigator.wakeLock?.request("screen")) || null;
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// The play layer must read landscape. If the viewport is still portrait
// (rotation lock, iOS), rotate the stage by ±90°, picking the side from the
// sensor so the text isn't upside down.
function layoutStage() {
  const st = $("stage");
  const W = window.innerWidth;
  const H = window.innerHeight;
  const portrait = H > W;
  st.classList.toggle("rotated", portrait);
  if (portrait) {
    Object.assign(st.style, {
      width: `${H}px`,
      height: `${W}px`,
      left: `${(W - H) / 2}px`,
      top: `${(H - W) / 2}px`,
      transform: `rotate(${tilt.side >= 0 ? 90 : -90}deg)`,
    });
  } else {
    Object.assign(st.style, { width: `${W}px`, height: `${H}px`, left: "0px", top: "0px", transform: "" });
  }
  playFx.resize();
  fitWord();
}

/* ---------- Round ---------- */

async function startRound() {
  if (!settings.cats.length || round.phase === "countdown" || round.phase === "playing") return;
  abortRound();
  resFx.clear();
  unlockAudio();
  play("click");
  // Both need the user gesture, so start them before anything is awaited.
  const motion = settings.tilt ? tilt.requestPermission() : Promise.resolve(false);
  enterFullscreen();

  let deck;
  try {
    deck = await Deck.create(settings.lang, settings.cats);
  } catch (err) {
    console.error(err);
    exitFullscreen();
    show("setup");
    $("setup-msg").textContent = t("loadErr");
    return;
  }
  round = newRound(deck);
  $("score").textContent = "0";
  $("word").textContent = "";
  $("word-cat").textContent = "";
  $("timeup").classList.remove("show");
  updateTimer(settings.time);
  show("play");
  acquireWakeLock();
  await motion;
  countdown();
}

function countdown() {
  round.phase = "countdown";
  $("countdown").classList.add("show");
  $("count").textContent = "";
  tilt.beginCalibration();
  let n = 3;
  const step = () => {
    if (round.phase !== "countdown") return;
    const useTilt = settings.tilt && tilt.available;
    $("hint").textContent = useTilt ? t("hintTilt", settings.swap) : t("hintTap");
    const c = $("count");
    c.classList.remove("pop");
    void c.offsetWidth; // restart the CSS animation
    c.classList.add("pop");
    if (n > 0) {
      c.textContent = String(n);
      play("count");
      n--;
      later(step, 1000);
    } else {
      c.textContent = t("go");
      play("go");
      vibrate(80);
      tilt.endCalibration();
      later(beginPlay, 650);
    }
  };
  later(step, 900);
}

function beginPlay() {
  $("countdown").classList.remove("show");
  round.phase = "playing";
  round.lastFrame = performance.now();
  tilt.enable(settings.tilt);
  nextWord();
  requestAnimationFrame(frame);
}

function frame(now) {
  if (round.phase !== "playing") return;
  // Wall-clock timer; the cap only stops a jump after the tab was in the background.
  round.elapsed += Math.min((now - round.lastFrame) / 1000, 0.25);
  round.lastFrame = now;
  const left = Math.max(0, settings.time - round.elapsed);
  updateTimer(left);
  if (left <= 0) {
    timeUp();
    return;
  }
  requestAnimationFrame(frame);
}

function updateTimer(left) {
  const sec = Math.ceil(left);
  $("time-bar").style.transform = `scaleX(${left / settings.time})`;
  if (sec === round.lastSec) return;
  round.lastSec = sec;
  $("time").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const low = sec <= 10 && round.phase === "playing";
  $("timer").classList.toggle("low", low);
  if (low && sec > 0) play("tick");
}

function nextWord() {
  round.current = round.deck.next();
  const cat = catById(round.current.cat);
  $("stage").style.setProperty("--c", cat?.color || "#9b5cff");
  $("word-cat").textContent = catName(cat);
  const w = $("word");
  w.textContent = round.current.word;
  fitWord();
  w.classList.remove("in");
  void w.offsetWidth;
  w.classList.add("in");
}

// Largest font size at which the word fits the box (long words never break
// mid-word; phrases may wrap).
function fitWord() {
  const el = $("word");
  if (!el.textContent) return;
  const box = $("word-box");
  const H = box.clientHeight - $("word-cat").offsetHeight - 8;
  let lo = 12;
  let hi = Math.max(lo, Math.min(H * 0.8, box.clientWidth * 0.3));
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    el.style.fontSize = `${mid}px`;
    if (el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= H) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
}

function answer(ok) {
  if (round.phase !== "playing") return;
  const now = performance.now();
  if (now - round.lastAnswer < MIN_ANSWER_GAP) return;
  round.lastAnswer = now;

  round.results.push({ ...round.current, status: ok ? "ok" : "bad" });
  $("score").textContent = String(round.results.filter((r) => r.status === "ok").length);

  const flash = $("flash");
  flash.className = "flash";
  void flash.offsetWidth;
  flash.className = `flash ${ok ? "good" : "bad"}`;
  flyAway(ok ? "down" : "up");
  const stage = $("stage");
  if (ok) {
    play("correct");
    vibrate(60);
    playFx.burst(0.5, 0.5, CONFETTI, 70);
  } else {
    play("wrong");
    vibrate([40, 60, 40]);
    stage.classList.remove("shake");
    void stage.offsetWidth;
    stage.classList.add("shake");
  }
  nextWord();
}

// A copy of the old word flies off while the new one pops in.
function flyAway(dir) {
  const w = $("word");
  const ghost = w.cloneNode(true);
  ghost.removeAttribute("id");
  ghost.classList.remove("in");
  ghost.classList.add("flyer", dir);
  Object.assign(ghost.style, { left: `${w.offsetLeft}px`, top: `${w.offsetTop}px`, width: `${w.offsetWidth}px` });
  $("word-box").append(ghost);
  setTimeout(() => ghost.remove(), 700);
}

function timeUp() {
  round.phase = "over";
  tilt.enable(false);
  $("timer").classList.remove("low");
  if (round.current) round.results.push({ ...round.current, status: "timeout" });
  play("timeUp");
  vibrate([200, 100, 300]);
  $("timeup").classList.add("show");
  later(showResults, 1700);
}

// Stops whatever is running and restores the normal page state.
function abortRound() {
  round.timers.forEach(clearTimeout);
  round.timers = [];
  if (round.phase !== "idle") round.deck?.save();
  round.phase = "idle";
  tilt.enable(false);
  tilt.samples = null;
  $("countdown").classList.remove("show");
  $("timeup").classList.remove("show");
  playFx.clear();
  exitFullscreen();
  releaseWakeLock();
}

function toMenu() {
  abortRound();
  resFx.clear();
  show("setup");
}

/* ---------- Results ---------- */

function showResults() {
  const results = round.results;
  abortRound();
  round.results = results;
  show("results");
  $("results").querySelector(".body").scrollTop = 0;
  renderResults();
  const ok = results.filter((r) => r.status === "ok").length;
  if (ok > 0) {
    play("fanfare");
    resFx.rain(CONFETTI, Math.min(60 + ok * 15, 200));
  }
}

function renderResults() {
  const list = $("res-list");
  if (!round.results.length) {
    const li = document.createElement("li");
    li.className = "res-empty";
    li.textContent = t("noWords");
    list.replaceChildren(li);
  } else {
    list.replaceChildren(...round.results.map((r, i) => {
      const li = document.createElement("li");
      li.className = r.status;
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.style.setProperty("--delay", `${Math.min(i * 45, 900)}ms`);
      const word = document.createElement("span");
      word.textContent = r.word;
      const tag = document.createElement("span");
      tag.className = "cat-tag";
      tag.textContent = catName(catById(r.cat));
      li.append(word, tag);
      const flip = () => {
        r.status = r.status === "ok" ? "bad" : "ok";
        li.className = r.status;
        li.style.animation = "none"; // don't replay the entrance animation
        play(r.status === "ok" ? "correct" : "wrong");
        updateResultCounts();
      };
      li.addEventListener("click", flip);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          flip();
        }
      });
      return li;
    }));
  }
  updateResultCounts();
}

function updateResultCounts() {
  const ok = round.results.filter((r) => r.status === "ok").length;
  const bad = round.results.filter((r) => r.status === "bad").length;
  $("res-score").textContent = String(ok);
  $("res-label").textContent = t("guessed", ok);
  $("res-sub").textContent = t("skipped", bad);
}

/* ---------- Input ---------- */

function bindUI() {
  document.querySelectorAll(".lang").forEach((b) => b.addEventListener("click", () => {
    settings.lang = b.dataset.lang;
    saveSettings();
    play("click");
    applyLang();
  }));
  $("continue").addEventListener("click", () => {
    play("click");
    show("setup");
  });
  $("to-lang").addEventListener("click", () => {
    play("click");
    show("welcome");
  });
  $("toggle-all").addEventListener("click", () => {
    settings.cats = settings.cats.length === categories.length ? [] : categories.map((c) => c.id);
    saveSettings();
    play("click");
    renderCats();
    updateSetup();
  });
  bindOption("opt-sound", "sound");
  bindOption("opt-tilt", "tilt");
  bindOption("opt-swap", "swap");
  $("start").addEventListener("click", startRound);
  $("res-next").addEventListener("click", startRound);
  $("res-menu").addEventListener("click", () => {
    play("click");
    toMenu();
  });
  $("menu").addEventListener("click", () => {
    play("click");
    toMenu();
  });
  $("skip").addEventListener("click", () => answer(false));

  // Tap anywhere on the stage (except the buttons) = correct.
  $("stage").addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.target.closest("button")) return;
    answer(true);
  });

  tilt.onTilt = (dir) => {
    if (!settings.tilt) return;
    answer((dir === "down") !== settings.swap);
  };
  tilt.onSide = () => {
    if (activeScreen === "play") layoutStage();
  };

  const unlock = () => unlockAudio();
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", (e) => {
    unlock();
    if (activeScreen !== "play") return;
    if (e.key === "Escape") {
      toMenu();
    } else if (round.phase === "playing") {
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowDown") {
        e.preventDefault();
        answer(true);
      } else if (e.key === "ArrowUp" || e.key === "s" || e.key === "S" || e.key === "Backspace") {
        e.preventDefault();
        answer(false);
      }
    }
  });

  window.addEventListener("resize", () => {
    if (activeScreen === "play") layoutStage();
  });
  // iOS reports the new size a moment after the rotation event.
  window.addEventListener("orientationchange", () => setTimeout(() => {
    if (activeScreen === "play") layoutStage();
  }, 250));
  document.addEventListener("visibilitychange", () => {
    // Wake locks are dropped when the page is hidden.
    if (!document.hidden && activeScreen === "play" && round.phase !== "idle") acquireWakeLock();
  });
}

/* ---------- Start-up ---------- */

async function init() {
  renderTimes();
  bindUI();
  settings.cats = Array.isArray(settings.cats) ? settings.cats : [];
  applyLang();
  show("welcome");
  try {
    categories = await loadCategories();
  } catch (err) {
    console.error(err);
    $("setup-msg").textContent = t("loadErr");
    return;
  }
  // First visit: everything selected. Drop ids of categories that no longer exist.
  const saved = store.get("settings", {});
  settings.cats = Array.isArray(saved.cats)
    ? settings.cats.filter((id) => catById(id))
    : categories.map((c) => c.id);
  applyLang();
}

init();
