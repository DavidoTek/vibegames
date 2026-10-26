// COMMAND.COM: boot sequence (POST, CONFIG.SYS, AUTOEXEC.BAT), the prompt,
// all DOS commands, batch files and launching programs.

import { Term } from "./term.js";
import { COLS } from "./screen.js";
import { DosError, file, dir, has, setAttr, sizeOf, splitName, valid83, match, isWild, clone, TODAY } from "./fs.js";
import { check, HINTS, COMPONENTS } from "./progress.js";
import { BYTE_ART, BYTE_SLEEP_ART } from "./disk.js";
import { Editor } from "./edit.js";
import { Quest } from "./apps/quest.js";
import { Nibbler } from "./apps/nibbler.js";
import { Brixx } from "./apps/brixx.js";
import { Labyrint } from "./apps/labyrint.js";
import { Panes } from "./apps/panes.js";
import { Linux } from "./apps/linux.js";

class Abort extends Error {}

const fmt = (n) => String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function wrap(text, width = 76) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const w of para.split(" ")) {
      if (line && (line + " " + w).length > width) { out.push(line); line = w; }
      else line = line ? line + " " + w : w;
    }
    out.push(line);
  }
  return out.join("\n");
}

const GARBAGE = "MZ@!#$%&*♥•·°►◄▲▼↑↓→←░▒▓█▄▀▌▐■═║╔╗╚╝─│┌┐└┘├┤┬┴┼¿ÿ";
export function garbage(node, lines = 3) {
  let seed = 7;
  for (const c of node.name) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) / 16777216;
  const out = [];
  for (let l = 0; l < lines; l++) {
    let s = "";
    for (let i = 0; i < 60; i++) s += rnd() < 0.15 ? " " : GARBAGE[Math.floor(rnd() * GARBAGE.length)];
    out.push(s);
  }
  return out.join("\n");
}

// Text of a file as TYPE/PRINT/EDIT see it: binary files show a header plus junk.
export function fileText(node) {
  if (!node.bin) return node.text || "";
  return (node.text ? node.text + "\n" : "") + garbage(node);
}

const HELP = `
Commands on this machine:
  ATTRIB    show or change file attributes   MD        make a folder
  CD        change folder (CD .. goes up)    MEM       show memory
  CLS       clear the screen                 MOVE      move or rename files
  COPY      copy (and join) files            PANES     start PANES / check parts
  DATE      show the date                    PATH      show the program path
  DEL       delete files                     PRINT     print a text file
  DIR       list files (DIR /A shows hidden) RD        remove an empty folder
  ECHO      print a message                  REBOOT    restart the computer
  EDIT      edit a text file                 REN       rename files
  EXIT      leave the shell                  TREE      show the folder tree
  HELP      this list (HELP DIR for one)     TYPE      show a text file
  HINT      get a hint (HINT 1-7)            UNDELETE  recover deleted files
  A: / C:   switch drive                     VER       show the DOS version
Run a program by typing its name, e.g. QUEST in C:\\GAMES\\QUEST.
Tab completes names, Up/Down recall earlier commands.`;

const USAGE = {
  ATTRIB: "ATTRIB [+R|-R] [+H|-H] [+S|-S] [+A|-A] [file]\n  Without switches, lists files with their attributes (R=read-only, H=hidden).",
  CD: "CD [folder]   CD ..   CD \\\n  Changes the current folder. Without a name, shows it.",
  COPY: "COPY source [destination]\nCOPY /B file1+file2+... destination   joins files together\nCOPY CON file                        type a file, end with Ctrl+Z (or F6)",
  DEL: "DEL file   (wildcards allowed: DEL *.TMP)\n  Deleted files can often be recovered with UNDELETE.",
  DIR: "DIR [folder or pattern] [/W] [/A]\n  /W wide list   /A also show hidden files",
  EDIT: "EDIT [file]   full-screen text editor. Ctrl+S saves, Esc leaves.",
  MOVE: "MOVE source destination\n  Moves files to another folder, or renames a file or folder.",
  REN: "REN oldname newname   (wildcards allowed: REN *.TXT *.BAK)",
  TYPE: "TYPE file   shows a text file. Long files pause after each screen.",
  UNDELETE: "UNDELETE   lists files deleted in the current folder and lets you recover them.",
  UNZIP: "UNZIP file.ZIP   extracts an archive into the current folder.",
  PRINT: "PRINT file   prints a text file on the printer next to the PC.",
  HINT: "HINT [1-7]   gives a hint for the next (or the given) unsolved component.",
  PANES: "PANES   checks the 7 PANES components and starts PANES once all are there.",
  MD: "MD folder   creates a folder.",
  RD: "RD folder   removes an empty folder.",
  TREE: "TREE [folder]   shows the folder structure.",
  MEM: "MEM   shows how memory is used.",
  REBOOT: "REBOOT   restarts the computer (runs CONFIG.SYS and AUTOEXEC.BAT again).",
};

const WRONG_OS = new Set(["LS", "CLEAR", "UNAME", "PWD", "MAN", "SUDO", "VI", "VIM", "GREP", "RM", "CP", "MV", "TOP", "SSH", "APT", "WHOAMI", "STARTX"]);

export class Shell {
  constructor(sys) {
    this.sys = sys;
    this.fs = sys.fs;
    this.state = sys.state;
    this.term = new Term(sys.screen);
    this.history = [];
    this.capture = null;
    this.skip = false;
    this.booting = false;
    this.echoOn = true;
    this.idle = 0;
    this.catDone = false;
    this.catQueue = null;
    this.catT = 0;
    this.catPending = false;
    this.sleeper = null;
  }

  controls() { return { set: "shell" }; }

  get music() { return this.booting ? null : "dos"; }

  start() { this.main(); }

  key(ev) {
    if (ev.type === "down") {
      this.idle = 0;
      if (this.booting) {
        this.skip = true;
        if (this.sleeper) this.sleeper();
        return;
      }
    }
    this.term.key(ev);
  }

