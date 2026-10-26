// QUEST.EXE: "The Quest for the Singing Crystal", a two-word parser adventure.

import { Term } from "../term.js";
import { COLS } from "../screen.js";
import { awardPrize } from "../progress.js";
import { wrap } from "../shell.js";

const ROOMS = {
  clearing: {
    name: "Forest Clearing",
    desc: "Tall pines ring a sunny clearing. A path leads north to a dark cave mouth. A thatched hut stands to the east, a lake glitters to the west, and an old well sits to the south.",
    exits: { n: "mouth", e: "hut", w: "lake", s: "well" },
  },
  hut: {
    name: "Hermit's Hut",
    desc: "A cramped hut that smells of pipe smoke and old socks. A rickety table with a drawer stands in the middle. The door is to the west.",
    exits: { w: "clearing", out: "clearing" },
  },
  lake: {
    name: "Lake Shore",
    desc: "Clear water laps at a pebbly shore. Silver fish dart about in the shallows. The clearing is back to the east.",
    exits: { e: "clearing" },
  },
  well: {
    name: "Old Well",
    desc: "A mossy stone well. A knotted rope disappears into the darkness below. The clearing is to the north.",
    exits: { n: "clearing", d: "bottom" },
  },
  bottom: {
    name: "Bottom of the Well",
    desc: "Damp, round and muddy. A little light filters down from far above. The rope leads back up.",
    exits: { u: "well" },
  },
  mouth: {
    name: "Cave Mouth",
    desc: "A gaping cave mouth in a cliff face. Cold air breathes out of the darkness to the north. The forest is to the south.",
    exits: { s: "clearing", n: "tunnel", in: "tunnel" },
  },
  tunnel: {
    name: "Dark Tunnel",
    desc: "Your lamp throws shaky shadows on wet rock. To the north the tunnel ends at a chasm spanned by a rope bridge. The way out is south.",
    exits: { s: "mouth", n: "ledge" },
    dark: true,
  },
  ledge: {
    name: "Bridge Ledge",
    desc: "A narrow ledge on the far side of the chasm. A huge stone door is set into the rock to the north, covered in carved letters. The rope bridge leads back south.",
    exits: { s: "tunnel", n: "hall" },
  },
  hall: {
    name: "Hall of Echoes",
    desc: "A vaulted hall where every footstep comes back three times. In the centre stands a stone pedestal with a pressure plate on top. The door is to the south.",
    exits: { s: "ledge" },
  },
};

const ITEMS = {
  lamp: { name: "an oil lamp", nouns: ["LAMP", "LANTERN"], start: "hut", desc: "A brass oil lamp, full of oil." },
  rod: { name: "a fishing rod", nouns: ["ROD", "POLE", "FISHING"], start: "hut", desc: "A bamboo fishing rod with a bent-pin hook." },
  matches: { name: "a box of matches", nouns: ["MATCHES", "MATCH", "BOX"], start: null, desc: "A box of matches. Three left." },
  rock: { name: "a smooth rock", nouns: ["ROCK", "STONE", "PEBBLE"], start: "lake", desc: "A smooth, heavy rock, about the size of a loaf of bread." },
  fish: { name: "a wriggling fish", nouns: ["FISH", "TROUT"], start: null, desc: "A plump, silvery fish. It looks at you reproachfully." },
  coin: { name: "an old coin", nouns: ["COIN", "GOLD", "MONEY"], start: "bottom", desc: "A tarnished gold coin. One side shows a cat, the other a floppy disk." },
  crystal: { name: "the Singing Crystal", nouns: ["CRYSTAL", "GEM"], start: null, desc: "A crystal as long as your hand. It hums very faintly." },
};

const DIRS = { N: "n", NORTH: "n", S: "s", SOUTH: "s", E: "e", EAST: "e", W: "w", WEST: "w", U: "u", UP: "u", D: "d", DOWN: "d", IN: "in", OUT: "out", ENTER: "in", LEAVE: "out" };
const FILLER = new Set(["THE", "A", "AN", "AT", "SOME", "MY", "INTO", "WITH"]);
const MAX_SCORE = 10;

