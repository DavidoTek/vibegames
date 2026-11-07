// Rusekin UI: screens, the pass-the-phone flow, timers and privacy handling.
// Every screen is a function returning HTML; buttons carry data-act="name"
// and are handled by one delegated click listener (see ACT).

import { MODES, MODE_IDS, DEFAULT_CONFIG, createRound, cardFor, tally, decide, scoreRound, isHiddenTeam } from "./engine.js";
import { CATEGORIES } from "./content.js";
import { t, tx, setLang, modeText } from "./i18n.js";
import { store } from "./store.js";
import { play, unlockAudio, setSoundEnabled, vibrate, setVibrate } from "./audio.js";
import { confetti, sparkle, smoke, centerOf, setFxEnabled } from "./fx.js";

const app = document.getElementById("app");

// ---------- persistent (non-secret) state ----------

const settings = {
  lang: (navigator.language || "en").toLowerCase().startsWith("de") ? "de" : "en",
  sound: true,
  vibrate: true,
  motion: true,
  contrast: false,
  bigText: false,
  ...store.get("settings", {}),
};

const AVATARS = ["🦊", "🐼", "🐸", "🦉", "🐙", "🦁", "🐯", "🐨", "🐵", "🦄", "🐲", "🐧", "🐰", "🐻", "🐝", "🦋", "🐢", "🦜", "🐺", "🦔"];
const COLORS = ["#ff7a59", "#5ac8ff", "#7ee081", "#ffcf5a", "#c58bff", "#ff6fb1", "#4fe0c8", "#ffa94d", "#8f9bff", "#e6e36a", "#ff8a8a", "#6fd3ff"];

let uid = Date.now() % 100000;
const newId = () => `p${uid++}`;

let players = store.get("players", null);
if (!Array.isArray(players) || !players.length) {
  players = [0, 1, 2, 3].map((i) => ({ id: newId(), name: "", av: i, col: i }));
}

let modeId = store.get("mode", "blank");
if (!MODES[modeId]) modeId = "blank";
const configs = {};
const cfgFor = (id) => (configs[id] ??= { ...DEFAULT_CONFIG, ...store.get(`cfg:${id}`, {}) });

// ---------- in-memory state ----------

let screen = "home";
let game = null; // the running game (secrets live here only)
let lastKey = "";

// ---------- helpers ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mt = () => modeText(modeId);
const displayName = (p, i) => p.name.trim() || t("playerN", { n: i + 1 });

function gp(id) {
  return game.players.find((p) => p.id === id);
}
const nm = (id) => esc(gp(id).name);

function avatar(p, cls = "") {
  return `<span class="av ${cls}" style="--c:${COLORS[p.col % COLORS.length]}" aria-hidden="true">${AVATARS[p.av % AVATARS.length]}</span>`;
}

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16"/>',
  soundOn: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  soundOff: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" class="ico" aria-hidden="true">${ICONS[name]}</svg>`;

// Hand-drawn mode emblems (48×48, stroke = currentColor).
const MODE_ICONS = {
  blank: '<rect x="11" y="5" width="26" height="38" rx="5" stroke-dasharray="4 4"/><path d="M19 19a5 5 0 1 1 7 4.6c-1.4.7-2 1.6-2 3v1.4"/><circle cx="24" cy="34" r="1.3" fill="currentColor"/>',
  near: '<circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="10"/><circle cx="24" cy="24" r="3" fill="currentColor"/><path d="M40 8L29 19"/><path d="M40 8h-6M40 8v6"/><circle cx="29.5" cy="18.5" r="1.8" fill="currentColor"/>',
  ally: '<circle cx="16" cy="17" r="6"/><path d="M5 40c0-7 5-12 11-12s11 5 11 12"/><circle cx="33" cy="19" r="5"/><path d="M27 31c1.8-2 3.8-3 6-3 5 0 9 4.5 9 11"/><path d="M24 9c2-3 5-4 8-3"/>',
  switch: '<path d="M10 20a14 14 0 0 1 25-7"/><path d="M36 6v8h-8"/><path d="M38 28a14 14 0 0 1-25 7"/><path d="M12 42v-8h8"/>',
  quests: '<path d="M12 8h22a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H14"/><path d="M12 8a4 4 0 0 0-4 4v4h8v-4a4 4 0 0 0-4-4z"/><path d="M14 42a4 4 0 0 1-4-4V16"/><path d="M25 17l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z"/>',
  odd: '<circle cx="13" cy="14" r="6"/><circle cx="35" cy="14" r="6"/><circle cx="13" cy="35" r="6"/><path d="M35 28l7 12H28z" fill="currentColor" fill-opacity=".25"/>',
};
const modeIcon = (id, cls = "") => `<svg viewBox="0 0 48 48" class="mode-ico ${cls}" aria-hidden="true">${MODE_ICONS[id]}</svg>`;

const LOGO = `<svg class="logo-mask" viewBox="0 0 120 56" aria-hidden="true">
  <defs><linearGradient id="lg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset=".55" stop-color="#ffb648"/><stop offset="1" stop-color="#ff6f91"/></linearGradient></defs>
  <path fill="url(#lg)" fill-rule="evenodd" d="M6 14C26 2 48 6 60 16 72 6 94 2 114 14c2 22-10 36-28 36-12 0-20-7-26-14-6 7-14 14-26 14C16 50 4 36 6 14zM24 24c4-5 14-6 22 0-6 7-16 8-22 0zm72 0c-4-5-14-6-22 0 6 7 16 8 22 0z"/>
  <path d="M60 16v18" stroke="#120b26" stroke-width="2" opacity=".35"/>
</svg>`;

function topbar({ back = null, home = false, title = "", right = "" } = {}) {
  const left = home
    ? `<a class="icon-btn" href="../" aria-label="${t("allGames")}">${icon("back")}</a>`
    : back
      ? `<button class="icon-btn" type="button" data-act="nav" data-to="${back}" aria-label="${t("back")}">${icon("back")}</button>`
      : `<span class="icon-sp"></span>`;
  return `<header class="top">${left}<div class="top-title">${title}</div>${right || '<span class="icon-sp"></span>'}</header>`;
}

function soundBtn() {
  return `<button class="icon-btn" type="button" data-act="toggleSound" aria-label="${t("sound")}" aria-pressed="${settings.sound}">${icon(settings.sound ? "soundOn" : "soundOff")}</button>`;
}

