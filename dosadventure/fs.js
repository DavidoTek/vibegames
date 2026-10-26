// A tiny FAT-like file system made of plain JSON objects, so the whole disk
// can be saved to localStorage as-is.
//   dir:  { t: "d", name, attr, date, time, kids: [], del: [] }
//   file: { t: "f", name, attr, date, time, text?, bin?, sig?, exe?, size?, zip? }
// Names are upper-case 8.3. attr is a string of R/H/S/A flags.

export class DosError extends Error {}

export const TODAY = "04-26-94";

export function dir(name, kids = [], extra = {}) {
  return { t: "d", name, attr: "", date: "04-12-94", time: "10:02a", kids, del: [], ...extra };
}

export function file(name, extra = {}) {
  return { t: "f", name, attr: "A", date: "04-12-94", time: "10:02a", ...extra };
}

export function sizeOf(node) {
  if (node.t === "d") return 0;
  if (node.size != null) return node.size;
  return node.text ? node.text.length + (node.text.match(/\n/g) || []).length : 0;
}

export function has(node, flag) { return node.attr.includes(flag); }

export function setAttr(node, flag, on) {
  node.attr = node.attr.replace(flag, "");
  if (on) node.attr = (node.attr + flag).split("").sort().join("");
}

export function splitName(name) {
  const i = name.lastIndexOf(".");
  return i <= 0 ? [name, ""] : [name.slice(0, i), name.slice(i + 1)];
}

const BAD = /[\s"*+,/:;<=>?\\[\]|]/;
export function valid83(name) {
  if (name === "." || name === "..") return false;
  const [b, e] = splitName(name);
  return b.length >= 1 && b.length <= 8 && e.length <= 3 && !BAD.test(b) && !BAD.test(e) && name.split(".").length <= 2;
}

// DOS wildcards: * and ? within the base and extension separately. A pattern
// without a dot matches any extension, which is friendlier than real DOS.
export function match(name, pattern) {
  pattern = pattern.toUpperCase();
  const [pb, pe] = pattern.includes(".") ? splitName(pattern) : [pattern, "*"];
  const [nb, ne] = splitName(name);
  const rx = (p) => new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".?") + "$");
  return rx(pb).test(nb) && rx(pe || "").test(ne);
}

export function isWild(s) { return /[*?]/.test(s); }

export class FS {
  // drives: { C: { label, root }, A: { label, root } }; cwd: { C: [], A: [] }
  constructor(drives, cwd) {
    this.drives = drives;
    this.cwd = cwd || { C: [], A: [] };
    this.drive = "C";
    this.onAccess = null;   // (drive, write) => void, for LEDs and sounds
  }

  // Parse "A:\FOO\BAR", "..\X", "BAR" into { drive, parts } (absolute, normalised).
  resolve(path) {
    let p = String(path || "").trim().replace(/\//g, "\\");
    let drive = this.drive;
    const m = /^([A-Za-z]):(.*)$/.exec(p);
    if (m) { drive = m[1].toUpperCase(); p = m[2]; }
    if (!this.drives[drive]) throw new DosError("Invalid drive specification");
    const parts = p.startsWith("\\") ? [] : [...(this.cwd[drive] || [])];
    for (const seg of p.split("\\")) {
      const s = seg.toUpperCase();
      if (!s || s === ".") continue;
      if (s === "..") { parts.pop(); continue; }
      if (/^\.{3,}$/.test(s)) { parts.pop(); parts.pop(); continue; }
      parts.push(s);
    }
    return { drive, parts };
  }

  root(drive) { return this.drives[drive].root; }

  walk(drive, parts) {
    let node = this.root(drive);
    for (const p of parts) {
      if (!node || node.t !== "d") return null;
      node = node.kids.find((k) => k.name === p) || null;
    }
    return node;
  }

  get(path) {
    const { drive, parts } = this.resolve(path);
    return this.walk(drive, parts);
  }

  // Returns { drive, parts, dir, name } where dir is the parent directory node.
  locate(path) {
    const r = this.resolve(path);
    const name = r.parts[r.parts.length - 1] || "";
    const dir = this.walk(r.drive, r.parts.slice(0, -1));
    return { ...r, dir: dir && dir.t === "d" ? dir : null, name };
  }

  pathOf(drive, parts) { return `${drive}:\\${parts.join("\\")}`; }
  cwdPath(drive = this.drive) { return this.pathOf(drive, this.cwd[drive]); }

  child(dirNode, name) { return dirNode.kids.find((k) => k.name === name) || null; }

  // Expand a possibly wildcarded file spec into { dir, drive, parts, items[] }.
  // A spec naming a directory means "everything in it".
  expand(spec, { hidden = false, dirs = false } = {}) {
    const node = isWild(spec) ? null : this.get(spec);
    let loc, pattern;
    if (node && node.t === "d") {
      const r = this.resolve(spec);
      loc = { drive: r.drive, parts: r.parts, dir: node };
      pattern = "*.*";
    } else {
      const l = this.locate(spec);
      loc = { drive: l.drive, parts: l.parts.slice(0, -1), dir: l.dir };
      pattern = l.name;
    }
    if (!loc.dir) return { ...loc, items: [] };
    const items = loc.dir.kids.filter((k) => (dirs || k.t === "f") && (hidden || !has(k, "H")) && match(k.name, pattern));
    return { ...loc, items, pattern };
  }

  add(dirNode, node) {
    const old = this.child(dirNode, node.name);
    if (old) dirNode.kids.splice(dirNode.kids.indexOf(old), 1);
    dirNode.kids.push(node);
    this.sort(dirNode);
  }

  remove(dirNode, node) {
    const i = dirNode.kids.indexOf(node);
    if (i >= 0) dirNode.kids.splice(i, 1);
  }

  sort(dirNode) {
    // directories first, then files, both alphabetical (like DIR /O:GN)
    dirNode.kids.sort((a, b) => (a.t === b.t ? (a.name < b.name ? -1 : 1) : a.t === "d" ? -1 : 1));
  }

  // Create missing directories along a path; returns the final dir node.
  mkdirp(path) {
    const { drive, parts } = this.resolve(path);
    let node = this.root(drive);
    for (const p of parts) {
      let next = this.child(node, p);
      if (!next) { next = dir(p, [], { date: TODAY }); this.add(node, next); }
      if (next.t !== "d") throw new DosError("Unable to create directory");
      node = next;
    }
    return node;
  }

  used(drive) {
    let n = 0;
    const visit = (d) => { for (const k of d.kids) { n += sizeOf(k); if (k.t === "d") visit(k); } };
    visit(this.root(drive));
    return n;
  }

  free(drive) {
    return (drive === "A" ? 1457664 : 104857600) - this.used(drive) - (drive === "A" ? 0 : 21340160);
  }

  touch(node) {
    node.date = TODAY;
    const d = new Date();
    const h = d.getHours() % 12 || 12;
    node.time = `${h}:${String(d.getMinutes()).padStart(2, "0")}${d.getHours() < 12 ? "a" : "p"}`;
  }
}

export function clone(node) { return JSON.parse(JSON.stringify(node)); }
