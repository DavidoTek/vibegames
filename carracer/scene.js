// Everything three.js needs to show a track: sky, terrain, road ribbons,
// barriers, bridge pillars, scenery and the car models. The geometry comes
// from track.js samples, so what you see is exactly what physics uses.

import * as THREE from "./vendor/three.module.js";
import { DS, clamp, lerp, rng } from "./track.js";

const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------ textures

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Asphalt with edge lines. u runs across the road, v along it.
function roadTexture() {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = "#4a4d55";
    g.fillRect(0, 0, w, h);
    const r = rng(7);
    for (let i = 0; i < 2500; i++) {
      const v = 60 + r() * 40;
      g.fillStyle = `rgba(${v},${v},${v + 6},0.35)`;
      g.fillRect(r() * w, r() * h, 1.5, 1.5);
    }
    g.fillStyle = "#e9e9e4";
    g.fillRect(3, 0, 4, h);
    g.fillRect(w - 7, 0, 4, h);
    // Dashed centre line.
    g.fillRect(w / 2 - 1.5, 0, 3, h / 2);
  });
}

function stripeTexture(a, b) {
  return canvasTex(64, 16, (g, w, h) => {
    g.fillStyle = a; g.fillRect(0, 0, w / 2, h);
    g.fillStyle = b; g.fillRect(w / 2, 0, w / 2, h);
  });
}

function checkerTexture() {
  return canvasTex(64, 16, (g, w, h) => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? "#111" : "#f4f4f4";
      g.fillRect(x * 4, y * 4, 4, 4);
    }
  });
}

// --------------------------------------------------------- ribbon helper

