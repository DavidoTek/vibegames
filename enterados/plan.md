# Enter-a-DOS: plan

> Design document, written before the game was built. Where the game
> differs: Byte's paw swipe and the Moth's falling glyph blocks were left
> out (the Moth sheds larvae only), and the fall-back for a refused pointer
> lock is dragging with the mouse.

## Context

A new game for the mini-games site: a simple 3D first-person adventure in
which the player is shrunk and walks around inside a retro PC, fixing it in a
handful of missions. Decisions already made with the user:

- **three.js, vendored** (explicitly asked for, as AGENTS.md requires). Copy
  r186 from `jumper/vendor/` into `enterados/vendor/`.
- **Loose sequel to DOS Adventure**: the PC is Uncle Mort's VIBETRON running
  VIBE-DOS and PANES, with Byte the cat. These made-up names replace "IBM PC",
  so no real trademarks appear. Playable without knowing the first game.
- **Explore and puzzle with light action**: a zapper stuns bugs, a short
  finale against a virus, forgiving checkpoints.

Folder: `enterados/` (already exists, empty). Title: **Enter-a-DOS**.
Play time: 20 to 30 minutes. Keyboard and mouse, touch, and gamepad.

---

## 1. Story

Uncle Mort's PC will not boot. The CRT shows a POST screen full of `FAIL`.
A floppy is stuck in drive A:, labelled *"FREE GAMES!!! ♥ Sis"* (Mort's
sister, known from `SISTER.TXT`). On the case, next to RESET, sits a TURBO
button with a strip of tape: *"DO NOT PRESS. — Mort"*.

You press it. Mort rewired TURBO into a shrink ray for "hardware
emergencies". You are now about 3 mm tall and get pulled through the floppy
slot.

Inside, the PC is a dark city: the motherboard is the ground, chips are
buildings, capacitors are water towers, ISA slots are long walls, and light
falls in through the vent slits.

**Cast**

- **Blink**, the block cursor `█`. It lost its prompt when the machine died.
  It floats ahead of you, talks in DOS messages (*"Unknown device detected.
  That's you."*), and hovers at the next objective, so it is also the
  waypoint and hint system.
- **The Moth** (`MOTH.COM`), a memory-resident virus from the sister's disk:
  a glowing wireframe moth with wings made of garbage characters. A nod to
  the first real computer bug. Its larvae are the **bugs** that chew on the
  hardware. If the PC boots with the Moth in memory, it formats C:.
- **Mort**, present only through notes. He has been in here before: there is
  a camp with a matchbox bed and a thimble mug, and marker scribbles on the
  chips.
- **Byte** the cat, at giant scale: an eye at the vent slits, a paw through
  the drive bay, and cat hair in the fan.

**Structure**: the HUD shows the POST checklist. Each mission turns one line
from `FAIL` to `OK`, in the real POST order:

```
VIBETRON BIOS v2.1
CMOS clock ...... FAIL     mission 1
Memory test ..... FAIL     mission 2
Drive C: ........ FAIL     mission 3
Cooling ......... FAIL     mission 4
CPU ............. INFECTED mission 5
```

Mission 1 comes first. Missions 2 and 3 can be done in either order.
Mission 4 opens after 1 to 3, and mission 5 follows it.

---

## 2. Missions

### 0. Prologue: "Insert Disk" (tutorial, floppy drive)
- Start on top of the giant floppy inside drive A:. Blink introduces itself.
- Learn look, move, jump (over the drive rail) and Use (read Mort's first
  note).
- See the disk's **write-protect tab**, a big sliding block, set to
  "protected". Blink: *"Read-only. Nothing gets written onto that disk."*
  This sets up the finale.
- Mort's camp: pick up the **Debug Probe** (the zapper). Zap the first bug.
- Slide down the grey ribbon cable to the motherboard. The POST checklist
  appears.

### 1. "Checksum Error" (CMOS clock, BIOS quarter)
- The clock tower (7-segment display) is stuck at `00:00 01-01-80`. Bugs
  have lifted the coin battery's contact clip.
- Zap the three bugs, pull the clip lever with Use, and power returns to the
  quarter.
- The clock wants a date on three dials (month, day, year). The answer is on
  the BIOS chip's sticker, *"BIOS Date 04/12/94"* (same date as in DOS
  Adventure). The sticker is on top of the chip, so the player climbs a
  staircase of resistors to read it.
