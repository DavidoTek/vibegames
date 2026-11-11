// The six missions (prologue + five POST lines), their props, the things the
// player can Use, and the extras. Progress that is saved: finished missions,
// the probe, screws, secrets and the restore point. Everything inside a
// mission starts over after a reload.

import {
  THREE, panel, place, ledModel, screwModel, clusterModel, hairModel, tuxModel, eyeModel,
} from "./props.js";
import { P, BAY_Y } from "./level.js";
import { Bug, Moth } from "./entities.js";
import { SAY, NOTES, OBJECTIVES } from "./story.js";

const TILE = P.tile;
const inRect = (p, r) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1;
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const CAT = [
  "................",
  "..##........##..",
  "..###......###..",
  "..####....####..",
  "..############..",
  "..############..",
  "..##oo####oo##..",
  "..##oo####oo##..",
  "..############..",
  "..#####nn#####..",
  "..####.##.####..",
  "...###....###...",
  "....########....",
  ".....######.....",
  "................",
  "................",
];

export class Missions {
  constructor(game, save) {
    this.game = game;
    this.done = save?.done?.slice() ?? [false, false, false, false, false, false];
    this.probe = save?.probe ?? false;
    this.screws = save?.screws?.slice() ?? P.screws.map(() => false);
    this.secrets = { tux: false, pads: false, scribble: false, ...save?.secrets };
    this.rp = save?.rp ?? 0;
    this.patched = save?.patched ?? 0;
    this.items = [];                   // things the player can Use
    this.groups = {};                  // bugs per mission
    this.said = new Set();
    this.t = 0;
    this.build();
  }

  data() {
    return { done: this.done, probe: this.probe, screws: this.screws, secrets: this.secrets, rp: this.rp, patched: this.patched };
  }

  // ---------------------------------------------------------------- helpers

  item(p, label, use, stand) { this.items.push({ p, label, use, stand }); }

  once(key) {
    if (this.said.has(key)) return false;
    this.said.add(key);
    return true;
  }

  sayOnce(key) { if (this.once(key)) this.game.say(SAY[key]); }

  spawn(group, zone, n, y) {
    const list = (this.groups[group] ??= []);
    for (let i = 0; i < n; i++) {
      const x = zone.x0 + Math.random() * (zone.x1 - zone.x0), z = zone.z0 + Math.random() * (zone.z1 - zone.z0);
      const b = new Bug(this.game, x, y, z, zone);
      list.push(b);
      this.game.bugs.push(b);
    }
  }

  left(group) { return (this.groups[group] || []).filter((b) => b.alive).length; }

  setGate(name, open) {
    this.game.level.byName(name).off = open;
    this.game.world.dyn[name].visible = !open;
  }

  finish(i) {
    if (this.done[i]) return;
    this.done[i] = true;
    this.game.onMission(i);
  }

  get unlocked4() { return this.done[1] && this.done[2] && this.done[3]; }
  get finale() { return this.done[4] && !this.done[5]; }

  // ---------------------------------------------------------------- build