function gameBar() {
  const m = modeText(game.mode);
  const r = game.cfg.rounds ? t("roundOf", { n: game.roundNo, m: game.cfg.rounds }) : t("round", { n: game.roundNo });
  return `<header class="top">
    <button class="icon-btn" type="button" data-act="quit" aria-label="${t("quit")}">${icon("close")}</button>
    <div class="top-title"><span class="chip-mode" style="--mc:${MODES[game.mode].color}">${modeIcon(game.mode)}${m.name}</span><small>${r}</small></div>
    ${soundBtn()}
  </header>`;
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function ring(total, cls = "") {
  const C = 2 * Math.PI * 54;
  return `<div class="ring ${cls}" data-timer style="--C:${C}">
    <svg viewBox="0 0 120 120"><circle class="ring-bg" cx="60" cy="60" r="54"/><circle class="ring-fg" cx="60" cy="60" r="54" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg>
    <span class="ring-txt">${fmtTime(total)}</span>
  </div>`;
}

function saveSettings() {
  store.set("settings", settings);
}
function savePlayers() {
  store.set("players", players);
}

function applySettings() {
  setLang(settings.lang);
  setSoundEnabled(settings.sound);
  setVibrate(settings.vibrate);
  const reduce = !settings.motion || matchMedia("(prefers-reduced-motion: reduce)").matches;
  setFxEnabled(!reduce);
  document.body.classList.toggle("calm", !settings.motion);
  document.body.classList.toggle("hc", settings.contrast);
  document.body.classList.toggle("big", settings.bigText);
}

// ---------- timers ----------

// One countdown at a time (clue turn or discussion). It is updated in place
// so re-rendering doesn't restart animations every second.
let timer = null;
let lastTick = performance.now();

function startTimer(total, key) {
  timer = { total, left: total, running: true, done: false, key };
}
function stopTimer() {
  timer = null;
}

function updateTimerUI() {
  const el = app.querySelector("[data-timer]");
  if (!el || !timer) return;
  const C = parseFloat(el.style.getPropertyValue("--C"));
  el.querySelector(".ring-fg").style.strokeDashoffset = String(C * (1 - timer.left / timer.total));
  el.querySelector(".ring-txt").textContent = timer.done ? "0:00" : fmtTime(Math.ceil(timer.left));
  el.classList.toggle("low", timer.left <= 10 && !timer.done);
  el.classList.toggle("done", timer.done);
  el.classList.toggle("paused", !timer.running && !timer.done);
  const pb = app.querySelector("[data-pause]");
  if (pb) pb.textContent = timer.running ? t("pause") : t("resume");
}

setInterval(() => {
  const now = performance.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  if (!timer || !timer.running || timer.done) return;
  const before = Math.ceil(timer.left);
  timer.left = Math.max(0, timer.left - dt);
  const after = Math.ceil(timer.left);
  if (after !== before && after <= 5 && after > 0) play("tick");
  if (timer.left <= 0) {
    timer.done = true;
    timer.running = false;
    play("alarm");
    vibrate([200, 100, 200]);
    const el = app.querySelector("[data-timer]");
    if (el) {
      const [x, y] = centerOf(el);
      sparkle(x, y, "#ff5c7a", 20);
    }
  }
  updateTimerUI();
}, 200);

// ---------- rendering ----------

function render() {
  const key = viewKey();
  const view = screen === "game" ? gameView() : VIEWS[screen]();
  const animate = key !== lastKey;
  lastKey = key;
  app.innerHTML = `<div class="screen ${animate ? "enter" : "still"} ${view.cls || ""}" style="--mc:${MODES[screen === "game" ? game.mode : modeId].color}">${view.html}</div>`;
  if (animate) app.querySelector(".body")?.scrollTo(0, 0);
  view.after?.();
  updateTimerUI();
  armButtons();
}

function viewKey() {
  if (screen !== "game") return screen;
  const s = game.sub;
  return [game.roundNo, game.stepIdx, s.idx ?? "", s.phase ?? "", s.speaker ?? ""].join(":");
}

// Buttons marked data-arm stay disabled for a moment, so a tap meant for the
// previous screen can't reveal the next player's secret.
function armButtons() {
  app.querySelectorAll("[data-arm]").forEach((b) => {
    b.disabled = true;
    setTimeout(() => {
      if (b.isConnected) b.disabled = false;
    }, Number(b.dataset.arm) || 700);
  });
}

function go(to) {
  screen = to;
  trap();
  render();
}

// ---------- setup screens ----------

const VIEWS = {
  home() {
    return {
      cls: "home",
      html: `${topbar({ home: true })}
      <main class="body center">
        <div class="hero">
          ${LOGO}
          <h1 class="wordmark">RUSEKIN</h1>
          <p class="tagline">${t("tagline")}</p>
        </div>
        <div class="hero-cards" aria-hidden="true">
          ${MODE_IDS.map((id, i) => `<span class="mini-card" style="--mc:${MODES[id].color};--i:${i};--y:${Math.abs(i - 2.5) * 6}px">${modeIcon(id)}</span>`).join("")}
        </div>
        <p class="intro">${t("intro")}</p>
      </main>
      <footer class="bottom col">
        <button class="btn primary big" type="button" data-act="nav" data-to="modes">${t("start")}</button>
        <div class="row">
          <button class="btn ghost" type="button" data-act="nav" data-to="howto">${icon("book")} ${t("howTo")}</button>
          <button class="btn ghost" type="button" data-act="nav" data-to="settings">${icon("gear")} ${t("settings")}</button>
        </div>
      </footer>`,
    };
  },

  howto() {
    const steps = t("howSteps");
    return {
      html: `${topbar({ back: "home", title: t("howTo") })}
      <main class="body">
        <ol class="steps">
          ${steps.map(([e, h, p], i) => `<li style="--i:${i}"><span class="step-ico">${e}</span><div><h3>${h}</h3><p>${p}</p></div></li>`).join("")}
        </ol>
        <h2 class="h2">${t("modesTitle")}</h2>
        <div class="mode-list">
          ${MODE_IDS.map((id) => `<button class="mode-row" type="button" data-act="openMode" data-id="${id}" style="--mc:${MODES[id].color}">${modeIcon(id)}<span><b>${modeText(id).name}</b><small>${modeText(id).blurb}</small></span></button>`).join("")}
        </div>
        <h2 class="h2">${t("pointsHowTitle")}</h2>
        <p class="panel">${t("pointsHow")}</p>
        <h2 class="h2">${t("howTipsTitle")}</h2>
        <ul class="tips">${t("howTips").map((s) => `<li>${s}</li>`).join("")}</ul>
      </main>
      <footer class="bottom"><button class="btn primary" type="button" data-act="nav" data-to="modes">${t("start")}</button></footer>`,
    };
  },

  settings() {
    const tog = (key, label) => `<label class="toggle"><span>${label}</span><input type="checkbox" data-setting="${key}" ${settings[key] ? "checked" : ""}><i></i></label>`;
    return {
      html: `${topbar({ back: "home", title: t("settings") })}
      <main class="body">
        <div class="opt">
          <h3>${t("language")}</h3>
          <div class="seg">
            ${[["en", "English"], ["de", "Deutsch"]].map(([l, n]) => `<button type="button" data-act="setLang" data-lang="${l}" aria-pressed="${settings.lang === l}">${n}</button>`).join("")}
          </div>
        </div>
        <div class="opt">
          ${tog("sound", t("sound"))}
          ${tog("vibrate", t("vibration"))}
          ${tog("motion", t("animations"))}
          ${tog("contrast", t("contrast"))}
          ${tog("bigText", t("bigText"))}
        </div>
        <p class="note">${t("settingsNote")}</p>
        <p class="note">${t("installHint")}</p>
      </main>`,
    };
  },

  modes() {
    return {
      html: `${topbar({ back: "home", title: t("modesTitle") })}
      <main class="body">
        <p class="sub">${t("modesSub")}</p>
        <div class="mode-grid">
          ${MODE_IDS.map((id, i) => {
            const m = MODES[id];
            const x = modeText(id);
            return `<button class="mode-card" type="button" data-act="openMode" data-id="${id}" style="--mc:${m.color};--i:${i}">
              <span class="mc-ico">${modeIcon(id)}</span>
              <b>${x.name}</b>
              <small>${x.blurb}</small>
              <span class="mc-meta"><span>👥 ${m.min}–${m.max}</span><span>⏱ ${m.minutes}′</span><span class="lvl" aria-label="${t("level")} ${m.level}">${"●".repeat(m.level)}${"○".repeat(3 - m.level)}</span></span>
            </button>`;
          }).join("")}
        </div>
      </main>`,
    };
  },

  mode() {
    const m = MODES[modeId];
    const x = mt();
    const lv = t("levels").split("|")[m.level - 1];
    return {
      html: `${topbar({ back: "modes", title: "" })}
      <main class="body">
        <div class="mode-hero">
          <span class="mh-ico">${modeIcon(modeId)}</span>
          <h1>${x.name}</h1>
          <p class="lead">${x.desc}</p>
          <div class="facts">
            <span>👥 ${t("playersN", { min: m.min, max: m.max })}</span>
            <span>⏱ ${t("minutesN", { m: m.minutes })}</span>
            <span>🎯 ${t("level")}: ${lv}</span>
          </div>
        </div>
        <h2 class="h2">${t("howItWorks")}</h2>
        <ol class="numbered">${x.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
        <h2 class="h2">${t("roles")}</h2>
        <div class="roles">${x.roles.map(([n, d]) => `<div class="role"><b>${n}</b><span>${d}</span></div>`).join("")}</div>
        <h2 class="h2">${t("winning")}</h2>
        <ul class="wins">${x.win.map((s) => `<li>${s}</li>`).join("")}</ul>
        <details class="example">
          <summary>${t("example")}</summary>
          <p>${x.example}</p>
        </details>
      </main>
      <footer class="bottom"><button class="btn primary" type="button" data-act="nav" data-to="players">${t("playThis", { name: x.name })} →</button></footer>`,
    };
  },

  players() {
    const m = MODES[modeId];
    const err = playersError();
    return {
      html: `${topbar({ back: "mode", title: t("playersTitle") })}
      <main class="body">
        <p class="sub">${t("playersSub")}</p>
        <ol class="plist">
          ${players.map((p, i) => `<li class="prow" data-i="${i}">
            <button class="av-btn" type="button" data-act="cycleAv" data-i="${i}" aria-label="Avatar">${avatar(p)}</button>
            <input class="pname" type="text" maxlength="16" autocomplete="off" enterkeyhint="next" placeholder="${t("playerN", { n: i + 1 })}" value="${esc(p.name)}" data-name="${i}" aria-label="${t("namePh")} ${i + 1}">
            <button class="icon-btn sm" type="button" data-act="moveP" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="${t("moveUp")}">${icon("up")}</button>
            <button class="icon-btn sm" type="button" data-act="moveP" data-i="${i}" data-d="1" ${i === players.length - 1 ? "disabled" : ""} aria-label="${t("moveDown")}">${icon("down")}</button>
            <button class="icon-btn sm danger" type="button" data-act="removeP" data-i="${i}" aria-label="${t("remove")}">${icon("trash")}</button>
          </li>`).join("")}
        </ol>
        <button class="btn ghost wide" type="button" data-act="addP" ${players.length >= 12 ? "disabled" : ""}>${icon("plus")} ${t("addPlayer")}</button>
        <p class="count">👥 ${players.length} · ${t("playersN", { min: m.min, max: m.max })}</p>
      </main>
      <footer class="bottom col">
        <p class="err" data-err ${err ? "" : "hidden"}>${err || ""}</p>
        <button class="btn primary" type="button" data-act="toConfig" ${err ? "disabled" : ""}>${t("next")} →</button>
      </footer>`,
    };
  },

  config() {
    const cfg = cfgFor(modeId);
    const seg = (key, values, label) => `<div class="seg">${values.map((v) => `<button type="button" data-act="setOpt" data-key="${key}" data-val="${v}" aria-pressed="${cfg[key] === v}">${label(v)}</button>`).join("")}</div>`;
    const tog = (key, hint) => `<label class="toggle"><span>${t(`opt_${key}`)}${hint ? `<small>${t(hint)}</small>` : ""}</span><input type="checkbox" data-opt="${key}" ${cfg[key] ? "checked" : ""}><i></i></label>`;
    const parts = {
      categories: () => `<div class="opt"><h3>${t("opt_categories")}</h3><small class="hint">${t("opt_categoriesHint")}</small>
        <div class="chips">
          <button type="button" class="chip" data-act="catAll" aria-pressed="${!cfg.categories.length}">✨ ${t("allCats")}</button>
          ${CATEGORIES.map((c) => `<button type="button" class="chip" data-act="cat" data-id="${c.id}" aria-pressed="${cfg.categories.includes(c.id)}">${c.icon} ${tx(c.name)}</button>`).join("")}
        </div></div>`,
      difficulty: () => `<div class="opt"><h3>${t("opt_difficulty")}</h3>${seg("difficulty", ["easy", "mixed", "hard"], (v) => t(`diff_${v}`))}</div>`,
      clueRounds: () => `<div class="opt"><h3>${t("opt_clueRounds")}</h3>${seg("clueRounds", [1, 2], (v) => v)}</div>`,
      rounds: () => `<div class="opt"><h3>${t("opt_rounds")}</h3>${seg("rounds", [1, 3, 5, 0], (v) => (v ? v : t("endless")))}</div>`,
      clueTimer: () => `<div class="opt"><h3>${t("opt_clueTimer")}</h3>${seg("clueTimer", [0, 15, 30, 45], (v) => (v ? t("sec", { n: v }) : t("off")))}</div>`,
      discussTimer: () => `<div class="opt"><h3>${t("opt_discussTimer")}</h3>${seg("discussTimer", [0, 60, 120, 180, 300], (v) => (v ? t("min", { n: v / 60 }) : t("off")))}</div>`,
      showCategory: () => `<div class="opt">${tog("showCategory", "opt_showCategoryHint")}</div>`,
      doubleKnows: () => `<div class="opt">${tog("doubleKnows", "opt_doubleKnowsHint")}</div>`,
      finalGuess: () => `<div class="opt">${tog("finalGuess", "opt_finalGuessHint")}</div>`,
    };
    return {
      html: `${topbar({ back: "players", title: t("configTitle") })}
      <main class="body">
        <p class="sub">${t("configSub", { name: mt().name })}</p>
        ${MODES[modeId].options.map((k) => parts[k]()).join("")}
        <div class="opt"><label class="toggle"><span>${t("sound")}</span><input type="checkbox" data-setting="sound" ${settings.sound ? "checked" : ""}><i></i></label></div>
      </main>
      <footer class="bottom"><button class="btn primary" type="button" data-act="nav" data-to="overview">${t("next")} →</button></footer>`,
    };
  },

  overview() {
    const cfg = cfgFor(modeId);
    const x = mt();
    const rows = [];
    const on = (b) => (b ? t("on") : t("off"));
    for (const k of MODES[modeId].options) {
      let v;
      if (k === "categories") v = cfg.categories.length ? CATEGORIES.filter((c) => cfg.categories.includes(c.id)).map((c) => c.icon).join(" ") : t("allCats");
      else if (k === "difficulty") v = t(`diff_${cfg.difficulty}`);
      else if (k === "rounds") v = cfg.rounds || t("endless");
      else if (k === "clueTimer") v = cfg.clueTimer ? t("sec", { n: cfg.clueTimer }) : t("off");
      else if (k === "discussTimer") v = cfg.discussTimer ? t("min", { n: cfg.discussTimer / 60 }) : t("off");
      else if (k === "clueRounds") v = cfg.clueRounds;
      else v = on(cfg[k]);
      rows.push(`<div><dt>${t(`opt_${k}`)}</dt><dd>${v}</dd></div>`);
    }
    return {
      html: `${topbar({ back: "config", title: t("overviewTitle") })}
      <main class="body">
        <div class="ov-mode">${modeIcon(modeId)}<div><h2>${x.name}</h2><p>${x.blurb}</p></div></div>
        <div class="ov-players">${players.map((p, i) => `<span class="pchip" style="--i:${i}">${avatar(p)}${esc(displayName(p, i))}</span>`).join("")}</div>
        <h2 class="h2">${t("summary")}</h2>
        <dl class="summary">${rows.join("")}</dl>
        <p class="panel tie">⚖️ ${t("tieRule")}</p>
        <p class="note">🔒 ${t("reloadNote")}</p>
      </main>
      <footer class="bottom"><button class="btn primary big" type="button" data-act="startGame">${t("startRound", { n: 1 })}</button></footer>`,
    };
  },
};

function playersError() {
  const m = MODES[modeId];
  const name = mt().name;
  if (players.length < m.min) return t("needPlayers", { name, min: m.min });
  if (players.length > m.max) return t("tooMany", { name, max: m.max });
  const names = players.map((p, i) => displayName(p, i).toLowerCase());
  if (new Set(names).size !== names.length) return t("dupNames");
  return "";
}

// ---------- game ----------

function startGame() {
  game = {
    mode: modeId,
    cfg: { ...cfgFor(modeId) },
    players: players.map((p, i) => ({ ...p, name: displayName(p, i) })),
    used: new Set(),
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    roundNo: 0,
  };
  newRound();
  screen = "game";
  trap();
  render();
}

function newRound() {
  stopTimer();
  game.roundNo++;
  game.round = createRound(game.mode, game.players, game.cfg, game.used);
  game.stepIdx = 0;
  game.votes = {};
  game.outcome = null;
  enterStep();
}

function step() {
  const [kind, n] = game.round.steps[game.stepIdx].split(":");
  return { kind, n: Number(n) || 0 };
}

function enterStep() {
  const { kind, n } = step();
  stopTimer();
  if (kind === "deal") game.sub = { act: n, idx: 0, phase: "handoff" };
  else if (kind === "clue") {
    game.sub = { act: n, speaker: 0 };
    if (game.cfg.clueTimer) startTimer(game.cfg.clueTimer, "clue");
  } else if (kind === "switch") game.sub = {};
  else if (kind === "discuss") {
    game.sub = {};
    if (game.cfg.discussTimer) startTimer(game.cfg.discussTimer, "discuss");
  } else if (kind === "vote") game.sub = { phase: "intro", idx: 0, candidates: game.round.ids.slice(), revote: false, votes: {} };
  else if (kind === "outcome") game.sub = { phase: "tally" };
}

function nextStep() {
  game.stepIdx++;
  enterStep();
  render();
}

function gameView() {
  const { kind } = step();
  return GAME_VIEWS[kind]();
}

const roleName = (role) => t(`role_${role}`);

// The front of a secret card.
function cardFront(card, act) {
  const r = game.round;
  const label = { holder: "role_holder", blank: "role_blank", double: "role_double", ally: "role_ally", word: "role_word" }[card.show];
  let body = "";
  if (card.show === "blank") {
    body = `<div class="blank-q" aria-hidden="true">?</div>
      <p class="card-info">${t("blankInfo")}</p>
      ${card.category ? `<p class="cat"><small>${t("blankCat")}</small><b>${tx(card.category)}</b></p>` : ""}`;
  } else {
    const info = card.show === "ally" ? "" : card.show === "double" ? t("doubleInfo") : card.show === "word" ? t(game.mode === "odd" ? "oddInfo" : "wordInfo") : t("holderInfo");
    body = `<small class="card-k">${t("yourWord")}</small>
      <div class="word">${esc(tx(card.word))}</div>
      ${info ? `<p class="card-info">${info}</p>` : ""}`;
    if (card.show === "ally") {
      const b = gp(card.blank);
      body += `<p class="card-info">${t("allyInfo")}</p><p class="ally-name">${avatar(b, "sm")}<b>${esc(b.name)}</b></p><p class="card-info">${t("allyGoal")}</p>`;
    }
  }
  const mission = card.mission ? `<div class="mission"><small>🎯 ${t("mission")}</small><p>${esc(tx(card.mission))}</p><small>${t("missionHint")}</small></div>` : "";
  const note = game.mode === "switch" && act === 1 ? `<p class="act-note">⚡ ${t("act2Note")}</p>` : "";
  return `<div class="role-badge role-${card.show}">${t(label)}</div>${note}${body}${mission}`;
}

function cardBack() {
  return `<div class="cb-pattern"></div><div class="cb-emblem">${LOGO}<span>RUSEKIN</span></div>`;
}

function handoff({ name, p, progress, btnLabel, btnAct, title }) {
  return `<main class="body center handoff">
      <p class="kicker">${title}</p>
      ${progress}
      <div class="ho-av">${avatar(p, "xl")}</div>
      <p class="ho-label">${t("handTo")}</p>
      <h1 class="ho-name">${esc(name)}</h1>
      <p class="sub">🙈 ${t("handHint", { name: esc(name) })}</p>
    </main>
    <footer class="bottom"><button class="btn primary big" type="button" data-act="${btnAct}" data-arm="700">${btnLabel}</button></footer>`;
}

function dots(n, done, cur) {
  return `<div class="dots" aria-label="${done}/${n}">${Array.from({ length: n }, (_, i) => `<i class="${i < done ? "done" : i === cur ? "cur" : ""}"></i>`).join("")}</div>`;
}

const GAME_VIEWS = {
  deal() {
    const s = game.sub;
    const ids = game.round.ids;
    const title = game.mode === "switch" ? `${t("dealTitle")} · ${t("actN", { n: s.act + 1 })}` : t("dealTitle");
    if (s.phase === "done") {
      return {
        html: `${gameBar()}
        <main class="body center">
          <div class="big-emoji pop">🤫</div>
          <h1 class="title">${t("dealDone")}</h1>
          <p class="sub">${t("dealDoneSub")}</p>
          <div class="table-phone" aria-hidden="true"><span></span></div>
        </main>
        <footer class="bottom"><button class="btn primary big" type="button" data-act="nextStep" data-arm="500">${t("toClues")}</button></footer>`,
      };
    }
    const id = ids[s.idx];
    const p = gp(id);
    if (s.phase === "handoff") {
      return { html: gameBar() + handoff({ name: p.name, p, title, progress: dots(ids.length, s.idx, s.idx), btnLabel: t("revealBtn", { name: esc(p.name) }), btnAct: "reveal" }) };
    }
    // reveal
    const card = cardFor(game.round, s.act, id);
    return {
      cls: "reveal-screen",
      html: `${gameBar()}
      <main class="body center">
        <div class="card3d" data-card>
          <div class="face back">${cardBack()}</div>
          <div class="face front">${cardFront(card, s.act)}</div>
        </div>
      </main>
      <footer class="bottom"><button class="btn primary big" type="button" data-act="hide" data-arm="900">${t("hideBtn")}</button></footer>`,
      after() {
        const el = app.querySelector("[data-card]");
        requestAnimationFrame(() => requestAnimationFrame(() => el?.classList.add("flipped")));
        play("flip");
        setTimeout(() => play("reveal"), 250);
        vibrate(30);
        if (el) {
          const [x, y] = centerOf(el);
          smoke(x, y, card.show === "blank" ? "rgba(255,92,122,.3)" : "rgba(160,130,255,.3)");
        }
      },
    };
  },

  clue() {
    const s = game.sub;
    const r = game.round;
    const order = r.order;
    const showLens = r.lens && s.act === 1;
    const done = s.speaker >= order.length;
    const roundN = game.round.steps.filter((x) => x.startsWith("clue")).indexOf(`clue:${s.act}`) + 1;
    return {
      html: `${gameBar()}
      <main class="body">
        <h1 class="title">${t("clueTitle", { n: roundN })}</h1>
        <p class="sub">${t(game.mode === "odd" ? "clueHintOdd" : "clueHint")}</p>
        ${showLens ? `<div class="lens"><span class="lens-ico" aria-hidden="true">🔍</span><div><small>${t("lensTitle")} · ${t("lensHint")}</small><b>${tx(r.lens)}</b></div></div>` : ""}
        <ol class="speakers">
          ${order.map((id, i) => `<li class="${i < s.speaker ? "done" : i === s.speaker ? "cur" : ""}">
            <span class="sp-n">${i < s.speaker ? icon("check") : i + 1}</span>${avatar(gp(id), "sm")}<b>${nm(id)}</b>
            ${i === s.speaker && game.cfg.clueTimer ? ring(game.cfg.clueTimer, "mini") : i === s.speaker ? `<span class="speaking">🗣️ ${t("speaking")}</span>` : ""}
          </li>`).join("")}
        </ol>
        ${done ? `<p class="done-note">✅ ${t("cluesDone")}</p>` : ""}
      </main>
      <footer class="bottom">
        ${done
          ? `<button class="btn primary big" type="button" data-act="nextStep">${step().kind === "clue" && r.steps[game.stepIdx + 1] === "discuss" ? t("toDiscussion") : t("toNext")} →</button>`
          : `<button class="btn primary big" type="button" data-act="nextSpeaker" data-arm="300">${s.speaker === order.length - 1 ? t("toNext") : t("nextSpeaker")} →</button>`}
      </footer>`,
    };
  },

  switch() {
    return {
      cls: "switch-screen",
      html: `${gameBar()}
      <main class="body center">
        <div class="switch-fx" aria-hidden="true">${modeIcon("switch")}</div>
        <h1 class="glitch" data-text="${t("switchTitle")}">${t("switchTitle")}</h1>
        <p class="lead">${t("switchSub")}</p>
        <p class="sub">${t("switchBody")}</p>
      </main>
      <footer class="bottom"><button class="btn primary big" type="button" data-act="nextStep" data-arm="1200">${t("dealAgain")}</button></footer>`,
      after() {
        play("warp");
        vibrate([60, 60, 120]);
        document.body.classList.add("shake");
        setTimeout(() => document.body.classList.remove("shake"), 700);
        const [x, y] = centerOf(app.querySelector(".switch-fx"));
        setTimeout(() => sparkle(x, y, MODES.switch.color, 40), 500);
      },
    };
  },

  discuss() {
    const cfg = game.cfg;
    return {
      html: `${gameBar()}
      <main class="body center">
        <h1 class="title">${t("discussTitle")}</h1>
        ${cfg.discussTimer ? ring(cfg.discussTimer, "big") : '<div class="big-emoji">🕵️</div>'}
        ${cfg.discussTimer ? `<button class="btn ghost small" type="button" data-act="pauseTimer" data-pause>${t("pause")}</button>` : ""}
        <p class="lead">${t(game.mode === "odd" ? "discussHintOdd" : "discussHint")}</p>
        <div class="ov-players">${game.round.order.map((id) => `<span class="pchip">${avatar(gp(id))}${nm(id)}</span>`).join("")}</div>
      </main>
      <footer class="bottom"><button class="btn primary big" type="button" data-act="nextStep">🗳️ ${t("toVote")}</button></footer>`,
    };
  },

  vote() {
    const s = game.sub;
    const ids = game.round.ids;
    const target = t(`target_${game.round.roles[game.round.hidden]}`);
    if (s.phase === "intro") {
      return {
        html: `${gameBar()}
        <main class="body center">
          <div class="ballot-box" aria-hidden="true"><span></span></div>
          <h1 class="title">${t("voteIntroTitle")}</h1>
          ${s.revote ? `<p class="panel warn">⚖️ ${t("voteIntroTie", { names: s.candidates.map(nm).join(", ") })}</p>` : ""}
          <p class="lead">${t("voteIntro")}</p>
          <p class="panel tie">⚖️ ${t("tieRule")}</p>
        </main>
        <footer class="bottom"><button class="btn primary big" type="button" data-act="voteBegin">${t("next")} →</button></footer>`,
      };
    }
    if (s.phase === "done") {
      return {
        html: `${gameBar()}
        <main class="body center">
          <div class="ballot-box full" aria-hidden="true"><span></span></div>
          <h1 class="title">${t("votesIn")}</h1>
          <p class="sub">${t("dealDoneSub")}</p>
        </main>
        <footer class="bottom"><button class="btn primary big" type="button" data-act="voteFinish" data-arm="600">${t("revealVotes")}</button></footer>`,
      };
    }
    const id = ids[s.idx];
    const p = gp(id);
    if (s.phase === "handoff") {
      return { html: gameBar() + handoff({ name: p.name, p, title: t("voteIntroTitle"), progress: dots(ids.length, s.idx, s.idx), btnLabel: t("voteBtn", { name: esc(p.name) }), btnAct: "votePick" }) };
    }
    if (s.phase === "sealed") {
      return {
        html: `${gameBar()}
        <main class="body center">
          <div class="envelope" aria-hidden="true"><div class="env-flap"></div><div class="env-seal">${LOGO}</div></div>
          <h1 class="title">${t("voteSealed")}</h1>
        </main>`,
        after() {
          play("stamp");
          vibrate(50);
        },
      };
    }
    // pick
    const options = s.candidates.filter((c) => c !== id);
    return {
      html: `${gameBar()}
      <main class="body">
        <p class="kicker">${esc(p.name)}</p>
        <h1 class="title">${t("voteFor", { target })}</h1>
        <div class="vote-grid">
          ${options.map((c, i) => `<button class="vote-opt ${s.choice === c ? "sel" : ""}" type="button" data-act="choose" data-id="${c}" style="--i:${i}" aria-pressed="${s.choice === c}">${avatar(gp(c), "lg")}<b>${nm(c)}</b></button>`).join("")}
        </div>
      </main>
      <footer class="bottom"><button class="btn primary big" type="button" data-act="lockVote" ${s.choice ? "" : "disabled"}>${s.choice ? `🔒 ${t("lockVote")}` : t("pickSomeone")}</button></footer>`,
    };
  },

  outcome() {
    return OUTCOME[game.sub.phase]();
  },
};

// Results flow: tally → accused → (guess → answer) → results → final.
const OUTCOME = {
  tally() {
    const s = game.sub;
    const v = game.vote;
    const sorted = v.candidates.slice().sort((a, b) => v.res.counts[b] - v.res.counts[a]);
    const max = Math.max(1, v.res.max);
    let verdict;
    if (v.res.top.length > 1) {
      verdict = v.revote
        ? `<div class="verdict"><h2>⚖️ ${t("tieAgain")}</h2><p>${t("tieEscape")}</p></div>`
        : `<div class="verdict"><h2>⚖️ ${t("voteIntroTie", { names: v.res.top.map(nm).join(", ") })}</h2></div>`;
    } else {
      verdict = `<div class="verdict"><p>${t("accusedIs")}</p><h2 class="accused">${avatar(gp(v.res.top[0]), "lg")} ${nm(v.res.top[0])}</h2></div>`;
    }
    const btn = v.res.top.length > 1 && !v.revote
      ? `<button class="btn primary big" type="button" data-act="revote">${t("toVote")}</button>`
      : v.res.top.length > 1
        ? `<button class="btn primary big" type="button" data-act="toResults">${t("seeResults")}</button>`
        : `<button class="btn primary big" type="button" data-act="toAccused">${t("toNext")} →</button>`;
    return {
      html: `${gameBar()}
      <main class="body">
        <h1 class="title">${t("tally")}</h1>
        <div class="bars">
          ${sorted.map((c, i) => {
            const n = v.res.counts[c];
            return `<div class="bar ${v.res.top.includes(c) ? "most" : ""}" style="--i:${i}"><span class="bar-who">${avatar(gp(c), "sm")}${nm(c)}</span><span class="bar-track"><span class="bar-fill" data-w="${(n / max) * 100}"></span></span><span class="bar-n">${n}</span></div>`;
          }).join("")}
        </div>
        <div class="verdict-wrap" data-verdict hidden>${verdict}</div>
      </main>
      <footer class="bottom" data-after hidden>${btn}</footer>`,
      after() {
        if (s.shown) return showVerdict(true);
        play("drumroll");
        requestAnimationFrame(() => requestAnimationFrame(() => {
          app.querySelectorAll(".bar-fill").forEach((b) => { b.style.width = `${b.dataset.w}%`; });
        }));
        setTimeout(() => showVerdict(false), settings.motion ? 1900 : 300);
      },
    };
  },

  accused() {
    const r = game.round;
    const acc = game.outcome.accused;
    const role = acc === r.hidden && r.mode === "switch" ? "blank2" : r.roles[acc];
    const caught = acc === r.hidden;
    const lastAct = r.acts.length - 1;
    const card = cardFor(r, lastAct, acc);
    const next = caught && game.cfg.finalGuess
      ? `<button class="btn primary big" type="button" data-act="toGuess">${t("guessTitle")} →</button>`
      : `<button class="btn primary big" type="button" data-act="toResults">${t("seeResults")}</button>`;
    return {
      html: `${gameBar()}
      <main class="body center">
        <div class="card3d small" data-card>
          <div class="face back">${cardBack()}</div>
          <div class="face front">
            <div class="ac-av">${avatar(gp(acc), "lg")}</div>
            <h2>${nm(acc)}</h2>
            <div class="role-badge role-${caught ? "blank" : "holder"}">${roleName(role)}</div>
            ${card.word ? `<div class="word sm">${esc(tx(card.word))}</div>` : ""}
          </div>
        </div>
        <h1 class="title ${caught ? "good" : "bad"}" data-after hidden>${caught ? t("wasHidden", { name: nm(acc), role: roleName(role) }) : t("wasNot", { name: nm(acc), role: roleName(role) })}</h1>
      </main>
      <footer class="bottom" data-after hidden>${next}</footer>`,
      after() {
        const el = app.querySelector("[data-card]");
        setTimeout(() => {
          el.classList.add("flipped");
          play("flip");
        }, 400);
        setTimeout(() => {
          app.querySelectorAll("[data-after]").forEach((e) => { e.hidden = false; });
          const [x, y] = centerOf(el);
          if (caught) {
            sparkle(x, y, "#2ed3a0", 40);
            play("stamp");
          } else {
            smoke(x, y, "rgba(255,92,122,.4)", 18);
            play("sting");
          }
          vibrate(caught ? [40, 40, 40] : 200);
        }, settings.motion ? 1200 : 450);
      },
    };
  },

  guess() {
    const acc = game.outcome.accused;
    const what = game.mode === "odd" ? t("guessWhatGroup") : t("guessWhatWord");
    return {
      html: `${gameBar()}
      <main class="body center">
        <div class="ho-av">${avatar(gp(acc), "xl")}</div>
        <h1 class="title">${t("guessTitle")}</h1>
        <p class="lead">${t("guessBody", { name: nm(acc), what })}</p>
        <div class="big-emoji pulse">🗣️</div>
      </main>
      <footer class="bottom"><button class="btn primary big" type="button" data-act="showAnswer" data-arm="800">${t("showAnswer")}</button></footer>`,
    };
  },

  answer() {
    const acc = game.outcome.accused;
    return {
      html: `${gameBar()}
      <main class="body center">
        <p class="kicker">${t("answerWas")}</p>
        <div class="answer pop">${esc(tx(game.round.answer))}</div>
        <h2 class="h2c">${t("wasRight", { name: nm(acc) })}</h2>
      </main>
      <footer class="bottom">
        <button class="btn bad-btn" type="button" data-act="judge" data-ok="0">✗ ${t("no")}</button>
        <button class="btn good-btn" type="button" data-act="judge" data-ok="1">✓ ${t("yes")}</button>
      </footer>`,
      after() {
        play("reveal");
      },
    };
  },

  results() {
    const r = game.round;
    const o = game.outcome;
    const pts = roundPoints();
    const hiddenWins = o.result.winner === "hidden";
    let headline;
    if (hiddenWins) headline = r.ally ? t("win_hiddenTeam", { name: nm(r.hidden), ally: nm(r.ally) }) : t("win_hidden", { name: nm(r.hidden) });
    else headline = t("win_holders", { team: t(r.mode === "odd" ? "team_members" : "team_holders") });

    const facts = [];
    const a0 = r.acts[0];
    if (r.mode === "near") {
      facts.push([t("mainWord"), tx(a0.word)], [t("altWord"), tx(a0.alt)]);
    } else if (r.mode === "odd") {
      facts.push([t("groupWas"), tx(a0.group)], [t("outlierWord"), tx(a0.odd)]);
    } else if (r.mode === "switch") {
      facts.push([`${t("actN", { n: 1 })} · ${roleName("blank1")}: ${nm(r.firstHidden)}`, tx(a0.word)], [`${t("actN", { n: 2 })} · ${roleName("blank2")}: ${nm(r.hidden)}`, tx(r.acts[1].word)]);
    } else {
      facts.push([t("role_word"), tx(a0.word)]);
    }
    const votesGot = (id) => Object.values(game.votes).filter((x) => x === id).length;
    const roleOf = (id) => {
      if (r.mode === "switch") return id === r.hidden ? "blank2" : id === r.firstHidden ? "blank1" : "holder";
      return r.roles[id];
    };
    const wordOf = (id) => {
      const c = cardFor(r, r.acts.length - 1, id);
      return c.word ? tx(c.word) : "—";
    };
    const final = game.cfg.rounds && game.roundNo >= game.cfg.rounds;
    const totals = game.round.ids.map((id) => [id, game.scores[id] + pts[id]]).sort((a, b) => b[1] - a[1]);

    return {
      cls: hiddenWins ? "win-hidden" : "win-holders",
      html: `${gameBar()}
      <main class="body">
        <div class="banner">
          <div class="banner-ico">${hiddenWins ? "🎭" : "🏆"}</div>
          <h1>${headline}</h1>
          <p>${t(`how_${o.result.how}`)}</p>
        </div>
        <div class="facts-grid">${facts.map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join("")}</div>
        <h2 class="h2">${t("reveal")}</h2>
        <ul class="reveal-list">
          ${r.ids.map((id, i) => {
            const role = roleOf(id);
            const team = isHiddenTeam(r, id) ? "hidden" : "holder";
            return `<li class="rv team-${team}" style="--i:${i}">
              ${avatar(gp(id), "sm")}
              <span class="rv-main"><b>${nm(id)}</b><small><span class="rb rb-${role}">${roleName(role)}</span> ${esc(wordOf(id))}</small></span>
              <span class="rv-votes" title="${t("tally")}">🗳️ ${votesGot(id)}</span>
              <span class="rv-pts">${pts[id] ? `+${pts[id]}` : "±0"}</span>
            </li>`;
          }).join("")}
        </ul>
        ${r.missions ? `<h2 class="h2">${t("missionsTitle")}</h2><p class="sub">${t("missionsHint")}</p>
          <ul class="missions">${r.ids.map((id) => `<li><button type="button" class="mis ${o.missionsDone.has(id) ? "on" : ""}" data-act="mission" data-id="${id}" aria-pressed="${o.missionsDone.has(id)}">
            <span class="mis-check">${icon("check")}</span>${avatar(gp(id), "sm")}<span><b>${nm(id)}</b><small>${esc(tx(r.missions[id]))}</small></span></button></li>`).join("")}</ul>` : ""}
        <h2 class="h2">${t("pointsTitle")}</h2>
        <ol class="scores">${totals.map(([id, s], i) => `<li><span class="rank">${i + 1}</span>${avatar(gp(id), "sm")}<b>${nm(id)}</b><span class="score">${t("pts", { n: s })}</span></li>`).join("")}</ol>
      </main>
      <footer class="bottom col">
        <button class="btn primary big" type="button" data-act="${final ? "toFinal" : "nextRound"}">${final ? `🏁 ${t("finalTitle")}` : `${t("nextRound")} →`}</button>
        <div class="row">
          ${!game.cfg.rounds ? `<button class="btn ghost" type="button" data-act="toFinal">🏁 ${t("finalTitle")}</button>` : ""}
          <button class="btn ghost" type="button" data-act="endTo" data-to="modes">${t("changeMode")}</button>
        </div>
      </footer>`,
      after() {
        if (o.celebrated) return;
        o.celebrated = true;
        play(hiddenWins ? "sneaky" : "fanfare");
        vibrate([30, 50, 30, 50, 80]);
        confetti(hiddenWins ? [MODES[r.mode].color, "#ff5c7a", "#ffffff", "#ffcf5a"] : undefined);
      },
    };
  },

  final() {
    const ranked = game.round.ids.map((id) => [id, game.scores[id]]).sort((a, b) => b[1] - a[1]);
    const podium = [ranked[1], ranked[0], ranked[2]].filter(Boolean);
    return {
      cls: "final-screen",
      html: `${gameBar()}
      <main class="body">
        <h1 class="title center-t">🏁 ${t("finalTitle")}</h1>
        <div class="podium">
          ${podium.map(([id, s]) => {
            const place = ranked.findIndex((x) => x[0] === id) + 1;
            return `<div class="pod p${place}">${avatar(gp(id), "lg")}<b>${nm(id)}</b><small>${t("pts", { n: s })}</small><span class="pod-block">${place}</span></div>`;
          }).join("")}
        </div>
        <ol class="scores">${ranked.map(([id, s], i) => `<li><span class="rank">${i + 1}</span>${avatar(gp(id), "sm")}<b>${nm(id)}</b><span class="score">${t("pts", { n: s })}</span></li>`).join("")}</ol>
      </main>
      <footer class="bottom col">
        <button class="btn primary big" type="button" data-act="playAgain">${t("playAgain")}</button>
        <div class="row">
          <button class="btn ghost" type="button" data-act="endTo" data-to="modes">${t("changeMode")}</button>
          <button class="btn ghost" type="button" data-act="endTo" data-to="home">${t("home")}</button>
        </div>
      </footer>`,
      after() {
        if (game.finalShown) return;
        game.finalShown = true;
        play("fanfare");
        confetti();
      },
    };
  },
};

function showVerdict(instant) {
  app.querySelectorAll(".bar-fill").forEach((b) => { b.style.width = `${b.dataset.w}%`; });
  const v = app.querySelector("[data-verdict]");
  if (v) v.hidden = false;
  const f = app.querySelector("[data-after]");
  if (f) f.hidden = false;
  if (!instant) {
    game.sub.shown = true;
    const el = app.querySelector(".verdict");
    if (el) {
      const [x, y] = centerOf(el);
      sparkle(x, y, "#ffcf5a", 30);
    }
  }
}

function roundPoints() {
  return scoreRound(game.round, game.outcome.result, game.votes, game.outcome.missionsDone);
}

function finishOutcome(guessed) {
  const o = game.outcome;
  o.result = decide(game.round, o.accused, guessed);
  game.sub = { phase: "results" };
  render();
}

function commitPoints() {
  if (game.outcome.committed) return;
  game.outcome.committed = true;
  const pts = roundPoints();
  for (const id in pts) game.scores[id] += pts[id];
}

function endGame(to) {
  stopTimer();
  game = null;
  hideVeil();
  go(to);
}

// ---------- actions ----------

const ACT = {
  nav(d) {
    play("click");
    if (d.to === "overview" || d.to === "config") saveConfig();
    go(d.to);
  },
  openMode(d) {
    play("click");
    modeId = d.id;
    store.set("mode", modeId);
    go("mode");
  },
  setLang(d) {
    settings.lang = d.lang;
    saveSettings();
    applySettings();
    render();
  },
  toggleSound() {
    settings.sound = !settings.sound;
    saveSettings();
    applySettings();
    play("click");
    render();
  },
  // players
  addP() {
    if (players.length >= 12) return;
    const used = new Set(players.map((p) => p.av));
    const av = [...AVATARS.keys()].find((i) => !used.has(i)) ?? players.length;
    players.push({ id: newId(), name: "", av, col: players.length % COLORS.length });
    savePlayers();
    play("pop");
    render();
    const inputs = app.querySelectorAll(".pname");
    inputs[inputs.length - 1]?.focus();
  },
  removeP(d) {
    players.splice(Number(d.i), 1);
    savePlayers();
    play("click");
    render();
  },
  moveP(d) {
    const i = Number(d.i);
    const j = i + Number(d.d);
    if (j < 0 || j >= players.length) return;
    [players[i], players[j]] = [players[j], players[i]];
    savePlayers();
    play("click");
    render();
  },
  cycleAv(d) {
    const p = players[Number(d.i)];
    p.av = (p.av + 1) % AVATARS.length;
    p.col = (p.col + 1) % COLORS.length;
    savePlayers();
    play("pop");
    render();
  },
  toConfig() {
    if (playersError()) return;
    play("click");
    go("config");
  },
  // config
  setOpt(d) {
    const cfg = cfgFor(modeId);
    cfg[d.key] = typeof DEFAULT_CONFIG[d.key] === "number" ? Number(d.val) : d.val;
    saveConfig();
    play("click");
    render();
  },
  cat(d) {
    const cfg = cfgFor(modeId);
    const set = new Set(cfg.categories);
    if (set.has(d.id)) set.delete(d.id);
    else set.add(d.id);
    // Selecting every category is the same as "All".
    cfg.categories = set.size === CATEGORIES.length ? [] : CATEGORIES.map((c) => c.id).filter((id) => set.has(id));
    saveConfig();
    play("click");
    render();
  },
  catAll() {
    cfgFor(modeId).categories = [];
    saveConfig();
    play("click");
    render();
  },
  startGame() {
    play("next");
    startGame();
  },
  // game
  quit() {
    confirmQuit();
  },
  nextStep() {
    play("next");
    nextStep();
  },
  reveal() {
    game.sub.phase = "reveal";
    render();
  },
  hide() {
    const el = app.querySelector("[data-card]");
    el?.classList.remove("flipped");
    play("hide");
    const s = game.sub;
    // Swap the content out immediately: the secret is gone before the fold ends.
    const front = el?.querySelector(".front");
    setTimeout(() => {
      if (front) front.innerHTML = "";
    }, 250);
    app.querySelector("[data-act=hide]")?.setAttribute("disabled", "");
    setTimeout(() => {
      if (!game || game.sub !== s) return;
      s.idx++;
      s.phase = s.idx >= game.round.ids.length ? "done" : "handoff";
      render();
    }, settings.motion ? 550 : 50);
  },
  nextSpeaker() {
    const s = game.sub;
    s.speaker++;
    play("next");
    if (s.speaker < game.round.order.length && game.cfg.clueTimer) startTimer(game.cfg.clueTimer, "clue");
    else stopTimer();
    render();
  },
  pauseTimer() {
    if (!timer || timer.done) return;
    timer.running = !timer.running;
    play("click");
    updateTimerUI();
  },
  voteBegin() {
    game.sub.phase = "handoff";
    game.sub.idx = 0;
    game.sub.votes = {};
    play("next");
    render();
  },
  votePick() {
    game.sub.phase = "pick";
    game.sub.choice = null;
    render();
  },
  choose(d) {
    game.sub.choice = d.id;
    play("select");
    render();
  },
  lockVote() {
    const s = game.sub;
    if (!s.choice) return;
    s.votes[game.round.ids[s.idx]] = s.choice;
    s.choice = null;
    s.phase = "sealed";
    render();
    setTimeout(() => {
      if (!game || game.sub !== s || s.phase !== "sealed") return;
      s.idx++;
      s.phase = s.idx >= game.round.ids.length ? "done" : "handoff";
      render();
    }, 1300);
  },
  voteFinish() {
    const s = game.sub;
    game.votes = s.votes;
    game.vote = { candidates: s.candidates, revote: s.revote, res: tally(s.votes, s.candidates) };
    game.stepIdx = game.round.steps.indexOf("outcome");
    game.sub = { phase: "tally" };
    game.outcome = { accused: null, missionsDone: new Set() };
    render();
  },
  revote() {
    game.stepIdx = game.round.steps.indexOf("vote");
    game.sub = { phase: "intro", idx: 0, candidates: game.vote.res.top.slice(), revote: true, votes: {} };
    play("next");
    render();
  },
  toAccused() {
    game.outcome.accused = game.vote.res.top[0];
    game.sub = { phase: "accused" };
    play("next");
    render();
  },
  toGuess() {
    game.sub = { phase: "guess" };
    play("next");
    render();
  },
  showAnswer() {
    game.sub = { phase: "answer" };
    render();
  },
  judge(d) {
    play(d.ok === "1" ? "select" : "click");
    finishOutcome(d.ok === "1");
  },
  toResults() {
    // A still-tied revote leaves accused = null: the hidden player escapes.
    finishOutcome(false);
  },
  mission(d) {
    const set = game.outcome.missionsDone;
    if (set.has(d.id)) set.delete(d.id);
    else {
      set.add(d.id);
      play("pop");
    }
    render();
  },
  nextRound() {
    commitPoints();
    play("next");
    newRound();
    render();
  },
  toFinal() {
    commitPoints();
    game.sub = { phase: "final" };
    render();
  },
  playAgain() {
    play("next");
    startGame();
  },
  endTo(d) {
    play("click");
    endGame(d.to);
  },
};

function saveConfig() {
  store.set(`cfg:${modeId}`, cfgFor(modeId));
}

app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (fn) {
    e.preventDefault();
    fn(el.dataset, el);
  }
});