- The crystal starts ticking. Line 1 is `OK`.

### 2. "Parity Error" (RAM Row)
- Four SIMM boards stand like library stacks. The "HIMEM lift" (a moving
  platform) takes the player up to a catwalk above a floor of bit tiles.
- Each puzzle is a grid of 0/1 tiles with a parity lamp per row and per
  column. A red row lamp and a red column lamp cross at the flipped bit.
  Stand on it and press Use to flip it back. This is real 2D parity.
- Three rounds: 4×4 with one error; 5×5 where roaming bugs flip tiles until
  they are zapped; 6×6 with two errors.
- Mort's note: *"Even parity. If a row or a column lights up red, somebody
  in it is lying."*
- The memory count-up runs across the SIMM lamps as a wave. Line 2 is `OK`.

### 3. "Seek Error" (hard disk)
- Walk up the wide IDE ribbon cable to the drive bay. Enter through the
  breather hole (*"DO NOT COVER THIS HOLE. Also do not climb in. — Mort"*).
- Inside is a large chrome platter turning slowly, which carries the player
  round, and a head arm that sweeps across on a timer and shoves the player
  off the platter (no damage).
- `BYTE.BMP` is fragmented into four numbered clusters lying on the platter.
  Carry each one (Use to pick up; no zapping or running while carrying) to
  its numbered slot on the fixed rail at the rim. Two or three bugs get in
  the way.
- The picture assembles into a pixel-art Byte on the sector display, the
  drive spins up, and line 3 is `OK`.

### 4. "Thermal Event" (CPU fan)
- The CPU fan is jammed with three clumps of cat hair. The HUD shows the CPU
  temperature. Hot fins hurt if the player stands on them for too long.
  There is no hard timer.
- Vertical platforming: capacitors as stepping stones, then the heatsink
  clip, then from fin to fin up to the fan.
- Pull each clump out with Use; each is guarded by bugs. The fan spins up
  and the temperature drops. Line 4 is `OK`.
- Byte's eye appears at the vent, and a paw swipes through the slits
  (harmless knockback).

### 5. "Moth to a Flame" (finale)
- POST reaches the CPU line and the Moth bursts out of the CPU. Zapping only
  stuns it for three seconds: *"It's resident. It copies itself back from
  memory."*
- Moths fly to light. The case has three LEDs with a switch each (TURBO near
  the CPU, HDD in the middle, POWER at the front panel), and only one can be
  lit at a time. The Moth flies to the lit LED and circles it. If it circles
  for too long it gets bored and returns to the CPU. On the way it drops
  garbage glyph blocks and larvae.
- Lure it LED by LED to the floppy drive. There: slide the write-protect tab
  to "writable", pull the drive lever so the drive LED lights, and the Moth
  is written onto the disk. Slide the tab back to "protected" and press
  EJECT.
- If the tab is still protected: *"Write protect error writing drive A:
  Abort, Retry, Fail?"*, the Moth escapes, and the player restarts from the
  second LED.
- **Ending**: POST shows all `OK`, *"Starting VIBE-DOS..."*, the board
  lights up district by district, the PANES chime plays, and Blink gets its
  prompt back (`C:\>█`). The player walks into the light of the floppy slot
  and grows back. The end card is a PANES "You won!" window with time, bugs
  patched, screws and secrets found. Last shot: Byte bats the ejected disk
  off the desk.

### Extras (optional content, built last)
- **8 lost screws** to collect (Mort always drops them in the case).
- **3 secrets**, counted on the end card like in DOS Adventure: a Tux statue
  in a "Linux partition" alcove of the hard disk; four pads on the sound
  card that play the PANES chime; Mort's *"Mort was here '94"* scribble and
  lost screwdriver bit under an ISA slot.

