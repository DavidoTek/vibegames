// Entry point: renderer, loop, game states (title, intro, play, pause, dead,
// end), HUD, zapping and Use, saving.

import { THREE, buildWorld, exterior, panel, probeModel, SLOT_VIEW } from "./props.js";
import { buildLevel, P, DISTRICTS } from "./level.js";
import { Physics } from "./physics.js";
import { Player } from "./player.js";
import { Input } from "./input.js";
import { Sounds, Music } from "./audio.js";
import { Missions } from "./missions.js";
import { Blink } from "./entities.js";
import { POST, SAY, MISSION_TITLES } from "./story.js";
import { store } from "./store.js";

const $ = (id) => document.getElementById(id);
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
const COARSE = matchMedia("(pointer: coarse)").matches;
const EXT_Y = 300;                     // the desk scene floats far above the board
const MAX_INTEGRITY = 4;
const ZAP_RANGE = 22;
const USE_RANGE = 3.6;
const FOG = 0x07120e;

function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

class Game {
  constructor() {
    const canvas = $("scene");
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !COARSE, powerPreference: "high-performance" });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(FOG);
    this.scene.fog = new THREE.Fog(FOG, 18, 125);
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.08, 500);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    this.scene.add(new THREE.HemisphereLight(0xc4ecd8, 0x16302a, 1.7));
    const sun = new THREE.DirectionalLight(0xfff0c8, 1.5);
    sun.position.set(40, 80, -60);
    sun.target.position.set(80, 0, 50);
    this.scene.add(sun, sun.target);
    // One coloured lamp per district, high enough not to burn out the roofs.
    for (const [x, y, z, c] of [[24, 16, 28, 0xffb347], [78, 20, 34, 0x4dff88], [132, 24, 28, 0x9ac8ff], [84, 30, 88, 0xbfd8ff], [134, 30, 90, 0xffe0a0]]) {
      const l = new THREE.PointLight(c, 220, 60, 2);
      l.position.set(x, y, z);
      this.scene.add(l);
    }

    this.level = buildLevel();
    this.phys = new Physics(this.level.solids);
    this.world = buildWorld(this.level);
    this.scene.add(this.world.root);

    this.postScreen = panel(22, 16, 256, 192);
    this.desk = exterior(this.postScreen);
    this.desk.position.y = EXT_Y;
    this.scene.add(this.desk);

    this.player = new Player(this.phys);
    this.input = new Input(canvas);
    this.input.onTouch = () => document.body.classList.add("touch");
    this.sounds = new Sounds();
    this.music = new Music(this.sounds);
    this.settings = { sens: 1, invert: false, bob: true, music: true, muted: false, ...store.get("settings", {}) };
    this.sounds.muted = this.settings.muted;
    this.music.enabled = this.settings.music;
    $("mute").setAttribute("aria-pressed", String(this.settings.muted));

    this.bugs = [];
    this.missions = null;
    this.state = "title";
    this.integrity = MAX_INTEGRITY;
    this.invuln = 0;
    this.zapCool = 0;
    this.beamT = 0;
    this.subs = [];
    this.subT = 0;
    this.noteT = 0;
    this.toastT = 0;
    this.district = "";
    this.districtT = 0;
    this.playTime = 0;
    this.target = null;
    this.endT = 0;
    this.time = 0;

    this.probe = probeModel();
    this.probe.position.set(0.17, -0.15, -0.36);
    this.probe.scale.setScalar(0.55);
    this.probe.visible = false;
    this.camera.add(this.probe);
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1, 6),
      new THREE.MeshBasicMaterial({ color: 0x9dffb8, transparent: true, opacity: 0.85, fog: false }),
    );
    this.beam.visible = false;
    this.scene.add(this.beam);

    this.bind();
    this.resize();
    this.drawPostScreen([false, false, false, false, false]);
    this.showTitle();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- setup

  bind() {
    addEventListener("resize", () => this.resize());
    addEventListener("pointerdown", () => this.sounds.unlock());
    addEventListener("keydown", () => this.sounds.unlock());
    document.addEventListener("visibilitychange", () => { if (document.hidden && this.state === "play") this.pause(); });
    document.addEventListener("pointerlockchange", () => {
      if (!document.pointerLockElement && this.state === "play" && this.wasLocked) {
        this.input.pressed.delete("pause");    // Esc already did its job
        this.pause();
      }
      this.wasLocked = !!document.pointerLockElement;
    });
    $("mute").addEventListener("click", () => this.toggleMute());
    $("pause").addEventListener("click", () => (this.state === "play" ? this.pause() : this.state === "pause" && this.resume()));
    $("post").addEventListener("click", () => $("post").classList.toggle("small"));
    $("panel").addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act) this.panelAction(act);
    });
    $("panel").addEventListener("input", (e) => {
      const el = e.target;
      if (el.name === "sens") this.settings.sens = Number(el.value);
      if (el.name === "invert") this.settings.invert = el.checked;
      if (el.name === "bob") this.settings.bob = el.checked;
      if (el.name === "music") { this.settings.music = el.checked; this.music.enabled = el.checked; }
      store.set("settings", this.settings);
    });
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, COARSE ? 1.5 : 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 88 : 72;       // portrait: keep a usable horizontal view
    this.camera.updateProjectionMatrix();
  }

  toggleMute() {
    this.settings.muted = !this.settings.muted;
    this.sounds.setMuted(this.settings.muted);
    $("mute").setAttribute("aria-pressed", String(this.settings.muted));
    store.set("settings", this.settings);
  }

  drawPostScreen(done) {
    const { g, w, h } = this.postScreen;
    g.fillStyle = "#05080a";
    g.fillRect(0, 0, w, h);
    g.font = "bold 15px 'DejaVu Sans Mono', monospace";
    g.fillStyle = "#b8c4c0";
    g.fillText("VIBETRON BIOS v2.1", 10, 24);
    POST.forEach((p, i) => {
      g.fillStyle = "#b8c4c0";
      g.fillText(p.name.padEnd(13, "."), 10, 56 + i * 22);
      g.fillStyle = done[i] ? "#4dff88" : "#ff5a4a";
      g.fillText(done[i] ? "OK" : p.bad, 150, 56 + i * 22);
    });
    g.fillStyle = "#ffb347";
    g.fillText(done.every(Boolean) ? "Starting VIBE-DOS..." : "System halted.", 10, 178);
    this.postScreen.update();
  }

  // ---------------------------------------------------------------- panels

  settingsHtml() {
    const s = this.settings;
    return `
      <div class="settings">
        <label>Look speed <input type="range" name="sens" min="0.4" max="2.2" step="0.1" value="${s.sens}"></label>
        <label><input type="checkbox" name="invert" ${s.invert ? "checked" : ""}> Invert Y</label>
        <label><input type="checkbox" name="bob" ${s.bob ? "checked" : ""}> Head bob</label>
        <label><input type="checkbox" name="music" ${s.music ? "checked" : ""}> Music</label>
      </div>`;
  }

  controlsHtml() {
    return `<p class="keys">WASD move &middot; mouse look (or &larr;/&rarr;) &middot; Space jump &middot; Shift run &middot; E use &middot; click / F zap &middot; Tab checklist &middot; Esc pause<br>
      Touch: left half moves, right half looks. Gamepad works too.</p>`;
  }

  showPanel(html) {
    $("panel").innerHTML = `<div class="window">${html}</div>`;
    $("panel").classList.add("show");
  }

  hidePanel() { $("panel").classList.remove("show"); }

  showTitle() {
    this.state = "title";
    const save = store.get("save", null);
    this.scene.fog.near = 900;
    this.scene.fog.far = 1000;
    this.scene.background.setHex(0x14100c);
    this.camera.position.set(-8, EXT_Y + 17, 64);
    this.camera.lookAt(0, EXT_Y + 15, 0);
    const cont = save?.done?.some(Boolean) || save?.probe;
    this.showPanel(`
      <h1>Enter-a-DOS</h1>
      <p>Uncle Mort's PC won't boot. On the case, next to RESET, there is a TURBO button with a strip of tape on it:
      <i>&ldquo;DO NOT PRESS. &mdash; Mort&rdquo;</i></p>
      <div class="buttons">
        ${cont ? '<button data-act="continue" class="primary">Continue</button><button data-act="new">New game</button>'
               : '<button data-act="new" class="primary turbo">Press TURBO</button>'}
      </div>
      ${this.controlsHtml()}
      ${this.settingsHtml()}`);
  }

  panelAction(act) {
    this.sounds.unlock();
    if (act === "new") {
      store.remove("save");
      this.begin(null);
    } else if (act === "continue") {
      this.begin(store.get("save", null));
    } else if (act === "resume") {
      this.resume();
    } else if (act === "reset") {
      if (confirm("Reset all progress?")) {
        store.remove("save");
        location.reload();
      }
    } else if (act === "explore") {
      this.hidePanel();
      this.state = "play";
      this.setHud(true);
    } else if (act === "again") {
      store.remove("save");
      location.reload();
    }
  }

  pause() {
    if (this.state !== "play") return;
    this.state = "pause";
    this.input.unlock();
    this.input.enabled = false;
    this.showPanel(`
      <h2>Paused</h2>
      <div class="buttons">
        <button data-act="resume" class="primary">Resume</button>
        <button data-act="reset">Reset progress</button>
      </div>
      ${this.controlsHtml()}
      ${this.settingsHtml()}`);
  }

  // Only works from a user gesture; if it is refused, dragging turns the view.
  lockPointer() {
    if (COARSE || this.input.touch) return;
    try { $("scene").requestPointerLock()?.catch?.(() => {}); } catch { /* not supported */ }
  }

  resume() {
    this.hidePanel();
    this.lockPointer();
    this.state = "play";
    this.input.enabled = true;
    this.input.takeLook();
    this.input.endFrame();
    this.last = performance.now();
  }

  showEnd() {
    const m = this.missions;
    this.state = "end";
    this.input.unlock();
    this.input.enabled = false;
    this.setHud(false);
    $("fade").className = "";
    this.showPanel(`
      <div class="titlebar"><span>PANES 1.0</span><span>&#9644; &#9633; &times;</span></div>
      <h2>You won!</h2>
      <p>All five POST lines read OK, VIBE-DOS is starting and PANES plays its chime. Blink has its prompt back.
      Outside, at full size again, you watch Byte bat the ejected floppy off the desk.</p>
      <table>
        <tr><td>Time</td><td>${fmtTime(this.playTime)}</td></tr>
        <tr><td>Bugs patched</td><td>${m.patched}</td></tr>
        <tr><td>Lost screws</td><td>${m.screws.filter(Boolean).length}/${m.screws.length}</td></tr>
        <tr><td>Secrets found</td><td>${Object.values(m.secrets).filter(Boolean).length}/3</td></tr>
      </table>
      <div class="buttons">
        <button data-act="explore" class="primary">Keep exploring</button>
        <button data-act="again">Play again</button>
      </div>`);
  }

  // ---------------------------------------------------------------- start

  begin(save) {
    this.hidePanel();
    this.lockPointer();
    this.playTime = save?.time ?? 0;
    this.missions = new Missions(this, save);
    this.blink = new Blink(this);
    const m = this.missions;
    this.probe.visible = m.probe;
    this.music.setLevel(m.done.slice(1).filter(Boolean).length);
    this.updatePost();
    const fresh = !save;
    this.introT = 0;
    this.introLen = fresh && !REDUCED_MOTION ? 2.6 : 0.6;
    this.fresh = fresh;
    this.state = "intro";
    this.camFrom = this.camera.position.clone();
    $("fade").className = "black";
  }

  enterWorld() {
    const m = this.missions;
    this.scene.fog.near = 18;
    this.scene.fog.far = 125;
    this.scene.background.setHex(FOG);
    this.desk.visible = false;
    this.player.place(this.fresh ? P.start : P.restore[m.rp]);
    this.integrity = MAX_INTEGRITY;
    const o = m.objective();
    if (o) this.blink.jump(o);
    this.state = "play";
    this.input.enabled = true;
    this.input.takeLook();
    this.setHud(true);
    $("fade").className = "";
    this.music.start();
    if (this.fresh) this.say(SAY.intro);
    if (m.done[5]) this.toast("All OK. Feel free to look around.");
  }

  setHud(on) {
    for (const id of ["hud", "post", "cross"]) $(id).hidden = !on;
    if (!on) for (const id of ["prompt", "arrow", "sub", "note"]) $(id).hidden = true;
    $("touch").hidden = !on;
    $("pause").hidden = !on;
  }

  save() {
    if (this.missions) store.set("save", { ...this.missions.data(), time: this.playTime });
  }

  // ---------------------------------------------------------------- messages

  say(what) {
    for (const line of Array.isArray(what) ? what : [what]) if (this.subs.length < 6) this.subs.push(line);
  }

  note(text) {
    $("note").textContent = text;
    $("note").hidden = false;
    this.noteT = Math.max(4, text.length * 0.08);
    this.sounds.note();
  }

  toast(text) {
    $("toast").textContent = text;
    $("toast").classList.add("show");
    this.toastT = 2.6;
  }

  updatePost() {
    const done = this.missions.done.slice(1);
    $("postLines").innerHTML = POST.map((p, i) =>
      `${p.name.padEnd(14, ".")} <b class="${done[i] ? "ok" : "bad"}">${done[i] ? "OK" : p.bad}</b>`).join("\n");
    this.drawPostScreen(done);
  }

  onMission(i) {
    const m = this.missions;
    this.music.setLevel(m.done.slice(1).filter(Boolean).length);
    this.updatePost();
    if (i > 0) {
      this.sounds.post();
      this.toast(`${POST[i - 1].name} ... OK`);
    }
    this.heal();
    this.save();
    if (i === 5) {
      this.music.setFinale(false);
      this.sounds.chime();
      this.say(SAY.end);
      this.endT = 11;
    }
  }

  gotProbe() {
    this.probe.visible = true;
    this.sounds.pick();
    this.save();
  }

  heal() { this.integrity = MAX_INTEGRITY; }

  hurt(fromX, fromZ) {
    if (this.invuln > 0 || this.state !== "play") return;
    const b = this.player.body;
    this.integrity--;
    this.invuln = 1.1;
    const dx = b.x - fromX, dz = b.z - fromZ, d = Math.hypot(dx, dz) || 1;
    this.player.knock((dx / d) * 8, (dz / d) * 8);
    this.sounds.hurt();
    const v = $("hurt");
    v.classList.remove("on");
    void v.offsetWidth;                // restart the fade
    v.classList.add("on");
    if (this.integrity <= 0) this.die();
    else if (this.integrity === 1) this.say(SAY.hurt);
  }

  die() {
    this.state = "dead";
    this.deadT = 2.6;
    this.sounds.gpf();
    this.missions.onDeath();
    $("gpf").hidden = false;
    this.subs.length = 0;
  }

  respawn() {
    $("gpf").hidden = true;
    this.player.place(P.restore[this.missions.rp]);
    this.integrity = MAX_INTEGRITY;
    this.invuln = 2;
    this.state = "play";
  }

  // ---------------------------------------------------------------- play

  viewDir() {
    const b = this.player.body, cp = Math.cos(this.player.pitch);
    return { x: -Math.sin(b.yaw) * cp, y: Math.sin(this.player.pitch), z: -Math.cos(b.yaw) * cp };
  }

  zap() {
    const m = this.missions;
    if (!m.probe || this.player.carrying || this.zapCool > 0) return;
    this.zapCool = 0.32;
    this.sounds.zap();
    const e = this.camera.position, d = this.viewDir();
    let best = null, bestT = ZAP_RANGE;
    const targets = this.bugs.filter((b) => b.alive);
    if (m.moth.alive) targets.push(m.moth);
    for (const t of targets) {
      const c = t.pos ? t.pos : { x: t.x, y: t.y + 0.35, z: t.z };
      const rx = c.x - e.x, ry = c.y - e.y, rz = c.z - e.z;
      const along = rx * d.x + ry * d.y + rz * d.z;
      if (along < 0 || along > bestT) continue;
      const off = Math.hypot(rx - d.x * along, ry - d.y * along, rz - d.z * along);
      // A little aim help that grows with distance.
      if (off > t.radius + 0.25 + along * 0.02) continue;
      if (!this.phys.rayClear(e.x, e.y, e.z, c.x, c.y + 0.2, c.z)) continue;
      best = t;
      bestT = along;
    }
    let len = bestT;
    if (!best) {
      // Stop the beam at the first wall.
      len = 0.5;
      while (len < ZAP_RANGE && !this.phys.solidAt(e.x + d.x * len, e.y + d.y * len, e.z + d.z * len)) len += 0.5;
    }
    const s = Math.sin(this.player.body.yaw), c = Math.cos(this.player.body.yaw);
    const from = new THREE.Vector3(e.x + c * 0.2 - s * 0.5, e.y - 0.2, e.z - s * 0.2 - c * 0.5);
    const to = new THREE.Vector3(e.x + d.x * len, e.y + d.y * len, e.z + d.z * len);
    const dir = to.clone().sub(from);
    const l = dir.length();
    this.beam.position.copy(from).addScaledVector(dir, 0.5);
    this.beam.scale.set(1, l, 1);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.divideScalar(l));
    this.beam.visible = true;
    this.beamT = 0.12;

    if (!best) return;
    const result = best.zap();
    if (best === m.moth) {
      this.sounds.stun();
      m.sayOnce("m5Stun");
    } else if (result === "patch") {
      this.sounds.patch();
      m.bugPatched(best);
    } else {
      this.sounds.stun();
    }
  }

  // The thing Use would act on: something the player stands in, or the best
  // match near the crosshair.
  pickTarget() {
    const e = this.camera.position, d = this.viewDir();
    let best = null, bestScore = -Infinity;
    for (const it of this.missions.items) {
      const label = it.label();
      if (!label) continue;
      if (it.stand) {
        if (it.stand()) return { it, label };
        continue;
      }
      const p = typeof it.p === "function" ? it.p() : it.p;
      const rx = p.x - e.x, ry = p.y - e.y, rz = p.z - e.z;
      const dist = Math.hypot(rx, ry, rz);
      if (dist > USE_RANGE) continue;
      const dot = (rx * d.x + ry * d.y + rz * d.z) / (dist || 1);
      if (dist > 1.3 && dot < 0.86) continue;
      const score = dot - dist * 0.06;
      if (score > bestScore) { bestScore = score; best = { it, label }; }
    }
    return best;
  }

  updateDistrict(dt) {
    const b = this.player.body;
    const d = DISTRICTS.find((r) => b.x >= r.x0 && b.x <= r.x1 && b.z >= r.z0 && b.z <= r.z1 && (r.y0 === undefined || b.y >= r.y0));
    const name = d ? d.name : "";
    if (name !== this.district) {
      this.district = name;
      if (name) {
        $("district").textContent = name;
        $("district").classList.add("show");
        this.districtT = 2.4;
      }
    }
    if (this.districtT > 0 && (this.districtT -= dt) <= 0) $("district").classList.remove("show");
  }

  updateArrow(o) {
    const el = $("arrow");
    if (!o) { el.hidden = true; return; }
    const v = this.blink.pos.clone().applyMatrix4(this.camera.matrixWorldInverse);
    const ndc = this.blink.pos.clone().project(this.camera);
    const onScreen = v.z < 0 && Math.abs(ndc.x) < 0.92 && Math.abs(ndc.y) < 0.88;
    el.hidden = onScreen;
    if (onScreen) return;
    let dx = v.x, dy = v.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const r = Math.min(innerWidth, innerHeight) / 2 - 56;
    el.style.transform = `translate(${dx * r}px, ${-dy * r}px) rotate(${Math.atan2(dx, dy)}rad)`;
  }

  updateHud(dt, o) {
    const m = this.missions;
    let pips = "";
    for (let i = 0; i < MAX_INTEGRITY; i++) pips += `<i class="${i < this.integrity ? "on" : ""}"></i>`;
    if (pips !== this.pipsHtml) $("pips").innerHTML = this.pipsHtml = pips;
    const cur = m.done.findIndex((d) => !d);
    const text = o ? `${MISSION_TITLES[cur]}: ${o.text}` : "All systems OK";
    if (text !== this.objText) $("objective").textContent = this.objText = text;
    const showTemp = m.unlocked4 && !m.done[5] && this.district === "CPU CITADEL";
    $("temp").hidden = !showTemp;
    if (showTemp) $("temp").textContent = `CPU ${Math.round(m.temp)} °C`;

    // Subtitles: one line at a time.
    if (this.subT > 0) {
      this.subT -= dt;
      if (this.subT <= 0) $("sub").hidden = true;
    } else if (this.subs.length) {
      const line = this.subs.shift();
      $("subText").textContent = line;
      $("sub").hidden = false;
      this.subT = Math.max(2.4, line.length * 0.062);
    }
    if (this.noteT > 0 && (this.noteT -= dt) <= 0) $("note").hidden = true;
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) $("toast").classList.remove("show");
  }

  update(dt) {
    const input = this.input, p = this.player, m = this.missions;
    input.poll(dt);
    if (input.consume("pause")) { this.pause(); return; }
    if (input.consume("mute")) this.toggleMute();
    if (input.consume("post")) $("post").classList.toggle("small");

    this.playTime += dt;
    this.invuln -= dt;
    this.zapCool -= dt;
    p.jumped = false;
    p.update(dt, input, this.settings);
    if (p.jumped) this.sounds.jump();
    if (p.landed) this.sounds.land();
    if (p.body.y < -18) {
      // Fell off the board: back to the last solid ground.
      p.place(p.safe || P.restore[m.rp]);
      m.onDeath();
    }
    const eye = p.eye(this.settings.bob && !REDUCED_MOTION && p.body.onGround);
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(p.pitch, p.body.yaw, 0);
    this.camera.updateMatrixWorld();

    this.updateDistrict(dt);
    m.update(dt);
    for (const b of this.bugs) b.update(dt);
    if (this.bugs.length > 40) this.bugs = this.bugs.filter((b) => b.state !== "gone");

    if (input.consume("zap") || input.held.has("zap")) this.zap();
    if (this.beamT > 0 && (this.beamT -= dt) <= 0) this.beam.visible = false;
    this.probe.visible = m.probe && !p.carrying;

    this.target = this.pickTarget();
    const use = input.consume("use");
    if (use && !$("note").hidden) {
      $("note").hidden = true;
      this.noteT = 0;
    } else if (use && this.target) {
      this.target.it.use();
    }
    $("prompt").hidden = !this.target;
    if (this.target) $("promptText").textContent = this.target.label;
    $("useBtn").classList.toggle("ready", !!this.target);

    const o = m.objective();
    this.blink.mesh.visible = !!o;
    this.blink.update(dt, o, p.body.yaw);
    this.updateArrow(o);
    this.updateHud(dt, o);

    if (this.endT > 0 && (this.endT -= dt) <= 0) {
      $("fade").className = "white";
      this.endFade = 1.2;
    }
    if (this.endFade > 0 && (this.endFade -= dt) <= 0) this.showEnd();
    input.endFrame();
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min((now - this.last) / 1000, 1 / 20);
    this.last = now;
    this.time += dt;

    if (this.state === "title") {
      if (!REDUCED_MOTION) this.camera.position.x = -8 + Math.sin(this.time * 0.25) * 3;
      this.camera.lookAt(0, EXT_Y + 15, 0);
    } else if (this.state === "intro") {
      // Shrink: fly into the floppy slot while the picture fades to black.
      this.introT += dt;
      const k = Math.min(1, this.introT / this.introLen), e = k * k * (3 - 2 * k);
      if (this.introLen > 1) {
        this.camera.position.lerpVectors(this.camFrom, new THREE.Vector3(SLOT_VIEW.x, EXT_Y + SLOT_VIEW.y, SLOT_VIEW.z + 1.5), e);
        this.camera.lookAt(SLOT_VIEW.x, EXT_Y + SLOT_VIEW.y, SLOT_VIEW.z - 4);
      }
      if (k >= 1) this.enterWorld();
    } else if (this.state === "play") {
      this.update(dt);
    } else if (this.state === "dead") {
      this.deadT -= dt;
      if (this.deadT <= 0) this.respawn();
    }
    if (this.missions && this.state !== "play" && this.state !== "intro") this.input.endFrame();
    this.music.tick();
    this.renderer.render(this.scene, this.camera);
  }

  // For testing (?debug): mark missions below n as done and reload.
  warp(n) {
    const done = [0, 1, 2, 3, 4, 5].map((i) => i < n);
    store.set("save", { done, probe: true, rp: n >= 4 ? 5 : n >= 1 ? 1 : 0, time: 0 });
    location.reload();
  }
}

const game = new Game();
if (new URLSearchParams(location.search).has("debug")) window.game = game;