// A strip along the whole track between two lateral offsets. `fn(i)` may
// return per-sample { a, b, ya, yb } to vary it. Closed loop, uv.v in metres.
function ribbon(T, fn, vScale = 1, uSpan = [0, 1], stride = 1) {
  const N = Math.ceil(T.n / stride);
  const pos = new Float32Array((N + 1) * 2 * 3), uv = new Float32Array((N + 1) * 4);
  for (let k = 0; k <= N; k++) {
    const i = T.wrap(k * stride);
    const r = fn(i);
    const nx = -T.dz[i], nz = T.dx[i];
    pos.set([T.x[i] + nx * r.a, T.y[i] + r.ya, T.z[i] + nz * r.a, T.x[i] + nx * r.b, T.y[i] + r.yb, T.z[i] + nz * r.b], k * 6);
    const v = (k * stride * DS) / vScale;
    uv.set([uSpan[0], v, uSpan[1], v], k * 4);
  }
  const idx = [];
  for (let k = 0; k < N; k++) {
    const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Swap u and v so a horizontal stripe texture repeats along the track.
function flipUV(g) {
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getY(k), uv.getX(k));
}

// ------------------------------------------------------------- terrain

// Height field around the track. Near the road the ground meets the verge;
// high road sections get embankments, the lower road of the figure-eight
// gets a cut under the bridge, and further out there are hills (or sea).
function buildTerrain(T, theme, seed) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < T.n; i++) {
    minX = Math.min(minX, T.x[i]); maxX = Math.max(maxX, T.x[i]);
    minZ = Math.min(minZ, T.z[i]); maxZ = Math.max(maxZ, T.z[i]);
  }
  const M = 320, cell = 6;
  minX -= M; minZ -= M; maxX += M; maxZ += M;
  const nx = Math.ceil((maxX - minX) / cell) + 1, nz = Math.ceil((maxZ - minZ) / cell) + 1;
  const embank = new Float32Array(nx * nz).fill(-Infinity);
  const cap = new Float32Array(nx * nz).fill(Infinity);
  const dmin = new Float32Array(nx * nz).fill(Infinity);
  const slope = 0.6;
  for (let i = 0; i < T.n; i++) {
    const c = T.half(i), h = T.y[i];
    const rad = c + 3 + Math.max(0, h) / slope;
    const x0 = Math.max(0, Math.floor((T.x[i] - rad - minX) / cell)), x1 = Math.min(nx - 1, Math.ceil((T.x[i] + rad - minX) / cell));
    const z0 = Math.max(0, Math.floor((T.z[i] - rad - minZ) / cell)), z1 = Math.min(nz - 1, Math.ceil((T.z[i] + rad - minZ) / cell));
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
      const k = gz * nx + gx;
      const d = Math.hypot(minX + gx * cell - T.x[i], minZ + gz * cell - T.z[i]) - c;
      embank[k] = Math.max(embank[k], h - slope * Math.max(0, d));
      if (d < 2.5) cap[k] = Math.min(cap[k], h - 0.25);
      dmin[k] = Math.min(dmin[k], d);
    }
  }
  // Far distance (for hills and shore) from a sparser pass.
  for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
    const k = gz * nx + gx;
    if (dmin[k] < Infinity) continue;
    const px = minX + gx * cell, pz = minZ + gz * cell;
    let d = Infinity;
    for (let i = 0; i < T.n; i += 4) d = Math.min(d, (T.x[i] - px) ** 2 + (T.z[i] - pz) ** 2);
    dmin[k] = Math.sqrt(d) - 12;
  }
  const noise = valueNoise(seed);
  const heights = new Float32Array(nx * nz);
  const col = new Float32Array(nx * nz * 3);
  const cGrass = new THREE.Color(theme.grass), cGround = new THREE.Color(theme.ground);
  const cSand = new THREE.Color(0xe3cf98), cRock = new THREE.Color(0x9c6b4a), tmp = new THREE.Color();
  const sea = theme.props === "harbour";
  for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
    const k = gz * nx + gx, px = minX + gx * cell, pz = minZ + gz * cell;
    const d = dmin[k];
    let far;
    if (sea) far = -3.5 * smooth(55, 95, d) + 0.6 * noise(px / 60, pz / 60) * smooth(10, 50, d);
    else far = (theme.props === "canyon" ? 34 : 22) * smooth(40, 260, d) * noise(px / 140, pz / 140) + 2 * noise(px / 30, pz / 30) * smooth(5, 40, d);
    let h = Math.max(embank[k], far);
    h = Math.min(h, cap[k]);
    heights[k] = h;
    const n = noise(px / 18 + 50, pz / 18);
    tmp.copy(cGrass).lerp(cGround, clamp(n * 0.8 + 0.2, 0, 1));
    if (sea && h < 0.3 && d > 40) tmp.copy(cSand);
    if (theme.props === "canyon" && h > 8) tmp.lerp(cRock, clamp((h - 8) / 10, 0, 0.8));
    col.set([tmp.r, tmp.g, tmp.b], k * 3);
  }
  const geo = new THREE.PlaneGeometry((nx - 1) * cell, (nz - 1) * cell, nx - 1, nz - 1);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  // PlaneGeometry rows run from -z to +z after the rotation (top row first).
  for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
    const v = gz * nx + gx;
    p.setXYZ(v, minX + gx * cell, heights[v], minZ + gz * cell);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  // Bilinear lookups for scenery placement.
  const sample = (arr, x, z) => {
    const fx = clamp((x - minX) / cell, 0, nx - 1.001), fz = clamp((z - minZ) / cell, 0, nz - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const a = arr[iz * nx + ix], b = arr[iz * nx + ix + 1], c = arr[(iz + 1) * nx + ix], e = arr[(iz + 1) * nx + ix + 1];
    return lerp(lerp(a, b, tx), lerp(c, e, tx), tz);
  };
  return {
    mesh,
    height: (x, z) => sample(heights, x, z),
    dist: (x, z) => sample(dmin, x, z),
    bounds: { minX, maxX, minZ, maxZ },
  };
}

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function valueNoise(seed) {
  const r = rng(seed), P = new Float32Array(256);
  for (let i = 0; i < 256; i++) P[i] = r();
  const h = (x, z) => P[(x * 37 + z * 113 + ((x * z) & 255)) & 255];
  return (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    return lerp(lerp(h(ix, iz), h(ix + 1, iz), sx), lerp(h(ix, iz + 1), h(ix + 1, iz + 1), sx), sz);
  };
}

// ---------------------------------------------------------------- world

