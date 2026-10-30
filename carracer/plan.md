# Car Racer: design plan

A 3D arcade circuit racer for one or two human players plus computer-controlled
cars. Races are three laps long. Two players connect peer-to-peer over WebRTC
(PeerJS), so the game stays a static site on GitHub Pages with no server code
of its own. Rendering uses three.js.

Name: **Twin Throttle** (made up, no trademarks; confirmed). The folder is
`carracer/`.

Expected session: a 2–4 minute race, then rematch. Works with keyboard, gamepad
and touch.

---

## 1. Acceptance criteria → where they are handled

| Requirement | Plan section |
|---|---|
| 3D racing game, three.js | §3, §5 |
| Two-player P2P with PeerJS | §8 |
| Privacy notice for the PeerServer | §9 |
| Runs in the browser on GitHub Pages, no server | §2 (only static files; signalling uses the public PeerJS cloud server) |
| Three laps; on crossing the line, an overlay with place, time etc. that updates as the others finish; own car drives on under computer control | §7 |
| Computer-controlled opponents (1–2 humans, the rest AI), beatable | §6 |

---

## 2. Constraints from AGENTS.md

- Plain ES modules, relative URLs, no build step, no CDN.
- **Two libraries, both asked for by the user, both vendored:**
  - three.js r186: copy `three.module.js`, `three.core.js` and `LICENSE` from
    `jumper/vendor/` into `carracer/vendor/` so each game stays self-contained.
    Same version as Jumper.
  - PeerJS **1.5.5** (npm `peerjs@1.5.5`, MIT, latest release, June 2025):
    vendor `dist/peerjs.min.js` as `carracer/vendor/peerjs.min.js`. It is an
    IIFE bundle that sets `window.Peer`, so it is loaded with a classic
    `<script>` tag (relative URL), not `import`. The minified file has no
    license header, so add `carracer/vendor/LICENSE-peerjs` with the MIT text
    from the peers/peerjs repo.
  - Add both rows to the "Third-party code" table in the root `README.md`.
- `localStorage` only through a `store` helper wrapped in `try/catch` (copy the
  one from `sudoku3d/game.js`).
- Audio is unlocked on the first pointer or key event.
- Canvas sized to `innerWidth/innerHeight * min(devicePixelRatio, 2)`. Use 1.5
  on touch devices for frame rate. `dt` is clamped to `1/20`.
- Reduced motion: no camera shake, no animated menu background.
- A "Games" chip linking to `href="../"`, as in Jumper.
- Nothing flashes, so no photosensitivity warning is needed. Keep the start
  lights and the boost effect steady rather than strobing.
- **Solo play must never touch the network.** PeerJS is only constructed after
  the player presses Host or Join (§9).

---

## 3. Game design

### Feel
- Arcade handling: grippy, with a forgiving drift on handbrake or hard
  steering at speed. No damage, no fuel.
- Small, chunky, low-poly cars, a bit toy-like, in the same visual family as
  Jumper.
- 6 cars per race: 1–2 humans + 4–5 AI.
- Off-track grass and sand slow you down. Barriers are soft walls that push you
  back and scrub speed. They never stop you dead.
- Slipstream: driving close behind another car gives up to +4 % top speed.
  This helps humans catch AI cars.

### Tracks (3, seeded and data-driven)
Each track is a closed list of control points (x, z, height, width) in
`tracks.js`, smoothed with `THREE.CatmullRomCurve3(closed = true)`.

1. **Harbour Loop**: flat and wide, with gentle corners. The tutorial track.
2. **Pine Ridge**: elevation changes, one crest, a fast sweeper and a hairpin.
3. **Canyon Eight**: a figure-of-eight with a bridge over itself. Only the
   lateral clamp is used, so the crossing is purely visual. The bridge deck sits
   high enough above the lower road that cars never interact there.

Scenery (trees, rocks, cranes, grandstand, start gantry) is placed by a seeded
RNG along the track, outside the barrier line. Static props are drawn as
`InstancedMesh`es.

### Modes (main menu)
- **Solo**: you against 5 AI. Pick track and difficulty.
- **Online: Host**: shows a 5-character room code and a copyable join link
  `./?join=CODE`.
