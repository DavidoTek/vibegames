// Particle overlay on a full-screen canvas (confetti, sparkle bursts, smoke).
// The loop only runs while particles are alive, so it costs nothing at rest.

const canvas = document.getElementById("fx");
const ctx = canvas.getContext("2d");
let parts = [];
let running = false;
let last = 0;
let dpr = 1;
let enabled = true;

export function setFxEnabled(on) {
  enabled = on;
  if (!on) parts = [];
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}
resize();
addEventListener("resize", resize);

const rand = (a, b) => a + Math.random() * (b - a);

function start() {
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => (p.life -= dt) > 0);
  for (const p of parts) {
    p.vx *= 1 - p.drag * dt;
    p.vy = p.vy * (1 - p.drag * dt) + p.grav * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
    const a = Math.min(1, p.life / p.fade);
    ctx.globalAlpha = a * p.alpha;
    ctx.fillStyle = p.color;
    if (p.kind === "rect") {
      // Confetti flutter: squash one axis with the rotation.
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.rot * 2.3));
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    } else if (p.kind === "star") {
      const s = p.size * (0.5 + a * 0.5);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 ? s * 0.25 : s;
        ctx.lineTo(Math.cos((i * Math.PI) / 4) * r, Math.sin((i * Math.PI) / 4) * r);
      }
      ctx.fill();
      ctx.restore();
    } else {
      // Smoke puff grows while it fades.
      const r = p.size * (2 - a);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, p.color);
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  if (parts.length) requestAnimationFrame(frame);
  else running = false;
}

function add(p) {
  parts.push({ rot: 0, spin: 0, drag: 0.6, grav: 0, alpha: 1, fade: 0.4, ...p });
}

export function confetti(colors = ["#ffd23f", "#ff5c8a", "#2ed3a0", "#8f9bff", "#ff9f43", "#b57bff"]) {
  if (!enabled) return;
  const w = innerWidth;
  for (let i = 0; i < 160; i++) {
    const fromLeft = i % 2 === 0;
    add({
      kind: "rect",
      x: fromLeft ? -10 : w + 10,
      y: innerHeight * rand(0.55, 0.85),
      vx: (fromLeft ? 1 : -1) * rand(250, 650),
      vy: rand(-900, -450),
      grav: 900,
      drag: 1.2,
      size: rand(7, 13),
      spin: rand(-12, 12),
      color: colors[i % colors.length],
      life: rand(2.2, 3.6),
      fade: 0.8,
    });
  }
  start();
}

export function sparkle(x, y, color = "#ffd23f", count = 26) {
  if (!enabled) return;
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const v = rand(120, 420);
    add({ kind: "star", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3, grav: 120, size: rand(4, 9), spin: rand(-6, 6), color, life: rand(0.6, 1.1) });
  }
  start();
}

export function smoke(x, y, color = "rgba(180,150,255,0.35)", count = 14) {
  if (!enabled) return;
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const v = rand(20, 120);
    add({ kind: "puff", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, drag: 1.5, size: rand(25, 60), color, life: rand(0.8, 1.5), fade: 1.2, alpha: 0.8 });
  }
  start();
}

/** Centre of an element, for aiming bursts. */
export function centerOf(el) {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}
