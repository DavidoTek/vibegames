# DOS Adventure: design plan

A puzzle/exploration game played entirely on an old CRT monitor. The player
pokes around a fictional DOS machine with real-feeling commands, repairs it,
and beats seven minigames. Some are puzzles in the shell itself and some are
programs on the disk. Once all seven are solved, a GUI operating system boots
on the CRT and a "You won" window pops up.

Expected play time: 30–60 minutes. Works with a keyboard and mouse, and on
phones with touch.

---

## 1. Story and framing

Your eccentric **Uncle Mort** left you his old PC. A sticky note is taped to
the monitor bezel:

> *"The good stuff is in PANES. But I took it apart so nobody unworthy could
> run it. Put the 7 pieces back and it's yours. Start with README.TXT. — Mort"*

- **VIBE-DOS 6.2** is the fictional DOS. **PANES 1.0** is the fictional GUI.
  The names are made up so no real trademarks are used.
- Mort hid the seven parts PANES needs. Some are broken shell setup (config,
  split files, a locked archive). The rest are prizes for beating his games:
  *"If you can't beat my games, you don't deserve my computer."*
- Mort's personality comes through his files (diary, to-do lists, recipes,
  angry notes to his sister). That's where the clues are, and it makes
  exploring fun.
- His cat **Byte** turns up everywhere: ASCII art, a sprite in BRIXX, a photo
  in the GUI.

### The 7 PANES components (= the 7 minigames)

| # | Component      | Where it comes from                            | Kind           |
|---|----------------|------------------------------------------------|----------------|
| 1 | Memory manager | Fix `CONFIG.SYS` so `HIMEM.SYS` loads, reboot  | Shell puzzle   |
| 2 | `VIDEO.DRV`    | Reassemble a driver split into 4 parts         | Shell puzzle   |
| 3 | `MOUSE.SYS`    | Crack the password of `MOUSE.ZIP`              | Shell puzzle   |
| 4 | `SOUND.DRV`    | `QUEST.EXE`: text adventure                    | Text adventure |
| 5 | `KEYBOARD.DRV` | `NIBBLER.EXE`: text-mode snake                 | 2D game        |
| 6 | `COLORS.PAL`   | `BRIXX.EXE`: VGA breakout                      | 2D game        |
| 7 | `PANES.KRN`    | `LABYRINT.EXE`: raycaster maze                 | 3D game        |