---

## 3. Rules

- **Debug Probe**: a short steady beam with a small cooldown and no ammo.
  The first hit stuns a bug for 4 s; a second hit while it is stunned
  "patches" it into a green firefly that flies away.
- **Integrity**: 4 pips. A bug touch costs one and knocks the player back.
  At zero: *"GENERAL PROTECTION FAULT"*, then respawn at the last restore
  point with mission progress kept. Falling off the board respawns at the
  last safe ground.
- **Restore points**: glowing solder pads that refill integrity and save.
- **Use** works on whatever is under the crosshair within 3 m (notes,
  levers, dials, pickups). A prompt shows what it will do.
- **Blink** hovers at the next objective. An arrow at the screen edge points
  to it when it is off screen. Its lines appear as subtitles in a DOS-style
  box and never block play, except in the intro.

---

## 4. Controls

| Action | Keyboard and mouse | Touch | Gamepad |
|---|---|---|---|
| Move | WASD, ↑/↓ | left half: floating stick | left stick |
| Look | mouse (pointer lock), ←/→ turn | right half: drag | right stick |
| Jump | Space | Jump button | A |
| Run | Shift | push the stick fully | L3 |
| Use / carry | E | Use button (shown when usable) | X |
| Zap | left click, F | Zap button | RT |
| POST checklist | Tab | tap the checklist | Back |
| Pause | Esc, P | pause chip | Start |
| Mute | M | mute chip | |

Arrow keys turn and move, so the game is playable without pointer lock.
Losing pointer lock opens the pause panel. Settings: look sensitivity,
invert Y, head bob, sound, music, reset progress.

---

## 5. Files

```
enterados/
  index.html     canvas, corner chips, HUD, subtitles, touch controls, panel
  style.css
  meta.json      tags ["adventure", "3D", "first-person", "three.js"], accent amber
  thumbnail.svg  16:9: tiny figure in front of a huge floppy slot
  plan.md        the design from this plan (same convention as dosadventure/, carracer/)
  vendor/        three.module.js, three.core.js, LICENSE (copied from jumper/vendor/)
  physics.js     no DOM, no three: colliders (box, ramp, cylinder) in a grid hash, moveAndSlide
  level.js       no DOM, no three: prop placements, districts, restore points, Blink paths, colliders
  story.js       all text: Blink's lines, Mort's notes, POST lines
  missions.js    one small state machine per mission, objectives, gates
  props.js       three.js mesh builders and CanvasTexture helpers
  entities.js    bugs, larvae, the Moth, Blink, pickups, particles
  player.js      first-person controller, carrying, probe view model
  input.js       keyboard, pointer lock, touch stick and look, gamepad
  audio.js       sounds, ambience, layered music
  store.js       localStorage wrapper with the "enterados:" prefix
  game.js        entry: renderer, loop, states (title, intro, play, pause, end), HUD, save
```

Site integration: append `"enterados"` to `games.json`; add a row to the
games table and a three.js row to "Third-party code" in `README.md`; add a
"Current games" entry to `AGENTS.md`.

---

## 6. Technical design

**World.** One continuous scene of about 140 × 100 units (1 unit = 1 m at
player scale). The drive bay with the floppy and hard disk sits above the
board and is reached over ribbon-cable ramps. Fog hides the distance, so
nothing is loaded or unloaded. Missions open gates.

**Level data** (`level.js`) is plain JS: a list of prop placements such as
`{ type: "dip", x, z, rot, label }`, with rotation in 90° steps so colliders
stay axis-aligned. Each prop type has a pure function that returns its
colliders, and a builder in `props.js` that returns its meshes.

**Physics** (`physics.js`). The player is a vertical cylinder (radius 0.35,
height 1.7). Each step finds the ground height under the player (the highest
collider top within step-up reach of 0.35), pushes the player out of walls
in the XZ plane, and checks the head against ceilings. Movement is
sub-stepped when it exceeds the radius. Colliders can carry a velocity or a
spin around a centre; standing on one adds its motion (lift, platter).

