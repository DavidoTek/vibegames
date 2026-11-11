// three.js side of the world: turns the solids from level.js into meshes and
// builds the handful of special models. All textures are drawn on canvases.

import * as THREE from "./vendor/three.module.js";
import { BOARD, COLORS, P, BAY_Y } from "./level.js";

export { THREE };

const MONO = "'DejaVu Sans Mono', 'Courier New', monospace";

// ---------------------------------------------------------------- textures

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}

function toTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function lines(g, text, x, y, lh) {
  text.split("\n").forEach((l, i) => g.fillText(l, x, y + i * lh));
}

function pcbTexture() {
  const [c, g] = canvas(512, 512);
  g.fillStyle = "#0f5a3a";
  g.fillRect(0, 0, 512, 512);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.lineCap = "round";
  g.lineJoin = "round";
  for (let i = 0; i < 46; i++) {
    let x = Math.round(rand() * 32) * 16, y = Math.round(rand() * 32) * 16;
    g.strokeStyle = rand() < 0.5 ? "#17754a" : "#136842";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      const len = (1 + Math.floor(rand() * 5)) * 16;
      const dir = Math.floor(rand() * 8);
      const dx = [1, 1, 0, -1, -1, -1, 0, 1][dir], dy = [0, 1, 1, 1, 0, -1, -1, -1][dir];
      x += dx * len;
      y += dy * len;
      g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = "#c9a23a";
    g.beginPath();
    g.arc(x, y, 5, 0, 7);
    g.fill();
    g.fillStyle = "#0a3d27";
    g.beginPath();
    g.arc(x, y, 2, 0, 7);
    g.fill();
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(BOARD.w / 32, BOARD.d / 32);
  return t;
}

function paper(g, w, h, text, size) {
  g.fillStyle = "#f2e6a8";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#2a3a8a";
  g.font = `bold ${size}px ${MONO}`;
  g.textBaseline = "top";
  lines(g, text, 14, 14, size * 1.25);
}

const DRAW = {
  bios(g, w, h) {
    g.fillStyle = "#e8e2d0";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#b02a2a";
    g.fillRect(0, 0, w, 54);
    g.fillStyle = "#fff";
    g.font = `bold 34px ${MONO}`;
    g.textAlign = "center";
    g.fillText("VIBETRON", w / 2, 40);
    g.fillStyle = "#222";
    g.font = `bold 26px ${MONO}`;
    lines(g, "BIOS v2.1\n\nBIOS Date\n04/12/94", w / 2, 110, 44);
    g.font = `16px ${MONO}`;
    lines(g, "Property of Mort.\nHands off.", w / 2, 420, 24);
  },
  battery(g, w, h) {
    g.fillStyle = "#b8bcc4";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#555";
    g.font = `bold 60px ${MONO}`;
    g.textAlign = "center";
    g.fillText("+", w / 2, 90);
    g.font = `bold 30px ${MONO}`;
    g.fillText("3V", w / 2, 150);
    g.fillText("CR-MORT", w / 2, 200);
  },
  floppy(g, w, h) {
    g.fillStyle = "#f4f0e4";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#9bb0d8";
    g.lineWidth = 2;
    for (let y = 70; y < h; y += 44) { g.beginPath(); g.moveTo(16, y); g.lineTo(w - 16, y); g.stroke(); }
    g.fillStyle = "#c2185b";
    g.font = `bold 52px ${MONO}`;
    g.textAlign = "center";
    g.fillText("FREE GAMES!!!", w / 2, 108);
    g.font = `bold 40px ${MONO}`;
    g.fillText("♥ Sis", w / 2, 196);
  },
  shutter(g, w, h) {
    g.fillStyle = "#c4c9d0";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#11141c";
    g.fillRect(w * 0.6, h * 0.12, w * 0.22, h * 0.76);
    g.fillStyle = "#8d949e";
    g.font = `bold 20px ${MONO}`;
    g.fillText("◀ SLIDE", 16, h / 2);
  },
  slot(g, w, h) {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "#fff8dc");
    gr.addColorStop(1, "#ffd98a");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  },
  slotpins(g, w, h) {
    g.fillStyle = "#1a120c";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#d9a520";
    for (let y = 4; y < h; y += 12) g.fillRect(4, y, w - 8, 6);
  },
  matchbox(g, w, h) {
    g.fillStyle = "#d8b84a";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#b3261e";
    g.fillRect(10, 10, w - 20, h - 20);
    g.fillStyle = "#ffe9a8";
    g.font = `bold 26px ${MONO}`;
    g.textAlign = "center";
    lines(g, "SAFETY\nMATCHES\n\n(bed)", w / 2, h / 2 - 50, 34);
  },
  scribble(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#e9f2ff";
    g.font = `bold 34px ${MONO}`;
    g.textAlign = "center";
    lines(g, "MORT WAS\nHERE '94", w / 2, h / 2 - 10, 42);
  },
};

