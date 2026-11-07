// Game engine: no DOM, so it can run headless in Node for testing.
// It deals roles and words, builds the list of steps a round goes through,
// tallies votes and works out the winner and points.

import { CATEGORIES, ODD_SETS, MISSIONS, LENSES } from "./content.js";

export const MODE_IDS = ["blank", "near", "ally", "switch", "quests", "odd"];

// `options` lists the config entries shown for the mode (in this order).
const COMMON = ["rounds", "clueTimer", "discussTimer", "finalGuess"];
export const MODES = {
  blank: { min: 3, max: 12, minutes: "5–10", level: 1, color: "#8f9bff", options: ["categories", "difficulty", "showCategory", "clueRounds", ...COMMON] },
  near: { min: 3, max: 12, minutes: "8–12", level: 2, color: "#ff9f43", options: ["categories", "doubleKnows", ...COMMON] },
  ally: { min: 4, max: 12, minutes: "8–12", level: 2, color: "#2ed3a0", options: ["categories", "difficulty", "showCategory", "clueRounds", ...COMMON] },
  switch: { min: 4, max: 12, minutes: "10–15", level: 3, color: "#ff5c8a", options: ["categories", "difficulty", "showCategory", ...COMMON] },
  quests: { min: 3, max: 12, minutes: "10–15", level: 2, color: "#ffd23f", options: ["categories", "difficulty", "showCategory", "clueRounds", ...COMMON] },
  odd: { min: 4, max: 10, minutes: "8–12", level: 3, color: "#b57bff", options: [...COMMON] },
};

export const DEFAULT_CONFIG = {
  categories: [], // empty = all
  difficulty: "mixed",
  showCategory: true,
  clueRounds: 1,
  doubleKnows: false,
  rounds: 3, // 0 = endless
  clueTimer: 0, // seconds per speaker, 0 = off
  discussTimer: 120, // seconds, 0 = off
  finalGuess: true,
};

// Uniform random integer in [0, n) from Web Crypto, with rejection sampling
// so there is no modulo bias.
export function randInt(n) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

export function shuffle(arr, rnd = randInt) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = (arr, rnd) => arr[rnd(arr.length)];

function activeCategories(cfg) {
  const chosen = CATEGORIES.filter((c) => cfg.categories.includes(c.id));
  return chosen.length ? chosen : CATEGORIES;
}

// Picks an item that hasn't been used this session; when the pool runs dry,
// its items are forgotten so play can go on forever.
function fresh(pool, used, key, rnd) {
  let left = pool.filter((p) => !used.has(key(p)));
  if (!left.length) {
    pool.forEach((p) => used.delete(key(p)));
    left = pool;
  }
  const item = pick(left, rnd);
  used.add(key(item));
  return item;
}

function wordPool(cfg) {
  return activeCategories(cfg).flatMap((c) => {
    const list = cfg.difficulty === "easy" ? c.easy : cfg.difficulty === "hard" ? c.hard : [...c.easy, ...c.hard];
    return list.map((word) => ({ word, category: c.name }));
  });
}

// Deals one "word + one Blank" act. Returns the per-player cards.
function dealWord(ids, word, category, blank, cfg) {
  const cards = {};
  for (const id of ids) {
    cards[id] = id === blank
      ? { show: "blank", category: cfg.showCategory ? category : null }
      : { show: "holder", word };
  }
  return cards;
}

/**
 * Builds a complete round. `players` is [{ id, name }], `used` a Set that
 * remembers words across rounds. Everything secret lives in the returned
 * object (memory only).
 */