  pointer(ev) {
    if (ev.type !== "click" || !this.term.editing) return;
    const cx = Math.floor(ev.x / 8), cy = Math.floor(ev.y / 16);
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= 25) return;
    const word = this.term.wordAt(cx, cy);
    if (!word) return;
    const buf = this.term.editBuffer;
    this.term.insertText((buf && !/[\s\\]$/.test(buf) ? " " : "") + word);
  }

  update(dt) {
    // Easter egg: leave the prompt alone long enough and Byte walks over the keyboard.
    if (this.catQueue) {
      this.catT -= dt;
      while (this.catT <= 0 && this.catQueue.length) {
        const k = this.catQueue.shift();
        this.term.key({ type: "down", key: k });
        this.sys.audio.key();
        this.catT += 0.03 + Math.random() * 0.11;
      }
      if (!this.catQueue.length) this.catQueue = null;
      return;
    }
    if (!this.catDone && !this.booting && this.term.editing && this.term.editBuffer === "") {
      this.idle += dt;
      if (this.idle > 90) {
        this.catDone = true;
        this.catPending = true;
        this.catQueue = [..."fffffffffffgggggggj;;;;;;;;;;;;;;;;;;;''''''", "Enter"];
        this.catT = 0.4;
      }
    } else this.idle = 0;
  }

  // ---------------------------------------------------------------- helpers

  sleep(ms) {
    if (this.skip) return Promise.resolve();
    return new Promise((resolve) => {
      const id = setTimeout(done, ms);
      function done() { clearTimeout(id); resolve(); }
      this.sleeper = () => { this.sleeper = null; done(); };
    });
  }

  async out(text = "", opts = {}) {
    if (this.capture) { this.capture.push(...String(text).split("\n")); return; }
    await this.term.out(text, opts);
  }

  prompt() { return `${this.fs.cwdPath()}>`; }

  // Make sure a drive is readable; drive A: needs the floppy.
  async need(drive) {
    if (drive !== "A") { this.sys.diskAccess("C"); return; }
    for (;;) {
      this.sys.diskAccess("A");
      if (this.sys.floppyIn()) return;
      await this.sleep(500);
      this.term.writeln();
      this.term.writeln("Not ready reading drive A");
      this.term.write("Abort, Retry, Fail?");
      const k = await this.term.readKey();
      const c = (k.key || "").toUpperCase();
      this.term.writeln(c.length === 1 ? c : "");
      if (c === "R") continue;
      if (c === "F" && this.fs.drive === "A") { this.fs.drive = "C"; }
      throw new Abort();
    }
  }

  async needPath(path) {
    const r = this.fs.resolve(path);
    await this.need(r.drive);
    return r;
  }

  // Create or replace a file; enforces read-only and 8.3 names.
  writeFile(path, props) {
    const loc = this.fs.locate(path);
    if (!loc.dir) throw new DosError("Path not found");
    if (!valid83(loc.name)) throw new DosError("Invalid filename");
    const old = this.fs.child(loc.dir, loc.name);
    if (old && (old.t === "d" || has(old, "R"))) throw new DosError("Access denied");
    const f = file(loc.name, props);
    this.fs.touch(f);
    this.fs.add(loc.dir, f);
    this.sys.diskAccess(loc.drive, true);
    return f;
  }

  fullName(drive, parts, name) { return this.fs.pathOf(drive, [...parts, name]); }

  fixCwd() {
    for (const d of ["C", "A"]) {
      const n = this.fs.walk(d, this.fs.cwd[d] || []);
      if (!n || n.t !== "d") this.fs.cwd[d] = [];
    }
  }

  // ---------------------------------------------------------------- boot

  async main() {
    await this.boot();
    for (;;) {
      this.term.write(this.prompt());
      const line = await this.term.readLine({ history: this.history, complete: (b) => this.complete(b) });
      if (line === null) continue;
      if (!line.trim()) continue;
      await this.execLine(line);
      if (this.term.x !== 0) this.term.writeln();
      this.term.writeln();
    }
  }

  async boot() {
    this.booting = true;
    this.skip = false;
    const s = this.sys.screen;
    const t = this.term;
    s.setMode("text");
    t.paging = false;
    t.clear();
    s.cursor.on = false;
    this.fs.drive = "C";
    this.fs.cwd = { C: [], A: [] };
    const quick = this.state.bootCount > 0;
    this.state.bootCount = (this.state.bootCount || 0) + 1;

    s.text(56, 1, "╔══════════════════╗", 9);
    s.text(56, 2, "║ ▄▀▀ VIBETRON ▀▀▄ ║", 11);
    s.text(56, 3, "║  Energy Saver ✓  ║", 10);
    s.text(56, 4, "╚══════════════════╝", 9);
    t.writeln("VIBETRON BIOS v2.1  (C) 1994 Vibetron Computer Corp.", 15);
    t.writeln("BIOS Date 04/12/94", 14);
    t.writeln();
    t.writeln("Main Processor  : 486DX2-66");
    t.write("Memory Test     : ");
    const mx = t.x, my = t.y;
    for (let k = 0; k <= 640; k += quick ? 160 : 32) {
      s.text(mx, my, `${k}K`);
      await this.sleep(18);
    }
    s.text(mx, my, "640K OK");
    t.newline();
    t.write("Extended Memory : ");
    const ex = t.x, ey = t.y;
    for (let k = 0; k <= 4096; k += quick ? 1024 : 128) {
      s.text(ex, ey, `${k}K`);
      await this.sleep(14);
    }
    s.text(ex, ey, "4096K OK");
    t.newline();
    t.writeln();
    await this.sleep(150);
    t.writeln("Detecting IDE Primary Master   ... VIBEDISK 120MB");
    await this.sleep(quick ? 80 : 300);
    t.writeln("Detecting IDE Primary Slave    ... None");
    t.writeln(`Floppy Drive A:                ... 1.44MB 3.5"`);
    t.writeln();
    this.sys.audio.beep();
    t.writeln("Press any key to skip the boot messages.", 8);
    await this.sleep(quick ? 400 : 1200);

    t.clear();
    s.cursor.on = true;
    t.writeln("Starting VIBE-DOS...");
    t.writeln();
    this.sys.diskAccess("C");
    await this.sleep(500);

    const { boot, msgs } = this.runConfig();
    for (const [m, color] of msgs) {
      t.writeln(m, color);
      await this.sleep(120);
    }
    if (msgs.length) t.writeln();
    this.state.boot = boot;
    this.state.path = "C:\\DOS;C:\\UTILS";
    this.skip = false;
    this.booting = false;
    t.paging = true;

    const auto = this.fs.get("C:\\AUTOEXEC.BAT");
    if (auto && auto.t === "f" && !auto.bin) await this.runBatch(auto);
    this.sys.save();
    this.sys.refresh();
  }

  runConfig() {
    const boot = { himem: false, dosHigh: false, files: 8, buffers: 15 };
    const msgs = [];
    const f = this.fs.get("C:\\CONFIG.SYS");
    if (!f || f.t !== "f" || f.bin) {
      msgs.push(["Bad or missing CONFIG.SYS - using default settings.", 7]);
      return { boot, msgs };
    }
    let wantHigh = false;
    f.text.split("\n").forEach((raw, i) => {
      const line = raw.trim();
      if (!line || /^REM(\s|$)/i.test(line) || line.startsWith(";")) return;
      const m = /^(\w+)\s*=\s*(.*)$/.exec(line);
      const key = m ? m[1].toUpperCase() : "";
      const val = m ? m[2].trim() : "";
      switch (key) {
        case "DEVICE":
        case "DEVICEHIGH": {
          const path = val.split(/\s+/)[0] || "";
          let node = null;
          try { node = path ? this.fs.get(path.includes(":") || path.startsWith("\\") ? path : "C:\\" + path) : null; } catch { node = null; }
          const shown = path.toUpperCase();
          if (!node || node.t !== "f") {
            msgs.push([`Bad or missing ${shown}`, 15]);
            msgs.push([`Error in CONFIG.SYS line ${i + 1}`, 15]);
          } else if (node.name === "HIMEM.SYS") {
            if (node.sig === "HIMEM") {
              boot.himem = true;
              msgs.push(["HIMEM: VIBE-DOS XMS Driver, Version 3.10 - 04/12/94", 7]);
              msgs.push(["XMS Specification Version 3.0", 7]);
              msgs.push(["Installed A20 handler number 1.", 7]);
              msgs.push(["64K High Memory Area is available.", 7]);
              msgs.push(["HIMEM is testing extended memory...done.", 10]);
            } else msgs.push([`${shown}: not a valid device driver`, 15]);
          } else if (node.name === "EMM386.EXE") {
            msgs.push(["EMM386: not needed on this machine, skipped.", 7]);
          } else msgs.push([`${shown}: not a device driver, ignored`, 7]);
          break;
        }
        case "DOS":
          wantHigh = val.toUpperCase().split(",").map((x) => x.trim()).includes("HIGH");
          break;
        case "FILES":
        case "BUFFERS": {
          const n = parseInt(val, 10);
          if (!/^\d+$/.test(val) || isNaN(n)) {
            msgs.push([`Bad command or parameters - ${line}`, 15]);
            msgs.push([`Error in CONFIG.SYS line ${i + 1}`, 15]);
          } else boot[key.toLowerCase()] = Math.max(8, Math.min(255, n));
          break;
        }
        case "SHELL": case "LASTDRIVE": case "STACKS": case "BREAK": case "COUNTRY": case "FCBS":
          break;
        default:
          msgs.push(["Unrecognized command in CONFIG.SYS", 15]);
          msgs.push([`Error in CONFIG.SYS line ${i + 1}`, 15]);
      }
    });
    if (wantHigh) {
      if (boot.himem) boot.dosHigh = true;
      else msgs.push(["HMA not available : Loading DOS low", 15]);
    }
    return { boot, msgs };
  }

  async runBatch(node) {
    const lines = (node.text || "").split("\n");
    let echo = this.echoOn;
    for (const raw of lines) {
      let line = raw.trim();
      if (!line) continue;
      const quiet = line.startsWith("@");
      if (quiet) line = line.slice(1).trim();
      if (/^ECHO\s+OFF$/i.test(line)) { echo = false; continue; }
      if (/^ECHO\s+ON$/i.test(line)) { echo = true; continue; }
      if (/^REM(\s|$)/i.test(line) || line.startsWith("::")) continue;
      if (echo && !quiet) this.term.writeln(this.prompt() + line);
      if (/^PAUSE$/i.test(line)) {
        this.term.write("Press any key to continue . . .");
        await this.term.readKey();
        this.term.writeln();
        continue;
      }
      if (/^(PROMPT|PATH)(\s|=)/i.test(line)) continue;
      await this.execLine(line, true);
    }
  }

  // ---------------------------------------------------------------- dispatch

  async execLine(raw, batch = false) {
    let line = raw.trim();
    if (!line) return;
    if (!batch) this.state.stats.commands++;
    let redirect = null;
    if (line.includes("|")) {
      const [a, ...rest] = line.split("|");
      line = a.trim();
      if (rest.some((r) => !/^\s*MORE\s*$/i.test(r))) {
        await this.out("Only | MORE works on this machine (TYPE already pauses for you).");
        return;
      }
    }
    let m = /^MORE\s*<\s*(\S+)\s*$/i.exec(line);
    if (m) line = `TYPE ${m[1]}`;
    m = /^(.*?[^\s>])\s*(>>?)\s*(\S+)\s*$/.exec(line);
    if (m && !/^COPY\s+CON/i.test(line)) { line = m[1]; redirect = { append: m[2] === ">>", path: m[3] }; }
    if (redirect) this.capture = [];
    try {
      await this.exec(line);
    } catch (err) {
      if (err instanceof Abort) { /* already reported */ }
      else if (err instanceof DosError) { this.capture = redirect ? null : this.capture; await this.out(err.message); }
      else { console.error(err); await this.out("General failure reading drive C"); }
    }
    if (redirect && this.capture) {
      const text = this.capture.join("\n");
      this.capture = null;
      try {
        await this.need(this.fs.resolve(redirect.path).drive);
        const old = this.fs.get(redirect.path);
        const prev = redirect.append && old && old.t === "f" && !old.bin ? (old.text || "") : "";
        this.writeFile(redirect.path, { text: prev + (prev && !prev.endsWith("\n") ? "\n" : "") + text + "\n" });
      } catch (err) {
        if (err instanceof DosError) await this.out(err.message);
        else if (!(err instanceof Abort)) throw err;
      }
    }
    this.capture = null;
    if (this.catPending) {
      this.catPending = false;
      await this.out("(Byte walked across the keyboard. Byte is now asleep on the monitor.)");
      this.sys.catWalk();
      this.sys.secret("cat");
    }
    this.fixCwd();
    this.sys.save();
    this.sys.refresh();
  }

  async exec(line) {
    const dm = /^([A-Za-z]):\s*$/.exec(line);
    if (dm) return this.changeDrive(dm[1].toUpperCase());
    const mm = /^([A-Za-z0-9_~!#$%&@^-]+)(.*)$/.exec(line);
    if (mm) {
      const name = mm[1].toUpperCase();
      const rest = mm[2];
      if (this.internal(name) && (rest === "" || /^[\s.\\/]/.test(rest))) return this.internal(name).call(this, this.args(rest), rest);
      if (WRONG_OS.has(name) || (name === "CAT" && rest.trim())) {
        await this.out("Bad command or file name. (Wrong OS, buddy. See C:\\LINUX)");
        return;
      }
    }
    const sp = line.search(/\s/);
    const cmd = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? "" : line.slice(sp);
    return this.runFile(cmd, this.args(rest));
  }

  args(rest) {
    const out = [];
    for (const tok of rest.trim().split(/\s+/).filter(Boolean)) {
      if (tok.startsWith("/")) out.push(...tok.split("/").filter(Boolean).map((s) => "/" + s.toUpperCase()));
      else {
        const i = tok.indexOf("/");
        if (i > 0) { out.push(tok.slice(0, i)); out.push(...tok.slice(i).split("/").filter(Boolean).map((s) => "/" + s.toUpperCase())); }
        else out.push(tok);
      }
    }
    return out;
  }

  internal(name) {
    const map = {
      DIR: this.cmdDir, CD: this.cmdCd, CHDIR: this.cmdCd, TYPE: this.cmdType, MORE: this.cmdType,
      COPY: this.cmdCopy, MOVE: this.cmdMove, REN: this.cmdRen, RENAME: this.cmdRen,
      DEL: this.cmdDel, ERASE: this.cmdDel, MD: this.cmdMd, MKDIR: this.cmdMd, RD: this.cmdRd, RMDIR: this.cmdRd,
      ATTRIB: this.cmdAttrib, UNDELETE: this.cmdUndelete, UNZIP: this.cmdUnzip, PKUNZIP: this.cmdUnzip,
      TREE: this.cmdTree, MEM: this.cmdMem, VER: this.cmdVer, VOL: this.cmdVol, DATE: this.cmdDate, TIME: this.cmdTime,
      CLS: this.cmdCls, ECHO: this.cmdEcho, PATH: this.cmdPath, PROMPT: () => {}, HELP: this.cmdHelp, HINT: this.cmdHint,
      PANES: this.cmdPanes, REBOOT: this.cmdReboot, PRINT: this.cmdPrint, EDIT: this.cmdEdit, EXIT: this.cmdExit,
      FORMAT: this.cmdFormat, WIN: this.cmdWin, CAT: this.cmdCat, XYZZY: this.cmdXyzzy, SCANDISK: this.cmdScandisk,
      CHKDSK: this.cmdScandisk,
    };
    return map[name];
  }

  async changeDrive(d) {
    if (!this.fs.drives[d]) throw new DosError("Invalid drive specification");
    await this.need(d);
    this.fs.drive = d;
  }

  // Search the current folder, then PATH, for NAME(.COM|.EXE|.BAT).
  findProgram(cmd) {
    const upper = cmd.toUpperCase();
    const [, ext] = splitName(upper.split("\\").pop());
    const names = ext ? [upper] : [".COM", ".EXE", ".BAT"].map((e) => upper + e);
    const dirs = /[\\:]/.test(cmd) ? [""] : ["", ...(this.state.path || "").split(";").filter(Boolean).map((p) => p + "\\")];
    for (const d of dirs) {
      for (const n of names) {
        let node = null;
        try { node = this.fs.get(d + n); } catch { node = null; }
        if (node && node.t === "f") return { node, path: d + n };
      }
    }
    return null;
  }

  async runFile(cmd, args) {
    if (/^[A-Za-z]:/.test(cmd)) await this.need(cmd[0].toUpperCase());
    const found = this.findProgram(cmd);
    if (!found) {
      await this.out("Bad command or file name");
      return;
    }
    const { node } = found;
    if (node.name.endsWith(".BAT")) {
      if (node.bin) throw new DosError("Bad command or file name");
      return this.runBatch(node);
    }
    if (!node.exe) {
      if (/\.(COM|EXE)$/.test(node.name)) {
        await this.out("Invalid program file. (Mort: that's not a real program, that's a text file in a trench coat.)");
        return;
      }
      await this.out("Bad command or file name");
      return;
    }
    const id = node.exe;
    switch (id) {
      case "edit": return this.cmdEdit(args);
      case "mem": return this.cmdMem(args);
      case "attrib": return this.cmdAttrib(args);
      case "undelete": return this.cmdUndelete(args);
      case "more": return this.cmdType(args);
      case "tree": return this.cmdTree(args);
      case "unzip": return this.cmdUnzip(args);
      case "format": return this.cmdFormat(args);
      case "scandisk": return this.cmdScandisk(args);
      case "panes": return this.cmdPanes(args);
      case "quest": return this.runApp(new Quest(this.sys));
      case "nibbler": return this.runApp(new Nibbler(this.sys));
      case "brixx": return this.runApp(new Brixx(this.sys));
      case "labyrint": return this.runLabyrint();
      case "loadlin": return this.loadlin(args, found.path);
      default: await this.out("This program requires a newer version of VIBE-DOS.");
    }
  }

  async runApp(prog) {
    const s = this.sys.screen;
    const snap = s.snapshot();
    const result = await this.sys.run(prog);
    s.restore(snap);
    this.term.syncCursor();
    if (result && result.lines) for (const l of result.lines) await this.out(l);
  }

  async runLabyrint() {
    const b = this.state.boot || {};
    if (!b.himem) {
      await this.out("LABYRINT requires 2048K of extended memory. 0K available.\n(Is HIMEM.SYS loaded? Check CONFIG.SYS)");
      return;
    }
    if (!(b.files >= 30)) {
      await this.out(`Not enough file handles (FILES=${b.files}). Set FILES=30 in CONFIG.SYS.`);
      return;
    }
    if (!b.dosHigh) {
      await this.out("Not enough conventional memory. Try DOS=HIGH in CONFIG.SYS.");
      return;
    }
    return this.runApp(new Labyrint(this.sys));
  }

  async loadlin(args, path) {
    const kernel = args.find((a) => !a.startsWith("/")) || "VMLINUZ";
    const base = path.includes("\\") ? path.slice(0, path.lastIndexOf("\\") + 1) : "";
    let k = this.fs.get(kernel);
    if (!k && !/[\\:]/.test(kernel)) k = this.fs.get(base + kernel);
    if (!k || k.t !== "f" || !/Linux kernel/.test(k.text || "")) {
      await this.out(`LOADLIN: can't open kernel image ${kernel.toUpperCase()}`);
      return;
    }
    await this.out("LOADLIN v1.4");
    await this.out(`Loading ${kernel.toUpperCase()}... ok, booting the kernel.`);
    await this.sleep(700);
    await this.runApp(new Linux(this.sys));
  }

  // ---------------------------------------------------------------- completion

  complete(buf) {
    const m = /^(.*?)(\S*)$/.exec(buf);
    const head = m[1], word = m[2].toUpperCase();
    const out = [];
    if (!head.trim()) {
      const cmds = ["ATTRIB", "CD", "CLS", "COPY", "DATE", "DEL", "DIR", "ECHO", "EDIT", "EXIT", "HELP", "HINT", "MD", "MEM", "MOVE",
        "PANES", "PATH", "PRINT", "RD", "REBOOT", "REN", "TIME", "TREE", "TYPE", "UNDELETE", "UNZIP", "VER", "VOL"];
      for (const c of cmds) if (c.startsWith(word)) out.push(c);
      try {
        const here = this.fs.walk(this.fs.drive, this.fs.cwd[this.fs.drive]);
        if (here && (this.fs.drive === "C" || this.sys.floppyIn())) {
          for (const k of here.kids) if (k.t === "f" && /\.(EXE|COM|BAT)$/.test(k.name) && k.name.startsWith(word) && !has(k, "H")) out.push(splitName(k.name)[0]);
        }
      } catch { /* ignore */ }
    }
    const cut = Math.max(word.lastIndexOf("\\"), word.lastIndexOf(":"));
    const dirPart = word.slice(0, cut + 1), namePart = word.slice(cut + 1);
    try {
      const r = this.fs.resolve(dirPart || ".");
      if (r.drive === "C" || this.sys.floppyIn()) {
        const d = this.fs.walk(r.drive, r.parts);
        if (d && d.t === "d") {
          for (const k of d.kids) {
            if (has(k, "H") || !k.name.startsWith(namePart)) continue;
            out.push(dirPart + k.name + (k.t === "d" ? "\\" : ""));
          }
        }
      }
    } catch { /* ignore */ }
    return [...new Set(out)].map((c) => head + c);
  }

  // ---------------------------------------------------------------- commands

  async cmdDir(args) {
    const sw = args.filter((a) => a.startsWith("/"));
    const spec = args.find((a) => !a.startsWith("/")) || ".";
    const wide = sw.includes("/W");
    const hidden = sw.some((s) => s.startsWith("/A"));
    const r = await this.needPath(spec);
    const node = isWild(spec) ? null : this.fs.walk(r.drive, r.parts);
    let dirNode, parts, pattern;
    if (node && node.t === "d") { dirNode = node; parts = r.parts; pattern = "*.*"; }
    else { parts = r.parts.slice(0, -1); dirNode = this.fs.walk(r.drive, parts); pattern = r.parts[r.parts.length - 1] || "*.*"; }
    if (!dirNode || dirNode.t !== "d") throw new DosError("Path not found");
    const drv = this.fs.drives[r.drive];
    await this.out(` Volume in drive ${r.drive} is ${drv.label}`);
    await this.out(` Volume Serial Number is ${drv.serial}`);
    await this.out(` Directory of ${this.fs.pathOf(r.drive, parts)}`);
    await this.out("");
    const items = dirNode.kids.filter((k) => (hidden || !has(k, "H")) && match(k.name, pattern));
    const entries = [];
    if (parts.length && pattern === "*.*") {
      entries.push({ name: ".", t: "d", date: dirNode.date, time: dirNode.time });
      entries.push({ name: "..", t: "d", date: dirNode.date, time: dirNode.time });
    }
    entries.push(...items);
    if (!items.length && !entries.length) throw new DosError("File not found");
    let files = 0, bytes = 0;
    if (wide) {
      let line = "";
      let n = 0;
      for (const e of entries) {
        const label = e.t === "d" ? `[${e.name}]` : e.name;
        line += label.padEnd(16);
        if (++n % 5 === 0) { await this.out(line.trimEnd()); line = ""; }
        if (e.t === "f") { files++; bytes += sizeOf(e); }
      }
      if (line) await this.out(line.trimEnd());
    } else {
      for (const e of entries) {
        const [b, x] = e.name === "." || e.name === ".." ? [e.name, ""] : splitName(e.name);
        const mid = e.t === "d" ? "<DIR>".padEnd(13) : fmt(sizeOf(e)).padStart(13);
        if (e.t === "f") { files++; bytes += sizeOf(e); }
        await this.out(`${b.padEnd(8)} ${x.padEnd(3)} ${mid} ${e.date}  ${(e.time || "").padStart(6)}`, { tag: e.name.startsWith(".") ? null : e.name });
      }
    }
    await this.out(`${String(files).padStart(9)} file(s) ${fmt(bytes).padStart(14)} bytes`);
    await this.out(`${" ".repeat(18)}${fmt(this.fs.free(r.drive)).padStart(14)} bytes free`);
  }

  async cmdCd(args) {
    const p = args.find((a) => !a.startsWith("/"));
    if (!p) { await this.out(this.fs.cwdPath()); return; }
    const r = await this.needPath(p);
    const node = this.fs.walk(r.drive, r.parts);
    if (!node || node.t !== "d") throw new DosError("Invalid directory");
    this.fs.cwd[r.drive] = r.parts;
  }

  async cmdType(args) {
    const spec = args.find((a) => !a.startsWith("/"));
    if (!spec) throw new DosError("Required parameter missing");
    const r = await this.needPath(spec);
    if (isWild(spec)) throw new DosError("Invalid filename or file not found");
    const node = this.fs.walk(r.drive, r.parts);
    if (!node) throw new DosError(`File not found - ${spec.toUpperCase()}`);
    if (node.t === "d") throw new DosError("Access denied");
    await this.out(fileText(node));
    if (node.bin) { this.sys.audio.beep(); this.sys.audio.tone(700, 0.12, { at: 0.2, vol: 0.04 }); }
  }

  async cmdCopy(args) {
    const binary = args.includes("/B");
    const pos = args.filter((a) => !a.startsWith("/")).join(" ").replace(/\s*\+\s*/g, "+").split(/\s+/).filter(Boolean);
    if (!pos.length) throw new DosError("Required parameter missing");
    const [src, dst] = pos;
    if (src.toUpperCase() === "CON") return this.copyCon(dst);
    if (src.includes("+")) return this.copyJoin(src.split("+").filter(Boolean), dst, binary);
    const r = await this.needPath(src);
    const ex = this.fs.expand(src);
    if (!ex.dir || !ex.items.length) throw new DosError(`File not found - ${src.toUpperCase()}`);
    const target = dst || ".";
    const tr = await this.needPath(target);
    const tnode = isWild(target) ? null : this.fs.walk(tr.drive, tr.parts);
    let count = 0;
    for (const item of ex.items) {
      let destDir, name;
      if (tnode && tnode.t === "d") { destDir = tnode; name = item.name; }
      else {
        const loc = this.fs.locate(target);
        destDir = loc.dir;
        name = isWild(loc.name) ? this.renamePattern(item.name, loc.name) : loc.name;
        if (ex.items.length > 1 && !isWild(loc.name)) throw new DosError("Cannot copy several files into one file. Copy them into a folder.");
      }
      if (!destDir) throw new DosError("Path not found");
      if (!valid83(name)) throw new DosError("Invalid filename");
      const old = this.fs.child(destDir, name);
      if (old === item) throw new DosError("File cannot be copied onto itself");
      if (old && (old.t === "d" || has(old, "R"))) throw new DosError("Access denied");
      const copy = clone(item);
      copy.name = name;
      copy.attr = "A";
      this.fs.add(destDir, copy);
      if (ex.items.length > 1) await this.out(this.fullName(r.drive, ex.parts, item.name));
      count++;
    }
    this.sys.diskAccess(tr.drive, true);
    await this.out(`${String(count).padStart(9)} file(s) copied`);
  }

  async copyJoin(parts, dst, binary) {
    const nodes = [];
    for (const p of parts) {
      const r = await this.needPath(p);
      const n = this.fs.walk(r.drive, r.parts);
      if (!n || n.t !== "f") throw new DosError(`File not found - ${p.toUpperCase()}`);
      nodes.push(n);
      await this.out(this.fs.pathOf(r.drive, r.parts));
    }
    const target = dst || nodes[0].name;
    const tr = await this.needPath(target);
    const tnode = this.fs.walk(tr.drive, tr.parts);
    const path = tnode && tnode.t === "d" ? this.fs.pathOf(tr.drive, [...tr.parts, nodes[0].name]) : target;
    let props;
    if (nodes.every((n) => !n.bin)) {
      props = { text: nodes.map((n) => (n.text || "").replace(/\n$/, "")).join("\n") + "\n" };
    } else {
      const sigs = nodes.map((n) => n.sig || "?").join(",");
      const ok = sigs === "VIDEO.P1,VIDEO.P2,VIDEO.P3,VIDEO.P4";
      props = {
        bin: true,
        size: nodes.reduce((a, n) => a + sizeOf(n), 0),
        sig: ok ? "VIDEO.DRV" : "CORRUPT",
        text: ok ? "VIDEO.DRV - display driver for PANES 1.0" : "(scrambled data)",
      };
    }
    this.writeFile(path, props);
    await this.out(`${String(1).padStart(9)} file(s) copied`);
    if (props.bin && !binary) await this.out("(Mort: next time use COPY /B for binary files. I'll let it slide.)");
  }

  async copyCon(dst) {
    if (!dst) throw new DosError("Required parameter missing");
    await this.needPath(dst);
    const lines = [];
    for (;;) {
      const l = await this.term.readLine();
      if (l === null) return;
      const z = l.indexOf("^Z");
      if (z >= 0) { if (z > 0) lines.push(l.slice(0, z)); break; }
      lines.push(l);
    }
    this.writeFile(dst, { text: lines.join("\n") + "\n" });
    await this.out(`${String(1).padStart(9)} file(s) copied`);
  }

  renamePattern(name, pat) {
    const [nb, ne] = splitName(name);
    const [pb, pe] = pat.includes(".") ? splitName(pat.toUpperCase()) : [pat.toUpperCase(), "*"];
    const part = (orig, p) => {
      let out = "";
      for (let i = 0; i < p.length; i++) {
        if (p[i] === "*") return out + orig.slice(i);
        out += p[i] === "?" ? (orig[i] || "") : p[i];
      }
      return out;
    };
    const b = part(nb, pb), e = part(ne, pe);
    return e ? `${b}.${e}` : b;
  }

  async cmdMove(args) {
    const pos = args.filter((a) => !a.startsWith("/"));
    if (pos.length < 2) throw new DosError("Required parameter missing");
    const [src, dst] = pos;
    const sr = await this.needPath(src);
    const tr = await this.needPath(dst);
    let items, srcDir, srcParts;
    if (isWild(src)) {
      const ex = this.fs.expand(src);
      items = ex.items; srcDir = ex.dir; srcParts = ex.parts;
    } else {
      const n = this.fs.walk(sr.drive, sr.parts);
      items = n ? [n] : [];
      srcParts = sr.parts.slice(0, -1);
      srcDir = this.fs.walk(sr.drive, srcParts);
    }
    if (!srcDir || !items.length) throw new DosError(`File not found - ${src.toUpperCase()}`);
    const tnode = isWild(dst) ? null : this.fs.walk(tr.drive, tr.parts);
    for (const item of items) {
      let destDir, name, destParts;
      if (tnode && tnode.t === "d") { destDir = tnode; name = item.name; destParts = tr.parts; }
      else {
        if (items.length > 1) throw new DosError("Cannot move several files into one file.");
        destParts = tr.parts.slice(0, -1);
        destDir = this.fs.walk(tr.drive, destParts);
        name = tr.parts[tr.parts.length - 1];
        if (!destDir || destDir.t !== "d") throw new DosError("Path not found");
        if (!name || !valid83(name)) throw new DosError("Invalid filename");
      }
      const from = this.fullName(sr.drive, srcParts, item.name);
      const to = this.fullName(tr.drive, destParts, name);
      if (has(item, "R")) { await this.out(`${from} => ${to} [Access denied]`); continue; }
      if (item.t === "d") {
        const a = [sr.drive, ...srcParts, item.name].join("\\"), b = [tr.drive, ...destParts, name].join("\\");
        if (b === a || b.startsWith(a + "\\")) { await this.out(`${from} => ${to} [Cannot move a folder into itself]`); continue; }
      }
      const old = this.fs.child(destDir, name);
      if (old === item) { await this.out(`${from} => ${to} [ok]`); continue; }
      if (old && (old.t === "d" || has(old, "R") || item.t === "d")) { await this.out(`${from} => ${to} [Access denied]`); continue; }
      this.fs.remove(srcDir, item);
      item.name = name;
      this.fs.add(destDir, item);
      await this.out(`${from} => ${to} [ok]`);
    }
    this.sys.diskAccess(tr.drive, true);
  }

  async cmdRen(args) {
    const pos = args.filter((a) => !a.startsWith("/"));
    if (pos.length < 2) throw new DosError("Required parameter missing");
    const [src, pat] = pos;
    if (/[\\:]/.test(pat)) throw new DosError("Invalid parameter (the new name can't contain a path)");
    await this.needPath(src);
    let items, d;
    if (isWild(src)) { const ex = this.fs.expand(src, { dirs: true }); items = ex.items; d = ex.dir; }
    else { const loc = this.fs.locate(src); d = loc.dir; const n = d && this.fs.child(d, loc.name); items = n ? [n] : []; }
    if (!d || !items.length) throw new DosError("Duplicate file name or file not found");
    for (const item of items) {
      const name = this.renamePattern(item.name, pat);
      if (!valid83(name)) throw new DosError("Invalid filename");
      if (has(item, "R")) throw new DosError("Access denied");
      if (this.fs.child(d, name) && name !== item.name) throw new DosError("Duplicate file name or file not found");
      item.name = name;
    }
    this.fs.sort(d);
  }

  async cmdDel(args) {
    const spec = args.find((a) => !a.startsWith("/"));
    if (!spec) throw new DosError("Required parameter missing");
    const r = await this.needPath(spec);
    const ex = this.fs.expand(spec);
    if (!ex.dir) throw new DosError("Path not found");
    if (!ex.items.length) throw new DosError("File not found");
    if (ex.pattern === "*.*" || ex.pattern === "*") {
      this.term.writeln("All files in directory will be deleted!");
      this.term.write("Are you sure (Y/N)?");
      const k = await this.term.readKey();
      this.term.writeln(k.key.length === 1 ? k.key.toUpperCase() : "");
      if (k.key.toUpperCase() !== "Y") return;
    }
    for (const item of ex.items) {
      if (has(item, "R")) { await this.out(`Access denied - ${item.name}`); continue; }
      this.fs.remove(ex.dir, item);
      ex.dir.del = ex.dir.del || [];
      ex.dir.del.push(item);
      if (ex.dir.del.length > 30) ex.dir.del.shift();
    }
    this.sys.diskAccess(r.drive, true);
  }

  async cmdUndelete(args) {
    const spec = args.find((a) => !a.startsWith("/")) || ".";
    const r = await this.needPath(spec);
    const d = this.fs.walk(r.drive, r.parts);
    if (!d || d.t !== "d") throw new DosError("Invalid directory");
    const path = this.fs.pathOf(r.drive, r.parts);
    await this.out("UNDELETE - recover deleted files.");
    await this.out("");
    await this.out(`Directory: ${path}`);
    await this.out("File Specifications: *.*");
    await this.out("");
    const del = d.del || [];
    if (!del.length) { await this.out("    No deleted files found."); return; }
    await this.out(`    VIBE-DOS directory contains ${del.length} deleted file(s).`);
    await this.out(`    Of those, ${del.length} file(s) may be recovered.`);
    await this.out("");
    for (const item of [...del]) {
      const shown = "?" + item.name.slice(1);
      const [b, x] = splitName(shown);
      this.term.write(`      ${b.padEnd(8)} ${x.padEnd(3)} ${fmt(sizeOf(item)).padStart(8)}  ${item.date}  Undelete (Y/N)?`);
      const k = await this.term.readKey();
      const yes = k.key.toUpperCase() === "Y";
      this.term.writeln(yes ? "Y" : "N");
      if (!yes) continue;
      for (;;) {
        this.term.write(`      Please type the first character for ${shown}: `);
        const c = (await this.term.readKey()).key.toUpperCase();
        if (c.length !== 1) { this.term.writeln(); continue; }
        this.term.writeln(c);
        const name = c + item.name.slice(1);
        if (!valid83(name)) { await this.out("      That character is not allowed in a file name."); continue; }
        if (this.fs.child(d, name)) { await this.out("      File already exists. Please type another first character."); continue; }
        d.del.splice(d.del.indexOf(item), 1);
        item.name = name;
        this.fs.add(d, item);
        await this.out("      File successfully undeleted.");
        await this.out("");
        break;
      }
    }
    this.sys.diskAccess(r.drive, true);
  }

  async cmdAttrib(args) {
    const flags = args.filter((a) => /^[+-][RHSA]$/i.test(a));
    const specs = args.filter((a) => !/^[+-][RHSA]$/i.test(a) && !a.startsWith("/"));
    const spec = specs[0] || "*.*";
    const r = await this.needPath(spec);
    const ex = this.fs.expand(spec, { hidden: true });
    if (!ex.dir || !ex.items.length) throw new DosError(`File not found - ${spec.toUpperCase()}`);
    if (!flags.length) {
      for (const k of ex.items) {
        const f = (c) => (has(k, c) ? c : " ");
        await this.out(`${f("A")}  ${f("S")}${f("H")}${f("R")}     ${this.fullName(r.drive, ex.parts, k.name)}`, { tag: k.name });
      }
      return;
    }
    for (const k of ex.items) for (const fl of flags) setAttr(k, fl[1].toUpperCase(), fl[0] === "+");
    this.sys.diskAccess(r.drive, true);
  }

  async cmdUnzip(args) {
    const spec = args.find((a) => !a.startsWith("/") && !a.startsWith("-"));
    if (!spec) { await this.out(USAGE.UNZIP); return; }
    let r = await this.needPath(spec);
    let node = this.fs.walk(r.drive, r.parts);
    if (!node && !/\.ZIP$/i.test(spec)) { r = await this.needPath(spec + ".ZIP"); node = this.fs.walk(r.drive, r.parts); }
    if (!node || node.t !== "f") throw new DosError(`UNZIP: can't find ${spec.toUpperCase()}`);
    if (!node.zip) throw new DosError(`UNZIP: ${node.name} is not a zip archive`);
    await this.out(`UNZIP 2.04  Archive: ${node.name}`);
    const z = node.zip;
    let tries = 0;
    const snark = [
      "Wrong password. (Mort: not even close.)",
      "Wrong password. (Mort: did you read my TODO list?)",
      "Wrong password. (Mort: my cat could guess this. Literally.)",
      "Wrong password. (Mort: the BIOS knows the year. The diary knows the cat.)",
    ];
    for (;;) {
      this.term.write(`Password for ${z.name}: `);
      const pw = await this.term.readLine({ mask: true });
      if (pw === null || !pw.trim()) { await this.out("Cancelled."); return; }
      const p = pw.trim().toUpperCase();
      if (p === z.password) break;
      if (p === "BYTE94") await this.out("Wrong password. (Mort: four digits for the year. I'm thorough.)");
      else if (p.startsWith("FLOPPY")) await this.out("Wrong password. (Mort: Floppy is the NEIGHBOUR's dog.)");
      else await this.out(snark[Math.min(tries, snark.length - 1)]);
      if (++tries >= 3) return;
    }
    const here = this.fs.walk(this.fs.drive, this.fs.cwd[this.fs.drive]);
    await this.out(`  Inflating: ${z.name}`);
    this.writeFile(this.fs.pathOf(this.fs.drive, [...this.fs.cwd[this.fs.drive], z.name]), { bin: true, size: z.size, sig: z.sig, text: z.text });
    if (here) await this.out(`Extracted to ${this.fs.cwdPath()}`);
  }

  async cmdMd(args) {
    const p = args.find((a) => !a.startsWith("/"));
    if (!p) throw new DosError("Required parameter missing");
    await this.needPath(p);
    const loc = this.fs.locate(p);
    if (!loc.dir) throw new DosError("Path not found");
    if (!valid83(loc.name)) throw new DosError("Invalid directory name");
    if (this.fs.child(loc.dir, loc.name)) throw new DosError("Directory already exists");
    const d = dir(loc.name, [], {});
    this.fs.touch(d);
    this.fs.add(loc.dir, d);
  }

  async cmdRd(args) {
    const p = args.find((a) => !a.startsWith("/"));
    if (!p) throw new DosError("Required parameter missing");
    const r = await this.needPath(p);
    const node = this.fs.walk(r.drive, r.parts);
    if (!node || node.t !== "d" || node.kids.length || !r.parts.length) throw new DosError("Invalid path, not directory,\nor directory not empty");
    const cwd = this.fs.cwd[r.drive].join("\\");
    if (cwd === r.parts.join("\\") || cwd.startsWith(r.parts.join("\\") + "\\")) throw new DosError("Attempt to remove current directory");
    this.fs.remove(this.fs.walk(r.drive, r.parts.slice(0, -1)), node);
  }

  async cmdTree(args) {
    const p = args.find((a) => !a.startsWith("/")) || "\\";
    const r = await this.needPath(p);
    const node = this.fs.walk(r.drive, r.parts);
    if (!node || node.t !== "d") throw new DosError("Invalid path");
    await this.out(`Folder PATH listing for volume ${this.fs.drives[r.drive].label}`);
    await this.out(this.fs.pathOf(r.drive, r.parts));
    const walk = async (d, prefix) => {
      const subs = d.kids.filter((k) => k.t === "d" && !has(k, "H"));
      for (let i = 0; i < subs.length; i++) {
        const last = i === subs.length - 1;
        await this.out(`${prefix}${last ? "└───" : "├───"}${subs[i].name}`, { tag: subs[i].name });
        await walk(subs[i], prefix + (last ? "    " : "│   "));
      }
    };
    await walk(node, "");
  }

  async cmdMem() {
    const b = this.state.boot || {};
    const conv = b.dosHigh ? 634 : 588;
    await this.out("");
    await this.out("Memory Type         Total  =   Used  +   Free");
    await this.out("----------------  -------   -------   -------");
    await this.out(`Conventional         640K      ${String(640 - conv).padStart(3)}K      ${conv}K`);
    await this.out("Upper                  0K        0K        0K");
    if (b.himem) await this.out("Extended (XMS)     3,072K       64K    3,008K");
    else await this.out("Extended (XMS)     3,072K        0K        0K  (not available)");
    await this.out("----------------  -------   -------   -------");
    await this.out("");
    await this.out(`Largest executable program size      ${conv}K`);
    await this.out(`Files available (FILES=)              ${b.files || 8}`);
    if (b.himem) await this.out(b.dosHigh ? "VIBE-DOS is resident in the high memory area." : "VIBE-DOS is loaded low. (DOS=HIGH would free some memory.)");
    else await this.out("HIMEM.SYS is not loaded. Extended memory is unavailable.");
  }

  async cmdVer() {
    await this.out("");
    await this.out("VIBE-DOS Version 6.2   (BIOS date: see the boot screen)");
  }

  async cmdVol(args) {
    const p = args[0] ? args[0].slice(0, 1).toUpperCase() : this.fs.drive;
    if (!this.fs.drives[p]) throw new DosError("Invalid drive specification");
    await this.need(p);
    await this.out(` Volume in drive ${p} is ${this.fs.drives[p].label}`);
    await this.out(` Volume Serial Number is ${this.fs.drives[p].serial}`);
  }

  async cmdDate() {
    await this.out(`Current date is Tue ${TODAY.slice(0, 6)}1994`);
    this.term.write("Enter new date (mm-dd-yy): ");
    const l = await this.term.readLine();
    if (l && l.trim()) await this.out("(Mort: the clock battery is soldered in. It's 1994 forever.)");
  }

  async cmdTime() {
    const d = new Date();
    await this.out(`Current time is ${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}${d.getHours() < 12 ? "a" : "p"}`);
    this.term.write("Enter new time: ");
    await this.term.readLine();
  }

  async cmdCls() {
    if (this.capture) return;
    this.term.clear();
  }

  async cmdEcho(args, rest) {
    if (rest === "") { await this.out(`ECHO is ${this.echoOn ? "on" : "off"}`); return; }
    if (/^\s*ON\s*$/i.test(rest)) { this.echoOn = true; return; }
    if (/^\s*OFF\s*$/i.test(rest)) { this.echoOn = false; return; }
    await this.out(rest.slice(1));
  }

  async cmdPath(args, rest) {
    const v = rest.trim().replace(/^=/, "").trim();
    if (!v) { await this.out(`PATH=${this.state.path}`); return; }
    this.state.path = v.toUpperCase();
  }

  async cmdHelp(args) {
    const c = (args[0] || "").toUpperCase();
    if (c && USAGE[c]) { await this.out(USAGE[c]); return; }
    if (c) { await this.out(`No help for ${c}. Type HELP for the list of commands.`); return; }
    await this.out(HELP.replace(/^\n/, ""));
  }

  async cmdHint(args) {
    const res = check(this.fs, this.state.boot);
    let n = args[0] ? parseInt(args[0], 10) : (res.find((c) => !c.ok) || {}).n;
    if (!n) { await this.out("Nothing left to hint at! Type PANES."); return; }
    if (!(n >= 1 && n <= 7)) { await this.out(USAGE.HINT); return; }
    const used = this.state.hints[n] || 0;
    const level = Math.min(used, 2);
    if (used < 3) { this.state.hints[n] = used + 1; this.state.stats.hints++; }
    const c = COMPONENTS[n - 1];
    await this.out(`Hint ${level + 1}/3 for #${n}, ${c.name} (${c.label})${res[n - 1].ok ? "  [already done!]" : ""}:`, { fg: 14 });
    await this.out(wrap(HINTS[n][level], 76).split("\n").map((l) => "  " + l).join("\n"));
    if (level < 2) await this.out("Type HINT again for a bigger hint.", { fg: 8 });
  }

  async cmdPanes() {
    const res = check(this.fs, this.state.boot);
    await this.out("PANES 1.0 - checking system components...");
    await this.out("");
    for (const c of res) {
      await this.out(`  [${c.ok ? "✓" : " "}] ${c.n}. ${c.name.padEnd(16)} ${c.label.padEnd(17)}${c.ok ? "OK" : c.problem}`, { fg: c.ok ? 10 : 12 });
    }
    await this.out("");
    const missing = res.filter((c) => !c.ok).length;
    if (missing) {
      await this.out(`${missing} component${missing > 1 ? "s" : ""} missing. PANES cannot start.`);
      await this.out("Files 2-7 go into C:\\PANES\\SYSTEM. Type HINT if you're stuck.");
      return;
    }
    await this.out("All components present. Starting PANES...", { fg: 15 });
    await this.sleep(600);
    await this.runApp(new Panes(this.sys));
  }

  async cmdReboot() {
    this.term.writeln("Rebooting...");
    await this.sleep(400);
    this.sys.screen.clear();
    await this.sleep(300);
    await this.boot();
  }

  async cmdPrint(args) {
    const spec = args.find((a) => !a.startsWith("/"));
    if (!spec) throw new DosError("Required parameter missing");
    const r = await this.needPath(spec);
    const node = this.fs.walk(r.drive, r.parts);
    if (!node || node.t !== "f") throw new DosError(`File not found - ${spec.toUpperCase()}`);
    const path = this.fs.pathOf(r.drive, r.parts);
    this.sys.print(path, fileText(node));
    await this.out(`${path} is currently being printed`);
  }

  async cmdEdit(args) {
    const spec = args.find((a) => !a.startsWith("/"));
    let path = null;
    if (spec) {
      const r = await this.needPath(spec);
      const node = this.fs.walk(r.drive, r.parts);
      if (node && node.t === "d") throw new DosError("Path/File access error (that's a folder)");
      path = this.fs.pathOf(r.drive, r.parts);
    }
    await this.runApp(new Editor(this.sys, path, this));
  }

  async cmdExit() {
    await this.out("(Mort: there's nowhere to exit to. This IS the computer. Try PANES.)");
  }

  async cmdFormat(args) {
    const d = (args.find((a) => /^[A-Za-z]:?$/.test(a)) || "").slice(0, 1).toUpperCase();
    if (!d) throw new DosError("Required parameter missing");
    if (d === "A") { await this.out("(Mort: don't you dare. That's my only backup.)"); return; }
    await this.out("");
    await this.out(`WARNING, ALL DATA ON NON-REMOVABLE DISK`);
    await this.out(`DRIVE ${d}: WILL BE LOST!`);
    this.term.write("Proceed with Format (Y/N)?");
    const k = await this.term.readKey();
    this.term.writeln(k.key.length === 1 ? k.key.toUpperCase() : "");
    await this.out(k.key.toUpperCase() === "Y" ? "Nice try. - Mort" : "Phew.");
  }

  async cmdWin() { await this.out("Bad command or file name. (Mort says: it's called PANES.)"); }

  async cmdCat() {
    const art = this.catDone ? BYTE_SLEEP_ART : BYTE_ART;
    await this.out(art.replace(/^\n/, ""));
  }

  async cmdXyzzy() { await this.out("Nothing happens."); }

  async cmdScandisk() {
    await this.out("VIBE-DOS ScanDisk is now checking drive C:");
    for (const s of ["Media descriptor", "File allocation tables", "Directory structure", "File system", "Free space"]) {
      await this.sleep(250);
      await this.out(`  ✓ ${s}`);
    }
    await this.out("ScanDisk did not find any problems on drive C.");
    await this.out("(It did find 3 cat hairs in the fan.)");
  }
}
