// Confetti particles on a canvas that fills its parent. The loop only runs
// while particles are alive, so it costs nothing when idle.

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

export class Fx {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.parts = [];
    this.running = false;
    this.last = 0;
    this.w = 0;
    this.h = 0;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // offsetWidth ignores CSS transforms, which matters for the rotated play layer.
    this.w = this.canvas.offsetWidth || window.innerWidth;
    this.h = this.canvas.offsetHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Explosion from a point (fractions of the canvas size).
  burst(fx, fy, colors, count = 60, power = 1) {
    if (reduceMotion.matches) count = Math.min(count, 12);
    if (this.canvas.offsetWidth !== this.w || this.canvas.offsetHeight !== this.h) this.resize();
    const x = fx * this.w;
    const y = fy * this.h;
    const scale = Math.min(this.w, this.h) / 400;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (200 + Math.random() * 500) * power * scale;
      this.parts.push(this.make(x, y, Math.cos(a) * v, Math.sin(a) * v - 250 * scale, colors));
    }
    this.start();
  }

  // Confetti falling from the top edge.
  rain(colors, count = 120) {
    if (reduceMotion.matches) count = Math.min(count, 20);
    if (this.canvas.offsetWidth !== this.w || this.canvas.offsetHeight !== this.h) this.resize();
    for (let i = 0; i < count; i++) {
      const p = this.make(Math.random() * this.w, -20 - Math.random() * this.h * 0.6,
        (Math.random() - 0.5) * 120, 60 + Math.random() * 120, colors);
      p.life = 4 + Math.random() * 2;
      this.parts.push(p);
    }
    this.start();
  }

  make(x, y, vx, vy, colors) {
    return {
      x, y, vx, vy,
      size: 6 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 14,
      flip: Math.random() * Math.PI,
      color: colors[(Math.random() * colors.length) | 0],
      round: Math.random() < 0.3,
      age: 0,
      life: 1.4 + Math.random() * 0.8,
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  clear() {
    this.parts.length = 0;
  }

  frame(t) {
    const dt = Math.min((t - this.last) / 1000, 1 / 20);
    this.last = t;
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    const g = 900 * Math.min(this.w, this.h) / 400;
    this.parts = this.parts.filter((p) => (p.age += dt) < p.life && p.y < this.h + 40);
    for (const p of this.parts) {
      // Air drag makes the pieces flutter instead of falling like stones.
      p.vx *= 1 - 2.2 * dt;
      p.vy = p.vy * (1 - 2.2 * dt) + g * 0.35 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.flip += 6 * dt;
      ctx.globalAlpha = Math.min(1, (p.life - p.age) * 2.5);
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.flip));
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (this.parts.length) requestAnimationFrame((tt) => this.frame(tt));
    else this.running = false;
  }
}
