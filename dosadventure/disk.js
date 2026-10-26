// The initial contents of Uncle Mort's hard disk and the BACKUP 2/2 floppy:
// every file, story text and puzzle clue lives here.

import { dir, file } from "./fs.js";

const bin = (name, size, extra = {}) => file(name, { bin: true, size, ...extra });
const exe = (name, id, size, extra = {}) => file(name, { bin: true, exe: id, size, attr: "AR", ...extra });
const txt = (name, text, extra = {}) => file(name, { text: text.replace(/^\n/, ""), ...extra });

export const BYTE_ART = `
      /\\_/\\
     ( o.o )    BYTE
      > ^ <     (the cat)
     /     \\
    (  | |  )
     \\_|_|_/~`;

export const BYTE_SLEEP_ART = `
              z
          z Z
     /\\_/\\
    ( -.- )_____
     \\__  ______)~
        \`-'  \`-'    BYTE (asleep on the monitor)`;

const README = `
==============================================================
                   HELLO FROM UNCLE MORT
==============================================================

Hey kiddo,

if you're reading this, the lawyer gave you my PC. Good.
Treat her well. Her name is VIBETRON and she has never
crashed (on purpose).

The best thing on this machine is PANES, a graphical
operating system I've been tinkering with. Windows! Icons!
A mouse pointer! It's going to be huge.

But I don't hand that out to just anybody. I took PANES
apart and hid the 7 pieces it needs. Some are broken setup
I never got around to fixing, some are prizes for beating
my games. If you can't beat my games, you don't deserve
my computer.

Put all 7 pieces back and type PANES. Until then, PANES
will tell you what's still missing. Try it now!

A few DOS basics, in case the youth has forgotten:
  DIR          list files           CD name    enter a folder
  CD ..        go up one folder     TYPE file  show a text file
  HELP         list all commands    HINT       if you're stuck
  PRINT file   print a file on the printer next to me

Love,
    Uncle Mort

P.S. Byte the cat lives with your aunt now. She says meow.
`;

const CONFIG = `
REM Mort's config. DON'T TOUCH (unless you know what you're doing)
DEVICE=C:\\DOS\\HIMEM.SYS
DOS=LOW
FILES=10
BUFFERS=20
`;

const AUTOEXEC = `
@ECHO OFF
PROMPT $P$G
PATH C:\\DOS;C:\\UTILS
ECHO.
ECHO   Welcome to VIBETRON, kiddo. Start with:  TYPE README.TXT
ECHO.
`;

const TODO = `
TO DO
-----
[x] buy more floppies
[ ] fix CONFIG.SYS (LABYRINT keeps complaining about memory)
[ ] tell my sister to stop reading my files
[ ] remember the password for MOUSE.ZIP
      -> it's my cat's name + the year this machine was
         built. The BIOS knows the year. I wrote the cat's
         name in my diary, which I hid from my sister.
[ ] finish PANES
[ ] feed Byte
[ ] feed Byte again (she insists)
`;

const DIARY = `
DEAR DIARY  (Doris: KEEP OUT. This means you.)

Mar 02  Got a kitten! Named her BYTE. She is tiny and sleeps
        on top of the warm monitor all day.
Mar 09  Byte walked across the keyboard and typed
        "fffffggggj;;;;;" into DOS. DOS was not impressed.
Mar 14  Got a free UNIX clone off the BBS. Some student in
        Finland wrote it. It boots straight from DOS with
        LOADLIN (I put it in C:\\LINUX). Doris says it will
        never catch on. Doris also said that about the mouse.
Apr 03  Split VIDEO.DRV over some floppies. Made a mess of it.
Apr 12  Finished LABYRINT. There are NO secret walls in it.
        None. Heh.
Apr 20  Byte knocked my coffee into the printer. Byte is still
        the best cat. The printer is still the worst printer.
`;

const PETS = `
PETS ON OUR STREET
------------------
FLOPPY  - the neighbour's dog. Barks at the mailman every day at
          8 sharp. Good boy, but NOT my pet. Floppy ate my floppy
          (BACKUP 1/2). Ironic.
GOLDIE  - the goldfish at number 12. Has seen things.
SIR MEOWS-A-LOT - Doris's cat. We don't talk about him.
`;

const RECIPES = `
MORT'S FAMOUS RECIPES
---------------------
FLOPPY PANCAKES
  2 eggs, 1 cup flour, 1 cup milk. Pour into a square pan so
  they come out 3.5 inches. Do NOT insert into drive A:.

DEBUGGER'S COFFEE
  Coffee. More coffee. Keep away from Byte and the printer.

INSTANT NOODLES (COMPILE TIME: 3 MINUTES)
  Add water. Wait for the build. Eat over the keyboard.
`;