export function createRound(mode, players, cfg, used = new Set(), rnd = randInt) {
  const ids = players.map((p) => p.id);
  const n = ids.length;
  const m = MODES[mode];
  if (!m || n < m.min || n > m.max) throw new Error(`Bad player count ${n} for ${mode}`);

  const r = { mode, ids, roles: {}, acts: [], hidden: null, ally: null, firstHidden: null, lens: null, missions: null, answer: null };
  const roleAll = (role) => ids.forEach((id) => { r.roles[id] = role; });

  if (mode === "blank" || mode === "ally" || mode === "quests") {
    const { word, category } = fresh(wordPool(cfg), used, (p) => p.word, rnd);
    const order = shuffle(ids, rnd);
    r.hidden = order[0];
    roleAll("holder");
    r.roles[r.hidden] = "blank";
    const cards = dealWord(ids, word, category, r.hidden, cfg);
    if (mode === "ally") {
      r.ally = order[1];
      r.roles[r.ally] = "ally";
      cards[r.ally] = { show: "ally", word, blank: r.hidden };
    }
    if (mode === "quests") {
      const missions = shuffle(MISSIONS, rnd);
      r.missions = {};
      ids.forEach((id, i) => {
        r.missions[id] = missions[i % missions.length];
        cards[id].mission = r.missions[id];
      });
    }
    r.acts.push({ word, category, cards });
    r.answer = word;
  } else if (mode === "near") {
    const cat = pick(activeCategories(cfg), rnd);
    const pair = fresh(cat.pairs, used, (p) => p.join("/"), rnd);
    const [main, alt] = rnd(2) ? pair : [pair[1], pair[0]];
    r.hidden = pick(ids, rnd);
    roleAll("holder");
    r.roles[r.hidden] = "double";
    const cards = {};
    for (const id of ids) {
      cards[id] = id === r.hidden
        ? { show: cfg.doubleKnows ? "double" : "word", word: alt }
        : { show: cfg.doubleKnows ? "holder" : "word", word: main };
    }
    r.acts.push({ word: main, alt, category: cat.name, cards });
    r.answer = main;
  } else if (mode === "switch") {
    const pool = wordPool(cfg);
    const a = fresh(pool, used, (p) => p.word, rnd);
    let b = fresh(pool, used, (p) => p.word, rnd);
    // A tiny pool (one category, one difficulty) could hand back the same word.
    for (let i = 0; b.word === a.word && i < 20; i++) b = pick(pool, rnd);
    const order = shuffle(ids, rnd);
    r.firstHidden = order[0];
    r.hidden = order[1];
    roleAll("holder");
    r.roles[r.hidden] = "blank";
    r.acts.push({ word: a.word, category: a.category, cards: dealWord(ids, a.word, a.category, r.firstHidden, cfg) });
    r.acts.push({ word: b.word, category: b.category, cards: dealWord(ids, b.word, b.category, r.hidden, cfg) });
    r.answer = b.word;
  } else if (mode === "odd") {
    const set = fresh(ODD_SETS.filter((s) => s.words.length >= n - 1), used, (s) => s.group, rnd);
    const words = shuffle(set.words, rnd).slice(0, n - 1);
    const odd = pick(set.odd, rnd);
    r.hidden = pick(ids, rnd);
    const cards = {};
    let w = 0;
    for (const id of ids) {
      const outlier = id === r.hidden;
      r.roles[id] = outlier ? "outlier" : "member";
      cards[id] = { show: "word", word: outlier ? odd : words[w++] };
    }
    r.acts.push({ group: set.group, odd, cards });
    r.answer = set.group;
  }

  // Second clue rounds get a shared "Clue Lens" question.
  const twoClues = mode === "near" || mode === "odd" || ((mode === "blank" || mode === "ally" || mode === "quests") && cfg.clueRounds === 2);
  if (twoClues) r.lens = pick(LENSES, rnd);

  // Clue order: clockwise from a random start that is never the hidden player
  // (opening the round with no word would be too harsh).
  const avoid = new Set([r.hidden, r.firstHidden]);
  const starts = ids.map((_, i) => i).filter((i) => !avoid.has(ids[i]));
  const s = pick(starts, rnd);
  r.order = [...ids.slice(s), ...ids.slice(0, s)];

  r.steps = mode === "switch"
    ? ["deal:0", "clue:0", "switch", "deal:1", "clue:1", "discuss", "vote", "outcome"]
    : ["deal:0", "clue:0", ...(twoClues ? ["clue:1"] : []), "discuss", "vote", "outcome"];
  return r;
}

/** The card a player sees in a given act (Switch has two acts). */
export function cardFor(round, act, id) {
  return round.acts[act].cards[id];
}

/** Counts votes for the candidates; `top` holds everyone with the most votes. */
export function tally(votes, candidates) {
  const counts = Object.fromEntries(candidates.map((c) => [c, 0]));
  for (const target of Object.values(votes)) if (target in counts) counts[target]++;
  const max = Math.max(...Object.values(counts));
  return { counts, max, top: candidates.filter((c) => counts[c] === max) };
}

/**
 * accused: the player voted out, or null when the revote was still tied.
 * guessed: whether a caught hidden player named the answer.
 */
export function decide(round, accused, guessed) {
  if (accused !== round.hidden) return { winner: "hidden", how: accused == null ? "tie" : "wrong" };
  if (guessed) return { winner: "hidden", how: "guessed" };
  return { winner: "holders", how: "caught" };
}

export function isHiddenTeam(round, id) {
  return id === round.hidden || id === round.ally;
}

/** Points for one round. `missionsDone` is a Set of player ids. */
export function scoreRound(round, result, votes, missionsDone = new Set()) {
  const pts = Object.fromEntries(round.ids.map((id) => [id, 0]));
  if (result.winner === "hidden") {
    pts[round.hidden] += result.how === "guessed" ? 2 : 3;
    if (round.ally) pts[round.ally] += 2;
  } else {
    for (const id of round.ids) {
      if (isHiddenTeam(round, id)) continue;
      pts[id] += 1;
      if (votes[id] === round.hidden) pts[id] += 1;
    }
  }
  for (const id of missionsDone) if (id in pts) pts[id] += 1;
  return pts;
}
