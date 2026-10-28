// Level maps. One character per 8x8 tile:
//   #  earth                 R  rock (cannot be dug)    d  soft soil (dig it)
//   T  twigs (beetles smash)  S  stone ant (solid)
//   ^  thorns (deadly)       ~  water (deadly)           L  leaf (jump-through, hides you)
//   |  grass stem (climb)    ,  grass tuft (hides you from birds)
//   o  pebble (2 ants push)  O  boulder, 2x2 (4 ants push)
//   P  old nest (start)      F  new nest (finish)
//   g  grasshopper           B  beetle                   f  firefly    *  glow mushroom
//   0-9  sign, text in `signs`
//
// Maps are written as sections that are glued together left to right. Each
// section is bottom-aligned to ROWS rows and padded with spaces, so only the
// interesting rows need to be written out.

export const ROWS = 24;

const ground = (w, n = 7) => Array(n).fill("#".repeat(w));

function build(sections) {
  const rows = Array.from({ length: ROWS }, () => "");
  for (const s of sections) {
    if (s.length > ROWS) throw new Error("section too tall");
    const w = Math.max(...s.map((r) => r.length));
    const pad = ROWS - s.length;
    for (let y = 0; y < ROWS; y++) rows[y] += (y < pad ? "" : s[y - pad]).padEnd(w, " ");
  }
  return rows;
}

const tutorial = build([
  [ // the old nest, two bumps to practise jumping
    "                  ###           ",
    "  P  0      ##    ###     1     ",
    ...ground(32),
  ],
  [ // first gorge: needs a stone bridge
    "  2             ",
    "######     #####",
    "######     #####",
    "######     #####",
    ...ground(16, 4),
  ],
  [ // cliff: needs a stone step
    "     ##########                 ",
    "     ##########                 ",
    "3    ##########     4 ,,,,      ",
    ...ground(32),
  ],
  [ // bird country
    "            LLL|LLL                     ",
    "               |                        ",
    "               |                        ",
    "               |                        ",
    ",,,,           |          ,,,,,    ,,,  ",
    ...ground(40),
  ],
  [ // a pebble in a low tunnel
    "        ###############       ",
    "        ###############       ",
    "        ###############       ",
    "  5       o                   ",
    "################## ###########",
    ...ground(30, 6),
  ],
  [ // climb a stem
    "         |####################",
    "         |####################",
    "         |####################",
    "         |####################",
    "         |####################",
    "  6      |####################",
    ...ground(30),
  ],
  [ // dig down into the cave with the new nest
    "                          RRRRRRRRRRRRRRRRRR",
    "                       RRRRRRRRRRRRRRRRRRRRR",
    "                     RRRRRRRRRRRRRRRRRRRRRRR",
    "                    RRRRRRRRRRRRRRRRRRRRRRRR",
    "        dd          RRRRRRRRRRRRRRRRRRRRRRRR",
    "        dd          RRRRRRRRRRRRRRRRRRRRRRRR",
    "  7     dd          RRRRRRRRRRRRRRRRRRRRRRRR",
    "##############dd####RRRRRRRRRRRRRRRRRRRRRRRR",
    "##############dd######                     R",
    "##############dd######                     R",
    "##############                             R",
    "##############                             R",
    "##############  * 8       *       *    F   R",
    ...ground(44),
  ],
]);