const SIZES = { bios: [256, 512], floppy: [512, 272], slot: [64, 32], slotpins: [32, 512], matchbox: [128, 256], scribble: [256, 192] };
const NOTE_TEXT = { mort: "TURBO?\nI told you\nnot to.\n  - Mort", hdd: "DO NOT\nCOVER THIS\nHOLE.\n  - Mort", ram: "EVEN\nPARITY!\n  - Mort" };
const cache = new Map();

export function texture(key) {
  if (cache.has(key)) return cache.get(key);
  let t;
  if (key.startsWith("chip:")) {
    const text = key.slice(5);
    const [c, g] = canvas(256, 96);
    g.fillStyle = "#1b1c22";
    g.fillRect(0, 0, 256, 96);
    g.fillStyle = "#9aa0a8";
    g.font = `bold ${Math.min(30, Math.floor(400 / text.length))}px ${MONO}`;
    g.textAlign = "center";
    g.fillText(text, 128, 56);
    g.beginPath();
    g.arc(18, 48, 7, 0, 7);
    g.fill();
    t = toTexture(c);
  } else if (key.startsWith("note:")) {
    const [c, g] = canvas(256, 208);
    paper(g, 256, 208, NOTE_TEXT[key.slice(5)], 30);
    t = toTexture(c);
  } else {
    const [w, h] = SIZES[key] || [256, 256];
    const [c, g] = canvas(w, h);
    DRAW[key](g, w, h);
    t = toTexture(c);
  }
  cache.set(key, t);
  return t;
}

// A rectangle whose picture is redrawn at run time (clock, sector display).
export function panel(w, h, pw, ph, glow = true) {
  const [c, g] = canvas(pw, ph);
  const tex = toTexture(c);
  const mat = glow ? new THREE.MeshBasicMaterial({ map: tex, fog: false }) : new THREE.MeshLambertMaterial({ map: tex });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  return { mesh, g, w: pw, h: ph, update: () => { tex.needsUpdate = true; } };
}

function faceRotation(mesh, face, rot = 0) {
  mesh.rotation.order = "YXZ";
  if (face === "up") { mesh.rotation.x = -Math.PI / 2; mesh.rotation.y = rot; }
  else mesh.rotation.y = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 }[face];
}

export function place(mesh, p, face, rot) {
  mesh.position.set(p.x, p.y, p.z);
  faceRotation(mesh, face, rot);
  return mesh;
}

// ---------------------------------------------------------------- world

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 20);

function wedge(s) {
  // Prism under a ramp: low end at x0, high end at x1.
  const { x0, x1, z0, z1, y0, ya, yb } = s;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, ya, z0], [x1, yb, z0], [x1, yb, z1], [x0, ya, z1],
  ];
  const quads = [[4, 7, 6, 5], [0, 1, 5, 4], [3, 7, 6, 2].reverse(), [1, 2, 6, 5], [0, 4, 7, 3]];
  const pos = [];
  for (const [a, b, c, d] of quads) for (const i of [a, b, c, a, c, d]) pos.push(...v[i]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function stripes() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = "#9aa0a8";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#7d838c";
  for (let y = 0; y < 64; y += 8) g.fillRect(0, y, 64, 2);
  g.fillStyle = "#c0392b";
  g.fillRect(0, 0, 64, 3);
  return toTexture(c);
}

function platterTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = "#c8d2dc";
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(90,110,130,0.35)";
  for (let r = 20; r < 128; r += 9) { g.beginPath(); g.arc(128, 128, r, 0, 7); g.stroke(); }
  // Sector marks make the rotation visible.
  g.strokeStyle = "rgba(60,80,110,0.5)";
  g.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * 24, 128 + Math.sin(a) * 24);
    g.lineTo(128 + Math.cos(a) * 126, 128 + Math.sin(a) * 126);
    g.stroke();
  }
  return toTexture(c);
}