export function buildWorld(T, seed) {
  const theme = T.def.theme;
  const root = new THREE.Group();
  const keep = [];      // things with a per-frame update

  // Sky dome with a vertical gradient; fog matches its horizon colour.
  const skyGeo = new THREE.SphereGeometry(1800, 24, 12);
  const sc = [], top = new THREE.Color(theme.sky[0]), bot = new THREE.Color(theme.sky[1]);
  const sp = skyGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const t = clamp(sp.getY(i) / 900, 0, 1);
    const c = bot.clone().lerp(top, Math.pow(t, 0.6));
    sc.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute("color", new THREE.Float32BufferAttribute(sc, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  root.add(sky);
  const fog = new THREE.Fog(theme.fog, 120, theme.fogFar);

  root.add(new THREE.HemisphereLight(0xdfefff, theme.ground, 1.3));
  const sun = new THREE.DirectionalLight(theme.sun, 2.2);
  sun.position.set(300, 500, 200);
  root.add(sun);

  const terrain = buildTerrain(T, theme, seed);
  root.add(terrain.mesh);
  if (theme.props === "harbour") {
    const b = terrain.bounds;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshLambertMaterial({ color: theme.water }));
    water.rotation.x = -Math.PI / 2;
    water.position.set((b.minX + b.maxX) / 2, -0.8, (b.minZ + b.maxZ) / 2);
    root.add(water);
  } else {
    // Ground beyond the terrain grid, slightly lower so it never pokes through.
    const g = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ color: theme.ground }));
    g.rotation.x = -Math.PI / 2;
    g.position.y = -1;
    root.add(g);
  }

  // Verge, road, kerbs, barriers.
  const verge = ribbon(T, (i) => ({ a: -T.half(i) - 0.5, b: T.half(i) + 0.5, ya: -0.02, yb: -0.02 }));
  root.add(new THREE.Mesh(verge, new THREE.MeshLambertMaterial({ color: theme.verge })));
  const roadTex = roadTexture();
  roadTex.repeat.set(1, 1);
  const road = ribbon(T, (i) => ({ a: -T.w[i] / 2, b: T.w[i] / 2, ya: 0.04, yb: 0.04 }), 12);
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
  root.add(new THREE.Mesh(road, roadMat));

  // Kerbs only where the road actually bends.
  const kerbTex = stripeTexture("#d8312a", "#f2f2f2");
  for (const side of [-1, 1]) {
    const g = ribbon(T, (i) => {
      const bend = Math.abs(T.curv[i]) > 1 / 140;
      const e = (T.w[i] / 2) * side, o = bend ? 1.4 * side : 0.01 * side;
      return { a: e, b: e + o, ya: 0.06, yb: 0.06 };
    }, 3);
    flipUV(g);
    root.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: kerbTex })));
  }
  const barTex = stripeTexture(theme.props === "canyon" ? "#e7e1d3" : "#e23b2e", "#f5f5f0");
  const barMat = new THREE.MeshLambertMaterial({ map: barTex, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const g = ribbon(T, (i) => ({ a: T.half(i) * side, b: T.half(i) * side, ya: 0, yb: 1.0 }), 4);
    flipUV(g);
    root.add(new THREE.Mesh(g, barMat));
  }

  // Start/finish line and gantry with five lights.
  const a0 = T.at(0);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(a0.w, 2.4), new THREE.MeshLambertMaterial({ map: checkerTexture() }));
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = Math.atan2(a0.dx, a0.dz);
  line.position.set(a0.x, a0.y + 0.07, a0.z);
  root.add(line);
  const gantry = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: 0x2b2f3a });
  const span = T.half(0) + 0.6;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), postMat);
    post.position.set(s * span, 3.5, 0);
    gantry.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2, 1.4, 0.6), postMat);
  beam.position.y = 6.6;
  gantry.add(beam);
  const lamps = [];
  for (let k = 0; k < 5; k++) {
    const m = new THREE.MeshBasicMaterial({ color: 0x331111 });
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), m);
    // Local -x is on the driver's right, so lamp 0 goes on +x (their left).
    lamp.position.set((2 - k) * 1.2, 6.6, -0.31);
    lamp.rotation.y = Math.PI;
    gantry.add(lamp);
    lamps.push(m);
  }
  gantry.position.set(a0.x, a0.y, a0.z);
  gantry.rotation.y = Math.atan2(a0.dx, a0.dz);
  root.add(gantry);

  addBridges(T, terrain, root);
  addScenery(T, terrain, theme, seed, root);

  return {
    root, fog, terrain,
    setLights(n, red = true) {
      lamps.forEach((m, k) => m.color.setHex(k < n ? (red ? 0xff2a2a : 0x2aff5a) : 0x331111));
    },
    dispose() {
      root.traverse((o) => {
        o.geometry?.dispose();
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) { m.map?.dispose(); m.dispose(); }
      });
    },
  };
}

