# AGENTS.md

Guidance for coding agents working in this repository. See `README.md` for the
user-facing overview.

## What this is

A static mini-games website: an overview page at `/` plus one folder per game.
Plain HTML/CSS/JavaScript (ES modules), no build step, no package manager, no
backend. It must keep working both locally and on GitHub Pages, where it is
served from a subfolder (`https://<user>.github.io/<repo>/`).

## Hard rules

- **Relative URLs only.** Never use root-absolute paths like `/style.css` or
  `/sudoku3d/`. Games link back to the overview with `href="../"`; the overview
  links to games as `<dir>/` (with trailing slash).
- **No runtime dependencies or CDNs.** Everything is self-contained so it also
  works offline. No bundlers, no `node_modules`, no frameworks.
  - Exception: a library (e.g. three.js) may be used **only if the user
    explicitly asks for it**. Vendor the prebuilt file(s) into that game's own
    folder (e.g. `<game>/vendor/three.module.min.js`), import them with relative
    URLs, and never load them from a CDN. Add a license notice to the root
    `README.md` (library name, version, license, copyright holder, and the
    path of the vendored file), and keep the library's license header or
    license file next to it.
- **No backend.** Anything that needs persistence uses `localStorage`, wrapped in
  `try/catch` (see `store` in `sudoku3d/game.js`).
- Keep `.nojekyll` at the root.

## Layout

```
index.html, style.css, main.js   overview page; fetches games.json, then each <dir>/meta.json
games.json                       ordered list of game folder names (static hosts can't list dirs)
favicon.svg
<game>/
  index.html                     entry point, served at /<game>/
  meta.json                      { name (required), description, tags[], thumbnail, accent, controls }
  thumbnail.svg                  16:9 card image (path relative to the game folder)
  ...                            game code, styles
```

## Adding a game

1. Create `<dir>/index.html` (+ code), `<dir>/meta.json`, and a thumbnail.
2. Append `"<dir>"` to `games.json`.
3. Include a visible way back to the overview (`href="../"`).
4. Make it usable at phone width with touch input as well as mouse/keyboard.

## Conventions

- Match existing style: 2-space indent, double quotes, semicolons, small
  helper functions, short comments explaining *why*.
- Canvas games: size the canvas to `innerWidth/innerHeight * devicePixelRatio`
  (capped at 2) and redraw on `resize`; use `requestAnimationFrame` with `dt`
  clamped (e.g. `Math.min(dt, 1/20)`).
- Audio contexts may only start after a user gesture; unlock on the first
  pointer/key event.
- Respect `prefers-reduced-motion` for decorative CSS animation.
- Anything that flashes (e.g. the Beat Strobe effect) needs a photosensitivity
  warning.

## Testing

There is no test suite. Verify changes in a browser over HTTP (not `file://`,
since `fetch` of JSON is blocked there):

```sh
python3 -m http.server 8000      # then open http://localhost:8000/
node --check path/to/file.js     # quick syntax check
```

To mimic GitHub Pages, serve a parent directory that contains this folder
under some name and open `http://localhost:8000/<name>/`. Check the browser
console for errors and try both a desktop and a phone-sized viewport.

## Current games

- `sudoku3d/`: `game.js` holds everything: puzzle
  generator/solver, a hand-rolled perspective `Camera`, painter's-algorithm tile
  drawing on Canvas 2D, particles, WebAudio sounds synthesized into buffers. The
  HUD is HTML (`#hud`); `Game.resize()` reads the HUD's bounding box to fit the
  board into the remaining area.
- `disco-effects/`: effects.js` has one
  class per effect (subclass `Effect`, implement `setup()` and `render(ctx, f)`,
  register in `EFFECTS`, whose order is the number-key order). `app.js` has the
  beat clock, crossfades, blackout, HUD/help and input. Effects draw into a
  persistent offscreen canvas (for motion trails), which is copied to the
  visible canvas each frame.
- `transport-racer/`: `game.js` holds everything. It is a pseudo-3D "segment"
  racer on Canvas 2D (no three.js, to stay dependency-free). `Track` builds
  segments (curve and height), junction zones, obstacles, cargo cranes and signs
  from a seeded RNG. `Train` handles physics (mass grows with wagons) and keeps a
  lateral-position history so wagons follow the loco through crossovers. Road
  polygons are batched per colour into `Path2D`s. Sprites and boxes are sorted
  far to near and clipped at hill crests via `clipY`.
