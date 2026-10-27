// The map a new game starts with: a double-track main line through three
// stations, a single-track branch with a passing loop, a single-track relief
// line via Southpark and a freight harbour at the far end.

import { emptyLayout, addTrack, addStation, markPlatform, signalKey, LINE_COLORS } from "./sim.js";

const E = 0, N = 6, S = 2, W = 4;

export function defaultLayout() {
  const L = emptyLayout();
  const T = (...pts) => addTrack(L, pts);
  const sig = (x, y, d, oneWay = 0) => { L.signals[signalKey(x, y, d)] = oneWay; };
  const plat = (id, x1, x2, ...ys) => { for (const y of ys) markPlatform(L, id, [[x1, y], [x2, y]]); };

  // Main line: y=24 westbound, y=25 eastbound (right-hand running).
  T([4, 24], [80, 24], [81, 25]);
  T([4, 25], [88, 25]);

  // Westend terminus: four stub tracks, crossovers in the throat.
  T([4, 23], [13, 23], [14, 24]);
  T([4, 26], [13, 26], [14, 25]);
  T([15, 24], [16, 25]);
  T([17, 25], [18, 24]);

  // Central: four through tracks, branch to the north, relief line south.
  T([28, 24], [29, 25]);
  T([30, 25], [31, 24]);
  T([32, 24], [33, 23], [48, 23], [52, 19], [52, 12], [55, 9], [70, 9]);
  T([32, 25], [33, 26], [48, 26], [51, 29], [61, 29], [64, 26], [77, 26], [78, 25]);
  T([45, 23], [46, 24], [47, 23]);
  T([45, 26], [46, 25], [47, 26]);
  T([47, 24], [48, 25]);
  T([49, 25], [50, 24]);

  // Passing loop on the branch, Hillcrest's second track.
  T([52, 18], [53, 17], [53, 14], [52, 13]);
  T([59, 9], [60, 8], [70, 8]);

  // Southpark passing loop.
  T([51, 29], [52, 30], [58, 30], [59, 29]);

  // Eastfield.
  T([62, 24], [63, 25]);
  T([64, 25], [65, 24]);
  T([66, 25], [67, 26]);

  // Harbour freight terminal.
  T([88, 25], [89, 24], [97, 24]);
  T([88, 25], [97, 25]);
  T([88, 25], [89, 26], [97, 26]);

  const west = addStation(L, "Westend");
  const central = addStation(L, "Central");
  const east = addStation(L, "Eastfield");
  const hill = addStation(L, "Hillcrest");
  const harbour = addStation(L, "Harbour");
  const south = addStation(L, "Southpark");
  plat(west, 5, 12, 23, 24, 25, 26);
  plat(central, 35, 44, 23, 24, 25, 26);
  plat(east, 68, 76, 24, 25, 26);
  plat(hill, 62, 69, 8, 9);
  plat(harbour, 90, 97, 24, 25, 26);
  plat(south, 52, 58, 29, 30);

  // Platform exit signals (two-way so trains can run through either way).
  for (const y of [23, 24, 25, 26]) { sig(12, y, E); sig(35, y, W); sig(44, y, E); }
  for (const y of [24, 25, 26]) { sig(68, y, W); sig(76, y, E); sig(90, y, W); }
  for (const y of [8, 9]) sig(62, y, W);
  for (const y of [29, 30]) { sig(58, y, E); sig(52, y, W); }

  // Main line block signals, one-way to keep right-hand running.
  sig(21, 24, W, 1); sig(21, 25, E, 1);
  sig(27, 24, W, 1); sig(27, 25, E, 1);
  sig(52, 24, W, 1); sig(52, 25, E, 1);
  sig(57, 24, W, 1); sig(57, 25, E, 1);
  sig(61, 25, E, 1);

  // Passing loop on the single-track branch. Single-track sections get no
  // signals in between, so a train only enters one when it can get through.
  sig(52, 14, N); sig(53, 14, N); sig(52, 17, S); sig(53, 17, S);

  const line = (name, type, stops, trains) => {
    L.lines.push({ id: "l" + L.nextId++, name, color: LINE_COLORS[L.lines.length % LINE_COLORS.length], type, stops, trains, circular: false });
  };
  line("RE 1", "regional", [west, central, east], 3);
  line("S 2", "commuter", [central, hill], 2);
  line("RB 3", "regional", [west, central, south, east], 1);
  line("IC 4", "express", [west, east], 1);
  line("G 5", "freight", [harbour, west], 1);
  return L;
}