- **Online: Join**: enter the code, or arrive via the link.
- A "Privacy" link on the start screen opens the short notice (§9).
- Settings: name, car colour, difficulty (host decides online), controls help,
  mute.

Local split-screen is a possible later extra and is not in scope.

---

## 4. File layout

```
carracer/
  index.html        canvas, HUD, menus, overlay, privacy dialog, touch controls
  style.css
  meta.json         name, description, tags ["racing","3D","multiplayer","three.js"], controls
  thumbnail.svg     16:9
  plan.md           this file
  vendor/
    three.module.js  three.core.js  LICENSE          (three.js r186)
    peerjs.min.js    LICENSE-peerjs                  (PeerJS 1.5.5)
  tracks.js         track data: control points, widths, theme colours, prop rules
  track.js          Track: spline samples, projection (x,z) → (s, lateral), racing line, speed profile (no three)
  scene.js          three.js: sky, terrain, road/kerb/barrier ribbons, bridge, props, car models
  car.js            car physics (pure JS, no three) + car mesh builder
  ai.js             driver controller (used by AI cars and by autopilot after finishing)
  race.js           race state: grid, countdown, laps, standings, finish logic (no DOM, no three)
  net.js            PeerJS wrapper: rooms, protocol, clock sync, interpolation buffers
  audio.js          synthesized engine, skid, countdown beeps, crowd (WebAudio)
  game.js           entry point: renderer, scene, camera, loop, input, HUD, menus, overlay
```

`race.js`, `car.js` and `ai.js` stay free of the DOM and three.js. That way
the same code runs on host and guest, and a headless AI-only race can be run in
Node with `node --check` plus a small script in the scratchpad. That is how the
AI difficulty gets tuned (§6).

---

## 5. Rendering (three.js)

- `WebGLRenderer` with antialias (off on low-end/touch), sRGB output and ACES
  tone mapping. One directional sun plus a hemisphere light. Cars get a soft
  blob shadow instead of a shadow map (cheap everywhere, same on phones).
- **Road mesh**: sample the spline every ~2 m. At each sample, build a frame
  (tangent, normal from the up vector, binormal) and extrude a ribbon of
  width `w(s)`. Then add kerb strips (red/white vertex colours), a barrier
  ribbon and a terrain skirt that fades into a large ground plane. Store the
  frames in arrays. Physics uses them too (`track.frameAt(s)`).
- Start/finish line as a chequered texture made with a `CanvasTexture` (no
  image files), plus a gantry with 5 start lights.
- Cars: about 10 boxes and cylinders each (body, cabin, wheels, spoiler),
  sharing geometries and materials and tinted per car. Wheels spin and the
  front wheels steer.
- Cameras: chase cam (spring-damped, looks ahead along the track tangent), a
  bumper cam toggled with `C`, and an orbit "TV" cam after finishing.
- Sky: a gradient sphere and fog for each track theme.
- A minimap of the track outline and car dots, drawn on a small 2D HUD canvas.

---

## 6. Physics and AI

### Car model (`car.js`)
A simplified 2D bicycle model on the ground plane. Height and pitch come from
the track surface.
- State: `x, z, yaw, vx, vz, yawRate, steer`, plus `s` (track distance) and
  `lat` (lateral offset), which come from `track.project()` every step.
- Inputs: `throttle 0..1, brake 0..1, steer -1..1, handbrake bool`.
- Fixed physics step of 1/120 s with an accumulator, so every machine sees the
  same behaviour.
- Lateral grip clamps the sideways velocity. The handbrake lowers rear grip and
  gives a drift.
- Surface: `|lat| > w/2` means grass, with lower grip and more drag.
  `|lat| > w/2 + verge` means barrier: clamp `lat`, reflect the lateral
  velocity at 0.3 restitution and lose 15 % speed.
- Car-to-car: circle-vs-circle with a soft push and a small speed exchange.
  Online, each client only applies the push to **its own** car, using the
  remote car's interpolated position, so nobody needs authority over someone
  else's car.

