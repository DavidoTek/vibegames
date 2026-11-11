// All text in one place: Blink's lines (subtitles), Mort's notes and the
// POST checklist.

export const POST = [
  { name: "CMOS clock", bad: "FAIL" },
  { name: "Memory test", bad: "FAIL" },
  { name: "Drive C:", bad: "FAIL" },
  { name: "Cooling", bad: "FAIL" },
  { name: "CPU", bad: "INFECTED" },
];

export const MISSION_TITLES = [
  "Insert Disk",
  "Checksum Error",
  "Parity Error",
  "Seek Error",
  "Thermal Event",
  "Moth to a Flame",
];

// Blink speaks in short DOS-flavoured lines. Arrays are said one after another.
export const SAY = {
  intro: [
    "Unknown device detected. That's you.",
    "I'm Blink. I'm the cursor. I used to have a prompt.",
    "Something on this disk got into memory. Now nothing boots.",
    "Mort left a note by his camp. West side. Go and read it.",
  ],
  tabEarly: "Write-protect tab. Read-only: nothing gets written onto this disk. Leave it.",
  needProbe: "Take Mort's probe first. It's on the crate.",
  gotProbe: "A debug probe. Zap a bug once to stun it, twice to patch it. Try it on that one.",
  firstPatch: "Patched. It's a firefly now. Much nicer.",
  gateOpen: "Drive A: is free. Down the ribbon cable. Mind the rail.",
  leverEarly: "Drive lever. Nothing to write yet.",
  ejectEarly: "EJECT. Not while we're standing in here.",
  board: [
    "This is the motherboard. Bus Boulevard, they call it.",
    "POST runs in order. First the clock, in the BIOS quarter. Follow me.",
  ],

  m1Start: "The clock thinks it's 1980. Bugs lifted the battery clip. Patch them, then pull the lever.",
  m1Bugs: "Bugs are still chewing on the clip. Patch them first.",
  m1Clip: "Battery's back. Now the clock wants a date. Month, day, year.",
  m1Hint: "Mort wrote the date on the BIOS chip. On top. There are stairs on the east side.",
  m1NoPower: "No power. The battery clip comes first.",
  m1Wrong: "Bad date. Mort wrote it on everything. Literally everything.",
  m1Done: ["Tick. Tick. CMOS clock... OK.", "Memory and drive C: are next. Either order. Memory is closer."],

  m2Locked: "Memory test hasn't started. The clock comes first.",
  m2Start: "Parity error. A red row lamp and a red column lamp cross at the bit that's lying. Stand on it and flip it.",
  m2Round2: "Next bank. Those bugs flip every bit they walk over. Patch them first.",
  m2Round3: "Last bank. Two liars this time.",
  m2Done: ["640K OK. 4096K OK. Memory test... OK."],
  m2Lift: "The HIMEM lift. High memory has the better view.",

  m3Locked: "Drive not detected. Fix the CMOS clock first.",
  m3Start: "BYTE.BMP is in four pieces. Carry each cluster to its numbered slot on the rail. Watch the head arm.",
  m3Arm: "Head crash! Stay clear of the arm.",
  m3Wrong: "Wrong slot. The numbers have to match.",
  m3Placed: "Cluster written.",
  m3Done: ["One file, one piece. Drive C:... OK."],
  tux: "A penguin. Mort said it would be the mascot one day.",

  m4Locked: "POST hasn't got this far. Clock, memory and drive first.",
  m4Start: "The CPU fan is jammed. Cat hair. Up the clip, along the base, then fin by fin. The pink fins are hot.",
  m4Hot: "Hot! Keep moving on the pink fins.",
  m4Clump: "One less hairball.",
  m4Done: ["Fan's turning. Cooling... OK.", "Something is watching us through the vent. It purrs."],

  m5Start: [
    "CPU... INFECTED. There it is. MOTH.COM.",
    "It's resident. Zap it and it copies itself straight back from memory.",
    "Moths. Light. The case LEDs! Switch on TURBO, down on the street.",
  ],
  m5Far: "Too far. It can't see that light from where it is.",
  m5Fly: "It's coming. Next LED, quick, before it gets bored.",
  m5Led2: "Now POWER, up the ribbon cable at the front panel.",
  m5Led3: "It's at the front panel. Into drive A:! Open the write-protect tab, then pull the drive lever.",
  m5Bored: "It got bored and went back to the CPU. Start again with TURBO.",
  m5Protected: "Write protect error writing drive A:. Abort, Retry, Fail? ...It's off again. Open the tab first!",
  m5Nothing: "Nothing to write. Bring the Moth here first.",
  m5Written: "It's on the disk! Close the tab so it can't write itself back out, then hit EJECT.",
  m5TabOpen: "Writable.",
  m5TabClosed: "Protected.",
  m5EjectOpen: "Protect the disk first, or it writes itself straight back out.",
  m5Stun: "Stunned. That won't hold it for long.",
  end: ["All OK. Starting VIBE-DOS...", "C:\\> I have a prompt again. You should go. It's going to get busy in here."],

  hurt: "Careful. You're losing integrity.",
  gpf: "GENERAL PROTECTION FAULT. Reloading you from the last restore point.",
  restore: "Restore point saved.",
  secretPads: "That chime. PANES plays it when it starts.",
  screwAll: "Eight screws. Mort will never know where they were.",
};

export const NOTES = {
  mort0: "If you're reading this, you pressed TURBO. I told you not to.\n\nTake my probe. Bugs hate it.\n\n— Mort",
  sticker: "VIBETRON BIOS v2.1\nBIOS Date 04/12/94\n\n(Property of Mort. Hands off.)",
  hdd: "DO NOT COVER THIS HOLE.\nAlso do not climb in.\n\n— Mort",
  ram: "Even parity. If a row or a column lights up red, somebody in it is lying.\n\n— Mort",
  scribble: "MORT WAS HERE '94\n\n(and so was his screwdriver bit)",
};

export const OBJECTIVES = {
  note: "Read Mort's note",
  probe: "Take the debug probe",
  bug0: "Patch the bug (zap it twice)",
  descend: "Go down the ribbon cable",
  m1Go: "Go to the BIOS quarter",
  m1Bugs: "Patch the bugs at the battery",
  m1Clip: "Pull the battery clip lever",
  m1Date: "Set the clock to the BIOS date",
  m2: "Fix the memory in RAM Row",
  m3: "Defragment BYTE.BMP on drive C:",
  m3Carry: "Carry the cluster to its slot",
  m4: "Free the CPU fan",
  m5Led: "Lure the Moth with the LEDs",
  m5Tab: "Open the write-protect tab",
  m5Lever: "Pull the drive lever",
  m5Close: "Close the write-protect tab",
  m5Eject: "Press EJECT",
};