  build() {
    const g = this.game, scene = g.scene;
    this.setGate("gateFloppy", this.done[0]);
    this.setGate("gateHdd", this.done[1]);

    // Restore points
    this.rpMeshes = P.restore.map((r) => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.1, 0.06, 24),
        new THREE.MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.55 }),
      );
      m.position.set(r.x, r.y + 0.04, r.z);
      scene.add(m);
      return m;
    });

    this.buildPrologue();
    this.buildClock();
    this.buildRam();
    this.buildDisk();
    this.buildFan();
    this.buildFinale();
    this.buildExtras();
  }

  buildPrologue() {
    const g = this.game;
    this.item(P.note0, () => "Read Mort's note", () => { this.readNote0 = true; g.note(NOTES.mort0); });
    if (!this.probe) {
      this.probeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.9), new THREE.MeshLambertMaterial({ color: 0xc23b2e, emissive: 0x401008 }));
      this.probeMesh.position.set(P.probe.x, P.probe.y - 0.3, P.probe.z);
      g.scene.add(this.probeMesh);
      this.item(P.probe, () => (this.probe ? null : "Take the debug probe"), () => {
        this.probe = true;
        g.scene.remove(this.probeMesh);
        g.gotProbe();
        g.say(SAY.gotProbe);
      });
    }
    if (!this.done[0]) this.spawn("m0", P.zoneM0, 1, BAY_Y);

    // Write-protect tab: slides between "protected" and "writable".
    this.tabOpen = false;
    this.tabMesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 1.2), new THREE.MeshLambertMaterial({ color: 0xd8dde4 }));
    this.tabMesh.position.set(P.tab.x - 0.45, P.tab.y - 0.1, P.tab.z);
    g.scene.add(this.tabMesh);
    this.item(P.tab, () => (!this.finale ? "Write-protect tab" : this.tabOpen ? "Close the write-protect tab" : "Open the write-protect tab"), () => {
      if (!this.finale) { g.say(SAY.tabEarly); return; }
      this.tabOpen = !this.tabOpen;
      g.sounds.click();
      g.say(this.tabOpen ? SAY.m5TabOpen : SAY.m5TabClosed);
    });

    this.leverMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.4, 0.3), new THREE.MeshLambertMaterial({ color: 0xd0393b }));
    this.leverMesh.position.set(P.lever.x, P.lever.y + 0.5, P.lever.z);
    this.leverMesh.rotation.z = 0.5;
    g.scene.add(this.leverMesh);
    this.driveLed = ledModel(0x4dff88);
    this.driveLed.scale.setScalar(0.35);
    this.driveLed.position.set(P.lever.x - 3, P.lever.y + 1.4, 104.6);
    g.scene.add(this.driveLed);
    this.item(P.lever, () => "Pull the drive lever", () => this.pullLever());
    this.item(P.eject, () => "Press EJECT", () => this.pressEject());
  }

  // -------------------------------------------------- mission 1: CMOS clock

  buildClock() {
    const g = this.game;
    this.clip = this.done[1];
    this.date = this.done[1] ? P.date.slice() : [1, 1, 80];
    this.clock = panel(3.6, 1.7, 256, 120);
    place(this.clock.mesh, P.clock, "s");
    g.scene.add(this.clock.mesh);
    this.drawClock();
    if (!this.done[1]) this.spawn("m1", P.zoneM1, 3, 0);

    this.clipMesh = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.3, 0.25), new THREE.MeshLambertMaterial({ color: 0xd0393b }));
    this.clipMesh.position.set(P.clip.x, P.clip.y + 0.4, P.clip.z);
    this.clipMesh.rotation.z = this.clip ? -0.6 : 0.6;
    g.scene.add(this.clipMesh);

    this.item(P.sticker, () => "Read the sticker", () => g.note(NOTES.sticker));
    this.item(P.clip, () => (this.clip ? null : "Pull the battery clip lever"), () => {
      if (!this.done[0]) return;
      if (this.left("m1") > 0) { g.say(SAY.m1Bugs); return; }
      this.clip = true;
      this.clipMesh.rotation.z = -0.6;
      g.sounds.power();
      g.say([SAY.m1Clip, SAY.m1Hint]);
      this.drawClock();
    });
    const names = ["Month", "Day", "Year"], lo = [1, 1, 80], hi = [12, 31, 99];
    P.dials.forEach((d, i) => {
      this.item(d, () => (this.done[1] ? null : `${names[i]} dial: +1`), () => {
        if (!this.clip) { g.say(SAY.m1NoPower); return; }
        this.date[i] = this.date[i] >= hi[i] ? lo[i] : this.date[i] + 1;
        g.sounds.dial();
        this.drawClock();
      });
    });
    this.item(P.setLever, () => (this.done[1] ? null : "Set the clock"), () => {
      if (!this.clip) { g.say(SAY.m1NoPower); return; }
      if (this.date.every((v, i) => v === P.date[i])) {
        this.finish(1);
        this.setGate("gateHdd", true);
        this.grids.forEach((gr) => this.paintGrid(gr));    // the first bit floor gets power
        g.say(SAY.m1Done);
      } else {
        g.sounds.error();
        g.say(SAY.m1Wrong);
      }
    });
  }

  drawClock() {
    const { g, w, h } = this.clock;
    const two = (n) => String(n).padStart(2, "0");
    g.fillStyle = "#0a0704";
    g.fillRect(0, 0, w, h);
    g.textAlign = "center";
    g.font = "bold 44px 'DejaVu Sans Mono', monospace";
    g.fillStyle = this.clip ? "#ffb347" : "#4a2f10";
    g.fillText(this.date.map(two).join("-"), w / 2, 52);
    let time = "00:00";
    if (this.done[1]) {
      const s = Math.floor(this.t);
      time = `${two(12 + Math.floor(s / 3600) % 12)}:${two(Math.floor(s / 60) % 60)}`;
    }
    g.fillText(time, w / 2, 104);
    this.clock.update();
    this.clockShown = Math.floor(this.t / 60);
  }

  // -------------------------------------------------- mission 2: parity

  buildRam() {
    const g = this.game;
    this.round = this.done[2] ? 3 : 0;
    this.grids = P.grids.map((spec, i) => this.makeGrid(spec, i));
    this.grids.forEach((gr) => this.paintGrid(gr));
    this.item(P.noteRam, () => "Read Mort's note", () => g.note(NOTES.ram));
    this.liftT = 0;
    this.lightSimms(this.done[2]);
  }

  makeGrid(spec, index) {
    const n = spec.n, g = this.game;
    const bits = [];
    for (let r = 0; r < n; r++) {
      bits.push([]);
      for (let c = 0; c < n; c++) bits[r].push(Math.random() < 0.5 ? 1 : 0);
    }
    // Last row and column are the parity bits: every row and column sums to even.
    for (let r = 0; r < n - 1; r++) bits[r][n - 1] = bits[r].slice(0, n - 1).reduce((a, b) => a ^ b, 0);
    for (let c = 0; c < n; c++) {
      let p = 0;
      for (let r = 0; r < n - 1; r++) p ^= bits[r][c];
      bits[n - 1][c] = p;
    }
    if (!this.done[2]) {
      // Flip one bit, or two in different rows and columns for the last bank.
      const r = Math.floor(Math.random() * n), c = Math.floor(Math.random() * n);
      bits[r][c] ^= 1;
      if (index === 2) bits[(r + 1 + Math.floor(Math.random() * (n - 1))) % n][(c + 1 + Math.floor(Math.random() * (n - 1))) % n] ^= 1;
    }
    const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE * 0.9, 0.1, TILE * 0.9), new THREE.MeshBasicMaterial({ color: 0xffffff }), n * n);
    const m4 = new THREE.Matrix4();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        tiles.setMatrixAt(r * n + c, m4.makeTranslation(spec.x + (c + 0.5) * TILE, 0.05, spec.z + (r + 0.5) * TILE));
      }
    }
    g.scene.add(tiles);
    const lamp = (x, z) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0x333333 }));
      m.position.set(x, 1, z);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1, 0.12), new THREE.MeshLambertMaterial({ color: 0x636a74 }));
      post.position.set(x, 0.5, z);
      g.scene.add(m, post);
      return m;
    };
    const rows = [], cols = [];
    for (let i = 0; i < n; i++) {
      rows.push(lamp(spec.x - 1, spec.z + (i + 0.5) * TILE));
      cols.push(lamp(spec.x + (i + 0.5) * TILE, spec.z + n * TILE + 1));
    }
    const grid = { ...spec, index, bits, tiles, rows, cols, rect: { x0: spec.x, x1: spec.x + n * TILE, z0: spec.z, z1: spec.z + n * TILE } };
    const tileAt = () => {
      const p = g.player.body;
      if (!inRect(p, grid.rect) || p.y > 0.5) return null;
      return [Math.min(n - 1, Math.floor((p.z - spec.z) / TILE)), Math.min(n - 1, Math.floor((p.x - spec.x) / TILE))];
    };
    this.item(
      () => g.player.body,
      () => (this.round > index ? null : this.round === index && this.done[1] ? "Flip this bit" : "Bit floor (no power)"),
      () => {
        if (!this.done[1]) { g.say(SAY.m2Locked); return; }
        if (this.round !== index) return;
        const [r, c] = tileAt();
        bits[r][c] ^= 1;
        g.sounds.dial();
        this.paintGrid(grid);
      },
      () => tileAt() !== null,
    );
    return grid;
  }

  parity(grid) {
    const n = grid.n, rows = [], cols = [];
    for (let i = 0; i < n; i++) {
      let r = 0, c = 0;
      for (let k = 0; k < n; k++) { r ^= grid.bits[i][k]; c ^= grid.bits[k][i]; }
      rows.push(r);
      cols.push(c);
    }
    return { rows, cols, ok: rows.every((v) => !v) && cols.every((v) => !v) };
  }

  paintGrid(grid) {
    const n = grid.n, live = this.round === grid.index && this.done[1], solved = this.round > grid.index;
    const col = new THREE.Color();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const on = grid.bits[r][c];
        col.setHex(live ? (on ? 0xffb347 : 0x3a2c14) : solved ? (on ? 0x4dc878 : 0x143a24) : on ? 0x6a5a3c : 0x24201a);
        grid.tiles.setColorAt(r * n + c, col);
      }
    }
    grid.tiles.instanceColor.needsUpdate = true;
    const p = this.parity(grid);
    for (let i = 0; i < n; i++) {
      grid.rows[i].material.color.setHex(!live && !solved ? 0x333333 : p.rows[i] ? 0xff4a3c : 0x4dff88);
      grid.cols[i].material.color.setHex(!live && !solved ? 0x333333 : p.cols[i] ? 0xff4a3c : 0x4dff88);
    }
  }

  lightSimms(on) {
    for (let i = 0; i < 4; i++) this.game.world.dyn["simm" + i].material.emissive.setHex(on ? 0x0c4a26 : 0);
  }

  updateRam(dt) {
    const g = this.game, p = g.player.body;
    // The lift waits at each end, then travels.
    const L = P.lift, solid = g.level.byName("lift");
    this.liftT = (this.liftT + dt) % 11;
    const t = this.liftT;
    const k = t < 2.5 ? 0 : t < 5.5 ? (t - 2.5) / 3 : t < 8 ? 1 : 1 - (t - 8) / 3;
    solid.y1 = L.low + (L.high - L.low) * k;
    solid.y0 = solid.y1 - 0.4;
    g.world.dyn.lift.position.y = solid.y1 - 0.2;
    if (p.ground === solid) this.sayOnce("m2Lift");

    if (!this.done[1] || this.done[2]) return;
    const grid = this.grids[this.round];
    if (this.round === 1) {
      for (const b of this.groups.m2 || []) {
        if (b.state !== "walk") continue;
        const tile = Math.floor((b.z - grid.z) / TILE) * grid.n + Math.floor((b.x - grid.x) / TILE);
        if (b.tile !== undefined && b.tile !== tile && tile >= 0 && tile < grid.n * grid.n) {
          grid.bits[Math.floor(tile / grid.n)][tile % grid.n] ^= 1;
          this.paintGrid(grid);
        }
        b.tile = tile;
      }
    }
    if (this.parity(grid).ok && (this.round !== 1 || this.left("m2") === 0)) {
      this.round++;
      g.sounds.good();
      this.grids.forEach((gr) => this.paintGrid(gr));
      if (this.round === 1) {
        const r = this.grids[1].rect;
        this.spawn("m2", { x0: r.x0 + 0.4, x1: r.x1 - 0.4, z0: r.z0 + 0.4, z1: r.z1 - 0.4 }, 2, 0);
        g.say(SAY.m2Round2);
      } else if (this.round === 2) {
        g.say(SAY.m2Round3);
      } else {
        this.lightSimms(true);
        this.finish(2);
        g.say(SAY.m2Done);
      }
    }
  }

  // -------------------------------------------------- mission 3: hard disk

  buildDisk() {
    const g = this.game, Y = BAY_Y;
    this.platterAng = 0;
    this.armT = 0;
    this.armCool = 0;
    this.carry = null;
    this.clusters = [[0.6, 7], [2.3, 11], [3.9, 6], [5.2, 12]].map(([a, r], i) => {
      const mesh = clusterModel(i + 1);
      g.scene.add(mesh);
      return { a, r, mesh, state: this.done[3] ? "placed" : "platter" };
    });
    if (!this.done[3]) this.spawn("m3", P.zoneM3, 2, Y + 1);

    this.arm = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.BoxGeometry(P.armLen, 0.5, 1.4), new THREE.MeshLambertMaterial({ color: 0x8a919c }));
    beam.position.x = P.armLen / 2;
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 2), new THREE.MeshLambertMaterial({ color: 0x23252b }));
    head.position.x = P.armLen;
    this.arm.add(beam, head);
    this.arm.position.set(P.armPivot.x, Y + 2, P.armPivot.z);
    g.scene.add(this.arm);

    this.sector = panel(8, 8, 128, 128);
    place(this.sector.mesh, P.sector, "e");
    g.scene.add(this.sector.mesh);
    this.drawSector();

    this.clusters.forEach((c, i) => {
      this.item(() => c.mesh.position, () => (c.state === "platter" && this.carry === null ? `Pick up cluster ${i + 1}` : null), () => {
        if (this.carry !== null) return;
        c.state = "carried";
        this.carry = i;
        g.player.carrying = true;
        g.camera.add(c.mesh);
        c.mesh.position.set(0, -0.55, -1.5);
        c.mesh.rotation.set(0, 0, 0);
        g.sounds.pick();
      });
    });
    P.slots.forEach((s, i) => {
      this.item(s, () => (this.carry === null || this.done[3] ? null : this.carry === i ? `Place cluster ${i + 1}` : `Slot ${i + 1}`), () => {
        if (this.carry !== i) { g.sounds.error(); g.say(SAY.m3Wrong); return; }
        const c = this.clusters[i];
        c.state = "placed";
        this.carry = null;
        g.player.carrying = false;
        g.scene.add(c.mesh);
        g.sounds.good();
        this.drawSector();
        if (this.clusters.every((k) => k.state === "placed")) {
          this.finish(3);
          g.say(SAY.m3Done);
        } else {
          g.say(SAY.m3Placed);
        }
      });
    });
    this.item(P.noteHdd, () => "Read Mort's note", () => g.note(NOTES.hdd));

    const tux = tuxModel();
    tux.position.set(P.tux.x, P.tux.y, P.tux.z);
    tux.rotation.y = 1.2;
    g.scene.add(tux);
  }

  drawSector() {
    const { g, w } = this.sector, px = w / 16;
    const colors = { ".": "#12646a", "#": "#e8963c", o: "#7dff8a", n: "#ff8fb0" };
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const q = (y >> 3) * 2 + (x >> 3);
        if (this.clusters[q].state === "placed") g.fillStyle = colors[CAT[y][x]];
        else g.fillStyle = ((x * 7 + y * 13) % 5 < 2) ? "#2a2f38" : "#14171c";
        g.fillRect(x * px, y * px, px, px);
      }
    }
    this.sector.update();
  }

  dropCluster() {
    if (this.carry === null) return;
    const g = this.game, c = this.clusters[this.carry], p = g.player.body;
    const dx = p.x - P.platter.x, dz = p.z - P.platter.z;
    c.r = Math.min(13, Math.max(4, Math.hypot(dx, dz)));
    c.a = Math.atan2(dz, dx) + this.platterAng;
    c.state = "platter";
    g.scene.add(c.mesh);
    this.carry = null;
    g.player.carrying = false;
  }

  updateDisk(dt) {
    const g = this.game, p = g.player.body, Y = BAY_Y;
    const platter = g.level.byName("platter");
    this.platterAng += platter.spin * dt;
    g.world.dyn.platter.rotation.y = this.platterAng;
    this.clusters.forEach((c, i) => {
      if (c.state === "platter") {
        const th = c.a - this.platterAng;
        c.mesh.position.set(P.platter.x + Math.cos(th) * c.r, Y + 1.6 + Math.sin(this.t * 2 + i) * 0.1, P.platter.z + Math.sin(th) * c.r);
        c.mesh.rotation.y = -th;
      } else if (c.state === "placed") {
        c.mesh.position.set(P.slots[i].x, Y + 1.45, P.slots[i].z);
        c.mesh.rotation.set(0, 0, 0);
      }
    });

    // The head arm sweeps over the platter until the drive is fixed.
    const base = Math.atan2(P.platter.z - P.armPivot.z, P.platter.x - P.armPivot.x);
    if (!this.done[3]) this.armT += dt;
    const ang = this.done[3] ? base + 0.62 : base + Math.sin(this.armT * 0.5) * 0.45;
    this.arm.rotation.y = -ang;
    this.armCool -= dt;
    if (!this.done[3] && p.y > Y + 0.5 && p.y < Y + 2.5) {
      const ax = Math.cos(ang), az = Math.sin(ang);
      const rx = p.x - P.armPivot.x, rz = p.z - P.armPivot.z;
      const along = rx * ax + rz * az, side = rx * -az + rz * ax;
      if (along > 3 && along < P.armLen + 1 && Math.abs(side) < 1.2) {
        const s = side >= 0 ? 1 : -1;
        g.player.knock(-az * s * 11, ax * s * 11);
        if (this.armCool <= 0) {
          this.armCool = 3;
          g.sounds.thud();
          g.say(SAY.m3Arm);
          this.dropCluster();
        }
      }
    }
    if (!this.secrets.tux && dist3(p, P.tux) < 3) this.secret("tux", SAY.tux);
  }

  // -------------------------------------------------- mission 4: CPU fan

  buildFan() {
    const g = this.game;
    this.temp = this.done[4] ? 38 : 71;
    this.heat = 0;
    this.clumps = P.clumps.map((c, i) => {
      const mesh = hairModel();
      mesh.position.set(c.x, c.y, c.z);
      mesh.visible = !this.done[4];
      g.scene.add(mesh);
      const clump = { ...c, mesh, pulled: this.done[4] };
      this.item(c, () => (clump.pulled ? null : "Pull out the cat hair"), () => {
        if (!this.unlocked4) { g.say(SAY.m4Locked); return; }
        clump.pulled = true;
        mesh.visible = false;
        g.sounds.pick();
        if (this.clumps.every((k) => k.pulled)) {
          this.finish(4);
          g.say(SAY.m4Done);
          this.eye.visible = true;
          this.mothDelay = 7;
        } else {
          g.say(SAY.m4Clump);
        }
      });
      return clump;
    });
    if (!this.done[4]) this.spawn("m4", P.zoneM4, 2, 8);
    this.eye = eyeModel();
    this.eye.position.set(P.eye.x, P.eye.y, P.eye.z);
    this.eye.visible = this.done[4];
    g.scene.add(this.eye);
    g.level.byName("fan").spin = this.done[4] ? 0.6 : 0;
  }

  updateFan(dt) {
    const g = this.game, p = g.player.body;
    const fan = g.level.byName("fan");
    if (this.done[4]) {
      fan.spin = 0.6;
      g.world.dyn.blades.rotation.y += dt * 4;
      this.temp += (38 - this.temp) * Math.min(1, dt * 0.4);
    } else if (this.unlocked4) {
      this.temp = Math.min(94, this.temp + dt * 0.06);
      const hot = p.onGround && P.hotFins.some((f) => inRect(p, f) && Math.abs(p.y - f.y) < 0.2);
      this.heat = hot ? this.heat + dt : Math.max(0, this.heat - dt * 2);
      if (this.heat > 2.2) {
        this.heat = 0;
        g.hurt(p.x, p.z + 1);
        g.say(SAY.m4Hot);
      }
    }
    if (this.eye.visible) {
      // Byte follows the player with a lazy pupil.
      this.eye.userData.pupil.position.x = Math.max(-3, Math.min(3, (p.x - P.eye.x) * 0.12));
      this.eye.userData.pupil.position.y = Math.max(-2, Math.min(1, (p.y - P.eye.y) * 0.1));
    }
  }

  // -------------------------------------------------- mission 5: the Moth

  buildFinale() {
    const g = this.game;
    this.moth = new Moth(g, P.cpu);
    this.mothAt = 0;                   // 0 = CPU, 1..3 = LED
    this.mothTo = null;
    this.lit = -1;
    this.written = false;
    this.larvaT = 0;
    this.leds = P.leds.map((l, i) => {
      const m = ledModel(l.color);
      m.position.set(l.x, l.y + 5.2, l.z);
      g.scene.add(m);
      this.item({ x: l.x, y: l.y + 1.5, z: l.z }, () => (this.finale && this.lit !== i && !this.written ? `Switch on the ${l.name} LED` : null), () => {
        if (this.mothAt !== i || this.mothTo !== null) { g.say(SAY.m5Far); return; }
        this.lit = i;
        this.mothTo = i + 1;
        this.moth.flyTo(this.ledCentre(i));
        g.sounds.click();
        g.say([SAY.m5Fly, SAY.m5Led2, SAY.m5Led3][i]);
      });
      return m;
    });
    if (this.finale) this.startFinale(true);
  }

  ledCentre(i) {
    const l = P.leds[i];
    return { x: l.x, y: l.y + 8, z: l.z };
  }

  startFinale(quiet) {
    this.moth.appear();
    this.game.sounds.moth();
    this.game.music.setFinale(true);
    if (!quiet) this.game.say(SAY.m5Start);
    else this.game.say(SAY.m5Start[2]);
  }

  pullLever() {
    const g = this.game;
    if (!this.finale) { g.say(SAY.leverEarly); return; }
    if (this.written) return;
    this.leverMesh.rotation.z = -this.leverMesh.rotation.z;
    g.sounds.seek();
    if (this.mothAt !== 3 || this.mothTo !== null) { g.say(SAY.m5Nothing); return; }
    if (this.tabOpen) {
      this.written = true;
      this.lit = -1;
      this.moth.sinkInto(P.shutter);
      g.say(SAY.m5Written);
    } else {
      g.sounds.error();
      g.say(SAY.m5Protected);
      this.lit = 0;
      this.mothTo = 1;
      this.moth.flyTo(this.ledCentre(0));
    }
  }

  pressEject() {
    const g = this.game;
    if (!this.finale || !this.written) { g.say(SAY.ejectEarly); return; }
    if (this.moth.state !== "written") return;
    if (this.tabOpen) { g.say(SAY.m5EjectOpen); return; }
    for (const b of g.bugs) if (b.larva) b.remove();
    this.finish(5);
  }

  updateFinale(dt) {
    const g = this.game;
    this.leds.forEach((m, i) => m.userData.set(this.done[5] || this.lit === i));
    this.driveLed.userData.set(this.done[5] || this.written);
    if (this.mothDelay > 0) {
      this.mothDelay -= dt;
      if (this.mothDelay <= 0) this.startFinale(false);
    }
    this.moth.update(dt);
    if (!this.finale || this.written) return;
    const moth = this.moth;
    if (moth.state === "circle" && this.mothTo !== null) {
      this.mothAt = this.mothTo;
      this.mothTo = null;
    }
    if (moth.state === "circle" && this.mothAt > 0 && moth.bored > 26) {
      moth.flyTo(P.cpu);
      this.mothTo = 0;
      this.lit = -1;
      g.say(SAY.m5Bored);
    }
    // Away from the CPU it sheds larvae.
    if (moth.alive && (this.mothAt > 0 || this.mothTo !== null)) {
      this.larvaT += dt;
      const alive = g.bugs.filter((b) => b.larva && b.alive).length;
      if (this.larvaT > 7 && alive < 3) {
        this.larvaT = 0;
        const h = g.phys.heightAt(moth.pos.x, moth.pos.z, moth.pos.y);
        if (h > -Infinity) g.bugs.push(new Bug(g, moth.pos.x, h, moth.pos.z, null, true));
      }
    }
  }

  // -------------------------------------------------- extras

  buildExtras() {
    const g = this.game;
    this.screwMeshes = P.screws.map((s, i) => {
      if (this.screws[i]) return null;
      const m = screwModel();
      m.position.set(s.x, s.y + 0.8, s.z);
      g.scene.add(m);
      return m;
    });
    this.padNext = 0;
    this.padOn = -1;
    this.item(P.scribble, () => "Read the scribble", () => {
      g.note(NOTES.scribble);
      if (!this.secrets.scribble) this.secret("scribble");
    });
  }

  secret(key, line) {
    this.secrets[key] = true;
    this.game.sounds.secret();
    this.game.toast(`Secret found (${Object.values(this.secrets).filter(Boolean).length}/3)`);
    if (line) this.game.say(line);
    this.game.save();
  }

  updateExtras(dt) {
    const g = this.game, p = g.player.body;
    this.screwMeshes.forEach((m, i) => {
      if (!m || this.screws[i]) return;
      m.rotation.y += dt * 2;
      if (Math.hypot(p.x - m.position.x, p.y + 0.8 - m.position.y, p.z - m.position.z) < 1.4) {
        this.screws[i] = true;
        g.scene.remove(m);
        g.sounds.screw();
        const n = this.screws.filter(Boolean).length;
        g.toast(`Lost screw ${n}/${this.screws.length}`);
        if (n === this.screws.length) g.say(SAY.screwAll);
        g.save();
      }
    });

    // Sound card pads: each plays a note; left to right is the PANES chime.
    const on = p.y < 0.5 ? P.pads.findIndex((pad) => Math.hypot(p.x - pad.x, p.z - pad.z) < 1.3) : -1;
    if (on !== this.padOn) {
      this.padOn = on;
      if (on >= 0) {
        g.sounds.pad(on);
        this.padNext = on === this.padNext ? this.padNext + 1 : on === 0 ? 1 : 0;
        if (this.padNext === P.pads.length) {
          this.padNext = 0;
          if (!this.secrets.pads) this.secret("pads", SAY.secretPads);
        }
      }
    }

    P.restore.forEach((r, i) => {
      this.rpMeshes[i].material.opacity = i === this.rp ? 0.9 : 0.45;
      if (i !== this.rp && Math.abs(p.y - r.y) < 1 && Math.hypot(p.x - r.x, p.z - r.z) < 1.6) {
        this.rp = i;
        g.heal();
        g.sounds.restore();
        g.toast("Restore point saved");
        g.save();
      }
    });
  }

  // ---------------------------------------------------------------- frame

  update(dt) {
    const g = this.game, p = g.player.body;
    this.t += dt;

    // Prologue
    if (!this.done[0]) {
      const gateOpen = g.level.byName("gateFloppy").off;
      if (!gateOpen && this.probe && this.left("m0") === 0) {
        this.setGate("gateFloppy", true);
        g.sounds.good();
        g.say(SAY.gateOpen);
      }
      if (!this.probe && p.z < 76 && p.y > BAY_Y - 1) this.sayOnce("needProbe");
      if (gateOpen && p.y < 1) {
        this.finish(0);
        g.say(SAY.board);
      }
    }
    const where = g.district;
    if (this.done[0] && !this.done[1] && where === "BIOS QUARTER") this.sayOnce("m1Start");
    if (this.done[1] && !this.done[2] && where === "RAM ROW") this.sayOnce("m2Start");
    if (this.done[1] && !this.done[3] && where === "DRIVE C:") this.sayOnce("m3Start");
    if (this.unlocked4 && !this.done[4] && where === "CPU CITADEL") this.sayOnce("m4Start");

    if (this.done[1] && Math.floor(this.t / 60) !== this.clockShown) this.drawClock();
    this.updateRam(dt);
    this.updateDisk(dt);
    this.updateFan(dt);
    this.updateFinale(dt);
    this.updateExtras(dt);
  }

  onDeath() { this.dropCluster(); }

  bugPatched(bug) {
    this.patched++;
    if (this.groups.m0?.includes(bug)) this.game.say(SAY.firstPatch);
  }

  // What Blink points at: { text, x, y, z }.
  objective() {
    const g = this.game, p = g.player.body, O = OBJECTIVES;
    const at = (text, q) => ({ text, x: q.x, y: q.y, z: q.z });
    const d = this.done;
    if (!d[0]) {
      if (!this.probe) return this.readNote0 ? at(O.probe, P.probe) : at(O.note, P.note0);
      const bug = (this.groups.m0 || []).find((b) => b.alive);
      if (bug) return at(O.bug0, bug);
      return at(O.descend, P.boardArrive);
    }
    if (!d[1]) {
      if (g.district !== "BIOS QUARTER" && !this.clip) return at(O.m1Go, P.restore[2]);
      const bug = (this.groups.m1 || []).find((b) => b.alive);
      if (bug) return at(O.m1Bugs, bug);
      if (!this.clip) return at(O.m1Clip, P.clip);
      return at(O.m1Date, P.dials[1]);
    }
    if (!d[3] && (d[2] || g.district === "DRIVE C:")) {
      if (this.carry !== null) return at(O.m3Carry, P.slots[this.carry]);
      if (p.y < BAY_Y - 1) return at(O.m3, P.hddDoor);
      const c = this.clusters.find((k) => k.state === "platter");
      return at(O.m3, c ? c.mesh.position : P.hddDoor);
    }
    if (!d[2]) {
      const gr = this.grids[Math.min(2, this.round)];
      return at(O.m2, { x: gr.x + gr.n, y: 0, z: gr.z + gr.n });
    }
    if (!d[4]) {
      if (p.y < 2.5) return at(O.m4, P.climb);
      return at(O.m4, this.clumps.find((c) => !c.pulled) || P.climb);
    }
    if (!d[5]) {
      if (this.moth.state === "hidden") return at(O.m4, P.cpu);
      if (this.written) return this.tabOpen ? at(O.m5Close, P.tab) : at(O.m5Eject, P.eject);
      const next = this.mothTo ?? this.mothAt;
      if (next >= 3) return this.tabOpen ? at(O.m5Lever, P.lever) : at(O.m5Tab, P.tab);
      const l = P.leds[next];
      return at(O.m5Led, { x: l.x, y: l.y + 1, z: l.z });
    }
    return null;
  }
}
