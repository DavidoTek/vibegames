// Word lists: words/categories.json is the manifest (static hosts can't list
// folders), words/<lang>/<id>.txt hold one word per line ("#" = comment).

import { store } from "./store.js";

const cache = new Map(); // "lang/id" -> string[]
const SEEN_MAX = 600; // remembered words per language, so rounds don't repeat

export async function loadCategories() {
  const res = await fetch("words/categories.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`categories.json: HTTP ${res.status}`);
  return res.json();
}

async function loadList(lang, id) {
  const key = `${lang}/${id}`;
  if (cache.has(key)) return cache.get(key);
  const res = await fetch(`words/${key}.txt`);
  if (!res.ok) throw new Error(`${key}.txt: HTTP ${res.status}`);
  const words = (await res.text())
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter((w) => w && !w.startsWith("#"));
  cache.set(key, words);
  return words;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Endless supply of { word, cat } from the chosen categories. Words seen in
// earlier rounds (also across page reloads) come last.
export class Deck {
  static async create(lang, catIds) {
    const lists = await Promise.all(catIds.map((id) => loadList(lang, id)));
    const pool = [];
    lists.forEach((words, i) => words.forEach((word) => pool.push({ word, cat: catIds[i] })));
    return new Deck(lang, pool);
  }

  constructor(lang, pool) {
    this.lang = lang;
    this.pool = pool;
    this.seenKey = `seen-${lang}`;
    this.seen = new Set(store.get(this.seenKey, []));
    this.queue = [];
    this.refill();
  }

  refill() {
    let fresh = this.pool.filter((e) => !this.seen.has(e.word));
    if (fresh.length < 5) {
      // Everything was played: start over, but keep the order random.
      for (const e of this.pool) this.seen.delete(e.word);
      fresh = this.pool.slice();
    }
    this.queue = shuffle(fresh);
  }

  next() {
    if (!this.queue.length) this.refill();
    const e = this.queue.pop();
    // Re-insert so the Set stays ordered by recency (save() keeps the newest).
    this.seen.delete(e.word);
    this.seen.add(e.word);
    return e;
  }

  save() {
    store.set(this.seenKey, [...this.seen].slice(-SEEN_MAX));
  }
}