// Name inputs update state without re-rendering (that would drop focus).
app.addEventListener("input", (e) => {
  const i = e.target.dataset.name;
  if (i == null) return;
  players[Number(i)].name = e.target.value;
  savePlayers();
  const err = playersError();
  const errEl = app.querySelector("[data-err]");
  const nextBtn = app.querySelector("[data-act=toConfig]");
  if (errEl) {
    errEl.hidden = !err;
    errEl.textContent = err;
  }
  if (nextBtn) nextBtn.disabled = !!err;
});

app.addEventListener("keydown", (e) => {
  // Enter in a name field jumps to the next one.
  if (e.key === "Enter" && e.target.classList.contains("pname")) {
    e.preventDefault();
    const inputs = [...app.querySelectorAll(".pname")];
    const i = inputs.indexOf(e.target);
    if (i < inputs.length - 1) inputs[i + 1].focus();
    else e.target.blur();
  }
});

app.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.setting) {
    settings[el.dataset.setting] = el.checked;
    saveSettings();
    applySettings();
    play("click");
    render();
  } else if (el.dataset.opt) {
    cfgFor(modeId)[el.dataset.opt] = el.checked;
    saveConfig();
    play("click");
  }
});

// Audio may only start after a gesture.
addEventListener("pointerdown", unlockAudio, { capture: true });
addEventListener("keydown", unlockAudio, { capture: true });

