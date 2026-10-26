// Easter egg: LOADLIN boots "Linux 1.0" with a tiny Unix shell. The DOS
// drive is mounted read-only at /dos, so it can't be used to skip puzzles.

import { Term } from "../term.js";
import { COLS } from "../screen.js";
import { fileText } from "../shell.js";

const BOOT = [
  "Linux version 1.0.0 (mort@vibetron) #1 Sun Mar 13 23:41:07 1994",
  "Console: colour EGA+ 80x25, 1 virtual console (max 63)",
  "Calibrating delay loop.. ok - 33.28 BogoMIPS",
  "Memory: 3772k/4096k available (448k kernel code, 384k reserved)",
  "Floppy drive(s): fd0 is 1.44M",
  "hda: VIBEDISK 120MB, 117MB w/0kB Cache, CHS=900/8/32",
  "Partition check:",
  "  hda: hda1 hda2",
  "VFS: Mounted root (ext2 filesystem) readonly.",
  "Adding Swap: 8188k swap-space",
  "INIT: version 2.4 booting",
  "mount: /dev/hda1 on /dos type msdos (ro)",
];

const TUX = [
  "            .-\"\"\"-.",
  "           /  o o  \\",
  "          |   \\_/   |",
  "         /|  .---.  |\\",
  "        / | /     \\ | \\",
  "       |  ||       ||  |",
  "        \\ | \\_____/ | /",
  "         `|_________|'",
  "          /__/   \\__\\",
];

const TRAIN = [
  "                  (@@)  (  )  (@)  ( )  @@",
  "             ( )",
  "           ====          ________________",
  "       _D _|  |_________/  MORT EXPRESS  \\_____",
  "        |(_)---  |   H  |  []  []  []  [] |   |",
  "        /     |  |   H  |__________________|___|",
  "       |      |  |   H  |  __    __    __  |",
  "       |______|__|___H__|_(__)__(__)__(__)_|",
  "         (O)   (O)       (O)  (O)  (O)  (O)",
];

const FORTUNES = [
  "You will find a missing part of PANES in an unexpected folder.",
  "Real programmers count from 0.",
  "There are 10 kinds of people: those who understand binary and those who don't.",
  "A cat on the keyboard is worth two in the bush.",
  "640K ought to be enough for... no. No it isn't.",
  "Today is a good day to UNDELETE something.",
  "Floppy is a good boy.",
  "If at first you don't succeed, call it version 1.0.",
  "The early bird gets the worm. The early mouse gets the cat.",
];

const FILES = {
  "/": ["bin", "dos", "etc", "home", "proc", "tmp", "usr"],
  "/bin": ["bash", "cat", "ls", "sh", "sl", "vi"],
  "/etc": ["issue", "motd", "passwd"],
  "/home": ["byte", "mort"],
  "/home/byte": ["nap.txt"],
  "/home/mort": [".plan", "README", "penguin.txt", "todo.txt"],
  "/proc": ["cpuinfo", "meminfo", "version"],
  "/tmp": [],
  "/usr": ["bin", "lib", "src"],
  "/usr/bin": ["emacs (too big)", "fortune", "startx"],
  "/usr/lib": [],
  "/usr/src": ["linux-1.0"],
  "/usr/src/linux-1.0": ["README"],
};

const TEXT = {
  "/etc/issue": "Linux 1.0.0 (vibetron) (tty1)",
  "/etc/motd": "Linux 1.0.0! Have fun, and don't break anything.\nYour DOS drive is mounted at /dos (read-only).\nType 'help' for the commands Mort managed to fit on the disk.",
  "/etc/passwd": "root:x:0:0:root:/root:/bin/bash\nmort:x:1000:100:Uncle Mort:/home/mort:/bin/bash\nbyte:x:1001:100:The Cat:/home/byte:/bin/meow",
  "/home/byte/nap.txt": "zzzzzzzzzzzzzzzzzzzzzzzzz\nzzzzzzzzz *purr* zzzzzzzzz",
  "/home/mort/.plan": "Plan: finish PANES. Make it huge. Then a Linux version. Maybe.",
  "/home/mort/README": "This is my Linux corner. The kernel came off a BBS on a stack of floppies.\nThe whole internet will run on this one day. You heard it here first.",
  "/home/mort/penguin.txt": "I drew a penguin for this thing. I think it should be the mascot.\nNobody listens to me.",
  "/home/mort/todo.txt": "- learn vi (how do I get OUT of it?)\n- port BRIXX to X11\n- convince Doris",
  "/proc/cpuinfo": "processor : 0\ncpu       : 486\nmodel     : DX2-66\nbogomips  : 33.28",
  "/proc/meminfo": "        total:    used:    free:\nMem:   3862528  2441216  1421312\nSwap:  8384512        0  8384512",
  "/proc/version": "Linux version 1.0.0 (mort@vibetron) #1 Sun Mar 13 23:41:07 1994",
  "/usr/src/linux-1.0/README": "Linux kernel release 1.0. Read the source, Luke.",
};