// Where the road runs high above the terrain, give it a deck and pillars.
function addBridges(T, terrain, root) {
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x8d8a84 });
  const pillar = new THREE.CylinderGeometry(0.9, 1.1, 1, 8);
  const pillars = [];
  const high = (i) => T.y[i] - terrain.height(T.x[i], T.z[i]) > 1.5;
  // Deck underside + side faces, only for high samples (others collapse).
  const under = ribbon(T, (i) => {
    const hi = high(i), c = T.half(i);
    // Reversed edges so this strip faces down.
    return hi ? { a: c, b: -c, ya: -1.2, yb: -1.2 } : { a: 0, b: 0, ya: -0.5, yb: -0.5 };
  });
  root.add(new THREE.Mesh(under, deckMat));
  for (const side of [-1, 1]) {
    const g = ribbon(T, (i) => {
      const c = T.half(i) * side;
      return high(i) ? { a: c, b: c, ya: -1.2, yb: 0 } : { a: c, b: c, ya: -0.3, yb: -0.3 };
    });
    root.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x8d8a84, side: THREE.DoubleSide })));
  }
  for (let i = 0; i < T.n; i += 9) {
    if (!high(i)) continue;
    for (const side of [-1, 1]) {
      const p = T.point(i * DS, side * (T.half(i) - 2));
      // No pillar in the middle of another road (the figure-eight crossing).
      if (onOtherRoad(T, p.x, p.z, i)) continue;
      const g = terrain.height(p.x, p.z) - 1;
      const h = T.y[i] - 1.2 - g;
      if (h < 1) continue;
      pillars.push({ x: p.x, z: p.z, y: g + h / 2, h });
    }
  }
  if (!pillars.length) return;
  const m = new THREE.InstancedMesh(pillar, deckMat, pillars.length);
  const mat = new THREE.Matrix4();
  pillars.forEach((p, k) => {
    mat.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(), new THREE.Vector3(1, p.h, 1));
    m.setMatrixAt(k, mat);
  });
  root.add(m);
}

function onOtherRoad(T, x, z, self) {
  for (let i = 0; i < T.n; i++) {
    const di = Math.abs(i - self);
    if (Math.min(di, T.n - di) < 30) continue;
    if (Math.hypot(T.x[i] - x, T.z[i] - z) < T.half(i) + 2) return true;
  }
  return false;
}

