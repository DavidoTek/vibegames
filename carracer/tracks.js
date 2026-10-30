// Track data. Each control point is [x, z, height, road width] in metres.
// The spline starts (and the start/finish line sits) at the first point, so
// that point should be on a straight. Theme colours are plain hex numbers.

// Canyon Eight is a figure-of-eight; generating its points keeps the two
// lobes symmetric. The second pass through the middle is a bridge.
function eight() {
  const pts = [], n = 36, A = 330, B = 250;
  for (let k = 0; k < n; k++) {
    const t = 0.5 + (k / n) * Math.PI * 2;
    let d = Math.abs(t - Math.PI);
    const h = 9.5 * Math.exp(-((d / 0.5) ** 2));
    pts.push([A * Math.sin(t), B * Math.sin(t) * Math.cos(t), h, 14]);
  }
  return pts;
}

export const TRACKS = [
  {
    id: "harbour",
    name: "Harbour Loop",
    blurb: "Flat and wide. Learn the car here.",
    verge: 6,
    points: [
      [0, -200, 0, 16], [120, -208, 0, 16], [215, -175, 0, 16], [262, -90, 0, 15],
      [240, 10, 0, 15], [175, 70, 0, 14], [190, 165, 0, 14], [140, 238, 0, 15],
      [30, 250, 0, 16], [-90, 228, 0, 16], [-185, 175, 0, 15], [-232, 80, 0, 14],
      [-170, 20, 0, 14], [-200, -70, 0, 15], [-150, -160, 0, 16], [-70, -195, 0, 16],
    ],
    theme: {
      sky: [0x5fa8e8, 0xd8ecff], fog: 0xcfe4f5, fogFar: 900,
      grass: 0x6dbb5a, verge: 0x8fca6a, ground: 0x5aa04c,
      water: 0x2d7fb8, sun: 0xfff2dd,
      props: "harbour",
    },
  },
  {
    id: "ridge",
    name: "Pine Ridge",
    blurb: "Hills, a blind crest and a tight hairpin.",
    verge: 5,
    points: [
      [0, 0, 0, 13], [140, -20, 3, 13], [250, 10, 8, 13], [300, 100, 13, 12],
      [282, 192, 15, 12], [205, 242, 11, 12], [146, 300, 7, 12], [134, 372, 5, 12],
      [96, 420, 5, 12], [42, 404, 5, 12], [28, 330, 6, 12], [-20, 252, 9, 12],
      [-92, 210, 13, 12], [-172, 222, 9, 12], [-242, 170, 4, 13], [-262, 70, 1, 13],
      [-200, 0, 0, 13], [-100, -12, 0, 13],
    ],
    theme: {
      sky: [0x6e9fd0, 0xf3e6d4], fog: 0xdfe3e0, fogFar: 700,
      grass: 0x4f8f45, verge: 0x6ea65a, ground: 0x467f3d,
      sun: 0xffe2b8,
      props: "pines",
    },
  },
  {
    id: "canyon",
    name: "Canyon Eight",
    blurb: "A fast figure-of-eight with a bridge over itself.",
    verge: 5,
    points: eight(),
    theme: {
      sky: [0x4f86c6, 0xffd9a8], fog: 0xf0cfa4, fogFar: 950,
      grass: 0xd08a52, verge: 0xdfa06a, ground: 0xc77f4a,
      sun: 0xffe6c4,
      props: "canyon",
    },
  },
];