const march = build([
  [ // the old nest
    "  P   0      ,,,,   ",
    ...ground(20),
  ],
  [ // a boulder next to a thorny gorge
    "  OO                    ",
    "  OO           ,,,,     ",
    "########      ##########",
    "########^^^^^^##########",
    ...ground(24, 5),
  ],
  [ // a cliff (an ancestor left a step) and a thorn pit with a pillar
    "      ,,,                 ",
    "    ########^^^#^^^#######",
    "    ######################",
    "   S######################",
    ...ground(26),
  ],
  [ // open sand, a deep gorge
    "######                        ",
    "######                        ",
    "######      ,,,         ,,,,  ",
    "################     #########",
    "################     #########",
    "################     #########",
    "################^^^^^#########",
    ...ground(30, 3),
  ],
  [ // the grass begins: a river and a grasshopper
    " 1   g                        ",
    "########~~~~~~~~~~############",
    "########~~~~~~~~~~############",
    "########~~~~~~~~~~############",
    ...ground(30, 4),
  ],
  [ // a twig wall and a sleepy beetle
    "            TT                ",
    "            TT                ",
    "            TT                ",
    "            TT                ",
    "            TT          ##    ",
    " 2   B      TT          ##    ",
    ...ground(30),
  ],
  [ // up a stem, then leaf to leaf over the brambles
    "     |######  LL|LL   LL|LL   ##########",
    "     |######    |       |     ##########",
    "     |######    |       |     ##########",
    "     |######    |       |     ##########",
    "     |######    |       |     ##########",
    "     |######^^^^|^^^^^^^|^^^^^##########",
    ...ground(40),
  ],
  [ // into the cave, a firefly, a wall of soft soil
    "        RRRRRRRRRRRRRRR",
    "      RRRRRRRRRRRRRRRRR",
    "    RRRRRRRRRRRRRRRRRRR",
    "    RRRRRRRRRRRRRRRRRRR",
    "    RRRRRRRRRRRRRRRRRRR",
    "    RRRRRRRRRRRRRRRRRRR",
    "    RRRRRRRRRRRRRRRRRRR",
    "    RRRRRRRRRRRRRRRRRRR",
    "                    ddd",
    "                    ddd",
    "                    ddd",
    "####                ddd",
    "####                ddd",
    "######        f     ddd",
    "######              ddd",
    "########            ddd",
    "########  3      *  ddd",
    ...ground(23),
  ],
  [ // an underground pool and a pebble
    "RRRRRRRRRRRRR",
    "RRRRRRRRRRRRR",
    "RRRRRRRRRRRRR",
    "RRRRRRRRRRRRR",
    "RRRRRRRRRRRRR",
    "RRRRRRRRRRRRR",
    "RRRRRRRRRRRRR",
    "RRRRRRRRRRRRR",
    "RRRRRRRRRRRRR",
    "RRRRRRRRRRRRR",
    "RRRRRRRRRRRRR",
    "RRRRRRRRRRRRR",
    "RRRRRRRRRRRRR",
    "             ",
    "             ",
    "             ",
    " *  o        ",
    "#######~~~~~#",
    ...ground(13, 6),
  ],
  [ // a floor of thorns under a low ceiling
    "RRRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRRR",
    "                         ",
    "                         ",
    "                         ",
    " *  ^^^^^^^   *          ",
    ...ground(25),
  ],
  [ // a heavy boulder in a tunnel
    "RRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRR",
    "RRRRRRRRRRRR  ",
    "RRRRRRRRRRRR  ",
    "RRRRRRRRRRRR  ",
    "   RRRRRRRRR  ",
    "   RRRRRRRRR  ",
    "    OO        ",
    "4   OO        ",
    "############  ",
    "############  ",
    ...ground(14, 5),
  ],
  [ // the new nest
    "RRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRR",
    "              R",
    "              R",
    "              R",
    "              R",
    "              R",
    "              R",
    "  *    *  F  *R",
    ...ground(15),
  ],
]);

// zones: where the scenery changes (tile x). Everything from `cave` on is dark
// underground. birds.zones are tile ranges where birds hunt.
export const LEVELS = [
  {
    id: "tutorial",
    name: "First Steps",
    blurb: "A short walk that teaches everything.",
    map: tutorial,
    ants: 12,
    stars: [6, 9],
    zones: { grass: 120, cave: 194 },
    birds: { zones: [[72, 118]], every: [6, 8], first: 2.5 },
    signs: [
      "WELCOME, LITTLE ANT! YOU ARE THE ONE WITH THE GOLDEN MARK. WALK WITH A/D OR THE ARROWS, JUMP WITH SPACE.",
      "THE COLONY FOLLOWS YOUR SCENT TRAIL. LEAD THEM EAST TO A SAFE NEW HOME UNDER THE GROUND.",
      "TOO WIDE TO JUMP! STAND AT THE EDGE AND HOLD X. YOU TURN TO STONE AND BECOME A BRIDGE, THEN YOU WAKE UP AS THE NEXT ANT.",
      "TOO HIGH! WALK UP TO THE CLIFF AND HOLD X TO BECOME A STEP. STUCK SOMEWHERE? HOLD X, TOO.",
      "BIRDS HUNT HERE! WHEN ONE SCREECHES, HIDE UNDER A LEAF OR IN TALL GRASS. EATEN ANTS ARE LOST FOR GOOD.",
      "A PEBBLE BLOCKS THE TUNNEL. PUSH IT! THE ANTS RIGHT BEHIND YOU HELP. THE NUMBER SHOWS HOW MANY ARE NEEDED.",
      "ANTS CAN CLIMB GRASS STEMS. HOLD W OR UP TO CLIMB, THEN WALK OFF AT THE TOP.",
      "SOFT SOIL! WALK INTO IT TO DIG, OR HOLD S OR DOWN TO DIG DOWNWARDS.",
      "THE NEW NEST! EVERY ANT THAT ARRIVES COUNTS. FEWER STONES MEAN MORE STARS.",
    ],
  },
  {
    id: "march",
    name: "The Long March",
    blurb: "Sand, birds, grass, beetles and a dark cave.",
    map: march,
    ants: 30,
    stars: [15, 22],
    zones: { grass: 100, cave: 204 },
    birds: { zones: [[10, 99]], every: [7, 11], first: 4 },
    signs: [
      "THE OLD NEST IS DRYING OUT. BIRDS HUNT ON THE OPEN SAND, SO STAY CLOSE TO THE GRASS TUFTS!",
      "A GRASSHOPPER! STAND ON IT AND JUMP FOR A HUGE LEAP.",
      "A SLEEPING BEETLE. WALK INTO IT TO WAKE IT UP. BEETLES SMASH TWIGS.",
      "IT IS DARK DOWN HERE. FIREFLIES LIKE TO KEEP ANTS COMPANY.",
      "A HEAVY BOULDER. IT TAKES FOUR ANTS TO PUSH IT. HOPEFULLY YOU SAVED SOME!",
    ],
  },
];