### Lap tracking (`race.js`)
- Each car's progress is its unwrapped distance along the track (`dist`,
  accumulated from the change in `s` every step). The line is at every
  multiple of the track length, and lap `k` counts once `dist` first reaches
  `k * length`. Reversing over the line lowers `dist`, so it can never count
  twice. This replaces the sector checkpoints from the first draft and gives
  the same protection.
- The exact crossing time is interpolated between the physics step before and
  after the line, so times are precise to the millisecond and do not depend on
  frame rate.

### AI driver (`ai.js`)
- **Racing line**: precomputed per track by smoothing a lateral offset per
  sample (inside of corners, a few iterations of curvature minimisation). It is
  stored as `lineLat[s]`.
- **Speed profile**: `vmax(s) = sqrt(gripLat / curvature(s))`, then a backward
  pass for braking distance, giving `targetSpeed[s]`.
- **Steering**: pure pursuit to a look-ahead point at `s + k * speed` on the
  racing line, plus an avoidance offset when a car is ahead within 12 m.
- **Personality per AI** (seeded): `pace` (fraction of the speed profile),
  `lineNoise` (wobble), `mistakeRate` (occasional brake-too-late that runs
  wide), `aggression` (overtaking offset).
- **Difficulty** sets the pace band:

  | Difficulty | AI pace (of `targetSpeed`) | Mistakes | Catch-up |
  |---|---|---|---|
  | Easy | 0.84–0.90 | frequent | AI ahead of every human slows down to −5 % |
  | Normal | 0.90–0.95 | occasional | ±3 % (keeps the pack together) |
  | Hard | 0.95–0.99 | rare | none |

  "Beatable" is checked in two ways. First, a human-quality line at full
  throttle is at least 1.5 % faster per lap than the best Hard AI. This is
  measured by running the AI at pace 1.0 as a stand-in for a good player.
  Second, the human car has the same physics as the AI cars, but the AI never
  gets slipstream on Easy or Normal.
- Grid: humans start in places 4 and 5 of 6 (Easy and Normal) or 5 and 6
  (Hard), so there is something to overtake.
- **Autopilot**: after a human finishes, the same controller drives their car at
  Normal pace with no mistakes and gentle avoidance, so it doesn't ram anyone.

---

## 7. Race flow and the finish overlay

1. **Grid and countdown**: cars line up 2-wide behind the line. The 5 lights
   come on one by one, one second apart, then go out after a short random delay
   (0.2–1 s; the host picks it and sends it in `start`). Throttle before the
   lights go out gives a short wheelspin penalty. This rule is original and
   adds a bit of skill.
2. **Racing**: the HUD shows position (`P3/6`), lap (`Lap 2/3`), current and
   best lap time, last-lap delta, speed and the minimap. A "Final lap" banner
   appears on lap 3.
3. **Crossing the line after lap 3**:
   - Control passes to the autopilot (§6). The camera switches to the orbit TV
     cam, and `C` cycles back to the chase cam.
   - The **results overlay** slides in. It is semi-transparent so the race
     stays visible behind it:

     | Pos | Driver | Total | Gap | Best lap | Status |
     |---|---|---|---|---|---|
     | 1 | Bolt (AI) | 2:31.408 | — | 0:49.902 | Finished |
     | 2 | **You** | 2:32.117 | +0.709 | 0:50.033 ★ | Finished |
     | 3 | Alex | — | — | 0:50.511 | Lap 3/3 · running P3 |
     | … | | | | | |

     - Finished rows are final and sorted by finish time.
     - Unfinished rows are sorted by live progress, show their current lap,
       and update a few times a second.
     - When another car crosses the line, its row gets its time and gap, a
       short highlight, and the table re-sorts. Positions are recalculated.
     - It also shows your lap times (3 small cells), your place, and a
       "personal best" marker. Best times per track and difficulty go to
       `localStorage`.
     - Buttons: **Hide** (watch the race; `Tab` toggles), **Rematch** (host;
       the guest sees "Waiting for host"), **Menu**.
4. **Race end**: the race ends when every car has finished. If some AI is still
   out 45 s after the **last human** finished, the remaining AI get an
   estimated time: their current time plus remaining distance divided by their
   average speed, shown as "est." in italics. Then the overlay shows
   "Race complete". A remote human who never finishes (disconnects) is shown as
   DNF.