const SISTER = `
Doris,

if you are reading this: stop reading my files.

That includes this file.

- Mort
`;

const JOKE = `
@ECHO OFF
ECHO Why did the programmer quit his job?
PAUSE
ECHO Because he didn't get arrays.
ECHO.
ECHO How many programmers does it take to change a light bulb?
PAUSE
ECHO None. That's a hardware problem.
`;

const SPLIT = `
Note to self:

VIDEO.DRV was too big for one floppy, so I split it into
4 parts with SPLIT.EXE. To glue them back together:

    COPY /B VIDEO.001+VIDEO.002+VIDEO.003+VIDEO.004 VIDEO.DRV

(in the RIGHT ORDER, or the driver comes out scrambled)

Where the parts are:
  Part 1 - right here.
  Part 2 - on the floppy, BACKUP 2/2. I think it's lying on
           the desk. Pop it in and type A:
  Part 3 - oops. I think I deleted it in C:\\TEMP while
           cleaning up. DOS can UNDELETE, right?
  Part 4 - I renamed it so Doris won't find it. It's in my
           folder, disguised as my lunch notes.
`;

const PANES_README = `
PANES 1.0 - SYSTEM REQUIREMENTS
-------------------------------
PANES needs these 7 components:

  1. Memory manager   HIMEM.SYS loaded at boot (see CONFIG.SYS)
  2. VIDEO.DRV        display driver
  3. MOUSE.SYS        mouse driver
  4. SOUND.DRV        sound driver
  5. KEYBOARD.DRV     keyboard driver
  6. COLORS.PAL       colour palette
  7. PANES.KRN        the PANES kernel

Files 2-7 go into C:\\PANES\\SYSTEM.
Type PANES to check what is still missing.
`;

const LAB_README = `
LABYRINT 3D  -  by Mort  (c) 1994
=================================
Find the 4 floppy disks hidden in the maze and bring them to
the exit terminal. Watch out for the glitches!

SYSTEM REQUIREMENTS
  - 386 or better
  - 2048K extended memory (HIMEM.SYS must be loaded)
  - DOS=HIGH in CONFIG.SYS
  - FILES=30 or more in CONFIG.SYS

CONTROLS
  Arrows / WASD   move and turn      Q / E   strafe
  Space           use (doors)        F       zap a glitch
  M or Tab        map                Esc     quit

P.S. There are absolutely no secret walls in this maze.
`;

const QUEST_README = `
THE QUEST FOR THE SINGING CRYSTAL
A text adventure by Mort, 1994

Type short commands like LOOK, GO NORTH (or just N), TAKE LAMP,
EXAMINE TABLE, INVENTORY (or I). Type HELP inside the game for
more. Your progress is saved when you QUIT.

Beat it and the hermit will hand you something nice.
`;

const NIB_README = `
NIBBLER - by Mort, 1994
Eat the numbers 1 to 9 in order. Don't bite yourself.
Clear all 3 levels for a prize.
Arrows / WASD to steer. Esc to quit.
`;

const BRIXX_README = `
BRIXX - by Mort, 1994
Break all the bricks in 3 levels. Level 2 features a very
handsome cat.
Mouse / touch drag or arrow keys to move. Space to launch.
`;

const UTILS_README = `
UNZIP.EXE - extracts a .ZIP archive into the current folder.
            Usage: UNZIP FILE.ZIP
            Asks for the password if the archive has one.
`;

const LINUX_README = `
Linux 1.0 for the VIBETRON
--------------------------
To boot Linux from DOS:   LOADLIN VMLINUZ
To get back to DOS:       exit   (in Linux)

Mort's notes: log in with any name. Your DOS drive shows up
as /dos (read-only, so Byte can't break anything).
`;

const OLDJUNK = `
Moved some old DOS stuff in here when I upgraded to
VIBE-DOS 6.2. Hope nothing needed it.
- M
`;

const HISCORE = `
NIBBLER HALL OF FAME
  1. MORT ......... 9999
  2. MORT ......... 9998
  3. BYTE ........... 12  (walked across the arrow keys)
`;

const BYTE_TXT = `
A photo of Byte, scanned at 1 bit per pixel:
${BYTE_ART}
`;