function fresh() {
  const loc = {};
  for (const [id, it] of Object.entries(ITEMS)) loc[id] = it.start;
  return { room: "clearing", loc, flags: {}, moves: 0, score: 0, done: false };
}

export class Quest {
  constructor(sys) {
    this.sys = sys;
    this.s = sys.screen;
    this.term = new Term(sys.screen, { top: 1, bottom: 24, fg: 7, bg: 0 });
    this.history = [];
  }

  controls() {
    return { set: "text", chips: ["LOOK", "INV", "N", "S", "E", "W", "U", "D", "TAKE ", "EXAMINE ", "HELP"] };
  }

  get music() { return "quest"; }

  get st() { return this.sys.state.quest; }

  start() {
    this.s.setMode("text");
    this.s.clear();
    this.s.cursor.on = true;
    if (!this.sys.state.quest || this.sys.state.quest.v !== 1) this.sys.state.quest = { v: 1, ...fresh() };
    this.status();
    this.loop();
  }

  status() {
    const r = ROOMS[this.st.room];
    this.s.fill(0, 0, COLS, 1, " ", 1, 7);
    this.s.text(1, 0, r.name, 1, 7);
    const right = `Score: ${this.st.score}/${MAX_SCORE}   Moves: ${this.st.moves}`;
    this.s.text(COLS - right.length - 1, 0, right, 1, 7);
  }

  say(text, fg) { this.term.writeln(wrap(text, 78), fg); }

  async loop() {
    const t = this.term;
    t.clear();
    t.writeln("THE QUEST FOR THE SINGING CRYSTAL", 14);
    t.writeln("A text adventure by Mort, 1994. Type HELP if you're lost, QUIT to leave.", 8);
    t.writeln();
    this.look(true);
    for (;;) {
      t.writeln();
      t.write(">", 15);
      const line = await t.readLine({ history: this.history });
      if (line === null) continue;
      const res = this.command(line);
      this.status();
      this.sys.save();
      if (res === "quit") return this.sys.exit();
      if (res === "won") {
        t.writeln();
        t.write("Press any key to return to DOS.", 8);
        await t.readKey();
        const lines = awardPrize(this.sys.fs, "C:\\GAMES\\QUEST", "SOUND.DRV", "SOUND.DRV - sound driver for PANES 1.0");
        return this.sys.exit({ lines: ["The hermit's crystal sings. You won THE QUEST!", ...lines] });
      }
    }
  }

  here(id) { return this.st.loc[id] === this.st.room; }
  carried(id) { return this.st.loc[id] === "inv"; }
  avail(id) { return this.here(id) || this.carried(id); }
  point(flag) { if (!this.st.flags["pt_" + flag]) { this.st.flags["pt_" + flag] = true; this.st.score++; } }

  look(full = true) {
    const st = this.st, r = ROOMS[st.room], f = st.flags;
    this.say(r.name, 15);
    if (!full) return;
    let d = r.desc;
    if (st.room === "hut") d += f.hermitAwake ? " An old hermit sits in a rocking chair, watching you with one eye open." : " An old hermit snores in a rocking chair.";
    if (st.room === "tunnel") d += f.trollFed ? " The bridge is clear now; the troll has wandered off, munching happily." : " A large troll sits on the bridge, arms crossed.";
    if (st.room === "ledge" && f.doorOpen) d = d.replace("is set into the rock to the north", "stands open to the north");
    if (st.room === "hall") d += f.rockPlaced ? " A smooth rock sits on the pressure plate." : "";
    if (st.room === "hall" && st.loc.crystal === null && !f.crystalTaken) d += " On the plate lies a glowing crystal.";
    this.say(d);
    const items = Object.keys(ITEMS).filter((id) => this.here(id) && !(id === "rock" && f.rockPlaced));
    if (items.length) this.say("You can see " + items.map((id) => ITEMS[id].name).join(", ") + ".", 11);
  }

