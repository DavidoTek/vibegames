# Minigames

A collection of small vibe-coded browser games and toys.
Plain static HTML/CSS/JavaScript: no build step, no backend, and no dependencies beyond
the few libraries vendored into individual games (see [Third-party code](#third-party-code)).

| Game | Folder |
|------|--------|
| Sudoku 3D | `sudoku3d/` |
| Disco Effects | `disco-effects/` |
| Transport Racer | `transport-racer/` |
| Jumper | `jumper/` |
| DOS Adventure | `dosadventure/` |
| WebDAW | `webdaw/` |
| Rail Dispatcher | `trainsim/` |
| Ant Colony | `antcolony/` |

## Run locally

Any static file server works. With Python:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. Opening `index.html` directly as a `file://` URL
does **not** work, because browsers block `fetch()` of the JSON files there.

## Layout

```
index.html, style.css, main.js   overview page (hosted at /)
games.json                       list of game folders shown on the overview
<game>/
  meta.json                      name, description, tags, ...
  index.html                     the game itself (hosted at /<game>/)
  thumbnail.svg                  card image (any image format works)
```

## Adding a game

1. Create a folder, e.g. `snake/`, with an `index.html`.
2. Add `snake/meta.json`:

   ```json
   {
     "name": "Snake",
     "description": "One or two sentences for the overview card.",
     "tags": ["arcade"],
     "thumbnail": "thumbnail.svg",
     "accent": "#6effaa"
   }
   ```

   Only `name` is required. `thumbnail` is relative to the game folder; `accent`
   colours the card's hover glow and tags.
3. Add `"snake"` to `games.json` (a static server can't list directories, so the
   overview needs this list; its order is the order of the cards).
4. Link back to the overview with `href="../"`, and keep all other URLs relative
   too, so the game keeps working under a GitHub Pages subfolder.

## Third-party code

| Library | Version | License | Copyright | Vendored files |
|---------|---------|---------|-----------|----------------|
| [three.js](https://threejs.org/) | r186 (npm `three@0.186.1`) | MIT | © 2010-2026 three.js authors | `jumper/vendor/three.module.js`, `jumper/vendor/three.core.js` (license text in `jumper/vendor/LICENSE`) |