// Instanced props placed by a seeded RNG, never on or right next to the road.
function addScenery(T, terrain, theme, seed, root) {
  const r = rng(seed * 7 + 3);
  const b = terrain.bounds;
  const place = (count, minD, maxD, fn) => {
    let tries = 0, made = 0;
    while (made < count && tries++ < count * 30) {
      const x = lerp(b.minX + 60, b.maxX - 60, r()), z = lerp(b.minZ + 60, b.maxZ - 60, r());
      const d = terrain.dist(x, z);
      if (d < minD || d > maxD) continue;
      const y = terrain.height(x, z);
      if (fn(x, y, z, d) !== false) made++;
    }
  };
  const inst = (geo, mat, list) => {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    const mx = new THREE.Matrix4(), q = new THREE.Quaternion();
    list.forEach((p, k) => {
      q.setFromAxisAngle(UP, p.rot ?? 0);
      mx.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.sx ?? p.s, p.sy ?? p.s, p.sz ?? p.s));
      m.setMatrixAt(k, mx);
      if (p.c != null) m.setColorAt(k, new THREE.Color(p.c));
    });
    root.add(m);
  };

  if (theme.props === "pines" || theme.props === "harbour") {
    const trunks = [], crowns = [];
    place(theme.props === "pines" ? 900 : 220, 6, theme.props === "pines" ? 260 : 60, (x, y, z) => {
      if (theme.props === "harbour" && y < 0.2 && terrain.dist(x, z) > 45) return false;
      const s = 0.8 + r() * 0.9;
      trunks.push({ x, y: y + 1.2 * s, z, s });
      crowns.push({ x, y: y + 4.6 * s, z, s, rot: r() * 6, c: new THREE.Color(theme.props === "pines" ? 0x2f6b3a : 0x3f8f45).offsetHSL(0, 0, (r() - 0.5) * 0.12) });
    });
    inst(new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0x6b4a2f }), trunks);
    inst(theme.props === "pines" ? new THREE.ConeGeometry(2, 6.5, 7) : new THREE.IcosahedronGeometry(2.4, 0),
      new THREE.MeshLambertMaterial({ color: 0xffffff }), crowns);
  }
  if (theme.props === "pines" || theme.props === "canyon") {
    const rocks = [];
    place(theme.props === "canyon" ? 260 : 120, 5, 280, (x, y, z) => {
      const s = 1 + r() * (theme.props === "canyon" ? 4 : 2);
      rocks.push({ x, y: y + s * 0.3, z, s, sy: s * (0.6 + r() * 0.6), rot: r() * 6, c: new THREE.Color(theme.props === "canyon" ? 0xa8603a : 0x8a8a86).offsetHSL(0, 0, (r() - 0.5) * 0.1) });
    });
    inst(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), rocks);
  }
  if (theme.props === "canyon") {
    // Tall layered mesas in the distance, cacti near the road.
    const mesas = [], cacti = [];
    place(40, 70, 400, (x, y, z) => {
      const s = 14 + r() * 26, h = 25 + r() * 45;
      mesas.push({ x, y: y + h / 2 - 2, z, sx: s, sy: h, sz: s, rot: r() * 6, c: new THREE.Color(0xb5653c).offsetHSL(0, 0, (r() - 0.5) * 0.1) });
    });
    place(160, 5, 60, (x, y, z) => { const s = 0.7 + r() * 0.6; cacti.push({ x, y: y + 1.6 * s, z, s, rot: r() * 6 }); });
    inst(new THREE.CylinderGeometry(0.75, 1, 1, 7), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), mesas);
    inst(new THREE.CylinderGeometry(0.35, 0.4, 3.2, 6), new THREE.MeshLambertMaterial({ color: 0x4f8a3c }), cacti);
  }
  if (theme.props === "harbour") {
    // Containers stacked in yards, a few cranes.
    const boxes = [], cols = [0xc8462f, 0x2f6ec8, 0xe0a624, 0x3a9a5a, 0xdddddd, 0x7c4bc0];
    place(26, 14, 50, (x, y, z) => {
      const rot = r() * Math.PI, n = 2 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) for (let h = 0; h < 1 + Math.floor(r() * 3); h++) {
        boxes.push({ x: x + Math.cos(rot) * k * 2.7, y: y + 1.3 + h * 2.6, z: z - Math.sin(rot) * k * 2.7, s: 1, rot, c: cols[Math.floor(r() * cols.length)] });
      }
    });
    inst(new THREE.BoxGeometry(2.5, 2.6, 6.1), new THREE.MeshLambertMaterial({ color: 0xffffff }), boxes);
    const crane = new THREE.MeshLambertMaterial({ color: 0xe8a33a });
    place(6, 30, 70, (x, y, z) => {
      const g = new THREE.Group();
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 22, 0.6), crane);
        leg.position.set(dx, 11, dz);
        g.add(leg);
      }
      const boom = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 40), crane);
      boom.position.set(0, 23, 8);
      g.add(boom);
      g.position.set(x, y, z);
      g.rotation.y = r() * 6;
      root.add(g);
    });
  }

  // Grandstand by the start line, on the side with more room.
  const a = T.at(-30);
  const side = terrain.dist(T.point(-30, 25).x, T.point(-30, 25).z) > terrain.dist(T.point(-30, -25).x, T.point(-30, -25).z) ? 1 : -1;
  const stand = new THREE.Group();
  const sMat = new THREE.MeshLambertMaterial({ color: 0xd9dde6 });
  for (let k = 0; k < 5; k++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(40, 1, 2), sMat);
    step.position.set(0, 0.5 + k, k * 2);
    stand.add(step);
  }
  const crowd = [];
  const cr = rng(seed + 99);
  for (let k = 0; k < 5; k++) for (let j = 0; j < 30; j++) {
    if (cr() < 0.3) continue;
    crowd.push({ x: -19 + j * 1.3, y: 1.5 + k, z: k * 2, s: 0.5, sy: 0.9, c: new THREE.Color().setHSL(cr(), 0.6, 0.55) });
  }
  const cm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), crowd.length);
  const mx = new THREE.Matrix4();
  crowd.forEach((p, k) => {
    mx.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(), new THREE.Vector3(p.s, p.sy, p.s));
    cm.setMatrixAt(k, mx);
    cm.setColorAt(k, p.c);
  });
  stand.add(cm);
  const sp = T.point(-30, side * (T.half(T.wrap(-15)) + 4));
  stand.position.set(sp.x, terrain.height(sp.x, sp.z), sp.z);
  // Face the track: local +z points away from it.
  stand.rotation.y = Math.atan2(-a.dz * side, a.dx * side);
  root.add(stand);
}