**Rendering** (`props.js`, `game.js`). `WebGLRenderer`, pixel ratio capped
at 2 (1.5 on coarse pointers), `dt` clamped to 1/20. Lambert materials, a
hemisphere light, one directional light through the vents, a few point
lights per district, and emissive materials for LEDs. Static props are
`InstancedMesh`es. All textures are `CanvasTexture`s: PCB traces, chip
labels, stickers, the floppy label, the 7-segment clock, the POST display.
No shadow maps on touch devices.

**Intro.** A small exterior group (beige case, CRT, desk) doubles as the
title screen. Pressing TURBO is the first user gesture: it unlocks audio and
starts the shrink (a camera move, or a fade with reduced motion).

**Audio** (`audio.js`). All synthesized. Ambience: PSU hum, fan whoosh by
distance, disk spin, the clock tick after mission 1. Music: one calm loop
that gains a layer with every POST line fixed, so the machine audibly comes
back to life.

**Save.** `enterados:save` holds finished missions, the restore point,
screws, secrets and settings.

### Reused from the repo
- `jumper/vendor/` → three.js r186 and its LICENSE.
- `Sounds` in `jumper/game.js:57` (`tone`, `noise`, `arp`, `unlock`) as the
  base of `audio.js`.
- `Music` and the 16-step pattern format in `dosadventure/music.js` for the
  layered soundtrack.
- `rusekin/store.js` as the template for `store.js`.
- Corner chips and the `#touch` markup from `jumper/index.html`; the
  slide-between-buttons handling from `jumper/game.js:995`.
- The coarse-pointer renderer settings and the `?debug` hook
  (`window.game`) from `carracer/game.js`.

### Rules from AGENTS.md
- Relative URLs only; `href="../"` back to the overview.
- Nothing flashes: the zap beam, the Moth and the LEDs glow or pulse slowly.
  If an effect ends up flashing, it gets a photosensitivity warning.
- `prefers-reduced-motion`: no head bob, no camera shake, fades in place of
  the shrink zoom, static dust.

---

## 7. Milestones

1. **Skeleton**: `plan.md`, vendored three.js, `index.html`, `meta.json`,
   thumbnail, `games.json`, README rows. Renderer, loop and a flat test
   board.
2. **Walking**: `physics.js`, `player.js`, `input.js` (keyboard, pointer
   lock, touch, gamepad), pause and settings.
3. **The PC**: `level.js` and `props.js` for all districts, ramps, fog and
   lights, district names.
4. **Systems**: Use, notes, subtitles, Blink, POST checklist, restore
   points, save, probe, bugs, integrity.
5. **Prologue and missions 1 to 3.**
6. **Mission 4 and the finale**, intro and ending.
7. **Audio**: sounds, ambience, layered music.
8. **Extras and polish**: screws, secrets, phone layout, reduced motion,
   performance on mobile, `AGENTS.md` entry.

---

## 8. Verification

- `node --check` on every file.
- **Headless level check** in Node (script in the scratchpad, importing
  `physics.js` and `level.js`): every restore point, pickup and mission
  target stands on ground and is not inside a collider; a simple bot walks
  each of Blink's paths with auto-jump and must arrive, which catches
  impossible jumps.
- **Browser**: `python3 -m http.server 8000` in the repo root and play the
  whole game at `http://localhost:8000/enterados/`: all five missions, a
  death and respawn, a reload mid-game (save), the wrong date in mission 1,
  and the protected-tab failure in the finale. Use `?debug` to jump between
  missions.
- Phone-sized viewport with touch emulation: stick, look, buttons, HUD fit.
- Reduced motion on; sound muted and unmuted; no console errors.
- Serve the parent folder and open `http://localhost:8000/vibegames/` to
  confirm the overview card and relative URLs work under a subfolder.