export function buildWorld(level) {
  const root = new THREE.Group();
  const dyn = {};
  const lambert = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();

  const boxes = level.solids.filter((s) => s.k === "box" && !s.dyn && !s.board && !s.name);
  const cyls = level.solids.filter((s) => s.k === "cyl" && !s.dyn);
  const boxMesh = new THREE.InstancedMesh(UNIT_BOX, lambert, boxes.length);
  boxes.forEach((s, i) => {
    pos.set((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2);
    scl.set(s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0);
    boxMesh.setMatrixAt(i, m4.compose(pos, q, scl));
    boxMesh.setColorAt(i, col.setHex(s.color));
  });
  const cylMesh = new THREE.InstancedMesh(UNIT_CYL, lambert, cyls.length);
  cyls.forEach((s, i) => {
    pos.set(s.x, (s.y0 + s.y1) / 2, s.z);
    scl.set(s.r, s.y1 - s.y0, s.r);
    cylMesh.setMatrixAt(i, m4.compose(pos, q, scl));
    cylMesh.setColorAt(i, col.setHex(s.color));
  });
  root.add(boxMesh, cylMesh);

  for (const s of level.solids) {
    if (s.board) {
      const side = new THREE.MeshLambertMaterial({ color: 0x0a3d27 });
      const top = new THREE.MeshLambertMaterial({ map: pcbTexture() });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(BOARD.w, 1, BOARD.d), [side, side, top, side, side, side]);
      mesh.position.set(BOARD.w / 2, -0.5, BOARD.d / 2);
      root.add(mesh);
    } else if (s.k === "ramp") {
      const mesh = new THREE.Mesh(wedge(s), new THREE.MeshLambertMaterial({ color: s.color, side: THREE.DoubleSide }));
      root.add(mesh);
      // The ribbon itself: a striped sheet lying on the slope.
      const len = Math.hypot(s.x1 - s.x0, s.yb - s.ya);
      const tex = stripes();
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 4);
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(len, s.z1 - s.z0), new THREE.MeshLambertMaterial({ map: tex }));
      sheet.rotation.order = "ZYX";
      sheet.rotation.x = -Math.PI / 2;
      sheet.rotation.z = Math.atan2(s.yb - s.ya, s.x1 - s.x0);
      sheet.position.set((s.x0 + s.x1) / 2, (s.ya + s.yb) / 2 + 0.03, (s.z0 + s.z1) / 2);
      root.add(sheet);
    } else if (s.dyn || s.name) {
      let mesh;
      if (s.k === "cyl") {
        const mats = new THREE.MeshLambertMaterial({ color: s.color });
        const top = s.name === "platter" ? new THREE.MeshLambertMaterial({ map: platterTexture() }) : mats;
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, s.y1 - s.y0, 40), [mats, top, mats]);
        mesh.position.set(s.x, (s.y0 + s.y1) / 2, s.z);
      } else {
        const mat = s.gate
          ? new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.35, depthWrite: false })
          : new THREE.MeshLambertMaterial({ color: s.color });
        mesh = new THREE.Mesh(new THREE.BoxGeometry(s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0), mat);
        mesh.position.set((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2);
      }
      dyn[s.name] = mesh;
      root.add(mesh);
    }
  }

  for (const l of level.labels) {
    const glow = l.key === "slot";
    const mat = glow
      ? new THREE.MeshBasicMaterial({ map: texture(l.key), fog: false })
      : new THREE.MeshLambertMaterial({ map: texture(l.key), transparent: l.key === "scribble" });
    root.add(place(new THREE.Mesh(new THREE.PlaneGeometry(l.w, l.h), mat), l, l.face, l.rot));
  }

  // Fan blades ride on the fan disc.
  const blades = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(P.fan.r * 0.95, 0.08, 0.9), new THREE.MeshLambertMaterial({ color: 0x30343c }));
    b.position.x = P.fan.r * 0.5;
    const arm = new THREE.Group();
    arm.rotation.y = (i / 5) * Math.PI * 2;
    arm.add(b);
    blades.add(arm);
  }
  blades.position.y = 0.3;
  dyn.fan.add(blades);
  dyn.blades = blades;

  // The case: a big dark shell with bright vent slits in the back wall.
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD.w + 28, 50, BOARD.d + 24),
    new THREE.MeshLambertMaterial({ color: 0x3a3f47, side: THREE.BackSide }),
  );
  shell.position.set(BOARD.w / 2, 22, BOARD.d / 2);
  root.add(shell);
  const slitMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8, fog: false });
  for (let i = 0; i < 9; i++) {
    const slit = new THREE.Mesh(new THREE.BoxGeometry(1.4, 16, 0.2), slitMat);
    slit.position.set(108 + i * 6, 22, -11.8);
    root.add(slit);
  }

  // Dust in the light.
  const n = 260, pts = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pts[i * 3] = Math.random() * BOARD.w;
    pts[i * 3 + 1] = 1 + Math.random() * 24;
    pts[i * 3 + 2] = Math.random() * BOARD.d;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xcfe8d8, size: 0.12, transparent: true, opacity: 0.5 }));
  root.add(dust);

  return { root, dyn, dust };
}

