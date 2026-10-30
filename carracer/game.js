// Twin Throttle: renderer, loop, input, camera, HUD, menus and the network
// glue. Physics, AI and race rules live in car.js / ai.js / race.js.

import { THREE, buildWorld, buildCar, disposeCar } from "./scene.js";
import { Track, angleDiff, clamp, lerp } from "./track.js";
import { TRACKS } from "./tracks.js";
import { Race, makeEntries, LAPS } from "./race.js";
import { DIFFICULTY } from "./ai.js";
import { Sounds } from "./audio.js";
import { Net, PROTOCOL, friendly, cleanCode } from "./net.js";

const $ = (id) => document.getElementById(id);
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
const COARSE = matchMedia("(pointer: coarse)").matches;
const DT = 1 / 120;             // physics step
const SNAP_EVERY = 1 / 20;      // network snapshots per second
const INTERP_DELAY = 0.1;       // remote cars are drawn this far in the past
const HUMAN_COLORS = [0xe8312a, 0x2f6bff, 0xf4f4f4, 0x2a2a30, 0x22c55e, 0xff8a00];

const store = {
  get(key, fallback) {
    try { return localStorage.getItem("twinthrottle." + key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("twinthrottle." + key, value); } catch { /* private mode etc. */ }
  },
  json(key, fallback) {
    try { return JSON.parse(this.get(key, "null")) ?? fallback; } catch { return fallback; }
  },
};

function fmt(t) {
  if (t == null || !isFinite(t)) return "–";
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (c) => "#" + c.toString(16).padStart(6, "0");

// ---------------------------------------------------------------- input

class Input {
  constructor() {
    this.keys = new Set();
    this.held = new Map();      // touch pointerId -> action
    this.steer = 0;
    this.padPrev = [];
    this.onPad = null;          // (button index) => void, for edge presses
  }

  has(act) {
    for (const a of this.held.values()) if (a === act) return true;
    return false;
  }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  read(dt) {
    const k = this.keys;
    const left = k.has("ArrowLeft") || k.has("KeyA") || this.has("left");
    const right = k.has("ArrowRight") || k.has("KeyD") || this.has("right");
    let throttle = k.has("ArrowUp") || k.has("KeyW") || this.has("gas") ? 1 : 0;
    let brake = k.has("ArrowDown") || k.has("KeyS") || this.has("brake") ? 1 : 0;
    let handbrake = k.has("Space") || this.has("drift");
    let analog = null;
    const p = this.pad();
    if (p) {
      const ax = p.axes[0] ?? 0;
      if (Math.abs(ax) > 0.12) analog = -Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88) ** 1.4;
      throttle = Math.max(throttle, p.buttons[7]?.value ?? 0);
      brake = Math.max(brake, p.buttons[6]?.value ?? 0);
      handbrake ||= !!p.buttons[0]?.pressed;
      p.buttons.forEach((b, i) => {
        if (b.pressed && !this.padPrev[i]) this.onPad?.(i);
        this.padPrev[i] = b.pressed;
      });
    }
    if (analog != null) this.steer = analog;
    else {
      // Keys ramp the steering so a tap does not jerk the car; letting go
      // or switching sides recentres faster.
      const target = (left ? 1 : 0) - (right ? 1 : 0);
      const rate = target === 0 || Math.sign(target) !== Math.sign(this.steer) ? 7 : 3.2;
      this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
    }
    return { throttle, brake, steer: this.steer, handbrake };
  }
}

// ----------------------------------------------------------------- game

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !COARSE, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(64, 1, 0.3, 2600);
    this.scene.add(this.camera);
    this.sounds = new Sounds();
    this.input = new Input();
    this.input.onPad = (i) => this.padButton(i);
    this.trackIdx = -1;
    this.meshes = new Map();
    this.snapBuf = new Map();
    this.mode = "menu";
    this.online = null;
    this.localId = "h";
    this.camMode = "chase";
    this.paused = false;
    this.clock = 0;                 // solo/attract race clock (seconds)
    this.goAt = 0;
    this.shake = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.camInit = false;
    this.touch = false;
    this.settings = {
      name: store.get("name", "Player").slice(0, 12),
      color: Number(store.get("color", HUMAN_COLORS[0])),
      track: clamp(Number(store.get("track", 0)) || 0, 0, TRACKS.length - 1),
      diff: DIFFICULTY[store.get("diff", "normal")] ? store.get("diff", "normal") : "normal",
      server: store.json("server", { host: "", port: "", path: "", key: "" }),
    };
    this.sounds.setMuted(store.get("muted", "0") === "1");
    $("mute").setAttribute("aria-pressed", String(this.sounds.muted));

    this.bindInput();
    addEventListener("resize", () => this.resize());
    this.resize();

    const join = new URLSearchParams(location.search).get("join");
    this.startAttract();
    if (join) this.showJoin(cleanCode(join)); else this.showMenu();

    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------ setup

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, COARSE ? 1.5 : 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  loadTrack(idx) {
    if (this.trackIdx === idx) return;
    if (this.world) {
      this.scene.remove(this.world.root);
      this.world.dispose();
    }
    this.trackIdx = idx;
    this.track = new Track(TRACKS[idx]);
    this.world = buildWorld(this.track, 1000 + idx);
    this.scene.add(this.world.root);
    this.scene.fog = this.world.fog;
    this.sky = this.world.root.children[0];
    // Minimap outline, fitted into a unit square.
    const T = this.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < T.n; i++) {
      minX = Math.min(minX, T.x[i]); maxX = Math.max(maxX, T.x[i]);
      minZ = Math.min(minZ, T.z[i]); maxZ = Math.max(maxZ, T.z[i]);
    }
    const size = Math.max(maxX - minX, maxZ - minZ);
    this.map = { minX, minZ, size, cx: (maxX - minX) / size, cz: (maxZ - minZ) / size };
    // TV camera spots along the track, alternating sides.
    this.tvSpots = [];
    for (let s = 0, k = 0; s < T.length; s += 140, k++) {
      const side = k % 2 ? 1 : -1;
      const p = T.point(s, side * (T.half(T.wrap(Math.round(s / 2))) + 7));
      const g = this.world.terrain.height(p.x, p.z);
      this.tvSpots.push({ s, x: p.x, z: p.z, y: Math.max(g, T.at(s).y) + 5 });
    }
  }

  // Race config: plain JSON so the host can send it to the guest.
  makeConfig(humans) {
    const seed = Math.floor(Math.random() * 1e6);
    return {
      seed,
      track: this.settings.track,
      difficulty: this.settings.diff,
      lightDelay: 0.2 + Math.random() * 0.8,
      entries: makeEntries(humans, this.settings.diff, seed),
    };
  }

  me() {
    return { id: this.localId, name: this.settings.name || "Player", color: this.settings.color, human: true };
  }

  // ------------------------------------------------------------ races

  // Menu background: an AI-only race. With reduced motion it stays still.
  startAttract() {
    this.mode = "attract";
    this.loadTrack(this.settings.track);
    const seed = Math.floor(Math.random() * 1e6);
    this.setRace(new Race(this.track, makeEntries([], "normal", seed).map((e) => ({ ...e, owned: true })), { difficulty: "normal" }));
    this.race.time = 0;
    this.race.phase = "racing";
    this.attractCar = 0;
    this.attractSwitch = 10;
    this.camInit = false;
    this.setHud(false);
  }

  setRace(race) {
    for (const m of this.meshes.values()) { this.scene.remove(m.group); disposeCar(m); }
    this.meshes.clear();
    this.snapBuf.clear();
    this.race = race;
    for (const c of race.cars) {
      const label = c.human && c.id !== this.localId ? c.name : null;
      const m = buildCar(c.color, label);
      this.scene.add(m.group);
      this.meshes.set(c.id, m);
    }
  }

  startSolo() {
    this.online = null;
    this.localId = "h";
    this.startRace(this.makeConfig([this.me()]), null);
  }

  // goAt: host-clock time of "lights out" (online), or null for solo.
  startRace(cfg, goAt) {
    const role = this.online?.role;
    this.loadTrack(cfg.track);
    const entries = cfg.entries.map((e) => ({
      ...e,
      owned: !role ? true : role === "host" ? e.id !== "g" : e.id === "g",
    }));
    this.cfg = cfg;
    this.setRace(new Race(this.track, entries, { difficulty: cfg.difficulty, lightDelay: cfg.lightDelay, owner: role !== "guest" }));
    if (goAt == null) {
      // Solo: the countdown begins one second from now on our own clock.
      this.clock = 0;
      this.goAt = 1 - this.race.time;
    } else this.goAt = goAt;
    this.mode = "race";
    this.paused = false;
    this.camMode = "chase";
    this.camInit = false;
    this.snapT = 0;
    this.finishedShown = false;
    this.freshRows = new Map();
    $("results").hidden = true;
    $("showResults").hidden = true;
    $("panel").hidden = true;
    this.setHud(true);
    this.sounds.unlock();
  }

  now() { return this.online?.net && !this.online.lost && this.online.role ? this.online.net.now() : this.clock; }

  setHud(on) {
    $("hud").hidden = !on;
    $("speed").hidden = !on;
    $("cam").hidden = !on;
    $("pause").hidden = !on;
    $("lights").hidden = true;
    $("touch").hidden = !(on && this.touch);
    if (!on) { $("results").hidden = true; $("showResults").hidden = true; this.sounds.silence(); }
  }

  quitToMenu() {
    this.paused = false;
    if (this.online) { this.online.net.close(); this.online = null; }
    this.startAttract();
    this.showMenu();
  }

  // --------------------------------------------------------- the loop

  frame(t) {
    const dt = Math.min((t - this.last) / 1000, 1 / 20);
    this.last = t;
    const R = this.race;
    if (this.mode === "race") this.updateRace(dt);
    else if (this.mode === "attract" && !REDUCED_MOTION) {
      for (let acc = 0; acc < dt; acc += DT) R.step(DT, new Map());
      R.events.length = 0;
      if (R.phase === "done" || R.time > 400) this.startAttract();
    }
    this.updateMeshes(dt);
    this.updateCamera(dt);
    if (this.mode === "race") { this.updateHud(); this.updateSound(); }
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((t2) => this.frame(t2));
  }

  updateRace(dt) {
    const R = this.race;
    const inp = this.input.read(dt);
    this.lastInput = inp;
    if (!this.paused && !this.online) this.clock += dt;
    if (this.paused) return;
    const target = this.now() - this.goAt;
    this.applyRemote(R.time);
    const inputs = new Map([[this.localId, inp]]);
    let n = 0;
    while (R.time + DT <= target && n < 60) { R.step(DT, inputs); n++; }
    // Far behind (tab was hidden): skip ahead instead of fast-forwarding.
    if (target - R.time > 0.5) R.time = target;
    this.handleEvents();
    if (this.online && !this.online.lost) {
      this.snapT += dt;
      if (this.snapT >= SNAP_EVERY) { this.snapT = 0; this.sendSnap(); }
    }
    this.resTick = (this.resTick ?? 0) + dt;
    if (this.resTick > 0.25 && !$("results").hidden) { this.resTick = 0; this.renderResults(); }
  }

  handleEvents() {
    const R = this.race;
    for (const e of R.events) {
      const c = e.id ? R.byId(e.id) : null;
      const mine = e.id === this.localId;
      switch (e.type) {
        case "light": this.sounds.light(); break;
        case "go": this.sounds.go(); this.message("GO!", "go", 900); break;
        case "wheelspin": if (mine) this.message("Wheelspin!", "bad small", 1200); break;
        case "goodstart": if (mine) this.message("Great start!", "good small", 1200); break;
        case "lap":
          if (c.owned) this.sendLaps(c);
          if (mine && !c.finish) {
            const best = c.best === c.laps[c.laps.length - 1];
            this.sounds.lap();
            const txt = c.laps.length === LAPS - 1 ? "Final lap!" : `Lap ${c.laps.length + 1}/${LAPS}`;
            this.message(`${txt}<br><span class="dim">${fmt(c.laps[c.laps.length - 1])}${best && c.laps.length > 1 ? " ★" : ""}</span>`, "small", 2000);
          }
          break;
        case "finish":
          if (c.owned) this.sendLaps(c);
          this.freshRows.set(e.id, performance.now());
          if (mine) this.localFinish(c);
          else if (!$("results").hidden) this.renderResults();
          break;
        case "end":
          if (this.online?.role === "host" && !this.online.lost) this.online.net.send({ t: "end" });
          this.renderResults();
          break;
      }
    }
    R.events.length = 0;
  }

  localFinish(c) {
    const pos = this.race.position(c.id);
    this.sounds.finish();
    this.message(`P${pos}!`, "good", 2200);
    this.camMode = "tv";
    // Personal bests per track and difficulty.
    const key = `best.${this.track.def.id}.${this.race.difficulty}`;
    const old = store.json(key, {});
    this.pb = { total: !old.total || c.finish.time < old.total, lap: !old.lap || c.best < old.lap };
    store.set(key, JSON.stringify({ total: Math.min(old.total ?? Infinity, c.finish.time), lap: Math.min(old.lap ?? Infinity, c.best) }));
    this.finishedShown = true;
    this.showResults(true);
  }

  // ---------------------------------------------------------- network

  sendSnap() {
    const R = this.race;
    const cars = [];
    for (const c of R.cars) {
      if (!c.owned) continue;
      const a = c.car;
      cars.push([c.id, +a.x.toFixed(2), +a.z.toFixed(2), +a.yaw.toFixed(4), +a.vx.toFixed(2), +a.vz.toFixed(2), +a.steer.toFixed(2), +a.dist.toFixed(2), c.autopilot ? 1 : 0]);
    }
    this.online.net.sendState({ t: "snap", rt: +R.time.toFixed(3), c: cars });
  }

  sendLaps(c) {
    if (!this.online || this.online.lost) return;
    this.online.net.send({ t: "laps", id: c.id, laps: c.laps, finish: c.finish });
  }

  onSnap(m) {
    if (this.mode !== "race") return;
    for (const s of m.c) {
      const c = this.race.byId(s[0]);
      if (!c || c.owned) continue;
      let b = this.snapBuf.get(s[0]);
      if (!b) this.snapBuf.set(s[0], (b = []));
      if (b.length && b[b.length - 1].rt >= m.rt) continue;   // late or duplicate
      b.push({ rt: m.rt, x: s[1], z: s[2], yaw: s[3], vx: s[4], vz: s[5], steer: s[6], dist: s[7], ap: s[8] });
      if (b.length > 30) b.shift();
    }
  }

  // Remote cars: interpolate between the two snapshots around (now - delay),
  // extrapolate briefly when packets are late, then hold.
  applyRemote(rt) {
    const t = rt - INTERP_DELAY;
    for (const c of this.race.cars) {
      if (c.owned) continue;
      const b = this.snapBuf.get(c.id);
      if (!b?.length) continue;
      let a = b[0], z = b[0], f = 0;
      if (t >= b[b.length - 1].rt) {
        a = z = b[b.length - 1];
        const ex = Math.min(t - a.rt, 0.25);
        this.putCar(c, a.x + a.vx * ex, a.z + a.vz * ex, a.yaw, a, a.dist);
        continue;
      }
      for (let i = 0; i < b.length - 1; i++) {
        if (b[i].rt <= t && b[i + 1].rt > t) { a = b[i]; z = b[i + 1]; f = (t - a.rt) / (z.rt - a.rt); break; }
      }
      this.putCar(c, lerp(a.x, z.x, f), lerp(a.z, z.z, f), a.yaw + angleDiff(a.yaw, z.yaw) * f, f < 0.5 ? a : z, lerp(a.dist, z.dist, f));
    }
  }

  putCar(c, x, z, yaw, s, dist) {
    const car = c.car;
    car.x = x; car.z = z; car.yaw = yaw;
    car.vx = s.vx; car.vz = s.vz; car.steer = s.steer;
    car.follow(false);
    car.dist = dist;
    c.autopilot = !!s.ap;
  }

  wireNet(net) {
    net.on("hello", (m) => {
      if (m.v !== PROTOCOL) { net.send({ t: "reject", why: "Different game versions. Please reload both pages." }); return; }
      let color = m.color;
      if (color === this.settings.color) color = HUMAN_COLORS.find((c) => c !== this.settings.color);
      this.online.guest = { id: "g", name: String(m.name || "Player 2").slice(0, 12), color, human: true };
      this.sendLobby();
      this.sounds.click();
      if (this.panelView === "host") this.showSetup("host");
    });
    net.on("lobby", (m) => {
      this.online.lobby = m;
      if (this.panelView === "guest") this.showGuestLobby();
    });
    net.on("start", (m) => this.startRace(m.cfg, m.goAt));
    net.on("snap", (m) => this.onSnap(m));
    net.on("laps", (m) => { if (this.mode === "race") this.race.applyLaps(m.id, m.laps, m.finish); });
    net.on("end", () => { if (this.mode === "race") this.race.end(); });
    net.on("menu", () => {
      if (this.mode === "race") { this.mode = "attract"; this.startAttract(); }
      this.showGuestLobby();
    });
    net.on("reject", (m) => { this.toast(m.why); this.quitToMenu(); });
    net.on("full", () => { this.toast("That room already has two players."); this.quitToMenu(); });
    net.on("bye", () => this.peerLeft());
    net.on("left", () => this.peerLeft());
    net.on("error", (e) => this.netError(e));
  }

  sendLobby() {
    const o = this.online;
    if (!o || o.role !== "host" || !o.guest) return;
    o.net.send({ t: "lobby", host: this.settings.name, track: this.settings.track, diff: this.settings.diff });
  }

  peerLeft() {
    const o = this.online;
    if (!o || o.lost) return;
    o.lost = true;
    const racing = this.mode === "race";
    if (racing) {
      // Whoever stays takes over the other side's cars and finishes the race.
      for (const c of this.race.cars) if (!c.owned) this.race.adopt(c);
      this.race.owner = true;
      // The race clock was the host's; continue from where we are.
      this.clock = this.race.time + this.goAt;
      if (this.race.phase === "done") this.toast(o.role === "host" ? "Player 2 left." : "The host left.");
      else this.toast(o.role === "host" ? "Player 2 left. The computer drives their car." : "The host left. Continuing offline.");
    }
    o.net.close();
    this.online = null;
    if (!racing) {
      this.toast(o.role === "host" ? "Player 2 left." : "The host left.");
      if (o.role === "host" && this.panelView === "host") this.openRoom();
      else this.showMenu();
    }
  }

  netError(e) {
    const el = $("netStatus");
    if (el) { el.className = "err"; el.textContent = friendly(e); }
    else this.toast(friendly(e));
  }

  async openRoom() {
    const net = new Net(this.settings.server);
    this.online = { role: "host", net, guest: null };
    this.wireNet(net);
    this.showSetup("host");
    try {
      const code = await net.host();
      if (this.online?.net !== net) return;
      this.online.code = code;
      this.showSetup("host");
    } catch (e) {
      if (this.online?.net !== net) return;
      this.online.error = friendly(e);
      this.showSetup("host");
    }
  }

  async joinRoom(code) {
    if (cleanCode(code).length !== 5) { this.netError({ message: "Room codes have 5 characters." }); return; }
    const net = new Net(this.settings.server);
    this.online = { role: "guest", net, lobby: null };
    this.localId = "g";
    this.wireNet(net);
    const st = $("netStatus");
    if (st) { st.className = "note"; st.textContent = "Connecting…"; }
    try {
      await net.join(code);
      net.send({ t: "hello", v: PROTOCOL, name: this.settings.name, color: this.settings.color });
      this.showGuestLobby();
    } catch (e) {
      net.close();
      this.online = null;
      this.netError(e);
    }
  }

  hostStart() {
    const o = this.online;
    if (!o?.guest) return;
    this.localId = "h";
    const cfg = this.makeConfig([this.me(), o.guest]);
    // One second for the message to arrive, then the usual countdown.
    const goAt = o.net.now() + 1 + 5.5 + cfg.lightDelay;
    o.net.send({ t: "start", cfg, goAt });
    this.startRace(cfg, goAt);
  }

  // ------------------------------------------------------------ menus

  setPanel(view, html) {
    this.panelView = view;
    const p = $("panel");
    p.innerHTML = html;
    p.hidden = false;
  }

  showMenu() {
    if (this.online) { this.online.net.close(); this.online = null; }
    if (this.mode === "race") this.startAttract();
    const s = this.settings;
    const sw = HUMAN_COLORS.map((c) => `<button type="button" class="swatch${c === s.color ? " sel" : ""}" style="background:${hex(c)}" data-do="color" data-c="${c}" aria-label="Colour ${hex(c)}"></button>`).join("");
    const sv = s.server;
    this.setPanel("menu", `
      <h1>Twin <span>Throttle</span></h1>
      <p>Three laps against the computer, alone or with a friend online.</p>
      <div class="col">
        <label class="field">Your name <input type="text" id="fName" maxlength="12" value="${esc(s.name)}" autocomplete="off"></label>
        <div class="field">Car colour <div class="swatches">${sw}</div></div>
      </div>
      <div class="col">
        <button type="button" class="btn big" data-do="solo">Solo race</button>
        <div class="row" style="margin-top:0">
          <button type="button" class="btn ghost" data-do="host" style="flex:1">Host online</button>
          <button type="button" class="btn ghost" data-do="join" style="flex:1">Join online</button>
        </div>
        <span class="note dim">Online play connects via PeerJS. <button type="button" class="linkish" data-do="privacy">Privacy</button></span>
      </div>
      <details>
        <summary>Own PeerJS server (optional)</summary>
        <p class="note">Leave empty to use the free PeerJS cloud server. Both players need the same settings.</p>
        <div class="grid">
          <input type="text" id="sHost" placeholder="host" value="${esc(sv.host || "")}">
          <input type="text" id="sPort" placeholder="port (443)" value="${esc(sv.port || "")}">
          <input type="text" id="sPath" placeholder="path (/)" value="${esc(sv.path || "")}">
          <input type="text" id="sKey" placeholder="key (peerjs)" value="${esc(sv.key || "")}">
        </div>
      </details>
      <p class="keys dim">W/↑ gas · S/↓ brake · A/D or ←/→ steer · Space drift · C camera · Tab results · Esc pause · M mute · gamepad works too</p>
      <div class="row"><button type="button" class="linkish" data-do="privacy">Privacy</button></div>
    `);
    const save = () => {
      s.name = $("fName").value.trim().slice(0, 12) || "Player";
      store.set("name", s.name);
      s.server = { host: $("sHost").value.trim(), port: $("sPort").value.trim(), path: $("sPath").value.trim(), key: $("sKey").value.trim() };
      store.set("server", JSON.stringify(s.server));
    };
    $("panel").querySelectorAll("input").forEach((el) => el.addEventListener("change", save));
    this.saveMenu = save;
  }

  trackOptions(disabled) {
    return TRACKS.map((t, i) => {
      const b = store.json(`best.${t.id}.${this.settings.diff}`, null);
      const info = b ? `Best ${fmt(b.total)}<br>Lap ${fmt(b.lap)}` : "";
      return `<button type="button" class="opt${i === this.settings.track ? " sel" : ""}" data-do="track" data-i="${i}"${disabled ? " disabled" : ""}>
        <span class="name">${esc(t.name)}<small>${esc(t.blurb)}</small></span><span class="info">${info}</span></button>`;
    }).join("");
  }

  diffOptions(disabled) {
    return Object.entries(DIFFICULTY).map(([k, d]) =>
      `<button type="button" class="opt${k === this.settings.diff ? " sel" : ""}" data-do="diff" data-k="${k}"${disabled ? " disabled" : ""}>${d.name}</button>`).join("");
  }

  showSetup(role) {
    const o = this.online;
    let top = "", canStart = true;
    if (role === "host") {
      canStart = !!o?.guest;
      const status = o?.error ? `<span class="err">${esc(o.error)}</span> <button type="button" class="linkish" data-do="reopen">Try again</button>`
        : !o?.code ? "Opening room…"
        : o.guest ? `<span class="ok">${esc(o.guest.name)} joined.</span>`
        : "Waiting for player 2… Share the code or the link.";
      top = `
        <p>Room code</p>
        <div class="row" style="margin-top:0">
          <span class="roomcode">${o?.code ?? "·····"}</span>
          ${o?.code ? `<button type="button" class="btn ghost" data-do="copy">Copy join link</button>` : ""}
        </div>
        <p id="netStatus" class="note">${status}</p>`;
    }
    this.setPanel(role, `
      <h2>${role === "host" ? "Host online" : "Solo race"}</h2>
      ${top}
      <p class="note">Track</p>
      <div class="options">${this.trackOptions(false)}</div>
      <p class="note">Computer drivers</p>
      <div class="seg">${this.diffOptions(false)}</div>
      <p class="note dim">Tip: don't hold the gas while the lights are on. Hit it right as they go out.</p>
      <div class="row">
        <button type="button" class="btn big" data-do="${role === "host" ? "hostStart" : "start"}"${canStart ? "" : " disabled"}>Start race</button>
        <button type="button" class="btn ghost" data-do="back">Back</button>
      </div>
    `);
  }

  showJoin(code = "") {
    this.setPanel("join", `
      <h2>Join online</h2>
      <p>Enter the room code from the host.</p>
      <div class="row">
        <input type="text" id="fCode" class="code" maxlength="5" value="${esc(code)}" autocomplete="off" spellcheck="false">
        <button type="button" class="btn" data-do="doJoin">Join</button>
      </div>
      <p id="netStatus" class="note"></p>
      <p class="note dim">Online play connects via PeerJS. <button type="button" class="linkish" data-do="privacy">Privacy</button></p>
      <div class="row"><button type="button" class="btn ghost" data-do="back">Back</button></div>
    `);
    const el = $("fCode");
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") this.joinRoom(el.value); });
    if (!COARSE) el.focus();
  }

  showGuestLobby() {
    const l = this.online?.lobby;
    const info = l ? `<p><b>${esc(l.host)}</b> picks the race:</p>
        <p>Track: <b>${esc(TRACKS[l.track]?.name ?? "?")}</b> · Computer drivers: <b>${DIFFICULTY[l.diff]?.name ?? "?"}</b></p>
        <p class="ok">Waiting for the host to start…</p>` : `<p>Connected. Waiting for the host…</p>`;
    this.setPanel("guest", `
      <h2>Online lobby</h2>
      ${info}
      <div class="row"><button type="button" class="btn ghost" data-do="leave">Leave</button></div>
    `);
  }

  showPause() {
    const online = !!this.online;
    if (!online) this.paused = true;
    this.setPanel("pause", `
      <h2>${online ? "Menu" : "Paused"}</h2>
      ${online ? `<p>The race keeps running while this is open.</p>` : ""}
      <div class="col">
        <button type="button" class="btn big" data-do="resume">Resume</button>
        ${online ? "" : `<button type="button" class="btn ghost" data-do="restart">Restart race</button>`}
        <button type="button" class="btn ghost" data-do="quit">${online ? "Leave race" : "Quit to menu"}</button>
      </div>
      <p class="keys dim">W/↑ gas · S/↓ brake · A/D or ←/→ steer · Space drift · C camera · Tab results · M mute</p>
    `);
  }

  resume() {
    this.paused = false;
    $("panel").hidden = true;
    this.panelView = null;
  }

  async panelAction(act, el) {
    this.sounds.unlock();
    const s = this.settings;
    switch (act) {
      case "color":
        s.color = Number(el.dataset.c);
        store.set("color", s.color);
        $("panel").querySelectorAll(".swatch").forEach((b) => b.classList.toggle("sel", b === el));
        break;
      case "solo": this.saveMenu?.(); this.showSetup("solo"); break;
      case "host": this.saveMenu?.(); this.openRoom(); break;
      case "join": this.saveMenu?.(); this.showJoin(); break;
      case "privacy": $("privacy").showModal(); break;
      case "track":
        s.track = Number(el.dataset.i);
        store.set("track", s.track);
        this.loadTrack(s.track);
        if (this.mode === "attract") this.startAttract();
        this.showSetup(this.panelView);
        this.sendLobby();
        break;
      case "diff":
        s.diff = el.dataset.k;
        store.set("diff", s.diff);
        this.showSetup(this.panelView);
        this.sendLobby();
        break;
      case "start": this.startSolo(); break;
      case "hostStart": this.hostStart(); break;
      case "reopen": this.online?.net.close(); this.openRoom(); break;
      case "copy": {
        const url = new URL(`./?join=${this.online.code}`, location.href).href;
        try { await navigator.clipboard.writeText(url); this.toast("Join link copied."); }
        catch { prompt("Copy this link:", url); }
        break;
      }
      case "doJoin": this.joinRoom($("fCode").value); break;
      case "back": this.showMenu(); break;
      case "leave": this.quitToMenu(); break;
      case "resume": this.resume(); break;
      case "restart": this.startSolo(); break;
      case "quit": this.quitToMenu(); break;
    }
  }

  // ---------------------------------------------------------- results

  showResults(on) {
    $("results").hidden = !on;
    $("showResults").hidden = on || !this.finishedShown;
    if (on) this.renderResults();
  }

  renderResults() {
    const R = this.race, st = R.standings();
    const me = R.byId(this.localId);
    const win = st[0].finish ? st[0].finish.time : null;
    let fastest = Infinity;
    for (const c of R.cars) if (c.best != null) fastest = Math.min(fastest, c.best);
    const now = performance.now();
    $("resBody").innerHTML = st.map((c, i) => {
      const f = c.finish;
      const tag = c.id === this.localId ? "you" : c.left ? "left" : c.human ? "" : "AI";
      const fresh = this.freshRows.get(c.id) && now - this.freshRows.get(c.id) < 300 ? " fresh" : "";
      const cls = (c.id === this.localId ? "me" : "") + fresh;
      const total = f ? `<span class="${f.est ? "est" : ""}">${fmt(f.time)}</span>` : "—";
      const gap = f && win != null && i > 0 ? `+${(f.time - win).toFixed(3)}` : "—";
      const best = c.best != null ? `${fmt(c.best)}${c.best === fastest ? ' <span class="star">★</span>' : ""}` : "—";
      const status = f ? (f.est ? '<span class="est">est.</span>' : "Finished")
        : `<span class="live">Lap ${Math.min(c.laps.length + 1, LAPS)}/${LAPS}</span>`;
      return `<tr class="${cls}"><td>${i + 1}</td>
        <td class="driver"><i style="background:${hex(c.color)}"></i>${esc(c.name)}${tag ? `<span class="tag">(${tag})</span>` : ""}</td>
        <td>${total}</td><td class="gap">${gap}</td><td>${best}</td><td class="st">${status}</td></tr>`;
    }).join("");
    for (const [id, t] of this.freshRows) if (now - t > 300) this.freshRows.delete(id);
    const done = R.phase === "done";
    const pos = R.position(this.localId);
    $("resTitle").textContent = done ? "Race complete" : me.finish ? `You finished P${pos}` : "Standings";
    $("resSub").textContent = done ? "" : me.finish ? "Your car is on autopilot. The table updates as the others finish." : "";
    const pb = this.pb ?? {};
    $("resLaps").innerHTML = me.laps.map((l, k) => `<span>Lap ${k + 1} <b>${fmt(l)}</b></span>`).join("")
      + (me.finish && pb.total ? '<span class="pb">New personal best!</span>' : "")
      + (me.finish && !pb.total && pb.lap ? '<span class="pb">New best lap!</span>' : "");
    const guest = this.online?.role === "guest";
    const rm = $("resRematch");
    rm.disabled = guest || (this.online && !this.online.guest);
    rm.textContent = guest ? "Waiting for host" : "Rematch";
    $("resMenu").textContent = guest ? "Leave" : "Menu";
  }

  resultsAction(act) {
    this.sounds.unlock();
    if (act === "hide") this.showResults(false);
    else if (act === "rematch") {
      if (this.online?.role === "host") this.hostStart();
      else if (!this.online) this.startSolo();
    } else if (act === "menu") {
      if (this.online?.role === "host") {
        this.online.net.send({ t: "menu" });
        this.startAttract();
        this.showSetup("host");
      } else if (this.online?.role === "guest") this.quitToMenu();
      else { this.startAttract(); this.showMenu(); }
    }
  }

  // ----------------------------------------------------------- visuals

  updateMeshes(dt) {
    const T = this.track;
    for (const c of this.race.cars) {
      const m = this.meshes.get(c.id), a = c.car;
      m.group.position.set(a.x, a.y, a.z);
      // Pitch from the road slope, scaled by how much the car faces along it.
      const t0 = T.at(a.s - 2), t1 = T.at(a.s + 2);
      const facing = Math.cos(angleDiff(a.yaw, Math.atan2(t0.dx, t0.dz)));
      m.group.rotation.set(-Math.atan((t1.y - t0.y) / 4) * facing, a.yaw, 0, "YXZ");
      const sp = a.fwd;
      if (!c.owned) a.wheel += (sp * dt) / 0.36;
      m.body.rotation.z = -a.steer * Math.min(Math.abs(sp) / 40, 1) * 0.06;
      for (const w of m.wheels) w.rotation.x = a.wheel;
      for (const p of m.pivots) p.rotation.y = a.steer * 0.45;
    }
    const R = this.race;
    const lights = this.mode === "race" ? R.lightsOn : 0;
    this.world.setLights(lights);
  }

  updateCamera(dt) {
    const cam = this.camera, R = this.race;
    let target;
    if (this.mode === "race") target = R.byId(this.localId).car;
    else {
      // Attract: follow one car for a while, then cut to another.
      this.attractSwitch -= dt;
      if (this.attractSwitch <= 0) { this.attractSwitch = 10; this.attractCar = (this.attractCar + 1) % R.cars.length; }
      target = R.cars[this.attractCar].car;
    }
    const mode = this.mode === "race" ? this.camMode : "tv";
    const fx = Math.sin(target.yaw), fz = Math.cos(target.yaw);
    const k = 1 - Math.exp(-dt * 7);
    let fov = 64;
    if (mode === "tv") {
      // Nearest spot slightly ahead of the car; cut between spots.
      const T = this.track;
      let best = this.tvSpots[0], bd = Infinity;
      for (const s of this.tvSpots) {
        let d = s.s - target.s;
        if (d < -T.length / 2) d += T.length;
        if (d > T.length / 2) d -= T.length;
        const score = Math.abs(d - 40);
        if (score < bd) { bd = score; best = s; }
      }
      cam.position.set(best.x, best.y, best.z);
      this.camLook.set(target.x, target.y + 1, target.z);
      cam.lookAt(this.camLook);
      const dist = cam.position.distanceTo(this.camLook);
      fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(9 / dist)), 10, 60);
      this.camInit = false;
    } else if (mode === "bumper") {
      cam.position.set(target.x + fx * 0.5, target.y + 1.2, target.z + fz * 0.5);
      this.camLook.set(target.x + fx * 20, target.y + 0.9, target.z + fz * 20);
      cam.lookAt(this.camLook);
      fov = 72 + Math.abs(target.fwd) * 0.1;
      this.camInit = false;
    } else {
      const want = new THREE.Vector3(target.x - fx * 8, target.y + 3.3, target.z - fz * 8);
      const look = new THREE.Vector3(target.x + fx * 5, target.y + 1.2, target.z + fz * 5);
      if (!this.camInit) { this.camPos.copy(want); this.camLook.copy(look); this.camInit = true; }
      this.camPos.lerp(want, k);
      this.camLook.lerp(look, 1 - Math.exp(-dt * 12));
      const g = this.world.terrain.height(this.camPos.x, this.camPos.z) + 1;
      this.camPos.y = Math.max(this.camPos.y, g, target.y + 1.5);
      cam.position.copy(this.camPos);
      if (this.shake > 0 && !REDUCED_MOTION) {
        cam.position.x += (Math.random() - 0.5) * this.shake;
        cam.position.y += (Math.random() - 0.5) * this.shake;
      }
      cam.lookAt(this.camLook);
      fov = 62 + Math.min(Math.abs(target.fwd) * 0.16, 12);
    }
    this.shake = Math.max(0, this.shake - dt * 2);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  updateHud() {
    const R = this.race, c = R.byId(this.localId), car = c.car;
    const pos = R.position(this.localId);
    $("hPos").textContent = `P${pos}`;
    $("hOf").textContent = `/${R.cars.length}`;
    $("hLap").textContent = c.finish ? "Finished" : `Lap ${Math.min(c.laps.length + 1, LAPS)}/${LAPS}`;
    $("hTime").textContent = fmt(c.finish ? c.finish.time : Math.max(0, R.time));
    $("hBest").textContent = fmt(c.best);
    $("hSpeed").textContent = Math.round(Math.abs(car.fwd) * 3.6);
    const n = R.lightsOn;
    $("lights").hidden = !(R.time < 0 && R.time > -(5.5 + R.lightDelay));
    $("lights").querySelectorAll("i").forEach((el, k) => el.classList.toggle("on", k < n));
    if (car.impact > 6) { this.sounds.hit(car.impact); this.shake = Math.min(0.5, car.impact / 40); }
    for (const o of R.cars) o.car.impact = 0;
    this.drawMap();
  }

  drawMap() {
    const cv = $("minimap"), g = cv.getContext("2d"), W = cv.width, M = this.map, T = this.track;
    const pad = 12, sc = (W - pad * 2) / M.size;
    const ox = pad + (W - pad * 2) * (1 - M.cx) / 2, oz = pad + (W - pad * 2) * (1 - M.cz) / 2;
    // Map is drawn with +x to the left so it matches the driver's view.
    const px = (x) => W - (ox + (x - M.minX) * sc), pz = (z) => W - (oz + (z - M.minZ) * sc);
    g.clearRect(0, 0, W, W);
    g.lineWidth = 5; g.lineJoin = "round"; g.strokeStyle = "rgba(255,255,255,0.75)";
    g.beginPath();
    for (let i = 0; i <= T.n; i += 3) { const j = T.wrap(i); g.lineTo(px(T.x[j]), pz(T.z[j])); }
    g.closePath(); g.stroke();
    g.fillStyle = "#fff";
    g.fillRect(px(T.x[0]) - 3, pz(T.z[0]) - 3, 6, 6);
    for (const c of this.race.cars) {
      const me = c.id === this.localId;
      g.beginPath();
      g.arc(px(c.car.x), pz(c.car.z), me ? 5.5 : c.human ? 4.5 : 3.5, 0, Math.PI * 2);
      g.fillStyle = hex(c.color); g.fill();
      if (me || c.human) { g.lineWidth = 2; g.strokeStyle = me ? "#fff" : "#000"; g.stroke(); }
    }
  }

  updateSound() {
    const R = this.race, me = R.byId(this.localId).car;
    const inp = this.lastInput ?? { throttle: 0 };
    const c = R.byId(this.localId);
    const engines = [{ speed: me.fwd, throttle: c.driver ? 0.7 : inp.throttle, gain: 1, pan: 0 }];
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const others = R.cars.filter((o) => o.car !== me)
      .map((o) => ({ o, d: Math.hypot(o.car.x - me.x, o.car.z - me.z) }))
      .filter((e) => e.d < 80).sort((a, b) => a.d - b.d).slice(0, 2);
    for (const { o, d } of others) {
      const dx = o.car.x - this.camera.position.x, dz = o.car.z - this.camera.position.z;
      const pan = clamp((dx * right.x + dz * right.z) / Math.max(d, 1), -1, 1);
      engines.push({ speed: o.car.fwd, throttle: 0.7, gain: 0.6 * (1 - d / 80), pan });
    }
    if (this.paused) this.sounds.silence();
    else this.sounds.update(engines, me.onGrass ? 0 : me.slip);
  }

  message(html, cls = "", ms = 1500) {
    const el = $("msg");
    el.innerHTML = html;
    el.className = "msg show " + cls;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => el.classList.remove("show"), ms);
  }

  toast(text, ms = 3500) {
    const el = $("toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove("show"), ms);
  }

  // ------------------------------------------------------------ input

  togglePause() {
    if (this.mode !== "race") return;
    if (this.panelView === "pause" && !$("panel").hidden) this.resume();
    else this.showPause();
  }

  cycleCam() {
    if (this.mode !== "race") return;
    const order = ["chase", "bumper", "tv"];
    this.camMode = order[(order.indexOf(this.camMode) + 1) % order.length];
  }

  toggleResults() {
    if (this.mode !== "race" || !this.finishedShown && this.race.phase !== "done") return;
    this.showResults($("results").hidden);
  }

  toggleMute() {
    this.sounds.unlock();
    this.sounds.setMuted(!this.sounds.muted);
    store.set("muted", this.sounds.muted ? "1" : "0");
    $("mute").setAttribute("aria-pressed", String(this.sounds.muted));
  }

  padButton(i) {
    if (i === 3) this.cycleCam();
    else if (i === 9) this.togglePause();
    else if (i === 8) this.toggleResults();
  }

  bindInput() {
    const typing = (e) => e.target instanceof HTMLInputElement;
    addEventListener("keydown", (e) => {
      this.sounds.unlock();
      if (typing(e)) return;
      if (e.code === "Tab") { e.preventDefault(); this.toggleResults(); return; }
      if (this.mode === "race" && (e.code.startsWith("Arrow") || e.code === "Space")) e.preventDefault();
      this.input.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === "KeyM") this.toggleMute();
      else if (e.code === "KeyC") this.cycleCam();
      else if (e.code === "Escape" || e.code === "KeyP") this.togglePause();
    });
    addEventListener("keyup", (e) => this.input.keys.delete(e.code));
    addEventListener("blur", () => this.input.keys.clear());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.mode === "race" && !this.online && !this.paused) this.showPause();
    });
    addEventListener("pagehide", () => this.online?.net.close());

    $("mute").addEventListener("click", () => this.toggleMute());
    $("cam").addEventListener("click", () => this.cycleCam());
    $("pause").addEventListener("click", () => this.togglePause());
    $("showResults").addEventListener("click", () => this.showResults(true));
    $("panel").addEventListener("click", (e) => {
      const b = e.target.closest("[data-do]");
      if (b && !b.disabled) this.panelAction(b.dataset.do, b);
    });
    $("results").addEventListener("click", (e) => {
      const b = e.target.closest("[data-res]");
      if (b && !b.disabled) this.resultsAction(b.dataset.res);
    });

    if (COARSE) this.enableTouch();
    addEventListener("pointerdown", (e) => {
      this.sounds.unlock();
      if (e.pointerType === "touch") this.enableTouch();
    });
    // Touch only counts as a user gesture on release, so audio may need a second try here.
    addEventListener("pointerup", () => this.sounds.unlock());

    // A finger can slide between buttons, so the action follows whatever is
    // under it rather than the button it first touched.
    const pad = $("touch");
    const track = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("#touch button");
      const act = el?.dataset.act ?? null;
      const prev = this.input.held.get(e.pointerId) ?? null;
      if (act === prev) return;
      if (act) this.input.held.set(e.pointerId, act); else this.input.held.delete(e.pointerId);
      this.markHeld();
    };
    pad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pad.setPointerCapture?.(e.pointerId);
      track(e);
    });
    pad.addEventListener("pointermove", (e) => { if (this.input.held.has(e.pointerId) || e.buttons) track(e); });
    const up = (e) => { this.input.held.delete(e.pointerId); this.markHeld(); };
    pad.addEventListener("pointerup", up);
    pad.addEventListener("pointercancel", up);
    pad.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  markHeld() {
    const acts = new Set(this.input.held.values());
    for (const b of document.querySelectorAll("#touch button")) b.classList.toggle("held", acts.has(b.dataset.act));
  }

  enableTouch() {
    if (this.touch) return;
    this.touch = true;
    document.body.classList.add("touch");
    if (this.mode === "race") $("touch").hidden = false;
  }
}

const game = new Game($("scene"));
// For testing in the console: open the page with ?debug.
if (new URLSearchParams(location.search).has("debug")) window.game = game;
