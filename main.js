// Overview page: reads games.json (list of folder names), then each folder's meta.json.
// All URLs are relative so the site works both at / and in a subfolder (GitHub Pages).

const list = document.getElementById("games");
const statusEl = document.getElementById("status");
const tagsEl = document.getElementById("tags");
const searchEl = document.getElementById("search");
const countEl = document.getElementById("count");
const tpl = document.getElementById("card-tpl");

let games = [];
let activeTag = null;

async function loadJSON(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function load() {
  let folders;
  try {
    folders = await loadJSON("games.json");
  } catch (err) {
    statusEl.textContent = location.protocol === "file:"
      ? "Open this page through a web server (e.g. `python3 -m http.server`), browsers block loading game data from file:// URLs."
      : `Could not load the game list (${err.message}).`;
    return;
  }
  const results = await Promise.allSettled(
    folders.map(async (dir) => ({ dir, ...(await loadJSON(`${dir}/meta.json`)) }))
  );
  games = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  results.forEach((r, i) => {
    if (r.status === "rejected") console.warn(`Skipping ${folders[i]}:`, r.reason);
  });
  renderTags();
  render();
}

function renderTags() {
  const tags = [...new Set(games.flatMap((g) => g.tags || []))].sort();
  tagsEl.replaceChildren(
    ...[null, ...tags].map((tag) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = tag ?? "All";
      b.setAttribute("aria-pressed", String(tag === activeTag));
      b.addEventListener("click", () => {
        activeTag = tag;
        tagsEl.querySelectorAll("button").forEach((x) =>
          x.setAttribute("aria-pressed", String(x === b)));
        render();
      });
      return b;
    })
  );
}

function matches(game, query) {
  if (activeTag && !(game.tags || []).includes(activeTag)) return false;
  if (!query) return true;
  const hay = [game.name, game.description, ...(game.tags || [])].join(" ").toLowerCase();
  return query.split(/\s+/).every((w) => hay.includes(w));
}

function render() {
  const query = searchEl.value.trim().toLowerCase();
  const shown = games.filter((g) => matches(g, query));
  list.replaceChildren(...shown.map(card));
  statusEl.textContent = games.length && !shown.length ? "No games match your search." : "";
  countEl.textContent = `${games.length} game${games.length === 1 ? "" : "s"}`;
}

function card(game, i) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.style.setProperty("--accent", game.accent || "#5ac8ff");
  node.style.setProperty("--delay", `${i * 70}ms`);
  const a = node.querySelector(".card-link");
  a.href = `${game.dir}/`;
  const img = node.querySelector("img");
  if (game.thumbnail) img.src = `${game.dir}/${game.thumbnail}`;
  else img.remove();
  node.querySelector(".card-title").textContent = game.name || game.dir;
  node.querySelector(".card-desc").textContent = game.description || "";
  node.querySelector(".card-tags").replaceChildren(
    ...(game.tags || []).map((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      return li;
    })
  );
  return node;
}

searchEl.addEventListener("input", render);
load();