// ----------------------------------------------------------------- cars

const carGeo = {
  body: new THREE.BoxGeometry(1.9, 0.55, 4.2),
  nose: new THREE.BoxGeometry(1.7, 0.3, 1.0),
  cabin: new THREE.BoxGeometry(1.5, 0.5, 1.9),
  wheel: new THREE.CylinderGeometry(0.36, 0.36, 0.32, 12).rotateZ(Math.PI / 2),
  wing: new THREE.BoxGeometry(1.9, 0.08, 0.5),
  strut: new THREE.BoxGeometry(0.1, 0.35, 0.1),
  lamp: new THREE.BoxGeometry(0.4, 0.14, 0.05),
  blob: new THREE.PlaneGeometry(2.6, 5).rotateX(-Math.PI / 2),
};
const sharedMat = {
  glass: new THREE.MeshLambertMaterial({ color: 0x1d2633 }),
  tyre: new THREE.MeshLambertMaterial({ color: 0x1b1b1e }),
  dark: new THREE.MeshLambertMaterial({ color: 0x23252b }),
  head: new THREE.MeshBasicMaterial({ color: 0xfff6d0 }),
  tail: new THREE.MeshBasicMaterial({ color: 0xff3030 }),
  blob: new THREE.MeshBasicMaterial({
    map: canvasTex(64, 128, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
      grd.addColorStop(0, "rgba(0,0,0,0.55)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.scale(1, 2);
      g.fillRect(0, 0, w, h);
    }, false),
    transparent: true, depthWrite: false,
  }),
};

// Car model facing +z. Returns the group plus the parts that move.
export function buildCar(color, label) {
  const g = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Group();
  g.add(body);
  const b = new THREE.Mesh(carGeo.body, paint); b.position.y = 0.55; body.add(b);
  const n = new THREE.Mesh(carGeo.nose, paint); n.position.set(0, 0.42, 2.4); body.add(n);
  const c = new THREE.Mesh(carGeo.cabin, sharedMat.glass); c.position.set(0, 1.05, -0.35); body.add(c);
  const w = new THREE.Mesh(carGeo.wing, sharedMat.dark); w.position.set(0, 1.25, -1.95); body.add(w);
  for (const s of [-0.6, 0.6]) {
    const st = new THREE.Mesh(carGeo.strut, sharedMat.dark); st.position.set(s, 1.0, -1.95); body.add(st);
    const hl = new THREE.Mesh(carGeo.lamp, sharedMat.head); hl.position.set(s, 0.6, 2.11); body.add(hl);
    const tl = new THREE.Mesh(carGeo.lamp, sharedMat.tail); tl.position.set(s, 0.62, -2.11); body.add(tl);
  }
  const wheels = [], pivots = [];
  for (const [x, z, front] of [[-0.98, 1.35, 1], [0.98, 1.35, 1], [-0.98, -1.35, 0], [0.98, -1.35, 0]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36, z);
    const wh = new THREE.Mesh(carGeo.wheel, sharedMat.tyre);
    pivot.add(wh);
    g.add(pivot);
    wheels.push(wh);
    if (front) pivots.push(pivot);
  }
  const blob = new THREE.Mesh(carGeo.blob, sharedMat.blob);
  blob.position.y = 0.06;
  blob.renderOrder = 1;
  g.add(blob);
  if (label) {
    const tex = canvasTex(256, 64, (ctx, cw, ch) => {
      ctx.font = "bold 34px DejaVu Sans, system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 7; ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(label, cw / 2, ch / 2);
      ctx.fillStyle = "#fff"; ctx.fillText(label, cw / 2, ch / 2);
    }, false);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(4, 1, 1);
    sprite.position.y = 2.8;
    sprite.renderOrder = 5;
    g.add(sprite);
  }
  return { group: g, body, wheels, pivots, paint };
}

export function disposeCar(m) {
  m.paint.dispose();
  m.group.traverse((o) => { if (o.isSprite) { o.material.map.dispose(); o.material.dispose(); } });
}

export { THREE };