// ---------- privacy ----------

// If the phone is locked or the app loses focus while a secret or a ballot is
// open, cover it at once and fall back to the neutral hand-off screen.
function coverSecrets() {
  if (!game || screen !== "game") return;
  const s = game.sub;
  const { kind } = step();
  let covered = false;
  if (kind === "deal" && s.phase === "reveal") {
    s.phase = "handoff";
    covered = true;
  } else if (kind === "vote" && s.phase === "pick") {
    s.phase = "handoff";
    s.choice = null;
    covered = true;
  }
  if (covered) {
    render();
    showVeil();
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) coverSecrets();
});
addEventListener("blur", coverSecrets);
addEventListener("pagehide", coverSecrets);

const veil = document.getElementById("veil");
function showVeil() {
  veil.querySelector("[data-veil-title]").textContent = t("hiddenVeil");
  veil.querySelector("[data-veil-sub]").textContent = t("hiddenVeilSub");
  veil.querySelector("[data-veil-ok]").textContent = t("resume");
  veil.hidden = false;
}
function hideVeil() {
  veil.hidden = true;
}
veil.querySelector("[data-veil-ok]").addEventListener("click", () => {
  hideVeil();
  armButtons();
});

addEventListener("beforeunload", (e) => {
  if (game) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ---------- history: no accidental "back" ----------

// One extra history entry while away from home. During a game the back
// gesture asks before quitting; in the setup screens it steps back one screen.
const BACK = { howto: "home", settings: "home", modes: "home", mode: "modes", players: "mode", config: "players", overview: "config" };
let trapped = false;
function trap() {
  const want = screen !== "home";
  if (want && !trapped) {
    history.pushState({ rusekin: 1 }, "");
    trapped = true;
  }
}
addEventListener("popstate", () => {
  trapped = false;
  if (game) {
    trap();
    confirmQuit();
  } else if (screen !== "home") {
    go(BACK[screen] || "home");
  }
});

const modal = document.getElementById("modal");
function confirmQuit() {
  modal.querySelector("#modal-title").textContent = t("quitQ");
  modal.querySelector("[data-modal-body]").textContent = t("quitBody");
  modal.querySelector("[data-modal-no]").textContent = t("cancel");
  modal.querySelector("[data-modal-yes]").textContent = t("confirmQuit");
  modal.hidden = false;
  modal.querySelector("[data-modal-no]").focus();
}
modal.querySelector("[data-modal-no]").addEventListener("click", () => {
  modal.hidden = true;
});
modal.querySelector("[data-modal-yes]").addEventListener("click", () => {
  modal.hidden = true;
  endGame("home");
});
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.hidden = true;
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) modal.hidden = true;
});

// ---------- boot ----------

applySettings();
matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", applySettings);
render();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker:", err));
}

if (new URLSearchParams(location.search).has("debug")) window.rusekin = { get game() { return game; } };
