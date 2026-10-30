// Two-player networking over PeerJS. The PeerJS server is only used to set
// up the connection; game data then goes browser to browser over WebRTC.
// Nothing here runs until the player presses Host or Join.
//
// Two data channels: "ctl" (reliable, ordered) for race events and "state"
// (unordered) for car snapshots, so an old snapshot never holds up a newer one.

export const PROTOCOL = 1;
const PREFIX = "twinthrottle-";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no 0/O/1/I
const TIMEOUT = 15000;

let loading = null;

// The vendored bundle sets window.Peer. It is injected on demand so solo
// players never even parse it.
function loadPeer() {
  if (window.Peer) return Promise.resolve();
  loading ??= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "vendor/peerjs.min.js";
    s.onload = () => res();
    s.onerror = () => { loading = null; rej(new Error("Could not load vendor/peerjs.min.js")); };
    document.head.appendChild(s);
  });
  return loading;
}

const FRIENDLY = {
  "peer-unavailable": "Room not found. Check the code.",
  "unavailable-id": "That room code is taken. Try again.",
  "browser-incompatible": "This browser does not support WebRTC.",
  network: "The PeerJS server is not reachable. Try again or play solo.",
  "server-error": "The PeerJS server is not reachable. Try again or play solo.",
  "socket-error": "The PeerJS server is not reachable. Try again or play solo.",
  "socket-closed": "The PeerJS server closed the connection.",
  webrtc: "The connection could not be set up (WebRTC).",
};

export function friendly(err) {
  return FRIENDLY[err?.type] ?? err?.message ?? String(err);
}

export function randomCode() {
  let s = "";
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function cleanCode(s) {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

export class Net {
  // server: optional { host, port, path, key, secure } for a self-hosted PeerServer.
  constructor(server) {
    this.server = server;
    this.handlers = new Map();
    this.peer = null;
    this.ctl = null;
    this.st = null;
    this.isHost = false;
    this.offset = 0;          // guest: hostTime - localTime
    this.samples = [];
    this.lastSeen = 0;
    this.closed = false;
  }

  on(type, fn) { this.handlers.set(type, fn); return this; }
  emit(type, data) { this.handlers.get(type)?.(data); }

  options() {
    const s = this.server;
    if (!s || !s.host) return { debug: 0 };
    return { debug: 0, host: s.host, port: Number(s.port) || 443, path: s.path || "/", key: s.key || "peerjs", secure: s.secure !== false };
  }

  // Host: open a room. Resolves with the code once the PeerJS server
  // accepted the id; "connected" is emitted when the guest has both channels.
  async host() {
    await loadPeer();
    this.isHost = true;
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = randomCode();
      try {
        await this.open(PREFIX + code);
        this.code = code;
        this.peer.on("connection", (c) => this.incoming(c));
        return code;
      } catch (e) {
        if (e?.type !== "unavailable-id") throw e;
      }
    }
    throw { type: "unavailable-id" };
  }

  open(id) {
    return new Promise((res, rej) => {
      const peer = id ? new window.Peer(id, this.options()) : new window.Peer(this.options());
      const timer = setTimeout(() => { peer.destroy(); rej({ type: "network" }); }, TIMEOUT);
      peer.on("open", () => { clearTimeout(timer); this.peer = peer; res(); });
      peer.on("error", (e) => {
        clearTimeout(timer);
        if (!this.peer) { peer.destroy(); rej(e); return; }
        // After setup, only errors that end the session matter.
        if (["peer-unavailable", "webrtc", "browser-incompatible"].includes(e.type) && !this.ctl) this.emit("error", e);
      });
    });
  }

  incoming(conn) {
    if (this.guestId && conn.peer !== this.guestId) {
      conn.on("open", () => { conn.send({ t: "full" }); setTimeout(() => conn.close(), 500); });
      return;
    }
    this.guestId = conn.peer;
    if (conn.label === "ctl") this.ctl = conn; else this.st = conn;
    this.wire(conn);
    conn.on("open", () => this.checkReady());
  }

  // Guest: connect to a room code.
  async join(code) {
    await loadPeer();
    this.isHost = false;
    await this.open(null);
    const id = PREFIX + cleanCode(code);
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej({ type: "peer-unavailable" }), TIMEOUT);
      this.peer.on("error", (e) => { if (e.type === "peer-unavailable") { clearTimeout(timer); rej(e); } });
      this.ctl = this.peer.connect(id, { label: "ctl", reliable: true, serialization: "json" });
      this.st = this.peer.connect(id, { label: "state", reliable: false, serialization: "json" });
      this.wire(this.ctl);
      this.wire(this.st);
      this.onReady = () => { clearTimeout(timer); res(); };
      this.ctl.on("open", () => this.checkReady());
      this.st.on("open", () => this.checkReady());
    });
  }

  checkReady() {
    if (this.ready || !this.ctl?.open || !this.st?.open) return;
    this.ready = true;
    this.lastSeen = performance.now();
    this.onReady?.();
    this.emit("connected");
    if (!this.isHost) this.syncClock(8);
    this.heartbeat = setInterval(() => this.tick(), 1000);
  }

  wire(conn) {
    conn.on("data", (m) => {
      this.lastSeen = performance.now();
      if (!m || typeof m !== "object") return;
      if (m.t === "ping") { this.send({ t: "pong", a: m.a, h: this.now() }); return; }
      if (m.t === "pong") { this.pong(m); return; }
      this.emit(m.t, m);
    });
    conn.on("close", () => this.lost());
    conn.on("error", () => this.lost());
  }

  // Keep-alive, clock resync, and noticing a silent peer.
  tick() {
    if (this.closed) return;
    if (!this.isHost) this.syncClock(1);
    else this.send({ t: "alive" });
    if (performance.now() - this.lastSeen > 6000) this.lost();
  }

  lost() {
    if (this.closed || !this.ready) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    this.emit("left");
  }

  // NTP-style: keep the samples with the lowest round trip and take the
  // median offset among them.
  syncClock(n) {
    for (let i = 0; i < n; i++) setTimeout(() => this.send({ t: "ping", a: performance.now() / 1000 }), i * 120);
  }

  pong(m) {
    const now = performance.now() / 1000, rtt = now - m.a;
    this.samples.push({ rtt, off: m.h + rtt / 2 - now });
    if (this.samples.length > 16) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 5).map((s) => s.off).sort((a, b) => a - b);
    this.offset = best[Math.floor(best.length / 2)];
    this.rtt = rtt;
  }

  // Host clock in seconds (the race runs on it).
  now() { return performance.now() / 1000 + (this.isHost ? 0 : this.offset); }

  send(m) { if (this.ctl?.open) this.ctl.send(m); }
  sendState(m) { if (this.st?.open) this.st.send(m); else this.send(m); }

  close() {
    this.closed = true;
    clearInterval(this.heartbeat);
    try { this.send({ t: "bye" }); } catch { /* already gone */ }
    // Give the goodbye a moment to leave before tearing everything down.
    const p = this.peer;
    setTimeout(() => { try { p?.destroy(); } catch { /* ignore */ } }, 150);
  }
}