Standings are computed in `race.js` from the same data on every machine.
Online, the host's standings list is the reference (§8).

---

## 8. Multiplayer (PeerJS)

### Topology
Star with 2 nodes: **host** and **guest** over one PeerJS `DataConnection`
pair. The PeerJS cloud server (`0.peerjs.com`) is only used for the
handshake. Game data then goes directly between the browsers over WebRTC,
encrypted with DTLS.

- Room code: 5 characters from an unambiguous alphabet (no 0/O/1/I). The host
  peer ID is `twinthrottle-<code>`. A random code gives an ID collision on the
  shared cloud server only rarely. On `unavailable-id`, pick a new code.
- The guest uses a random PeerJS ID, chosen by the server.
- Join link: `./?join=CODE` (relative), which opens the join flow straight
  away.
- ICE: the PeerJS 1.5.5 defaults (`stun:stun.l.google.com:19302`, plus TURN at
  `eu-0` and `us-0.turn.peerjs.com:3478`). The privacy popup mentions them because
  Google STUN and the PeerJS relay also receive the IP address.
- An "Advanced" field lets the player use their own PeerServer and ICE
  servers (host/port/path/key). It is saved in `localStorage` and lets
  privacy-conscious players self-host.

### Authority
- **Each client is authoritative for its own human car.** No input lag, and
  no prediction or rollback is needed for racing.
- **The host is authoritative for the AI cars**, the race clock, the start, and
  the final standings. The guest renders AI cars from host snapshots.
- Each client reports its own car's lap crossings and finish time, measured in
  host time (see clock sync). The host merges them into standings and
  broadcasts them.

### Channels
Two `DataConnection`s, both with JSON serialisation:
- `ctl` (reliable): lobby, start, laps, finish, results, rematch, chat-less
  emotes (optional).
- `state` (`reliable: false`, unordered): car snapshots at 20 Hz, each with a
  sequence number. Old ones are dropped.

### Messages

