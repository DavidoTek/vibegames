// The 7 PANES components: how each is checked, prize files, and hints.

import { file } from "./fs.js";

export const SYSTEM_DIR = "C:\\PANES\\SYSTEM";

export const COMPONENTS = [
  { n: 1, name: "Memory manager", label: "HIMEM.SYS loaded", file: null },
  { n: 2, name: "Display driver", label: "VIDEO.DRV", file: "VIDEO.DRV" },
  { n: 3, name: "Mouse driver", label: "MOUSE.SYS", file: "MOUSE.SYS" },
  { n: 4, name: "Sound driver", label: "SOUND.DRV", file: "SOUND.DRV" },
  { n: 5, name: "Keyboard driver", label: "KEYBOARD.DRV", file: "KEYBOARD.DRV" },
  { n: 6, name: "Colour palette", label: "COLORS.PAL", file: "COLORS.PAL" },
  { n: 7, name: "PANES kernel", label: "PANES.KRN", file: "PANES.KRN" },
];

export function bootOk(boot) {
  return !!(boot && boot.himem && boot.dosHigh && boot.files >= 30);
}

// Returns [{ ...component, ok, problem }] for the current disk and booted config.
export function check(fs, boot) {
  const sys = fs.get(SYSTEM_DIR);
  return COMPONENTS.map((c) => {
    if (!c.file) {
      let problem = null;
      if (!boot || !boot.himem) problem = "HIMEM.SYS was not loaded at boot";
      else if (!boot.dosHigh) problem = "DOS is not loaded HIGH (DOS=HIGH)";
      else if (!(boot.files >= 30)) problem = `FILES=${boot.files} is too low (needs 30)`;
      return { ...c, ok: !problem, problem };
    }
    const f = sys && sys.t === "d" ? sys.kids.find((k) => k.name === c.file && k.t === "f") : null;
    if (!f) return { ...c, ok: false, problem: `not found in ${SYSTEM_DIR}` };
    if (f.sig === c.file) return { ...c, ok: true, problem: null };
    if (c.file === "VIDEO.DRV" && f.sig && f.sig.startsWith("CORRUPT")) {
      return { ...c, ok: false, problem: "is corrupt (parts missing or out of order?)" };
    }
    return { ...c, ok: false, problem: "checksum mismatch. Nice try." };
  });
}

export function allOk(fs, boot) { return check(fs, boot).every((c) => c.ok); }

// Games drop their prize into their own folder; the player then MOVEs it.
export function awardPrize(fs, folder, name, header) {
  const d = fs.mkdirp(folder);
  const f = file(name, { bin: true, sig: name, size: 18000 + name.length * 997, text: header });
  fs.touch(f);
  fs.add(d, f);
  return [
    `${name} written to ${folder}\\`,
    `Mort says: now put it where PANES can find it:`,
    `  MOVE ${folder}\\${name} ${SYSTEM_DIR}`,
  ];
}

export const HINTS = {
  1: [
    "Watch the screen while the PC boots. Did everything load?",
    "CONFIG.SYS points at C:\\DOS\\HIMEM.SYS, but is it there? Check C:\\OLD_DOS. LABYRINT's README lists more settings. Use EDIT C:\\CONFIG.SYS, then REBOOT.",
    "MOVE C:\\OLD_DOS\\HIMEM.SYS C:\\DOS, then EDIT C:\\CONFIG.SYS: set DOS=HIGH and FILES=30, save, and type REBOOT.",
  ],
  2: [
    "Read C:\\PANES\\SYSTEM\\SPLIT.TXT. Four parts, four hiding places.",
    "Part 2: click the floppy on the desk to insert it, then A:. Part 3: CD C:\\TEMP and UNDELETE. Part 4: TYPE the files in C:\\MORT.",
    "In C:\\PANES\\SYSTEM: COPY /B VIDEO.001+A:\\VIDEO.002+C:\\TEMP\\VIDEO.003+C:\\MORT\\LUNCH.TXT VIDEO.DRV",
  ],
  3: [
    "Mort writes everything down. Even things he hides.",
    "Some files don't show up in a plain DIR. Try DIR /A in C:\\MORT. And watch the BIOS screen when the PC boots (REBOOT).",
    "CD C:\\MORT, UNZIP MOUSE.ZIP, password BYTE1994. Then MOVE MOUSE.SYS C:\\PANES\\SYSTEM.",
  ],
  4: [
    "Run C:\\GAMES\\QUEST\\QUEST. LOOK at everything and EXAMINE what you find.",
    "Light the lamp with the matches from the hut's drawer. The troll is hungry: the lake has fish if you have a rod. Read the door.",
    "SAY KEYBOARD at the door. PUT ROCK ON PEDESTAL before taking the crystal. Then WAKE HERMIT and GIVE CRYSTAL TO HERMIT.",
  ],
  5: [
    "Run C:\\GAMES\\NIBBLER\\NIBBLER and eat the numbers.",
    "Plan your turns early; the snake can't reverse. Losing all lives only restarts at level 1.",
    "Clear level 3, then MOVE C:\\GAMES\\NIBBLER\\KEYBOARD.DRV C:\\PANES\\SYSTEM.",
  ],
  6: [
    "Run C:\\GAMES\\BRIXX\\BRIXX.",
    "Where the ball hits the paddle sets its angle: hit it with the paddle's edge to aim. Catch the falling W, S and M capsules.",
    "Clear level 3, then MOVE C:\\GAMES\\BRIXX\\COLORS.PAL C:\\PANES\\SYSTEM.",
  ],
  7: [
    "LABYRINT needs the memory manager first (component 1).",
    "In the maze, press Space to open doors. One door needs a key card. Zap glitches with F to freeze them.",
    "Collect all 4 disks, use the exit terminal, then MOVE C:\\GAMES\\LABYRINT\\PANES.KRN C:\\PANES\\SYSTEM.",
  ],
};
