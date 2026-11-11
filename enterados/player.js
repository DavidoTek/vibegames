// First-person controller. No three.js: game.js copies the result to the camera.

const SPEED = 6, RUN = 9.5, CARRY = 4.6;
const JUMP_V = 8;                      // apex about 1.45 m: one "storey" of the level
const COYOTE = 0.1, BUFFER = 0.13;
const EYE = 1.6;

export class Player {
  constructor(phys) {
    this.phys = phys;
    this.body = { x: 0, y: 0, z: 0, vy: 0, r: 0.35, h: 1.7, onGround: false, ground: null, yaw: 0 };
    this.pitch = 0;
    this.vx = 0;
    this.vz = 0;
    this.kx = 0;                       // knockback velocity, decays
    this.kz = 0;
    this.air = 0;
    this.jumpBuf = 0;
    this.walk = 0;
    this.carrying = false;
    this.safe = null;                  // last spot on solid ground
    this.safeT = 0;
    this.landed = false;
  }

  place(p) {
    const b = this.body;
    Object.assign(b, { x: p.x, y: p.y, z: p.z, vy: 0, onGround: false, ground: null, yaw: p.yaw ?? b.yaw });
    this.pitch = 0;
    this.vx = this.vz = this.kx = this.kz = 0;
  }

  knock(vx, vz) {
    this.kx = vx;
    this.kz = vz;
  }

  update(dt, input, settings) {
    const b = this.body;
    const [lx, ly] = input.takeLook();
    b.yaw -= lx * settings.sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - ly * settings.sens * (settings.invert ? -1 : 1)));

    const m = input.move();
    const max = this.carrying ? CARRY : m.run ? RUN : SPEED;
    const s = Math.sin(b.yaw), c = Math.cos(b.yaw);
    const wx = (-s * m.y + c * m.x) * max, wz = (-c * m.y - s * m.x) * max;
    const k = 1 - Math.exp(-(b.onGround ? 12 : 3) * dt);
    this.vx += (wx - this.vx) * k;
    this.vz += (wz - this.vz) * k;
    const kd = Math.exp(-5 * dt);
    this.kx *= kd;
    this.kz *= kd;

    this.air = b.onGround ? 0 : this.air + dt;
    this.jumpBuf = input.consume("jump") ? BUFFER : this.jumpBuf - dt;
    if (this.jumpBuf > 0 && this.air < COYOTE) {
      b.vy = JUMP_V;
      b.onGround = false;
      b.ground = null;
      this.air = COYOTE;
      this.jumpBuf = 0;
      this.jumped = true;
    }

    const wasAir = !b.onGround, fall = b.vy;
    this.phys.move(b, this.vx + this.kx, this.vz + this.kz, dt);
    this.landed = wasAir && b.onGround && fall < -6;

    const speed = Math.hypot(this.vx, this.vz);
    if (b.onGround) this.walk += speed * dt;
    this.safeT -= dt;
    if (b.onGround && b.ground && !b.ground.dyn && this.safeT <= 0) {
      this.safeT = 0.5;
      this.safe = { x: b.x, y: b.y, z: b.z, yaw: b.yaw };
    }
  }

  eye(bob) {
    const b = this.body;
    return { x: b.x, y: b.y + EYE + (bob ? Math.sin(this.walk * 1.5) * 0.04 : 0), z: b.z };
  }
}