// ---------------------------------------------------------------- models

const bugGeo = {
  body: new THREE.SphereGeometry(0.45, 10, 8),
  head: new THREE.SphereGeometry(0.22, 8, 6),
  leg: new THREE.BoxGeometry(0.9, 0.06, 0.06),
};
export const BUG_MATS = {
  live: new THREE.MeshLambertMaterial({ color: 0xe0389a, emissive: 0x5a0a3a }),
  stun: new THREE.MeshLambertMaterial({ color: 0x7f8fb0, emissive: 0x101828 }),
  fly: new THREE.MeshBasicMaterial({ color: 0x7dffa0 }),
  leg: new THREE.MeshLambertMaterial({ color: 0x40102c }),
};

export function bugModel(scale = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(bugGeo.body, BUG_MATS.live);
  body.scale.set(1, 0.55, 1.3);
  body.position.y = 0.32;
  const head = new THREE.Mesh(bugGeo.head, BUG_MATS.live);
  head.position.set(0, 0.3, 0.62);
  g.add(body, head);
  const legs = [];
  for (let i = 0; i < 3; i++) {
    const leg = new THREE.Mesh(bugGeo.leg, BUG_MATS.leg);
    leg.position.set(0, 0.2, -0.35 + i * 0.35);
    leg.scale.x = 1.5;
    g.add(leg);
    legs.push(leg);
  }
  g.scale.setScalar(scale);
  g.userData = { body, head, legs };
  return g;
}

export function mothModel() {
  const [c, g2] = canvas(128, 128);
  g2.fillStyle = "rgba(255,60,200,0.25)";
  g2.fillRect(0, 0, 128, 128);
  g2.fillStyle = "#ff8ae0";
  g2.font = `bold 15px ${MONO}`;
  const junk = "░▒▓§¶@#%&$ØÞ≈∆";
  for (let y = 14; y < 128; y += 16) {
    let row = "";
    for (let x = 0; x < 13; x++) row += junk[(x * 7 + y * 3) % junk.length];
    g2.fillText(row, 2, y);
  }
  const wingMat = new THREE.MeshBasicMaterial({ map: toTexture(c), transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xff5ad0, wireframe: true });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.2, 2.4, 6), lineMat);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const wings = [];
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.9);
    shape.lineTo(3.2 * side, -1.6);
    shape.lineTo(3.8 * side, 0.6);
    shape.lineTo(2.2 * side, 1.5);
    shape.lineTo(0, 0.8);
    const geo = new THREE.ShapeGeometry(shape);
    // ShapeGeometry uvs are the raw coordinates: bring them into 0..1.
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, Math.abs(uv.getX(i)) / 3.8, (uv.getY(i) + 1.6) / 3.1);
    const wing = new THREE.Mesh(geo, wingMat);
    wing.rotation.x = -Math.PI / 2;
    hinge.add(wing);
    g.add(hinge);
    wings.push(hinge);
  }
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb0f0 }));
  glow.position.z = 1.2;
  g.add(glow);
  g.userData = { wings };
  return g;
}

export function blinkModel() {
  const mat = new THREE.MeshBasicMaterial({ color: 0x4dff88, transparent: true, fog: false });
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.85, 0.12), mat);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x4dff88, transparent: true, opacity: 0.12, depthWrite: false, fog: false }),
  );
  m.add(halo);
  return m;
}

export function ledModel(color) {
  const mat = new THREE.MeshBasicMaterial({ color });
  const g = new THREE.Group();
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.8, 14, 10), mat);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 14, 10),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, fog: false }),
  );
  g.add(bulb, halo);
  const on = new THREE.Color(color), off = new THREE.Color(color).multiplyScalar(0.18);
  g.userData.set = (lit) => { mat.color.copy(lit ? on : off); mat.fog = !lit; halo.visible = lit; };
  g.userData.set(false);
  return g;
}

export function screwModel() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xd8dde4, emissive: 0x30343a });
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.14, 12), mat);
  head.position.y = 0.3;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.08, 0.6, 8), mat);
  g.add(head, shaft);
  g.rotation.z = 0.5;
  const holder = new THREE.Group();
  holder.add(g);
  return holder;
}