export function makeDisk() {
  const C = dir("", [
    dir("DOS", [
      exe("ATTRIB.EXE", "attrib", 11165), exe("EDIT.COM", "edit", 413),
      exe("FORMAT.COM", "format", 22916), exe("MEM.EXE", "mem", 32150),
      exe("MORE.COM", "more", 2618), exe("SCANDISK.EXE", "scandisk", 124262),
      exe("TREE.COM", "tree", 6898), exe("UNDELETE.EXE", "undelete", 26420),
      bin("EGA.CPI", 58873), bin("KEYBOARD.SYS", 34598), bin("EMM386.EXE", 120926),
    ], { date: "03-10-94", time: "6:20a" }),
    dir("OLD_DOS", [
      bin("HIMEM.SYS", 29136, { sig: "HIMEM", text: "HIMEM.SYS - XMS memory manager" }),
      txt("OLDJUNK.TXT", OLDJUNK),
    ], { date: "03-10-94", time: "6:25a" }),
    dir("UTILS", [exe("UNZIP.EXE", "unzip", 29378), txt("README.TXT", UTILS_README)], { date: "03-12-94" }),
    dir("LINUX", [
      exe("LOADLIN.EXE", "loadlin", 32208), bin("VMLINUZ", 309456, { text: "Linux kernel image 1.0.0" }),
      txt("README.TXT", LINUX_README),
    ], { date: "03-14-94", time: "11:48p" }),
    dir("MORT", [
      txt("TODO.TXT", TODO, { date: "04-20-94" }),
      txt("DIARY.TXT", DIARY, { attr: "AH", date: "04-20-94", time: "11:12p" }),
      txt("PETS.TXT", PETS),
      bin("LUNCH.TXT", 9120, { sig: "VIDEO.P4", text: "SPLIT.EXE archive - VIDEO.DRV part 4 of 4", date: "04-03-94" }),
      txt("RECIPES.TXT", RECIPES),
      txt("SISTER.TXT", SISTER),
      txt("JOKE.BAT", JOKE),
      bin("MOUSE.ZIP", 14988, { zip: { password: "BYTE1994", name: "MOUSE.SYS", size: 31270, sig: "MOUSE.SYS", text: "MOUSE.SYS - mouse driver for PANES 1.0" }, text: "PK\u0003\u0004 ZIP archive (password protected)" }),
    ], { date: "04-20-94" }),
    dir("GAMES", [
      dir("QUEST", [exe("QUEST.EXE", "quest", 48211), txt("README.TXT", QUEST_README)], { date: "02-11-94" }),
      dir("NIBBLER", [exe("NIBBLER.EXE", "nibbler", 22104), txt("HISCORE.DAT", HISCORE), txt("README.TXT", NIB_README)], { date: "01-30-94" }),
      dir("BRIXX", [exe("BRIXX.EXE", "brixx", 61733), txt("README.TXT", BRIXX_README)], { date: "03-01-94" }),
      dir("LABYRINT", [exe("LABYRINT.EXE", "labyrint", 182440), txt("README.TXT", LAB_README)], { date: "04-12-94" }),
    ], { date: "01-30-94" }),
    dir("PANES", [
      exe("PANES.EXE", "panes", 96512),
      txt("README.TXT", PANES_README),
      dir("SYSTEM", [
        bin("VIDEO.001", 12000, { sig: "VIDEO.P1", text: "SPLIT.EXE archive - VIDEO.DRV part 1 of 4", date: "04-03-94" }),
        txt("SPLIT.TXT", SPLIT, { date: "04-03-94" }),
      ], { date: "04-03-94" }),
    ], { date: "04-03-94" }),
    dir("TEMP", [bin("~WRL0001.TMP", 4096)], {
      date: "04-20-94",
      del: [bin("VIDEO.003", 11200, { sig: "VIDEO.P3", text: "SPLIT.EXE archive - VIDEO.DRV part 3 of 4", date: "04-03-94" })],
    }),
    file("COMMAND.COM", { bin: true, size: 54619, attr: "RSH", date: "03-10-94", time: "6:20a" }),
    txt("AUTOEXEC.BAT", AUTOEXEC, { date: "04-12-94" }),
    txt("CONFIG.SYS", CONFIG, { date: "04-12-94" }),
    txt("README.TXT", README, { date: "04-21-94", time: "9:00p" }),
  ]);

  const A = dir("", [
    bin("VIDEO.002", 12000, { sig: "VIDEO.P2", text: "SPLIT.EXE archive - VIDEO.DRV part 2 of 4", date: "04-03-94" }),
    txt("BYTE.TXT", BYTE_TXT, { date: "03-02-94" }),
  ]);

  return { C: { label: "MORT_HD", serial: "1994-0412", root: C }, A: { label: "BACKUP_2", serial: "0B17-E5ED", root: A } };
}