  findItem(noun) {
    return Object.keys(ITEMS).find((id) => ITEMS[id].nouns.includes(noun)) || null;
  }

  command(raw) {
    const words = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !FILLER.has(w));
    if (!words.length) { this.say("Beg pardon?"); return; }
    this.st.moves++;
    let [verb, ...rest] = words;
    if (verb === "PICK" && rest[0] === "UP") rest.shift();
    if (verb === "LOOK" && rest[0] === "AT") rest.shift();
    if (verb === "GO" || verb === "WALK" || verb === "RUN" || verb === "CLIMB") {
      if (verb === "CLIMB" && !rest.length) rest = [this.st.room === "bottom" ? "UP" : "DOWN"];
      verb = rest.shift() || "";
    }
    const noun = rest.join(" ");
    const first = rest[0] || "";
    if (DIRS[verb]) return this.go(DIRS[verb]);
    switch (verb) {
      case "L": case "LOOK": if (!first) return this.look(); return this.examine(first);
      case "X": case "EXAMINE": case "INSPECT": case "READ": case "SEARCH": return this.examine(first);
      case "I": case "INV": case "INVENTORY": return this.inventory();
      case "TAKE": case "GET": case "PICK": case "GRAB": return this.take(first);
      case "DROP": case "PUT": case "PLACE": return this.drop(rest);
      case "OPEN": return this.open(first);
      case "LIGHT": case "IGNITE": case "BURN": return this.light(first);
      case "FISH": case "CATCH": return this.fish();
      case "GIVE": case "FEED": case "OFFER": return this.give(rest);
      case "SAY": case "ANSWER": case "SPEAK": case "SHOUT": case "YELL": return this.speak(first);
      case "WAKE": case "POKE": case "SHAKE": return this.wake(first);
      case "TALK": case "ASK": return this.talk(rest[0] === "TO" ? rest[1] : first);
      case "USE": return this.use(rest);
      case "KEYBOARD": return this.speak("KEYBOARD");
      case "HELP": case "HINT":
        this.say("Try verbs like LOOK, EXAMINE thing, TAKE thing, DROP thing, OPEN, LIGHT, GIVE thing TO someone, PUT thing ON thing, SAY word, WAKE someone, INVENTORY (I). Move with N, S, E, W, U, D. RESTART starts over, QUIT goes back to DOS (your progress is kept).");
        return;
      case "SCORE": this.say(`You have ${this.st.score} of ${MAX_SCORE} points in ${this.st.moves} moves.`); return;
      case "XYZZY": case "PLUGH": this.say("A hollow voice says: \"Wrong game, buddy.\""); return;
      case "SWIM": this.say("The water is freezing. You decide against it."); return;
      case "EAT": this.say(first === "FISH" ? "Raw? You're not a troll." : "You're not hungry."); return;
      case "QUIT": case "EXIT": case "Q": this.say("Your progress is saved. See you, adventurer."); return "quit";
      case "RESTART":
        this.sys.state.quest = { v: 1, ...fresh() };
        this.say("Time rewinds...", 14);
        this.look();
        return;
      default:
        this.say(`I don't know the word "${verb.toLowerCase()}".`);
    }
  }

  go(dir) {
    const st = this.st, r = ROOMS[st.room], f = st.flags;
    const to = r.exits[dir];
    if (!to) { this.say("You can't go that way."); return; }
    if (to === "tunnel" && st.room === "mouth" && !(f.lampLit && this.carried("lamp"))) {
      this.say("It is pitch dark. Something with too many legs scuttles nearby. You hurry back out into the light.");
      return;
    }
    if (to === "ledge" && st.room === "tunnel" && !f.trollFed) {
      this.say("The troll growls: \"NO CROSS. TROLL HUNGRY.\"");
      return;
    }
    if (to === "hall" && !f.doorOpen) { this.say("The stone door is shut tight. There's writing on it."); return; }
    st.room = to;
    this.look();
  }

  examine(noun) {
    const st = this.st, f = st.flags;
    if (!noun) { this.say("Examine what?"); return; }
    const id = this.findItem(noun);
    if (id && this.avail(id)) {
      let d = ITEMS[id].desc;
      if (id === "lamp") d = f.lampLit ? "A brass oil lamp, burning with a steady flame." : d + " It isn't lit.";
      this.say(d);
      return;
    }
    const room = st.room;
    if (["DRAWER", "TABLE"].includes(noun) && room === "hut") { this.say(f.drawerOpen ? "The drawer is open." : "A small drawer. It is closed."); return; }
    if (["HERMIT", "MAN", "OLD"].includes(noun) && room === "hut") { this.say(f.hermitAwake ? "A wiry old hermit with a beard down to his knees. He's waiting for something." : "A wiry old hermit with a beard down to his knees, snoring loudly."); return; }
    if (["TROLL"].includes(noun) && room === "tunnel" && !f.trollFed) { this.say("Big, green, and grumpy. His stomach rumbles like a hard disk."); return; }
    if (["DOOR", "WRITING", "LETTERS", "RIDDLE", "INSCRIPTION"].includes(noun) && room === "ledge") {
      this.say("The carved letters read:", 15);
      this.say("  \"I have keys, but open no locks.\n   I have space, but no room.\n   You can enter, but never go outside.\n   Speak my name, and pass.\"", 14);
      return;
    }
    if (["PEDESTAL", "PLATE"].includes(noun) && room === "hall") { this.say("A pressure plate. Lift whatever is on it and something will surely happen. Unless something just as heavy takes its place..."); return; }
    if (["WELL", "ROPE"].includes(noun) && (room === "well" || room === "bottom")) { this.say("A knotted rope. You could climb it."); return; }
    if (["WATER", "LAKE"].includes(noun) && room === "lake") { this.say("Fish dart about. With a rod you could catch one."); return; }
    if (["BRIDGE", "CHASM"].includes(noun) && (room === "tunnel" || room === "ledge")) { this.say("A rope bridge over a very deep chasm. Don't look down."); return; }
    this.say("You see nothing special.");
  }

  inventory() {
    const items = Object.keys(ITEMS).filter((id) => this.carried(id));
    this.say(items.length ? "You are carrying: " + items.map((id) => ITEMS[id].name).join(", ") + "." : "You are empty-handed.");
  }

  take(noun) {
    const st = this.st, f = st.flags;
    if (!noun) { this.say("Take what?"); return; }
    if (noun === "ALL") {
      const items = Object.keys(ITEMS).filter((id) => this.here(id) && !(id === "rock" && f.rockPlaced));
      if (!items.length) { this.say("There's nothing here to take."); return; }
      for (const id of items) this.take(ITEMS[id].nouns[0]);
      return;
    }
    if (noun === "CRYSTAL" && st.room === "hall" && st.loc.crystal === null && !f.crystalTaken) {
      if (!f.rockPlaced) {
        this.say("You lift the crystal. The plate clicks. A rock the size of a cow drops from the ceiling! You dive for the door...", 12);
        this.say("...and wake up on the Bridge Ledge, bruised but alive. The crystal is back on its plate. Maybe something else should keep the plate pressed down.");
        st.room = "ledge";
        return;
      }
      f.crystalTaken = true;
      st.loc.crystal = "inv";
      this.point("crystal");
      this.say("You lift the crystal. The rock keeps the plate pressed down. Nothing falls on your head. The crystal hums softly in your hand.", 10);
      return;
    }
    const id = this.findItem(noun);
    if (!id) { this.say(`I don't know what a "${noun.toLowerCase()}" is.`); return; }
    if (this.carried(id)) { this.say("You already have it."); return; }
    if (id === "rock" && f.rockPlaced && st.room === "hall") { this.say("Better leave it on the plate."); return; }
    if (!this.here(id)) { this.say("You don't see that here."); return; }
    st.loc[id] = "inv";
    this.say("Taken.");
  }

  drop(rest) {
    const st = this.st, f = st.flags;
    const onIdx = rest.findIndex((w) => w === "ON" || w === "IN");
    const what = rest[0] || "";
    const target = onIdx >= 0 ? rest[onIdx + 1] : null;
    const id = this.findItem(what);
    if (!id || !this.carried(id)) { this.say("You don't have that."); return; }
    if (target && ["PEDESTAL", "PLATE"].includes(target)) {
      if (st.room !== "hall") { this.say("There's no pedestal here."); return; }
      if (id !== "rock") { this.say("That's far too light to keep the plate pressed down."); return; }
      st.loc.rock = "hall";
      f.rockPlaced = true;
      this.point("rock");
      this.say("You set the rock on the pressure plate, right next to the crystal. The plate sinks a little and stays down.");
      return;
    }
    st.loc[id] = st.room;
    this.say("Dropped.");
  }

  open(noun) {
    const st = this.st, f = st.flags;
    if (["DRAWER", "TABLE"].includes(noun) && st.room === "hut") {
      if (f.drawerOpen) { this.say("It's already open."); return; }
      f.drawerOpen = true;
      st.loc.matches = "hut";
      this.point("matches");
      this.say("You open the drawer. Inside is a box of matches.");
      return;
    }
    if (noun === "DOOR" && st.room === "ledge") { this.say(f.doorOpen ? "It's open." : "There's no handle. The door seems to be waiting for the right word."); return; }
    this.say("You can't open that.");
  }

  light(noun) {
    const st = this.st, f = st.flags;
    if (noun && !["LAMP", "LANTERN"].includes(noun)) { this.say("You can't light that."); return; }
    if (!this.carried("lamp")) { this.say("You need to be holding the lamp."); return; }
    if (!this.carried("matches")) { this.say("You have nothing to light it with."); return; }
    if (f.lampLit) { this.say("It's already burning."); return; }
    f.lampLit = true;
    this.point("lamp");
    this.say("You strike a match and light the lamp. It burns with a warm, steady flame.");
  }

  fish() {
    const st = this.st;
    if (st.room !== "lake") { this.say("There are no fish here."); return; }
    if (!this.carried("rod")) { this.say("You try to grab a fish with your bare hands. The fish are not impressed."); return; }
    if (st.loc.fish) { this.say("One fish is plenty."); return; }
    st.loc.fish = "inv";
    this.point("fish");
    this.say("You cast the line. After a moment, a plump fish bites! You now have a fish.");
  }

  give(rest) {
    const st = this.st, f = st.flags;
    const toIdx = rest.indexOf("TO");
    const what = toIdx >= 0 ? rest[0] : rest[rest.length > 1 ? 1 : 0];
    const who = toIdx >= 0 ? rest[toIdx + 1] : rest.length > 1 ? rest[0] : "";
    const id = this.findItem(what || "");
    if (!id || !this.carried(id)) { this.say("You don't have that."); return; }
    if (who === "TROLL" && st.room === "tunnel" && !f.trollFed) {
      if (id === "fish") {
        st.loc.fish = "gone";
        f.trollFed = true;
        this.point("troll");
        this.say("The troll sniffs the fish, swallows it whole and pats his belly. \"FISH GOOD. YOU CROSS.\" He lumbers off into a side passage.", 10);
      } else if (id === "coin") this.say("\"TROLL NOT WANT SHINY. TROLL WANT FOOD.\"");
      else this.say("The troll looks at it, then at you. \"NOT FOOD.\"");
      return;
    }
    if (["HERMIT", "MAN", "OLD"].includes(who) && st.room === "hut") {
      if (!f.hermitAwake) { this.say("The hermit is fast asleep."); return; }
      if (id === "coin") {
        st.loc.coin = "gone";
        this.point("coin");
        this.say("\"Ooh, a cat-and-floppy coin! Very rare.\" The hermit pockets it with a grin.");
        return;
      }
      if (id === "crystal") return this.win();
      this.say("\"No thanks.\"");
      return;
    }
    this.say("Nobody here wants that.");
  }

  win() {
    const st = this.st;
    st.loc.crystal = "gone";
    this.point("win"); this.point("win2");
    st.done = true;
    this.say("The hermit takes the crystal and taps it with his pipe. It begins to sing: a clear, bright melody that fills the hut and drifts out over the forest.", 14);
    this.sys.audio.tune([[523, 0.15], [659, 0.15], [784, 0.15], [1047, 0.3], [784, 0.15], [1047, 0.5]], { type: "square", vol: 0.05 });
    this.say("\"There,\" says the hermit. \"Sound! Mort will be pleased. Take this, it fell out of the crystal.\" He hands you a small disk labelled SOUND.DRV.");
    this.say(`*** You have won! You scored ${st.score} of ${MAX_SCORE} points in ${st.moves} moves. ***`, 10);
    this.sys.state.stats.questMoves = st.moves;
    this.sys.state.quest = { v: 1, ...fresh() };
    return "won";
  }

  speak(word) {
    const st = this.st, f = st.flags;
    if (!word) { this.say("Say what?"); return; }
    if (st.room === "ledge" && !f.doorOpen) {
      if (word === "KEYBOARD") {
        f.doorOpen = true;
        this.point("door");
        this.say("The letters glow and the stone door grinds open. The way north is clear!", 10);
      } else this.say("Your voice echoes. The door doesn't move.");
      return;
    }
    this.say(`You say "${word.toLowerCase()}" out loud. Nothing happens.`);
  }

  wake(noun) {
    const st = this.st, f = st.flags;
    if (st.room === "hut" && (!noun || ["HERMIT", "MAN", "OLD"].includes(noun))) {
      if (f.hermitAwake) { this.say("He's awake. \"Got that crystal yet?\""); return; }
      f.hermitAwake = true;
      this.say("The hermit opens one eye. \"Hm? Bring me the Singing Crystal from the Hall of Echoes, and I'll make it sing for you. It's beyond the troll and the talking door.\"");
      return;
    }
    if (st.room === "tunnel" && noun === "TROLL") { this.say("He isn't asleep. He's hungry."); return; }
    this.say("There's nobody here to wake.");
  }

  talk(noun) {
    if (["HERMIT", "MAN", "OLD"].includes(noun) || (!noun && this.st.room === "hut")) return this.wake("HERMIT");
    if (noun === "TROLL" && this.st.room === "tunnel") { this.say("\"TROLL HUNGRY.\""); return; }
    this.say("Nobody answers.");
  }

  use(rest) {
    const id = this.findItem(rest[0] || "");
    if (id === "rod") return this.fish();
    if (id === "matches") return this.light("LAMP");
    if (id === "lamp") return this.light("LAMP");
    if (id === "rock" && rest.includes("PEDESTAL")) return this.drop(["ROCK", "ON", "PEDESTAL"]);
    if (this.st.room === "well" && (rest.includes("ROPE") || rest.includes("WELL"))) return this.go("d");
    this.say("How do you want to use it? Try a more specific verb.");
  }

  key(ev) { this.term.key(ev); }
  pointer(ev) {
    if (ev.type !== "click" || !this.term.editing) return;
    const w = this.term.wordAt(Math.floor(ev.x / 8), Math.floor(ev.y / 16));
    if (w && /^[A-Za-z]+$/.test(w)) {
      const buf = this.term.editBuffer;
      this.term.insertText((buf && !buf.endsWith(" ") ? " " : "") + w.toUpperCase());
    }
  }
  update() {}
}