export function probeModel() {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.32), new THREE.MeshLambertMaterial({ color: 0xc23b2e }));
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.02, 0.22, 8), new THREE.MeshLambertMaterial({ color: 0xd0d4da }));
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.27;
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7dffa0 }));
  led.position.set(0, 0.06, -0.1);
  g.add(handle, tip, led);
  return g;
}

export function clusterModel(n) {
  const [c, g] = canvas(64, 64);
  g.fillStyle = "#ffb347";
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = "#7a4a00";
  g.lineWidth = 4;
  g.strokeRect(2, 2, 60, 60);
  g.fillStyle = "#3a2200";
  g.font = `bold 40px ${MONO}`;
  g.textAlign = "center";
  g.fillText(String(n), 32, 46);
  return new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), new THREE.MeshBasicMaterial({ map: toTexture(c) }));
}

export function hairModel() {
  const mat = new THREE.MeshLambertMaterial({ color: 0x8a7a6a, flatShading: true });
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.TorusKnotGeometry(0.45, 0.07, 40, 5, 2 + i, 3), mat);
    m.rotation.set(i * 1.3, i * 2.1, i * 0.7);
    m.scale.setScalar(0.8 + i * 0.15);
    g.add(m);
  }
  return g;
}

export function tuxModel() {
  const g = new THREE.Group();
  const black = new THREE.MeshLambertMaterial({ color: 0x15161a });
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f2ee });
  const yellow = new THREE.MeshLambertMaterial({ color: 0xf2b21c });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.8, 14, 10), black);
  body.scale.y = 1.25;
  body.position.y = 1;
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8), white);
  belly.scale.set(1, 1.2, 0.6);
  belly.position.set(0, 0.9, 0.42);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), black);
  head.position.y = 2.1;
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 8), yellow);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 2.05, 0.6);
  g.add(body, belly, head, beak);
  for (const s of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.6), yellow);
    foot.position.set(s * 0.35, 0.06, 0.3);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), white);
    eye.position.set(s * 0.18, 2.22, 0.42);
    g.add(foot, eye);
  }
  return g;
}

// Byte looking in through the vent.
export function eyeModel() {
  const g = new THREE.Group();
  const iris = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 16), new THREE.MeshBasicMaterial({ color: 0xb8d43c }));
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(4.4, 16, 12), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
  pupil.scale.set(0.3, 1.2, 0.5);
  pupil.position.z = 5.4;
  g.add(iris, pupil);
  g.userData = { pupil };
  return g;
}

// The desk outside, far above the board: title screen and intro.
export function exterior(postScreen) {
  const g = new THREE.Group();
  const beige = new THREE.MeshLambertMaterial({ color: 0xd8cdb0 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x24262b });
  const add = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  add(140, 2, 80, 0, -1, 0, new THREE.MeshLambertMaterial({ color: 0x4a3626 }));   // desk
  add(44, 12, 40, 0, 6, 0, beige);                                                  // case
  add(34, 26, 30, 0, 26, -2, beige);                                                // monitor
  add(26, 19, 0.6, 0, 26.5, 13, dark);
  postScreen.mesh.position.set(0, 26.5, 13.4);
  g.add(postScreen.mesh);
  add(15, 1.2, 0.6, 10, 8.5, 20, dark);                                             // floppy slot
  add(1.2, 0.8, 0.8, 16, 6.6, 20.2, dark);
  add(2.4, 1.6, 1, -12, 6, 20.3, new THREE.MeshBasicMaterial({ color: 0xff3b30 })); // TURBO
  add(1.6, 1.2, 1, -17, 6, 20.2, new THREE.MeshLambertMaterial({ color: 0x8a8f98 }));
  const tape = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.4), new THREE.MeshLambertMaterial({ map: tapeTexture() }));
  tape.position.set(-12, 9, 20.05);
  g.add(tape);
  for (const [x, c] of [[-4, 0x4dff88], [-1, 0xffd23c], [2, 0x401010]]) add(0.9, 0.5, 0.4, x, 6, 20.1, new THREE.MeshBasicMaterial({ color: c }));
  return g;
}

function tapeTexture() {
  const [c, g] = canvas(256, 64);
  g.fillStyle = "#efe6c0";
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = "#1d2a7a";
  g.font = `bold 20px ${MONO}`;
  g.textAlign = "center";
  g.fillText("TURBO: DO NOT PRESS.", 128, 28);
  g.fillText("- Mort", 128, 52);
  return toTexture(c);
}

export const SLOT_VIEW = { x: 10, y: 8.5, z: 21 };
export { BAY_Y, COLORS };
