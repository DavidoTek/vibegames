// The inside of the PC as data. No DOM and no three.js: the same solids feed
// the collision code (physics.js) and the renderer (props.js).
//
// 1 unit = 1 m at player scale. x runs east, z runs south (towards the front
// panel), y is up. The motherboard top is y = 0.

export const BOARD = { w: 160, d: 110 };
export const BAY_Y = 14;                 // floor height of the drive bay

export const COLORS = {
  pcb: 0x0f5a3a, chip: 0x1b1c22, silver: 0xb8bcc4, gold: 0xd9a520, beige: 0xcfc4a4,
  ribbon: 0x9aa0a8, metal: 0x636a74, dark: 0x2a2d33, capBlue: 0x2a4fa0, capBlack: 0x23252b,
  tan: 0xc9a878, red: 0xd0393b, simm: 0x1c7a48, slot: 0x3a2a20, disk: 0x20283c,
  chrome: 0xc8d2dc, amber: 0xffb347, card: 0x176a52, match: 0xd8b84a, paper: 0xf2e6a8,
};

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Places and numbers the missions refer to.
export const P = {
  start: { x: 136, y: BAY_Y + 0.8, z: 91, yaw: 0 },

  // Prologue (floppy drive)
  noteRam: { x: 64, y: 2, z: 26.3 },
  noteHdd: { x: 94.5, y: BAY_Y + 2.2, z: 69.6 },
  note0: { x: 115.6, y: BAY_Y + 1.6, z: 94 },
  probe: { x: 119, y: BAY_Y + 1.6, z: 90 },
  tab: { x: 146.5, y: BAY_Y + 1.1, z: 100.5 },
  lever: { x: 130, y: BAY_Y + 2.1, z: 104 },
  eject: { x: 140, y: BAY_Y + 2, z: 104.2 },
  shutter: { x: 136, y: BAY_Y + 1, z: 80 },
  zoneM0: { x0: 116, x1: 123, z0: 77, z1: 86 },
  boardArrive: { x: 106, y: 0, z: 58 },

  // Mission 1 (BIOS quarter)
  sticker: { x: 21, y: 3.05, z: 16 },
  clip: { x: 28.5, y: 1.7, z: 32 },
  dials: [{ x: 38.5, y: 1.3, z: 29 }, { x: 40, y: 1.3, z: 29 }, { x: 41.5, y: 1.3, z: 29 }],
  setLever: { x: 43.6, y: 1.5, z: 29 },
  clock: { x: 40, y: 6.5, z: 28.06 },
  zoneM1: { x0: 12, x1: 35, z0: 24, z1: 40 },
  date: [4, 12, 94],

  // Mission 2 (RAM Row): grids of 2 m tiles
  grids: [
    { x: 60, z: 30, n: 4 },
    { x: 72, z: 29, n: 5 },
    { x: 86, z: 28, n: 6 },
  ],
  tile: 2,
  lift: { x0: 54, x1: 58, z0: 23, z1: 26, low: 0.3, high: 6 },

  // Mission 3 (hard disk)
  platter: { x: 81, z: 88, r: 15, y: BAY_Y + 1 },
  armPivot: { x: 98, z: 103 },
  armLen: 23,
  slots: [78, 82, 86, 90].map((z) => ({ x: 100.5, y: BAY_Y + 1.4, z })),
  sector: { x: 63.06, y: BAY_Y + 5, z: 88 },
  tux: { x: 65.5, y: BAY_Y, z: 102.6 },
  zoneM3: { x0: 71, x1: 91, z0: 78, z1: 98 },
  hddDoor: { x: 100, y: BAY_Y, z: 66 },

  // Mission 4 (CPU fan)
  cpu: { x: 134, y: 12, z: 27 },
  fan: { x: 134, z: 29.5, r: 3.2, y: 8 },
  clumps: [{ x: 129.6, y: 8.5, z: 27.2 }, { x: 138.6, y: 8.5, z: 27.4 }, { x: 134, y: 9, z: 29.5 }],
  zoneM4: { x0: 128.6, x1: 139.4, z0: 26.6, z1: 32.4 },
  hotFins: [{ x0: 128, x1: 141, z0: 19.4, z1: 20.6, y: 5 }, { x0: 128, x1: 141, z0: 21.6, z1: 22.8, y: 6 }],
  climb: { x: 124, y: 2, z: 25 },
  eye: { x: 132, y: 22, z: -6 },

  // Mission 5 (finale)
  leds: [
    { name: "TURBO", x: 132, y: 0, z: 46, color: 0xffd23c },
    { name: "HDD", x: 104, y: 0, z: 54, color: 0xff4a3c },
    { name: "POWER", x: 150, y: BAY_Y, z: 64, color: 0x4dff88 },
  ],

  // Extras
  pads: [17, 25, 33, 41].map((x) => ({ x, z: 85 })),
  scribble: { x: 44, y: 1.2, z: 101 },
  screws: [
    [116.5, BAY_Y, 87.5], [14, 3, 13], [102, 0, 12], [96, 6, 24.5],
    [65, BAY_Y, 73], [145, 1, 13], [9, 0, 104], [80, 0, 50],
  ].map(([x, y, z]) => ({ x, y, z })),

  restore: [
    { x: 136, y: BAY_Y + 0.8, z: 93, yaw: 0 },
    { x: 106, y: 0, z: 56, yaw: 1.2 },
    { x: 36, y: 0, z: 44, yaw: 0.4 },
    { x: 78, y: 0, z: 44, yaw: 0 },
    { x: 100, y: BAY_Y, z: 66, yaw: 3.14 },
    { x: 122, y: 0, z: 44, yaw: -0.4 },
    { x: 145, y: BAY_Y, z: 67.5, yaw: 3.14 },
  ],
};