| Type | From | Payload |
|---|---|---|
| `hello` | guest | `v` (protocol version), name, colour |
| `lobby` | host | players, trackId, difficulty, laps = 3 |
| `ping` / `pong` | both | `t0`, `t1` (clock sync) |
| `start` | host | seed, trackId, grid, AI personalities, `goAt` (host time), light delay |
| `snap` | both | race time + one row per car this machine owns: id, x, z, yaw, vx, vz, steer, dist, autopilot (state channel, 20 Hz) |
| `laps` | owner | carId, all lap times so far, finish `{ time, est }` (sent on every lap/finish of an owned car; the host also sends estimated AI times this way) |
| `end` | host | the race is over |
| `alive` | host | keep-alive once a second (the guest's pings serve the same purpose) |
| `menu` | host | back to the lobby; a rematch is simply a new `start` |
| `reject` / `full` | host | wrong protocol version / room already has a guest |
| `bye` | both | sent on leave |

On a version mismatch, `hello` is rejected with "Please reload both pages".

### Clock sync
In the lobby and countdown, the guest sends 8 pings. Using the samples with
the lowest RTT, it computes `offset = hostT − (t0 + rtt/2)`. All race times are
in host time, so finish times can be compared across machines. Resync every
5 s during the race. The median filter keeps it stable.

### Remote rendering
Snapshots are buffered and drawn 100 ms in the past, interpolated between the
two surrounding snapshots. With packet loss, they are extrapolated for up to
250 ms, then held. Since the host trusts each client's lap data, the 2-player
"race-against-a-friend" game is cooperative-trust. This is fine for a hobby
game, and the plan says so.

### Disconnects
- **Guest drops**: the host turns that car into an AI car (autopilot) and keeps
  racing. The standings show "(left)".
- **Host drops**: the guest promotes itself. Its last AI snapshot plus the
  seeded personalities are enough to resume simulating the AI locally, so the
  race finishes as a solo race. A toast says "Host left; continuing offline".
- After results, the PeerJS connection stays open for rematches. **Menu** calls
  `peer.destroy()`, and so does `pagehide`.

### Errors
Map PeerJS `error.type` to friendly messages: `peer-unavailable` → "Room not
found", `network`/`server-error`/`socket-error` → "Signalling server not
reachable; try again or play solo", `browser-incompatible`. A 15 s connect
timeout falls back to the same message.

---

## 9. Privacy notice (PeerJS signalling)

### Research summary (not legal advice)

- **What leaves the browser in online mode.** Connecting to the default
  PeerServer `0.peerjs.com` sends the player's **IP address**, a random client
  ID and WebRTC signalling data (SDP and ICE candidates, which contain local
  and public IP addresses). The open-source PeerServer's `PRIVACY.md` says this
  is held only in memory while connected and dropped about 60 s after the last
  contact (`alive_timeout`). It also says nothing is stored. That file
  describes the server software. I found no published privacy policy, data
  controller or GDPR statement for the hosted `0.peerjs.com` service itself.
  It resolves to Cloudflare (US). The default ICE config also contacts
  **Google's STUN server** and the **PeerJS TURN servers**. The other player
  receives your IP directly, because that is how P2P works.
- **IP addresses are personal data** under the GDPR when the recipient can
  reasonably identify the person (CJEU C‑582/14 *Breyer*, 2016).
- **The site operator is responsible for the transfer.** A site that makes the
  visitor's browser contact a third party is (jointly) responsible for that
  transfer (CJEU C‑40/17 *Fashion ID*, 2019). LG München I (3 O 17493/20,
  20 Jan 2022) awarded damages because a site loaded Google Fonts from Google's
  servers without consent. The same pattern fits loading a third-party
  signalling server silently.
- **Information duty (Art. 13 GDPR)**: who receives what, why, for how long,
  on which legal basis, third-country transfer, and the player's rights.
- **Legal basis** (background only; the owner chose an information-only
  popup without a consent gate, see below): the cleanest is **consent
  (Art. 6(1)(a))**, given before any connection. An argument for 6(1)(b)/(f) exists, because the player asked
  to play online. But the recipients are in the US or unknown, and the hosted
  service publishes no terms or DPA. So use **explicit consent, which also
  covers the third-country transfer under Art. 49(1)(a)**. The notice must name
  the risk: no adequacy guarantee for an operator that is not shown to be
  DPF-certified.
- **`localStorage`** for name, settings and best times is storage the user
  asked for, so it is exempt under §25(2) No. 2 TDDDG (DE) and Art. 5(3)
  ePrivacy.
- **Solo mode transmits nothing.** GitHub Pages receives visitors' IP addresses
  when serving the site, so the popup mentions that too.

### Implementation (decided: short, English, no operator details)
- A small **"Privacy"** link on the start screen opens a popup (`<dialog>`).
  Under the two Online buttons sits one muted line: "Online play connects via
  PeerJS. Privacy". Its link opens the same popup. There is no consent gate
  and nothing to store.
- `new Peer()` (and the injection of `peerjs.min.js`) only happens once the
  player presses Host or Join. Solo and the menus never touch the network.
- Popup text (final wording may be tightened a little):

  > **Privacy**
  >
  > This game is a static website hosted on **GitHub Pages**. GitHub
  > receives your IP address when you load it (see GitHub's privacy
  > statement).
  >
  > **Solo play** sends nothing anywhere.
  >
  > **Online play** uses **PeerJS** to connect two browsers directly. To set
  > up the connection, your browser contacts the free PeerJS server
  > (0.peerjs.com) and Google's STUN server, and, if needed, a PeerJS relay
  > server. These receive your IP address and connection data. The other
  > player also sees your IP address. Game data goes directly between the
  > two browsers, encrypted.
  >
  > Your name, settings and best times are only stored in your browser.

  It has links to GitHub's privacy statement and to peerjs.com, both with
  `rel="noopener"` and `target="_blank"`, plus a **Close** button.
- `privacy.js` is not needed. The dialog is a few lines of HTML in
  `index.html` and a handler in `game.js`.

---

## 10. Input

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Steer | A/D, ←/→ | left stick | left/right pads (bottom-left) |
| Throttle | W, ↑ | RT | big pedal bottom-right |
| Brake/reverse | S, ↓ | LT | smaller pedal next to it |
| Handbrake | Space | A | drift button |
| Camera | C | Y | camera icon |
| Results overlay | Tab | Back | overlay "Hide" button |
| Pause (solo only) / menu | Esc, P | Start | pause chip |
| Mute | M | | mute chip |

Keyboard steering is smoothed: steer ramps toward the target at a
speed-dependent rate, so tapping a key does not jerk the car. Touch shows
`#touch` on `pointer: coarse`, and the HUD layout moves to the top. Online
races cannot be paused, so Esc opens the menu without stopping the race.

---

## 11. Audio (`audio.js`)

- Engine: two detuned sawtooth oscillators plus a low-pass filter. Frequency
  follows RPM, which is derived from speed and a fake gear ratio with 5
  "shifts". One voice per car within 60 m, with distance gain and pan. Remote
  and AI cars are quieter.
- Tyre skid: filtered noise whose gain follows slip angle. Barrier hit: a
  short thud.
- Countdown beeps (low for each light, high on "go"), a finish-line jingle,
  and crowd noise near the grandstand.
- All synthesized, no audio files. Created on first gesture. Mute is saved.

---

## 12. Milestones

1. **Skeleton**: folder, meta, thumbnail, `games.json` entry, vendored libs,
   README license rows. Renderer and loop with a flat test spline.
2. **Track**: spline → road/kerbs/barriers/terrain, `project()`, minimap, 3
   tracks.
3. **Car**: physics, chase cam, keyboard/touch/gamepad input, surfaces, walls.
4. **Race**: grid, lights, laps/sectors, HUD, finish detection with
   interpolated times.
5. **AI**: racing line, speed profile, pursuit, avoidance, personalities,
   difficulty. A headless tuning script checks the "beatable" margin. Car-to-car
   collisions.
6. **Finish overlay and autopilot**: live-updating standings, TV cam, race-end
   rule with estimated times, best times saved, rematch.
7. **Audio.**
8. **Privacy popup**: start-screen link, `<dialog>` text, the line under the
   Online buttons, advanced server settings.
9. **Multiplayer**: lobby and join link, clock sync, snapshot channels,
   interpolation, lap/finish reporting, host standings, disconnect handling,
   error messages.
10. **Polish and verification**: phone layout, reduced motion, perf on mobile
    (no shadows, lower DPR), README and AGENTS.md "Current games" entry.

---

## 13. Verification

- `node --check` on every module. A headless AI race in Node (race/car/ai
  only) to confirm that all 6 cars finish 3 laps on every track, with no car
  stuck, and that the beatable margin holds.
- Browser over HTTP (`python3 -m http.server`), also served from a parent
  folder to mimic the GitHub Pages subfolder. Check desktop and phone-sized
  viewports.
- Multiplayer: two browser profiles on one machine, then two devices on
  different networks (phone on mobile data) to exercise TURN. Test a guest
  disconnect mid-race, a host disconnect mid-race, and joining a non-existent
  room.
- Privacy: DevTools Network/WebRTC internals confirm **zero** requests to
  `peerjs.com`/Google in solo mode, in the menus, and before Host/Join is
  pressed.

---

## 14. Decisions and status

Decided: the name is "Twin Throttle". The privacy notice is a short English
popup with no operator details (§9).

Implemented as planned, with these changes:
- Lap counting uses unwrapped distance instead of sectors (§6).
- One `snap` message per machine instead of separate `car`/`ai` messages,
  and per-car `laps` messages instead of a host `results` list (§8). Every
  machine sorts the standings itself from the same data.
- Blob shadows instead of a shadow map (§5). No tilt steering (§10).
- `?debug` exposes `window.game`, used to fast-forward races in tests.

Verified: a headless Node race on every track and difficulty (all cars finish,
a clean line beats Hard by about 1.5 % per lap); solo and online in headless
Chromium, including a full online race with identical standings on both sides,
the guest leaving mid-race and the host leaving after the finish; no request
to peerjs.com or Google in solo play (`window.Peer` is never loaded).

Later extras: local split-screen 2P, ghost car of your best lap, more tracks,
tilt steering.