const HELP = "Commands: ls [-l] [dir], cd, pwd, cat file, uname -a, whoami, date, fortune,\n" +
  "ps, free, echo, clear, sl, vi, emacs, startx, exit (back to DOS)";

export class Linux {
  constructor(sys) {
    this.sys = sys;
    this.s = sys.screen;
    this.term = new Term(sys.screen);
    this.cwd = "/home/mort";
    this.user = "mort";
    this.history = [];
    this.fast = false;
    this.vi = null;
    this.train = null;
  }

  controls() { return { set: "text", chips: ["ls ", "cd ", "cat ", "uname -a", "fortune", "sl", "help", "exit"] }; }

  start() {
    this.s.setMode("text");
    this.s.clear();
    this.s.cursor.on = true;
    this.run();
  }

  wait(ms) { return this.fast ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)); }

  async run() {
    const t = this.term;
    t.paging = false;
    t.clear();
    for (const l of BOOT) { t.writeln(l); await this.wait(110); }
    t.writeln();
    TUX.forEach((l, i) => t.writeln(l, i === 8 ? 14 : i < 3 ? 15 : 7));
    t.writeln("        Mort drew this penguin. Says it will be the mascot one day.", 8);
    t.writeln();
    t.writeln("Welcome to Linux 1.0.0", 15);
    t.writeln();
    t.paging = true;
    this.fast = false;
    this.sys.secret("linux");
    t.write("vibetron login: ");
    const u = await t.readLine();
    this.user = (u || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 12) || "mort";
    t.write("Password: ");
    await t.readLine({ mask: true });
    t.writeln("Last login: Mon Apr 25 23:59:59 on tty1");
    t.writeln(TEXT["/etc/motd"]);
    for (;;) {
      t.writeln();
      t.write(`${this.user}@vibetron`, 10);
      t.write(":");
      t.write(this.cwd === "/home/mort" ? "~" : this.cwd.replace(/^\/home\/mort/, "~"), 9);
      t.write("$ ");
      const line = await t.readLine({ history: this.history });
      if (line === null) continue;
      const res = await this.exec(line.trim());
      if (res === "halt") return this.halt();
    }
  }

  async halt() {
    const t = this.term;
    t.writeln("INIT: Switching to runlevel: 0");
    await this.wait(400);
    t.writeln("INIT: Sending processes the TERM signal");
    await this.wait(400);
    t.writeln("Unmounting file systems... done.");
    await this.wait(300);
    t.writeln("System halted.", 15);
    await this.wait(900);
    this.sys.reboot();
  }

  // ---- virtual file system ----
  norm(path) {
    const parts = (path.startsWith("/") ? path : `${this.cwd}/${path}`).replace(/^~/, "/home/mort").split("/");
    const out = [];
    for (const p of parts) { if (!p || p === ".") continue; if (p === "..") out.pop(); else out.push(p); }
    return "/" + out.join("/");
  }

  dosNode(path) {
    const parts = path.split("/").filter(Boolean).slice(1).map((p) => p.toUpperCase());
    return this.sys.fs.walk("C", parts);
  }

  list(path) {
    if (path === "/dos" || path.startsWith("/dos/")) {
      const n = this.dosNode(path);
      if (!n || n.t !== "d") return null;
      return n.kids.filter((k) => !k.attr.includes("H")).map((k) => ({ name: k.name.toLowerCase(), dir: k.t === "d", size: k.size || (k.text || "").length }));
    }
    if (!FILES[path]) return null;
    return FILES[path].map((n) => ({ name: n, dir: !!FILES[`${path === "/" ? "" : path}/${n}`], size: (TEXT[`${path}/${n}`] || "x".repeat(4096)).length }));
  }

  read(path) {
    if (path.startsWith("/dos/")) {
      const n = this.dosNode(path);
      if (!n) return { err: "No such file or directory" };
      if (n.t === "d") return { err: "Is a directory" };
      return { text: fileText(n) };
    }
    if (FILES[path]) return { err: "Is a directory" };
    if (TEXT[path] !== undefined) return { text: TEXT[path] };
    const dir = path.slice(0, path.lastIndexOf("/")) || "/";
    if (FILES[dir] && FILES[dir].includes(path.slice(path.lastIndexOf("/") + 1))) return { text: "\u007fELF\u0001\u0001 (binary)" };
    return { err: "No such file or directory" };
  }

  // ---- commands ----
  async exec(line) {
    const t = this.term;
    if (!line) return;
    const [cmd, ...args] = line.split(/\s+/);
    const flags = args.filter((a) => a.startsWith("-")).join("");
    const paths = args.filter((a) => !a.startsWith("-"));
    const out = (s, fg) => t.out(s, { fg });
    switch (cmd) {
      case "ls": case "dir": case "ll": {
        if (cmd === "dir") await out("(you're in Linux now - but fine, here's ls)");
        const p = this.norm(paths[0] || ".");
        const items = this.list(p);
        if (!items) { const r = this.read(p); await out(r.text !== undefined ? paths[0] : `ls: ${paths[0]}: No such file or directory`); return; }
        const shown = items.filter((i) => flags.includes("a") || !i.name.startsWith("."));
        if (flags.includes("l") || cmd === "ll") {
          for (const i of shown) await out(`${i.dir ? "drwxr-xr-x" : "-rw-r--r--"}   1 mort     users    ${String(i.size).padStart(7)} Apr 12  1994 ${i.name}`, i.dir ? 9 : 7);
        } else {
          let row = "";
          for (const i of shown) {
            const cell = (i.name + (i.dir ? "/" : "")).padEnd(16);
            if ((row + cell).length > 78) { await out(row); row = ""; }
            row += cell;
          }
          if (row) await out(row);
        }
        return;
      }
      case "cd": {
        const p = this.norm(paths[0] || "~");
        if (this.list(p)) this.cwd = p;
        else await out(`bash: cd: ${paths[0]}: No such file or directory`);
        return;
      }
      case "pwd": await out(this.cwd); return;
      case "cat": case "less": case "more": case "head": case "tail": {
        if (!paths.length) { await out(`${cmd}: missing file operand`); return; }
        for (const p of paths) {
          const r = this.read(this.norm(p));
          await out(r.err ? `${cmd}: ${p}: ${r.err}` : r.text);
        }
        return;
      }
      case "uname": await out(flags.includes("a") ? "Linux vibetron 1.0.0 #1 Sun Mar 13 23:41:07 1994 i486" : "Linux"); return;
      case "whoami": await out(this.user); return;
      case "id": await out(`uid=1000(${this.user}) gid=100(users)`); return;
      case "hostname": await out("vibetron"); return;
      case "date": {
        const d = new Date();
        await out(`Tue Apr 26 ${[d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":")} 1994`);
        return;
      }
      case "fortune": await out(FORTUNES[Math.floor(Math.random() * FORTUNES.length)], 14); return;
      case "echo": await out(args.join(" ")); return;
      case "clear": t.clear(); return;
      case "help": await out(HELP); return;
      case "ps": await out("  PID TTY STAT  TIME COMMAND\n    1  ?  S    0:00 init\n   23  1  S    0:00 -bash\n   42  ?  S    0:00 /usr/sbin/catd --feed-byte\n   57  1  R    0:00 ps"); return;
      case "free": await out(TEXT["/proc/meminfo"]); return;
      case "man": await out(paths[0] ? `No manual entry for ${paths[0]}. (Mort: try 'help'.)` : "What manual page do you want?"); return;
      case "sudo": await out("bash: sudo: command not found. (Mort: it's my PC. You're a guest.)"); return;
      case "su": await out("su: Permission denied. (Byte has root.)"); return;
      case "emacs": await out("emacs: Not enough memory. Try vi."); return;
      case "startx": await out("X needs PANES-compatible video. Ha. - Mort"); return;
      case "rm":
        if (/r/.test(flags) && paths.includes("/")) await out("Nice try. - Mort", 12);
        else await out(`rm: cannot remove '${paths[0] || ""}': Read-only file system`);
        return;
      case "touch": case "mkdir": case "cp": case "mv": case "rmdir": case "chmod": case "chown": case "ln":
        await out(`${cmd}: Read-only file system`);
        return;
      case "sl": await this.runTrain(); return;
      case "vi": case "vim": case "nano": case "ed":
        if (cmd === "nano") await out("bash: nano: command not found (it's 1994). Opening vi instead...");
        await this.runVi(paths[0] || "untitled");
        return;
      case "exit": case "logout": case "reboot": case "halt": case "shutdown": case "poweroff":
        return "halt";
      default:
        await out(`bash: ${cmd}: command not found`);
    }
  }

  // ---- sl: an ASCII train crosses the screen ----
  runTrain() {
    return new Promise((resolve) => {
      this.snap = this.s.snapshot();
      this.s.cursor.on = false;
      this.train = { x: COLS, t: 0, resolve };
    });
  }

  // ---- vi: the classic trap ----
  runVi(name) {
    return new Promise((resolve) => {
      this.snap = this.s.snapshot();
      this.vi = { name, cmd: null, msg: `"${name}" [New File]`, resolve };
      this.drawVi();
    });
  }

  drawVi() {
    const s = this.s, v = this.vi;
    s.clear();
    s.put(0, 0, " ");
    for (let y = 1; y < 24; y++) s.put(0, y, "~", 9);
    s.text(0, 24, v.cmd !== null ? ":" + v.cmd : v.msg, v.msg.startsWith("E") && v.cmd === null ? 15 : 7, v.msg.startsWith("E") && v.cmd === null ? 4 : 0);
    s.cursor.on = true;
    s.cursor.x = v.cmd !== null ? v.cmd.length + 1 : 0;
    s.cursor.y = v.cmd !== null ? 24 : 0;
  }

  viKey(ev) {
    const v = this.vi, k = ev.key;
    if (v.cmd === null) {
      if (k === ":") v.cmd = "";
      else if (k.length === 1 || k === "Escape") v.msg = k === "Escape" ? v.msg : "-- (you are now trapped in vi. Type :q! and Enter to escape) --";
    } else if (k === "Enter") {
      const c = v.cmd.trim();
      v.cmd = null;
      if (c === "q!" || c === "qa!") {
        this.vi = null;
        this.s.restore(this.snap);
        this.term.syncCursor();
        v.resolve();
        return;
      }
      if (c === "q" || c === "quit") v.msg = "E37: No write since last change (add ! to override)";
      else if (c === "wq" || c === "x" || c === "w") v.msg = "E45: 'readonly' option is set (add ! to override)";
      else v.msg = `E492: Not an editor command: ${c}`;
    } else if (k === "Escape") v.cmd = null;
    else if (k === "Backspace") { if (v.cmd.length) v.cmd = v.cmd.slice(0, -1); else v.cmd = null; }
    else if (k.length === 1) v.cmd += k;
    this.drawVi();
  }

  update(dt) {
    const tr = this.train;
    if (!tr) return;
    tr.t += dt;
    if (tr.t < 0.035) return;
    tr.t = 0;
    tr.x--;
    const s = this.s;
    s.fill(0, 0, COLS, 25, " ", 7, 0);
    TRAIN.forEach((line, i) => {
      for (let j = 0; j < line.length; j++) {
        const x = tr.x + j;
        if (x < 0 || x >= COLS) continue;
        let ch = line[j];
        if (i === 0 && ch !== " " && ((j + (-tr.x >> 2)) & 1)) ch = ch === "@" ? "(" : "@";
        if (i === 8 && ch === "O" && (tr.x & 1)) ch = "o";
        s.put(x, 8 + i, ch, i === 0 ? 8 : i >= 7 ? 15 : 7);
      }
    });
    if (tr.x < -60) {
      this.train = null;
      this.s.restore(this.snap);
      this.term.syncCursor();
      tr.resolve();
    }
  }

  key(ev) {
    if (ev.type !== "down") return;
    if (this.train) return;
    if (this.vi) return this.viKey(ev);
    if (!this.term.editing && !this.term.waiter) this.fast = true;
    this.term.key(ev);
  }

  pointer(ev) {
    if (ev.type !== "click" || !this.term.editing || this.vi || this.train) return;
    const w = this.term.wordAt(Math.floor(ev.x / 8), Math.floor(ev.y / 16));
    if (w) {
      const buf = this.term.editBuffer;
      this.term.insertText((buf && !buf.endsWith(" ") ? " " : "") + w.toLowerCase());
    }
  }
}