export const DISTRICTS = [
  { name: "DRIVE A:", x0: 114, x1: 152, z0: 70, z1: 106, y0: 10 },
  { name: "DRIVE C:", x0: 62, x1: 104, z0: 70, z1: 106, y0: 10 },
  { name: "BIOS QUARTER", x0: 6, x1: 46, z0: 6, z1: 42 },
  { name: "RAM ROW", x0: 52, x1: 102, z0: 6, z1: 42 },
  { name: "CPU CITADEL", x0: 116, x1: 150, z0: 8, z1: 42 },
  { name: "ISA ALLEY", x0: 6, x1: 50, z0: 62, z1: 106 },
  { name: "BUS BOULEVARD", x0: 0, x1: 160, z0: 0, z1: 110 },
];

export function buildLevel() {
  const solids = [];
  const labels = [];
  const C = COLORS;

  const box = (x0, z0, x1, z1, y0, y1, color, opts) => {
    const s = { k: "box", x0, x1, y0, y1, z0, z1, color, ...opts };
    solids.push(s);
    return s;
  };
  const cyl = (x, z, r, y0, y1, color, opts) => {
    const s = { k: "cyl", x, z, r, y0, y1, color, ...opts };
    solids.push(s);
    return s;
  };
  const ramp = (x0, z0, x1, z1, ya, yb, color) => {
    solids.push({ k: "ramp", x0, x1, z0, z1, y0: 0, ya, yb, color });
  };
  // A textured rectangle. face: "up", or the direction its front looks ("n", "s", "e", "w").
  const label = (key, x, y, z, w, h, face, opts) => labels.push({ key, x, y, z, w, h, face, ...opts });

  // A DIP chip: body, a row of legs on both long sides and a printed top.
  const chip = (x0, z0, x1, z1, h, text) => {
    box(x0, z0, x1, z1, 0.25, h, C.chip);
    const alongX = x1 - x0 >= z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    const n = Math.max(2, Math.floor(len / 1.4));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      if (alongX) {
        const x = x0 + t * len;
        box(x - 0.2, z0 - 0.35, x + 0.2, z0, 0, h * 0.6, C.silver, { nocol: true });
        box(x - 0.2, z1, x + 0.2, z1 + 0.35, 0, h * 0.6, C.silver, { nocol: true });
      } else {
        const z = z0 + t * len;
        box(x0 - 0.35, z - 0.2, x0, z + 0.2, 0, h * 0.6, C.silver, { nocol: true });
        box(x1, z - 0.2, x1 + 0.35, z + 0.2, 0, h * 0.6, C.silver, { nocol: true });
      }
    }
    // The body floats on its legs in the picture, but it is solid to the ground.
    box(x0, z0, x1, z1, 0, 0.25, C.dark);
    if (text) label("chip:" + text, (x0 + x1) / 2, h + 0.02, (z0 + z1) / 2, x1 - x0, z1 - z0, "up");
  };

  // ------------------------------------------------------------ board
  box(0, 0, BOARD.w, BOARD.d, -1, 0, C.pcb, { board: true });

  // ------------------------------------------------------------ BIOS quarter
  chip(12, 12, 30, 20, 3, null);
  label("bios", 21, 3.03, 16, 7, 14, "up", { rot: Math.PI / 2 });
  box(30.4, 14, 32, 18, 0, 2, C.tan);                      // resistor stairs up to the sticker
  box(32, 14, 34, 18, 0, 1, C.tan);
  cyl(22, 32, 5, 0, 1.2, C.silver);                        // coin battery
  label("battery", 22, 1.23, 32, 6, 6, "up");
  box(27, 30, 28, 34, 0, 1.6, C.gold);                     // contact clip
  box(28.2, 31.6, 28.8, 32.4, 0, 1.6, C.metal);            // lever post
  box(38, 24, 42, 28, 0, 9, C.dark);                       // clock tower
  for (const d of P.dials) box(d.x - 0.5, d.z - 0.5, d.x + 0.5, d.z + 0.5, 0, 1.2, C.metal);
  box(43.2, 28.6, 44, 29.4, 0, 1.4, C.red);                // "set" lever
  cyl(34, 36, 1.2, 0, 3.5, C.silver);                      // crystal can
  chip(10, 34, 14, 40, 1.5, "RTC-146");

  // ------------------------------------------------------------ RAM Row
  for (let i = 0; i < 4; i++) {
    const z = 9 + i * 3.5;
    box(58, z, 98, z + 1, 0, 12, C.simm, { name: "simm" + i });
    box(57, z - 0.4, 99, z + 1.4, 0, 1.5, C.beige);        // socket
    for (let k = 0; k < 8; k++) {
      box(60 + k * 4.75, z + 1, 63.5 + k * 4.75, z + 1.3, 4, 9, C.chip, { nocol: true });
    }
  }
  box(58, 23, 98, 26, 0, 6, C.beige);                      // catwalk above the bit floors
  label("note:ram", 64, 2, 26.06, 2.4, 2, "s");
  const L = P.lift;
  box(L.x0, L.z0, L.x1, L.z1, L.low - 0.4, L.low, C.amber, { dyn: true, name: "lift" });

  // ------------------------------------------------------------ CPU citadel
  box(120, 12, 146, 38, 0, 1, C.beige);                    // socket
  label("chip:V486 DX-TRA", 122.5, 1.02, 35.5, 5, 3, "up");
  box(125, 17, 141, 33, 1, 3, C.silver);                   // heat spreader and heatsink base
  box(123, 23, 125, 27, 1, 2, C.metal);                    // heatsink clip: the first step up
  for (let i = 0; i < 4; i++) {
    const z = 17.2 + i * 2.2;
    box(128, z, 141, z + 1.2, 3, 4 + i, i === 1 || i === 2 ? 0xd9b0a0 : C.chrome);   // fins as a staircase
  }
  box(128, 25.4, 140, 33, 3, 8, C.dark);                   // fan shroud
  cyl(P.fan.x, P.fan.z, P.fan.r, 8, 8.5, C.metal, { dyn: true, name: "fan" });
  for (const [x, z, h] of [[118, 16, 1.2], [118, 22, 2.2], [118, 34, 3.4]]) cyl(x, z, 1.4, 0, h, C.capBlue);

  // ------------------------------------------------------------ ISA alley
  for (const x of [12, 20, 28, 36]) {
    box(x, 68, x + 2, 102, 0, 2.5, C.slot);
    label("slotpins", x + 1, 2.52, 85, 1.2, 33, "up");
  }
  box(20.6, 70, 21.4, 100, 2.5, 16, C.card);               // the sound card
  label("chip:BOOMBOX 16", 21.42, 9, 85, 14, 5, "e");
  for (const p of P.pads) cyl(p.x, p.z, 1.3, 0, 0.12, C.gold, { nocol: true });
  box(44.5, 97, 45.3, 104, 0, 0.8, C.red, { nocol: true });   // Mort's lost screwdriver bit
  label("scribble", 46.4, 0.03, 101, 4, 3, "up", { rot: Math.PI / 2 });

  // ------------------------------------------------------------ drive bay: hard disk
  const Y = BAY_Y;
  box(62, 70, 104, 106, 0, Y, C.metal);                    // cage block
  ramp(62, 62, 96, 70, 0, Y, C.ribbon);                    // IDE ribbon cable
  box(96, 62, 104, 70, 0, Y, C.metal);                     // landing
  box(62, 70, 63, 106, Y, Y + 8, C.dark);                  // walls
  box(103, 71, 104, 106, Y, Y + 8, C.dark);
  box(62, 105, 104, 106, Y, Y + 8, C.dark);
  box(62, 70, 97, 71, Y, Y + 8, C.dark);
  box(103, 70, 104, 71, Y, Y + 8, C.dark);
  box(97, 70, 103, 71, Y, Y + 8, 0xff5a4a, { dyn: true, name: "gateHdd", gate: true });
  cyl(P.platter.x, P.platter.z, P.platter.r, Y, Y + 1, C.chrome, { dyn: true, name: "platter", spin: 0.22 });
  cyl(P.platter.x, P.platter.z, 2.4, Y + 1, Y + 3, C.metal);    // spindle hub
  box(99.6, 76, 101.4, 92, Y, Y + 0.9, C.dark);            // rail with the four slots
  cyl(P.armPivot.x, P.armPivot.z, 1.6, Y, Y + 2.4, C.metal);
  box(64, 99, 69, 99.6, Y, Y + 4, C.dark);                 // partition hiding the Linux alcove
  label("note:hdd", 94.5, Y + 2.2, 69.94, 3, 2, "n");
  label("chip:TRACK 0", 100.5, Y + 0.92, 94, 1.6, 1.2, "up");

  // ------------------------------------------------------------ drive bay: floppy
  box(114, 70, 152, 106, 0, Y, C.metal);
  ramp(108, 62, 142, 70, 0, Y, C.ribbon);
  box(142, 62, 152, 70, 0, Y, C.metal);
  box(114, 70, 115, 106, Y, Y + 7, C.dark);
  box(151, 71, 152, 106, Y, Y + 7, C.dark);
  box(114, 105, 152, 106, Y, Y + 7, C.dark);
  box(114, 70, 143, 71, Y, Y + 7, C.dark);
  box(151, 70, 152, 71, Y, Y + 7, C.dark);
  box(143, 70, 151, 71, Y, Y + 7, 0xff5a4a, { dyn: true, name: "gateFloppy", gate: true });
  box(124, 76, 148, 102, Y, Y + 0.8, C.disk);              // the disk
  cyl(136, 88, 2.4, Y + 0.8, Y + 0.86, C.silver, { nocol: true });
  label("shutter", 136, Y + 0.83, 80, 9, 7, "up");
  label("floppy", 136, Y + 0.83, 96.5, 17, 9, "up");
  box(115, 73.5, 151, 74.3, Y, Y + 0.9, C.silver);         // drive rail to jump over
  box(145.6, 99.8, 147.4, 101.2, Y + 0.8, Y + 1.2, C.dark, { nocol: true });   // write-protect window
  box(129.6, 103.4, 130.4, 105, Y, Y + 2, C.metal);        // drive lever post
  box(139, 104, 141, 105, Y + 1, Y + 3, C.red);            // EJECT
  label("slot", 136, Y + 5, 104.94, 24, 1.6, "n");
  label("chip:EJECT", 140, Y + 3.4, 104.94, 2.4, 0.7, "n");
  // Mort's camp
  box(116, 98, 119, 104, Y, Y + 1, C.match);               // matchbox bed
  label("matchbox", 117.5, Y + 1.02, 101, 3, 6, "up");
  cyl(121.5, 101.5, 0.8, Y, Y + 1.4, C.silver);            // thimble mug
  box(118, 89, 120, 91, Y, Y + 1, C.tan);                  // crate with the probe
  label("note:mort", 115.06, Y + 1.7, 94, 2.2, 1.8, "e");

  // ------------------------------------------------------------ LED posts (finale)
  for (const l of P.leds) box(l.x - 0.5, l.z - 0.5, l.x + 0.5, l.z + 0.5, l.y, l.y + 4.5, C.dark);

  // ------------------------------------------------------------ decor
  // Parts scattered over the free board. Keep-out rectangles cover the
  // districts, the ramps and the streets between them.
  const keep = [
    [6, 6, 48, 44], [52, 4, 102, 44], [112, 6, 152, 50], [4, 60, 52, 108],
    [58, 58, 156, 110], [0, 44, 160, 60],
  ];
  const free = (x0, z0, x1, z1) => keep.every(([a, b, c, d]) => x1 < a || x0 > c || z1 < b || z0 > d);
  const rand = rng(1994);
  const tryPlace = (w, d, fn, street) => {
    for (let i = 0; i < 12; i++) {
      const x = 2 + rand() * (BOARD.w - 4 - w), z = 2 + rand() * (BOARD.d - 4 - d);
      const ok = street ? !keep.slice(0, 5).some(([a, b, c, e]) => !(x + w < a || x > c || z + d < b || z > e)) : free(x, z, x + w, z + d);
      if (ok) { fn(x, z); return; }
    }
  };
  for (let i = 0; i < 26; i++) {
    const r = 0.7 + rand() * 0.8, h = 2 + rand() * 3.5;
    tryPlace(r * 2, r * 2, (x, z) => {
      cyl(x + r, z + r, r, 0, h, rand() < 0.6 ? C.capBlue : C.capBlack);
      cyl(x + r, z + r, r * 0.8, h, h + 0.05, C.silver, { nocol: true });
    });
  }
  const names = ["74LS-MORT", "VT82C42", "UM-8253", "PAL-16", "BYTE-01", "KB-8042", "DMA-8237"];
  for (let i = 0; i < 16; i++) {
    const w = 4 + Math.floor(rand() * 5), d = 2.4;
    const flip = rand() < 0.5;
    tryPlace(flip ? d : w, flip ? w : d, (x, z) => chip(x, z, x + (flip ? d : w), z + (flip ? w : d), 1.2, flip ? null : names[i % names.length]));
  }
  // Small flat parts; these may also lie on the streets, where they are stepped over.
  for (let i = 0; i < 110; i++) {
    const flip = rand() < 0.5, w = flip ? 0.5 : 1.2, d = flip ? 1.2 : 0.5;
    tryPlace(w, d, (x, z) => {
      box(x, z, x + w, z + d, 0, 0.3, rand() < 0.5 ? C.tan : C.chip, { nocol: true });
      box(x - (flip ? 0 : 0.2), z - (flip ? 0.2 : 0), x + w + (flip ? 0 : 0.2), z + d + (flip ? 0.2 : 0), 0, 0.2, C.silver, { nocol: true });
    }, true);
  }

  return { solids, labels, byName: (name) => solids.find((s) => s.name === name) };
}