Components 2–7 are files that must end up in `C:\PANES\SYSTEM\`.
Component 1 counts as done when the *running* system has HIMEM loaded and
`DOS=HIGH`, `FILES>=30`. Editing the file isn't enough: you have to reboot.

The games save their prize file into their own folder (for example
`C:\GAMES\NIBBLER\KEYBOARD.DRV`). The player then moves it with
`MOVE KEYBOARD.DRV C:\PANES\SYSTEM`. This step is intentional: it keeps the
shell part of the game, and it teaches `MOVE`/`COPY` before the VIDEO puzzle
needs them. The game's win screen spells out what to do.

Each component file has a hidden **signature**. It's an internal property
that `COPY`/`MOVE`/`REN` keep and that `EDIT`, `ECHO >` or `COPY CON` can't
create. A faked `VIDEO.DRV` is rejected with
*"VIDEO.DRV: checksum mismatch. Nice try."*

---

## 2. Progression

```
           ┌───────────────────── power on / boot ─────────────────────┐
           │  POST screen (BIOS date 04/12/94 ← clue for #3)           │
           │  CONFIG.SYS errors shown during boot (← clue for #1)      │
           └───────────────────────────┬───────────────────────────────┘
                                       ▼
                          C:\> TYPE README.TXT
                                       │
       ┌──────────┬──────────┬─────────┼──────────┬──────────┐
       ▼          ▼          ▼         ▼          ▼          │
  #1 CONFIG   #2 VIDEO   #3 MOUSE  #4 QUEST  #5 NIBBLER  #6 BRIXX
  (EDIT,      (A: floppy, (DIR /A,  (text     (snake)     (breakout)
   MOVE,       UNDELETE,   ATTRIB,   adv.)
   REBOOT)     COPY /B)    UNZIP)
       │
       ▼ HIMEM loaded
  #7 LABYRINT (refuses to start without extended memory and FILES=30)
       │
       ▼   all 7 in place
  C:\> PANES   →  GUI boots  →  "You won!" window
```

- Six of the seven are open from the start, so a player who gets stuck can
  try another one.
- Only LABYRINT is gated, behind #1. The gate uses classic DOS error messages
  that point at the fix
  (*"LABYRINT requires 2048K of extended memory. 0K available. Check
  CONFIG.SYS."*).
- `PANES` (or `C:\PANES\PANES.EXE`) acts as the progress checker. Run before
  everything is in place, it prints a checklist of what's missing and where
  it looks. Once all 7 are present it boots the GUI.
- The **sticky note** on the bezel mirrors the checklist outside the CRT. All
  7 lines start unchecked and get ticked as components are installed. It can
  be clicked to enlarge.

---

## 3. Presentation and UI

### 3.1 Scene layout (desktop)

```
┌───────────────────────────────────────────────────────────────────┐
│ ‹ Games   ⚙                                                       │
│                                                                   │
│        ┌───────────────────────────────────────┐   ┌─────────┐    │
│        │ ┌───────────────────────────────────┐ │   │ printer │    │
│        │ │                                   │ │   │ ░░░░░░░ │    │
│        │ │     CRT screen (640×400 virtual)  │ │   └────┬────┘    │
│        │ │     curved, scanlines, glow       │ │  ┌─────┴─────┐   │
│        │ │                                   │ │  │ printouts │   │
│        │ └───────────────────────────────────┘ │  └───────────┘   │
│ [note] │  VIBETRON 14"                ● (pwr)  │                  │
│        └───────────────┬───────────────────────┘                  │
│        ┌───────────────┴───────────────────────┐   ╔══════╗       │
│        │ [=== A: ===]  ▪HDD ▪PWR    [RESET]    │   ║FLOPPY║ ← desk│
│        └───────────────────────────────────────┘   ╚══════╝       │
└───────────────────────────────────────────────────────────────────┘
```

- **Monitor**: a beige bezel built from HTML/CSS: rounded plastic, model
  label "VIBETRON 14", power button with LED. A sticky note is stuck to the
  left edge.
- **PC case** under the monitor: a 3.5" floppy slot (drive A:), HDD and power
  LEDs, and a RESET button. The HDD LED flickers on disk access and the
  floppy LED lights while A: is being read.
- **Floppy disk** on the desk, labelled *"BACKUP 2/2 — Mort"*. Click or drag
  it into the slot to insert it, and click the eject button to take it out.
  Until then, `A:` gives the classic
  *"Not ready reading drive A — Abort, Retry, Fail?"*
- **Dot-matrix printer**: the in-game `PRINT file` command makes a paper
  sheet slide out (with a printer sound). Printouts stay on the desk as HTML
  overlays you can click to enlarge, drag or crumple (dismiss), up to 6. This
  is the "print text files" feature, and it's also a usability win: you can
  keep a clue visible (the LABYRINT requirements, say) while editing
  `CONFIG.SYS` on screen.
- The background is a dim desk with a warm lamp gradient. Outside the
  monitor everything stays muted so the CRT is the focal point.
- Top-left: the `‹ Games` chip (`href="../"`) and a ⚙ settings chip, styled
  like the other games.

### 3.2 Phone layout

```
┌──────────────────────┐
│ ‹ Games  ⚙  📝 🖨 💾 │  ← note, printouts tray, floppy (insert/eject)
│ ┌──────────────────┐ │
│ │  CRT (bezel thin)│ │
│ │                  │ │
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │ context controls │ │  ← changes with the active program
│ └──────────────────┘ │
└──────────────────────┘
```

- In portrait the monitor fills the width and the bezel gets thinner. The
  case, printer and floppy fold into icon buttons in the top bar.
- 80×25 text on a ~360 px wide screen is ~4.5 px per char, which is too small
  to read comfortably. So there's a **zoom mode** for text: a pinch or a
  button zooms the CRT 2× and pans to follow the cursor line. Landscape is
  recommended for the games, with a dismissible hint.
- **Context controls** under the CRT:
  - *Shell:* `⌨` (focuses a hidden `<textarea>` to bring up the native
    keyboard), `Tab`, `↑`, `↓`, `Esc`, `Enter`, plus quick chips `DIR`,
    `CD ..`, `TYPE `, `CLS`, `HELP`.
  - *Tap to insert:* tapping a word on the CRT (a file name in `DIR` output,
    say) types it at the prompt. This makes the shell usable on a phone
    without much typing.
  - *Editor:* arrows, Home/End, `Esc` (save/quit dialog), `⌨`.
  - *Games:* D-pad plus 1–2 action buttons. BRIXX uses drag on the screen,
    and LABYRINT uses a virtual stick on the left half and Zap/Use buttons
    on the right.
- Mobile keyboards send unreliable `keydown`s, so the hidden textarea's
  `input`/`beforeinput` events are turned into key presses.

### 3.3 Start screen and power-on

1. On load the monitor is **off**: a dark glass reflection, with the title
   "DOS Adventure" and *"Press the power button"* printed on the desk. The
   power LED pulses gently; with `prefers-reduced-motion` it's static.
2. Clicking power (or pressing any key) is the user gesture that unlocks
   WebAudio. It plays a CRT "thunk" plus a degauss hum, and the picture
   warms up as a horizontal line that expands. This is short and dim:
   **no flashes**.
3. **POST**: *VIBETRON BIOS v2.1, BIOS Date 04/12/94*, memory count-up
   `640K OK`, `Extended 4096K`, drive detection, a beep.
4. *"Starting VIBE-DOS..."*. CONFIG.SYS lines run with their errors shown
   (*"HIMEM.SYS: file not found — C:\DOS\HIMEM.SYS"*), then AUTOEXEC.BAT
   echoes Mort's greeting, then the prompt `C:\>`.
5. Any key skips the boot animation. A returning player (with a save) gets
   the same boot, but shortened.

### 3.4 Settings (⚙)

- CRT effect: *Full / Light / Off*. Off is a crisp pixel canvas, useful for
  readability and weak GPUs.
- Sound: on/off, and keyboard click sounds on/off.
- Text zoom (phones).
- *Reset progress* asks for confirmation, then wipes the save and powers the
  monitor off.

---

## 4. Technical architecture

### 4.1 Libraries

**None needed.** Everything is hand-rolled to match the repo's
dependency-free style:
- The CRT effect is a small raw **WebGL1 fragment shader**, with a Canvas 2D
  fallback.
- The 3D game is a **software raycaster** writing into the 320×200
  framebuffer. That's also what a real DOS game would do, so three.js would
  only get in the way of the look.

(If we later want a 3D-modelled monitor/desk scene, three.js could be
vendored like in `jumper/`, but the CSS bezel is lighter and reads better
on phones.)

### 4.2 Files

```
dosadventure/
  index.html        markup: desk, monitor bezel, case, printer, floppy, overlays, controls
  style.css
  meta.json         { name, description, tags, thumbnail, accent, controls }
  thumbnail.svg     CRT with a DOS prompt, 16:9
  plan.md           this file
  main.js           bootstrap, layout, main loop (rAF, dt clamped to 1/20), input routing,
                    save/load, desk objects (floppy, printer, sticky note), settings
  crt.js            WebGL CRT post-process + 2D fallback
  screen.js         Screen: text mode 80×25 + mode 13h 320×200 → 640×400 canvas
  font.js           8×16 bitmap font (CP437 subset), own design, stored as hex rows
  music.js          8-bit soundtrack: sequencer, pulse/triangle/noise voices, tracks
  audio.js          PC speaker (square-wave beeps/melodies), floppy seek, HDD clicks,
                    printer, key clicks; PANES startup chime (SOUND.DRV payoff)
  fs.js             virtual file system (8.3 names, attributes, dates, undelete list)
  disk.js           initial disk contents: every file, text and clue; drive A:
  term.js           scrolling terminal + line editor with promise-based readLine/readKey
  shell.js          COMMAND.COM: parser, commands, history, completion, batch files
  edit.js           EDIT.COM full-screen editor
  progress.js       the 7 component checks, sticky-note state, hint texts
  apps/quest.js     #4 text adventure
  apps/nibbler.js   #5 snake
  apps/brixx.js     #6 breakout
  apps/labyrint.js  #7 raycaster
  apps/panes.js     final GUI + "You won" window
  apps/linux.js     easter egg: Linux 1.0 boot + mini Unix shell (9.1)
```

The module-per-subsystem split follows `disco-effects/`. Every file is an ES
module imported with a relative URL.

### 4.3 Rendering pipeline

```
Program ──draws──▶ Screen (text cells or 320×200 indexed pixels)
                     │  rasterise (font atlas / palette lookup), only when dirty
                     ▼
             640×400 "signal" canvas  ──texture──▶  CRT shader  ──▶  visible <canvas>
```

- **Text mode**: 80×25 cells, each with `char`, `fg`, `bg` and `blink`. The
  16-colour CGA palette is used. With the 8×16 font that gives 640×400
  exactly. There's a blinking underline cursor, and a blink attribute for
  things like the `PANES` checklist warning.
- **Mode 13h**: 320×200 bytes (palette indices), 256-entry VGA palette,
  scaled 2× to 640×400. A program calls `screen.setMode("text" | "vga")`.
- **Visible canvas** is sized to its CSS box × `devicePixelRatio` (capped at
  2), as the AGENTS conventions require, and redrawn on `resize`.
- **CRT shader** (uniforms: time, strength):
  - barrel distortion, with black outside the curved area and rounded
    corners
  - scanlines and an aperture-grille mask
  - a cheap bloom/glow from a 5-tap blur of bright pixels
  - vignette
  - very slight static noise
  - a horizontal refresh band that rolls slowly; it's subtle, and off with
    reduced motion
  - a faint reflection highlight
  No full-screen flicker or strobing anywhere.
- **Fallback** (no WebGL, or CRT *Off*): draw the signal canvas with
  `imageSmoothingEnabled = false` and put CSS scanlines over it.
- Screen coordinates for pointer input (tap-to-insert, BRIXX paddle, PANES
  mouse) are mapped back through the same barrel distortion so taps hit what
  you see.

### 4.4 Program interface

Everything that takes over the screen (shell, editor, games, PANES) is a
`Program`:

```js
class Program {
  start(sys, args) {}   // sys = { screen, fs, audio, shell, progress, exit(code), ... }
  update(dt) {}         // fixed-ish step; dt clamped
  draw(screen) {}
  key(ev) {}            // normalised: { key, ctrl, shift, alt, type: "down"|"up" }
  pointer(ev) {}        // CRT-space coords (0..639, 0..399) + type
  controls() {}         // which touch control set to show
  stop() {}
}
```

- The shell runs programs and gets control back when they call `sys.exit()`.
- `Esc` in a game opens *"Quit to DOS? (Y/N)"*.
- All games pause automatically when the tab is hidden.

### 4.5 File system

- A tree of `Dir` / `File` nodes on drives `C:` and `A:`. Each node has:
  - an upper-case 8.3 name (validated; invalid names give
    *"Invalid filename"*)
  - a size and a date/time, in the 1993–94 range
  - attributes `R H S A`
  - for files, either `text` or `kind: "exe"` with a program id;
    pseudo-binary files have a `sig` (signature) and display as garbage
    glyphs in `TYPE`/`EDIT`
- Every directory keeps a `deleted[]` list, which `UNDELETE` uses. Puzzle #2
  places one file there from the start.
- Wildcards `*` and `?` work in `DIR`, `DEL`, `COPY` and `MOVE`.
- **Persistence**: one `localStorage` key, `dosadventure.save.v1`. It stores
  the serialized C: drive, the floppy state, the booted config, the solved
  set, stats, QUEST state and settings. Writes are debounced, wrapped in
  `try/catch` (same pattern as `store` in `sudoku3d/game.js`), and also
  happen on `visibilitychange` and power-off. Drive A: is read-write like a
  real floppy, so it's saved too.

---

## 5. The shell (COMMAND.COM)

Prompt `C:\GAMES>` (`$P$G` style). Commands, file names and switches are
case-insensitive. You get 32 lines of history with ↑/↓, Tab completion of
commands and file names, `Ctrl+C` to cancel, and `F3` to repeat the last
command (a nostalgic touch). Error messages are the classic ones:
*"Bad command or file name"*, *"File not found"*, *"Invalid directory"*,
*"Access denied"*, *"Required parameter missing"*, *"Invalid switch"*.

| Command | Notes |
|---|---|
| `HELP [cmd]` | List of commands / usage for one. |
| `DIR [path] [/W] [/P] [/A[:H]]` | Classic layout: volume label `MORT_HD`, serial, `<DIR>`, sizes with thousands separators, dates, totals and "bytes free". `/A` shows hidden entries. Output longer than the screen pauses with *"Press any key to continue . . ."* |
| `CD` / `CHDIR`, `CD ..`, `CD \`, `C:`, `A:` | `A:` without a floppy → *Abort, Retry, Fail?* prompt (R retries after inserting the disk). |
| `TYPE file` | Prints a text file and pages long ones automatically (`-- More --`). Binary files print garbage plus beeps (`BEL` chars), like the real thing. |
| `MORE < file`, `TYPE file \| MORE` | Accepted as aliases for paging. |
| `PRINT file` | Prints to the desk printer (see 3.1). |
| `EDIT [file]` | Full-screen editor (5.1). |
| `COPY src dst`, `COPY /B a+b+c dst`, `COPY CON file` | Concatenation is needed for #2. `COPY CON` ends with `Ctrl+Z`, with an on-screen `^Z` button on touch. |
| `MOVE src dst`, `REN old new`, `DEL` / `ERASE` | Wildcards. `DEL *.*` asks *"Are you sure (Y/N)?"*. |
| `MD`, `RD`, `TREE` | |
| `ATTRIB [+H\|-H\|+R\|-R] [file]` | Without arguments it lists attributes, hidden files included. |
| `UNDELETE [file]` | Lists deleted files as `?IDEO.003` and asks for the first letter, like MS-DOS 5. |
| `UNZIP file` | Asks for a password if the archive is protected (#3). |
| `MEM` | Shows conventional and extended memory, with *"HIMEM not loaded"* when it isn't. This is the feedback for #1. |
| `VER`, `DATE`, `TIME`, `VOL`, `CLS`, `ECHO [text] [> / >> file]`, `EXIT` | `DATE`/`TIME` show the frozen 1994 date. |
| `REBOOT` (and the RESET button on the case) | Warm reboot: runs POST and CONFIG.SYS again. Needed for #1. |
| `HINT` | Escalating hints (3 per unsolved component; see 7). |
| `PANES` | Checklist, or the final boot. |
| *program name* | Runs a `.EXE` / `.COM` / `.BAT` from the current dir or `PATH` (`C:\DOS;C:\UTILS`). |

- **Batch files**: a tiny interpreter that runs one command per line and
  supports `@ECHO OFF`, `ECHO`, `REM`, `PAUSE` and `CLS`. That's enough for
  `AUTOEXEC.BAT` and a few joke `.BAT` files of Mort's.
- **Small jokes** (the three bigger secrets are in section 9): `FORMAT C:` → *"Nice try. — Mort"*. `WIN` → *"Bad command
  or file name. (Mort says: it's called PANES.)"*. `CAT` → ASCII Byte.
  `XYZZY` → *"Nothing happens."* `DIR` in `C:\TEMP` shows `~WRL0001.TMP`
  junk.

### 5.1 EDIT.COM

- A blue full-screen editor in the style of MS-DOS EDIT: a menu bar
  (`File  Edit  Search  Help`, mostly decorative), a status line with
  line:col, and the cursor.
- Keys: arrows, Home/End, PgUp/PgDn, Enter, Backspace, Del, Tab, `Ctrl+S`
  save, `Esc` → *"Save changes? (Y/N/Esc)"*.
- `Alt` / `F10` opens the File menu: New, Save, Exit.
- Opening a pseudo-binary file shows garbage, and saving it destroys the
  signature. This is the anti-cheat mentioned in section 1.

---

## 6. The minigames

### #1 Memory manager: *"Fix the config"* (shell)

**Setup.** `C:\CONFIG.SYS` contains:
```
REM Mort's config. DON'T TOUCH (unless you know what you're doing)
DEVICE=C:\DOS\HIMEM.SYS
DOS=LOW
FILES=10
BUFFERS=20
```
`HIMEM.SYS` isn't in `C:\DOS`: Mort moved it to `C:\OLD_DOS\`.
`C:\GAMES\LABYRINT\README.TXT` lists the requirements: *extended memory
(HIMEM.SYS), DOS=HIGH, FILES=30 or more*.

**Clues.**
- The boot shows *"Error loading device driver C:\DOS\HIMEM.SYS: file not
  found"*.
- `MEM` says HIMEM isn't loaded.
- LABYRINT refuses to start with a specific reason, one problem at a time.

**Solution.** Either fix the path in `EDIT CONFIG.SYS` or
`MOVE C:\OLD_DOS\HIMEM.SYS C:\DOS`. Set `DOS=HIGH` and `FILES=30` (any value
from 30 to 99), then `REBOOT`. Boot then shows *"HIMEM is testing extended
memory... done."*

**Check.** It runs on the booted config. The parser is forgiving about
spaces and case, and ignores `REM` lines and unknown lines (unknown lines
print *"Unrecognized command in CONFIG.SYS"* at boot, which is authentic and
helpful). If CONFIG.SYS gets deleted, boot uses defaults and the puzzle is
still solvable by recreating the file with `EDIT`.

### #2 `VIDEO.DRV`: *"The split driver"* (shell)

**Setup.** `C:\PANES\SYSTEM\SPLIT.TXT`, a note from Mort:
*"Split VIDEO.DRV into 4 parts for the floppy backups. Glue them back with
COPY /B in the right order. Part 2 is on BACKUP 2/2. Part 3, oops, think I
deleted it in TEMP. Part 4 I renamed so my sister won't find it; it's next
to my lunch notes."*

| Part | Location | What's needed |
|---|---|---|
| `VIDEO.001` | `C:\PANES\SYSTEM\` | nothing |
| `VIDEO.002` | `A:\` on the floppy | insert the floppy (desk object), `A:` |
| `VIDEO.003` | deleted in `C:\TEMP\` | `UNDELETE`, type `V` |
| `VIDEO.004` | `C:\MORT\LUNCH.TXT` (renamed) | `TYPE` shows *"SPLIT.EXE part 4 of 4"* above garbage, so rename or use it directly |

The parts are pseudo-binary. `TYPE` on any of them shows a readable header
(*"VIDEO.DRV — part n of 4"*).

**Solution.** Something like
`COPY /B VIDEO.001+A:\VIDEO.002+VIDEO.003+LUNCH.TXT VIDEO.DRV` inside
`C:\PANES\SYSTEM`. Any route that ends with a correct `VIDEO.DRV` in that
folder counts. A wrong order or a missing part gives a `VIDEO.DRV` with a
bad signature. `PANES` then reports *"VIDEO.DRV is corrupt (parts out of
order?)"*.

### #3 `MOUSE.SYS`: *"Mort's password"* (shell)

**Setup.** `C:\MORT\MOUSE.ZIP`; `C:\UTILS\UNZIP.EXE`.
`C:\MORT\TODO.TXT` says:
*"zip password = my cat's name + the year this machine was built (the BIOS
knows)"*.

**Clues.**
- The cat's name is in the **hidden** file `C:\MORT\DIARY.TXT`. You find it
  with `DIR /A` or `ATTRIB`. It's a funny diary that mentions Byte several
  times.
- `C:\MORT\PETS.TXT` is a decoy: it's about the neighbour's dog *Floppy*.
- The year is on the POST screen (*BIOS Date 04/12/94*) → 1994. Rebooting
  shows it again. `VER` deliberately doesn't show the date, but it does say
  *"see BIOS"*.

**Solution.** `UNZIP MOUSE.ZIP` with password `BYTE1994` (case-insensitive)
extracts `MOUSE.SYS`, then `MOVE MOUSE.SYS C:\PANES\SYSTEM`. Each wrong
password prints *"Wrong password."* plus a slightly snarkier comment from
Mort, with no lockout. `BYTE94` gives a nudge: *"Four digits, Mort is
thorough."*

### #4 `SOUND.DRV`: `QUEST.EXE`, *"The Singing Crystal"* (text adventure)

A classic two-word parser adventure in text mode. Two status lines at the
top show the room name and `Moves: n`.

**Parser.** `GO N/S/E/W/U/D` (or just `N`), `LOOK`/`L`, `EXAMINE`/`X`,
`TAKE`/`GET`, `DROP`, `INVENTORY`/`I`, `OPEN`, `LIGHT`, `GIVE x TO y`,
`PUT x ON y`, `SAY word`, `READ`, `USE x [ON y]`, `CATCH`, `WAKE`, `HELP`,
`QUIT`. It has synonyms and ignores articles. Unknown words get *"I don't
know the word 'xyz'."*

**Map** (9 rooms):
```
                    [Hall of Echoes]
                           │ N (riddle door)
                    [Bridge Ledge]
                           │ N (troll bridge)
                     [Dark Tunnel]   (needs light)
                           │ N
  [Lake Shore] ─W─ [Forest Clearing] ─E─ [Hermit's Hut]
                           │ S
                      [Old Well]  → D → [Well Bottom]
```

**Puzzle chain.**
1. In the hut: `OPEN DRAWER` → matches. A lamp is on the table and a
   fishing rod leans on the wall. The hermit is asleep.
2. At the lake: `CATCH FISH` (needs the rod) → fish. There's also a smooth
   **rock**.
3. At the well: `USE ROD ON WELL` / `GO DOWN` fetches an old coin. It's an
   optional bonus point and a red herring for the troll.
4. `LIGHT LAMP` (needs the matches). Without light, the tunnel says *"It is
   pitch dark. Something with too many legs scuttles nearby."* and sends you
   back.
5. At the bridge the troll is hungry. `GIVE FISH TO TROLL` makes him step
   aside. Giving the coin gets *"Troll not want shiny. Troll want FOOD."*
6. The riddle door reads *"I have keys but open no locks. I have space but
   no room. You can enter, but never go outside."* → `SAY KEYBOARD`.
7. In the Hall of Echoes the crystal sits on a pressure plate. Taking it
   directly triggers a falling rock and you wake up back at the bridge (no
   real death). The solution is `PUT ROCK ON PEDESTAL` and then
   `TAKE CRYSTAL`.
8. Back at the hut: `WAKE HERMIT` and `GIVE CRYSTAL TO HERMIT`. He strikes
   it, and the PC speaker plays a little melody. The win text follows:
   *"SOUND.DRV written to C:\GAMES\QUEST\"*.

The state (room, inventory, flags) is saved, so leaving and coming back
continues. `RESTART` starts over.

### #5 `KEYBOARD.DRV`: `NIBBLER.EXE` (2D, text mode)

A snake game in the spirit of QBasic Nibbles, drawn **in text mode** with
CP437 block characters on the 80×25 grid. Each cell is split into top and
bottom halves (`▀▄█`), which gives an 80×50 play field.

- **3 levels** with different wall layouts: an open box, then pillars, then
  a spiral. Food is the digits `1`–`9` in order. Eating `9` clears the
  level. Speed goes up per level.
- **3 lives**, plus 1 per cleared level. Hitting a wall or yourself costs a
  life: the snake respawns short at the level start, but the next number to
  eat is kept. If all lives are lost, the game goes back to level 1. An eaten digit makes the snake grow by its value ×2.
- **Win**: clear level 3. *"KEYBOARD.DRV written to C:\GAMES\NIBBLER\"*.
- **Controls**: arrows/WASD; on touch, swipe on the CRT or the D-pad. Input
  is buffered (2 turns queued) so quick turns don't get lost.
- **Sound**: PC speaker blips on eat and a descending tone on death.

### #6 `COLORS.PAL`: `BRIXX.EXE` (2D, VGA mode 13h)

A breakout game in 320×200 with chunky VGA colours and palette-cycling
effects. The colour cycling is slow, small and never flashes.

- **3 levels**:
  1. rainbow rows
  2. a Byte-the-cat pixel portrait made of bricks
  3. the word `PANES` in bricks, with some 2-hit bricks
- The ball angle depends on where it hits the paddle. **Power-ups** drop
  from some bricks: wide paddle, slow ball, multi-ball. That's 3 types,
  kept simple.
- **3 lives**, plus 1 extra per cleared level. Losing all lives restarts
  the current level, not the whole game, so it stays casual.
- **Win**: clear level 3. *"COLORS.PAL written to C:\GAMES\BRIXX\"*.
- **Controls**: mouse move, touch drag anywhere on the CRT (relative
  movement), or ←/→. Space/tap launches the ball. Ball speed is sub-stepped
  so it doesn't tunnel through bricks.

### #7 `PANES.KRN`: `LABYRINT.EXE` (3D raycaster)

A Wolfenstein-style first-person maze, software-rendered into the 320×200
framebuffer. Gated behind #1.

- **Rendering**: DDA raycasting at a 66° FOV. Walls use 32×32 procedural
  textures: brick, circuit-board, server rack, plus a door texture. Floor
  and ceiling are flat colours with a dithered distance gradient. Distance
  shading uses precomputed palette ramps (a "colormap", like in Doom).
  Sprites are billboards sorted by distance and clipped with a per-column
  z-buffer. A bottom HUD bar (40 px) shows disks, health, and a little
  Mort-face that reacts to damage.
- **Goal**: collect **4 floppy disks** scattered in a ~24×24 handmade maze
  (ASCII map in the source), then reach the exit terminal. Sliding doors
  open with Use. One locked door needs a key card found in the maze.
- **Enemies**: 4–5 "glitches", flickery-looking sprites that are animated
  by sprite-frame swaps rather than screen flashes. They wander, and chase
  when they have line of sight. Touching one costs 25% health. `Zap` (the
  debugger beam) freezes a glitch for 6 s.
- **Health** hits 0 → *"GENERAL PROTECTION FAULT"* screen and a restart of
  the maze. Collected disks are kept, so it's forgiving.
- **Minimap**: `Tab`/`M`, or a touch button.
- **Secret**: one push-wall leads to Mort's dev room (easter egg, see 9.3).
- **Win**: exit with all 4 disks. *"PANES.KRN written to
  C:\GAMES\LABYRINT\"*.
- **Controls**: arrows/WASD move and turn, `Q`/`E` strafe, `Space` use,
  `Ctrl`/`F` zap. Mouse-look is optional via pointer lock. On touch: a
  virtual stick on the left half for move and turn, and Use/Zap buttons on
  the right.
- **Gate messages** (one at a time, in this order):
  1. *"LABYRINT requires 2048K of extended memory. 0K available.
     (Is HIMEM.SYS loaded? Check CONFIG.SYS)"*
  2. *"Not enough file handles. Set FILES=30 in CONFIG.SYS."*
  3. *"Not enough conventional memory. Try DOS=HIGH."*

---

## 7. Hints

`HINT` looks at what's still unsolved and gives the next hint for the
**lowest-numbered unsolved** component. `HINT n` picks a specific one.
Each component has 3 escalating hints: a nudge, then a pointer, then the
explicit answer. Example for #3:
1. *"Mort writes everything down. Even things he hides."*
2. *"Some files don't show up in a plain DIR. Try DIR /A in C:\MORT. And
   watch the screen when the PC boots."*
3. *"The password is BYTE1994."*

The number of hints used shows up in the final stats. There's no penalty
otherwise.

---

## 8. The finale: PANES

1. With all 7 in place, `PANES` prints *"Loading PANES 1.0..."* and a
   progress bar, one segment per component, each with its name.
2. Switch to a 640×400 16-colour "GUI mode". It's the VGA path at full
   resolution: the screen module gets a third mode, `gui`, with a
   640×400×4-bit framebuffer.
3. Splash: the PANES logo (four coloured window panes). If `SOUND.DRV` is
   installed, which it always is by then, a **startup chime** plays. It's
   the first "real" sound beyond the PC speaker beeps, and that's the
   payoff for #4.
4. The **desktop**: a teal background and icons (My Disk, Byte.bmp,
   Mort's Notes, Recycle Bin), with a mouse cursor. The cursor is the
   payoff for #3, and the colours are the payoff for #6.
5. A window opens: **"You won!"**. It holds a short thank-you note from
   Mort, plus stats: time played, commands typed, hints used, QUEST moves
   and secrets found (section 9). Buttons: `[ OK ]` and `[ Shut Down ]`.
6. `Shut Down` shows *"It's now safe to turn off your computer."* in orange
   on black. The power button now offers *"Play again"*, which resets the
   save after a confirmation.
7. Small extras on the desktop: Byte.bmp opens a window with a pixel cat,
   and windows can be dragged. Only light interaction; it's a victory lap,
   not a second game.

After winning, `PANES` can be run again any time. The sticky note shows
*"✓ All done! — Mort"*.

---

## 9. Easter eggs

Three optional secrets on top of the small jokes in section 5 (`FORMAT C:`,
`WIN`, `XYZZY`, …). None of them is needed to win, and `HINT` never
mentions them. Each one is tracked in the save, and the "You won!" window
shows **"Secrets found: n/3"**. That count is the only nudge that they
exist, and it gives players a reason to go back after winning.

### 9.1 The penguin: booting Linux 1.0 (shell)

It fits the period: Linux 1.0 came out in March 1994, one month before the
BIOS date of Mort's machine.

- **Discovery**:
  - `DIARY.TXT`, the file players read for #3 anyway, has an entry:
    *"Got a free UNIX clone off the BBS. Some student in Finland wrote it.
    Boots straight from DOS with LOADLIN. Sister says it'll never catch
    on."*
  - The directory `C:\LINUX\` holds `LOADLIN.EXE`, `VMLINUZ` and
    `README.TXT`.
  - Typing `ls`, `cat` (with a file argument), `clear` or `uname` in DOS
    gets *"Bad command or file name. (Wrong OS, buddy. See C:\LINUX)"*.
    Plain `CAT` still shows the ASCII Byte joke.
- **Trigger**: `LOADLIN VMLINUZ` (or just `LOADLIN`, which uses VMLINUZ by
  default).
  1. The CRT clears, and a period-style kernel log scrolls by:
     *"Linux version 1.0.0 … Console: colour EGA+ 80x25 … Calibrating delay
     loop.. ok - 33.28 BogoMIPS … hda: 120MB … VFS: Mounted root (ext2
     filesystem)"*. The text is invented, but the style is the real one.
  2. A big ASCII **Tux** shows up next to *"Mort drew this penguin. Says it
     will be the mascot one day."* This winks at the anachronism, since Tux
     only arrived in 1996.
  3. `vibetron login:` takes any name, and the password is ignored, then
     the prompt `mort@vibetron:~$` appears.
- **The mini shell** (`apps/linux.js`, reusing the shell's line editor and
  history):
  - `ls [-la]`, `cd`, `pwd`, and `cat`/`less` on a tiny fake home folder.
  - `/dos` is the C: drive mounted **read-only**: you can browse and `cat`
    Mort's files with Unix paths, but there's no way to bypass the puzzles.
  - `uname -a`, `whoami`, `date` (stuck in 1994) and `fortune`, with a
    handful of Mort-flavoured fortunes.
  - `sl` runs the ASCII steam locomotive, which also dates from 1993.
  - `vi` → *"You are now trapped. Type :q! to escape."*, and `:q!` works.
  - `emacs` → *"Not enough memory. Try vi."*
  - `rm -rf /` → *"Nice try. — Mort"*
  - `startx` → *"X needs PANES-compatible video. Ha. — Mort"*
  - `exit`, `logout`, `reboot`, `halt` → *"System halted."*, then a reboot
    back into VIBE-DOS with the normal POST.
- **Found** when the login prompt is reached.

### 9.2 Byte walks across the keyboard (shell)

- **Trigger**: the shell prompt is empty and idle for **90 s**. It fires at
  most once per session and never while a program is running.
- **What happens**: the PC "types" by itself with uneven key-click timing:
  `fffffffffffgggggggj;;;;;;;;;;;;;;;;;;;''''''`. Then it presses Enter,
  DOS answers *"Bad command or file name"*, and a line follows:
  *"(Byte walked across the keyboard. Byte is now asleep on the
  monitor.)"*.
- **On the desk**: a small cat silhouette walks along the front edge of
  the desk and then curls up on top of the monitor bezel. Clicking or
  tapping it plays a purr (filtered noise with a low LFO) and a
  small `♥` floats up above it. With `prefers-reduced-motion` the cat just appears on
  the monitor without walking.
- After this the `CAT` joke command shows a sleeping Byte instead of the
  awake one.
- **Found** when the cat walks across the keyboard the first time.

### 9.3 Mort's secret room in LABYRINT (3D)

- **Discovery**:
  - `C:\GAMES\LABYRINT\README.TXT` ends with *"P.S. There are absolutely
    no secret walls in this maze. — Mort"*.
  - In the maze, one brick wall looks slightly different: it has a tiny
    paw-print mark in the texture.
- **Trigger**: press `Use` facing that wall. It slides back two tiles, like
  the classic Wolfenstein push-wall, with a grinding sound.
- **The room** behind it is Mort's "dev room":
  - a desk sprite with a tiny CRT showing a blinking `C:\>`, a monitor
    inside the monitor
  - a Tux statue
  - Byte asleep on a pile of floppies
  - a credits sign: *"LABYRINT by Mort, 1994. Thanks for playing!"*
- Walking into the room **restores full health** and briefly freezes all
  glitches. It helps, but it's not needed to finish.
- The minimap only shows the room once it has been found.
- **Found** when the player steps into the room.

---

## 10. Audio

All sound is synthesized with WebAudio (no files), in the same style as the
other games. Everything is unlocked by the power-button gesture.

- **8-bit soundtrack** (`music.js`): a step sequencer with NES-style voices
  (12.5/25/50% pulse waves, triangle bass, noise drums). Each program names
  a looping track: a calm arpeggio at the DOS prompt and in EDIT, plus one
  track each for QUEST, NIBBLER, BRIXX, LABYRINT and the PANES desktop.
  Linux and the boot screens stay silent. Music has its own on/off setting.
- **PC speaker voice**: square-wave beeps, POST beep, error beeps and game
  melodies (simple note arrays).
- **Mechanical**: CRT thunk/degauss on power-on, floppy seek/grind on A:
  access, short HDD clicks on file ops, printer rattle, optional key
  clicks. All of these are short noise bursts through filters.
- **PANES chime**: a soft sine/triangle chord. It's the only "pretty"
  sound.
- A mute toggle in settings, also on `Ctrl+M`.

---

## 11. Accessibility and safety

- **No flashing.** Power-on is a dim expanding line. The glitch enemies
  animate by sprite frames, not screen strobes. BRIXX palette cycling is
  slow, and so is the CRT refresh band. Since nothing flashes, no
  photosensitivity warning is needed. If any effect ends up flashing during
  implementation, it gets a warning, as the AGENTS rules require.
- `prefers-reduced-motion` turns off the rolling band, the LED pulse,
  printer paper animation and boot warm-up easing.
- The CRT effect can be turned *Off* for readability.
- Each game has a pause option, and the casual-retry rules (above) keep the
  action games beatable on phones.

---

## 12. Overview integration

- `dosadventure/meta.json`:
  ```json
  {
    "name": "DOS Adventure",
    "description": "Explore Uncle Mort's old DOS PC on a glowing CRT. Fix his config, crack his passwords and beat his games to boot the mysterious PANES.",
    "tags": ["adventure", "puzzle", "retro"],
    "thumbnail": "thumbnail.svg",
    "accent": "#4dff88",
    "controls": "Type DOS commands (HELP) · tap words to insert them · games: arrows/WASD, Space · Esc to quit a program"
  }
  ```
- Append `"dosadventure"` to `games.json` and add a row to the `README.md`
  table.
- Update the "Current games" section in `AGENTS.md` with a short
  architecture note.

---

## 13. Implementation milestones

1. **Scaffolding**: HTML/CSS desk, monitor, case and controls; `screen.js`
   text mode; `font.js`; the 2D-fallback CRT; the main loop and input
   routing (keyboard plus hidden textarea).
2. **CRT shader**: WebGL post-process, pointer mapping, settings.
3. **File system and shell**: `fs.js`, `disk.js` with all the content,
   commands, paging, history, completion, tap-to-insert, batch, boot
   sequence, save/load.
4. **Shell puzzles**: EDIT, REBOOT/config parsing, `MEM`, the floppy desk
   object, `UNDELETE`, `COPY /B`, `UNZIP`, signatures, `PANES` checklist,
   sticky note, `HINT`, printer.
5. **QUEST.EXE**.
6. **NIBBLER.EXE**.
7. **BRIXX.EXE**: mode 13h path.
8. **LABYRINT.EXE**: raycaster, sprites, HUD, touch stick.
9. **PANES finale**: GUI mode, desktop, windows, chime, shutdown.
10. **Easter eggs**: LOADLIN/Linux shell, Byte on the keyboard (desk cat),
    LABYRINT push-wall room, secrets counter.
11. **Audio pass, polish, thumbnail, meta, games.json, README, AGENTS.md**.
12. **Test pass**: see below.

---

## 14. Testing checklist

- Serve over HTTP (`python3 -m http.server`) and also from a parent folder
  to mimic GitHub Pages. Run `node --check` on every module. Watch the
  console for errors.
- A full playthrough using the walkthrough below, on desktop and on a
  phone-sized viewport (portrait and landscape).
- Saving: reload mid-game at each stage (including inside QUEST and with
  the floppy inserted) and check the state is restored. Reset progress
  works.
- Robustness:
  - deleting important files (`CONFIG.SYS`, `PANES.EXE`, part files) must
    never soft-lock the game: `UNDELETE` always works, and `PANES.EXE` /
    the games are read-only (`R` attribute, *"Access denied"*)
  - faked component files are rejected
  - wildcard edge cases behave
- Easter eggs:
  - all 3 can be triggered, and each counts once in the secrets counter
  - the Linux shell can't write to `/dos`
  - `exit` from Linux reboots cleanly into DOS
  - the idle cat never fires mid-typing or inside a program
- CRT *Off* and the no-WebGL fallback render correctly. `prefers-reduced-motion`
  is honoured.

### Walkthrough (for testing)

```
TYPE README.TXT
CD MORT
DIR /A                       → DIARY.TXT (hidden)
TYPE DIARY.TXT               → cat "Byte"
UNZIP MOUSE.ZIP              → password BYTE1994 (year from BIOS screen)
MOVE MOUSE.SYS C:\PANES\SYSTEM                         (#3)
MOVE C:\OLD_DOS\HIMEM.SYS C:\DOS
EDIT C:\CONFIG.SYS           → DOS=HIGH, FILES=30
REBOOT                                                 (#1)
[insert floppy]  CD C:\TEMP   UNDELETE  → V
CD C:\PANES\SYSTEM
COPY /B VIDEO.001+A:\VIDEO.002+C:\TEMP\VIDEO.003+C:\MORT\LUNCH.TXT VIDEO.DRV   (#2)
C:\GAMES\QUEST\QUEST         → … → SOUND.DRV     → MOVE to C:\PANES\SYSTEM (#4)
C:\GAMES\NIBBLER\NIBBLER     → KEYBOARD.DRV      → MOVE              (#5)
C:\GAMES\BRIXX\BRIXX         → COLORS.PAL        → MOVE              (#6)
C:\GAMES\LABYRINT\LABYRINT   → PANES.KRN         → MOVE              (#7)
PANES                        → GUI → "You won!"
```

---

## 15. Initial disk layout (C:)

```
C:\
├── AUTOEXEC.BAT        @ECHO OFF / PATH / Mort's greeting
├── CONFIG.SYS          broken (#1)
├── COMMAND.COM         (R,S,H)
├── README.TXT          Mort's letter: the premise and where to start
├── DOS\                EDIT.COM, MEM.EXE, UNDELETE.EXE, ATTRIB.EXE, … (flavour; built-ins)
├── OLD_DOS\            HIMEM.SYS (misplaced, #1), OLDJUNK.TXT
├── UTILS\              UNZIP.EXE, README.TXT
├── LINUX\              LOADLIN.EXE, VMLINUZ, README.TXT (easter egg 9.1)
├── MORT\               TODO.TXT, DIARY.TXT (H), PETS.TXT (decoy), LUNCH.TXT (=part 4),
│                       RECIPES.TXT, SISTER.TXT, MOUSE.ZIP, JOKE.BAT
├── GAMES\
│   ├── QUEST\          QUEST.EXE (R), README.TXT
│   ├── NIBBLER\        NIBBLER.EXE (R), HISCORE.DAT
│   ├── BRIXX\          BRIXX.EXE (R)
│   └── LABYRINT\       LABYRINT.EXE (R), README.TXT (system requirements; "no secret walls")
├── PANES\              PANES.EXE (R), README.TXT (lists the 7 components)
│   └── SYSTEM\         VIDEO.001, SPLIT.TXT
└── TEMP\               ~WRL0001.TMP; deleted: VIDEO.003
A:\  (floppy "BACKUP 2/2")   VIDEO.002, BYTE.TXT (ASCII cat photo)
```

---

## 16. Open questions

- **Prize files**: the plan has the player `MOVE` each game's prize into
  `C:\PANES\SYSTEM` by hand. The alternative is to install them
  automatically, which would make the games less shell-heavy.
- **Names**: "Uncle Mort", "VIBE-DOS", "PANES" and "VIBETRON" are
  placeholders that are easy to change.
- **Phone text readability**: the plan uses an optional 2× zoom with
  cursor-follow. The alternative is a 40-column text mode on narrow
  screens. That's more authentic (40×25 existed), but every text layout
  would need to adapt.
