// Things that move on their own: bugs (and the Moth's larvae), the Moth and
// Blink the cursor.

import { THREE, bugModel, mothModel, blinkModel, BUG_MATS } from "./props.js";

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export class Bug {
  // zone: { x0, x1, z0, z1 } the bug stays in; larvae have none and roam.
  constructor(game, x, y, z, zone, larva = false) {
    this.game = game;
    this.zone = zone;
    this.larva = larva;
    this.x = x;
    this.y = y;
    this.z = z;
    this.radius = larva ? 0.45 : 0.7;
    this.state = "walk";
    this.t = 0;
    this.cool = 0;
    this.phase = Math.random() * 6;
    this.tx = x;
    this.tz = z;
    this.mesh = bugModel(larva ? 0.6 : 1);
    this.mesh.position.set(x, y, z);
    game.scene.add(this.mesh);
    this.pickTarget();
  }

  get alive() { return this.state === "walk" || this.state === "stun"; }

  pickTarget() {
    if (this.zone) {
      this.tx = this.zone.x0 + Math.random() * (this.zone.x1 - this.zone.x0);
      this.tz = this.zone.z0 + Math.random() * (this.zone.z1 - this.zone.z0);
    } else {
      this.tx = this.x + (Math.random() - 0.5) * 8;
      this.tz = this.z + (Math.random() - 0.5) * 8;
    }
  }

  paint(mat) {
    this.mesh.userData.body.material = mat;
    this.mesh.userData.head.material = mat;
  }

  // Returns "stun" or "patch".
  zap() {
    if (this.state === "stun" || this.larva) {
      this.state = "patched";
      this.t = 0;
      this.paint(BUG_MATS.fly);
      for (const l of this.mesh.userData.legs) l.visible = false;
      return "patch";
    }
    this.state = "stun";
    this.t = 4;
    this.paint(BUG_MATS.stun);
    return "stun";
  }

  update(dt) {
    const g = this.game, p = g.player.body, m = this.mesh;
    if (this.state === "gone") return;
    if (this.state === "patched") {
      // A patched bug floats off as a firefly.
      this.t += dt;
      this.y += dt * 2.2;
      m.position.set(this.x + Math.sin(this.t * 5) * 0.3, this.y, this.z);
      m.scale.setScalar(Math.max(0.01, (this.larva ? 0.6 : 1) * (1 - this.t / 3)));
      if (this.t > 3) {
        this.state = "gone";
        g.scene.remove(m);
      }
      return;
    }
    if (this.state === "stun") {
      this.t -= dt;
      if (this.t <= 0) {
        this.state = "walk";
        this.paint(BUG_MATS.live);
      }
      return;
    }

    this.cool -= dt;
    const dx = p.x - this.x, dz = p.z - this.z;
    const dist = Math.hypot(dx, dz), dy = p.y - this.y;
    const inZone = !this.zone || (p.x > this.zone.x0 - 3 && p.x < this.zone.x1 + 3 && p.z > this.zone.z0 - 3 && p.z < this.zone.z1 + 3);
    const chase = this.cool <= 0 && inZone && dist < (this.larva ? 16 : 10) && Math.abs(dy) < 3;
    if (chase) {
      this.tx = p.x;
      this.tz = p.z;
    }
    let ex = this.tx - this.x, ez = this.tz - this.z;
    const el = Math.hypot(ex, ez);
    if (el < 0.3) {
      this.pickTarget();
    } else {
      const speed = (this.larva ? 3.6 : chase ? 3.3 : 2) * dt;
      ex /= el;
      ez /= el;
      let nx = this.x + ex * speed, nz = this.z + ez * speed;
      if (this.zone) {
        nx = Math.max(this.zone.x0, Math.min(this.zone.x1, nx));
        nz = Math.max(this.zone.z0, Math.min(this.zone.z1, nz));
      }
      const h = g.phys.heightAt(nx, nz, this.y + 1.3);
      if (h === -Infinity || g.phys.solidAt(nx, h + 0.5, nz)) {
        this.pickTarget();
      } else {
        this.x = nx;
        this.z = nz;
        this.y = damp(this.y, h, 14, dt);
        m.rotation.y = Math.atan2(ex, ez);
      }
    }
    m.position.set(this.x, this.y, this.z);
    this.phase += dt * 14;
    m.userData.legs.forEach((l, i) => { l.rotation.y = Math.sin(this.phase + i * 2) * 0.45; });

    if (this.cool <= 0 && dist < this.radius + 0.4 && Math.abs(dy) < 1.4) {
      this.cool = 1.6;
      g.hurt(this.x, this.z);
      // Back off, so the player is not hit again straight away.
      this.tx = this.x - (dx / (dist || 1)) * 4;
      this.tz = this.z - (dz / (dist || 1)) * 4;
    }
  }

  remove() {
    if (this.state !== "gone") this.game.scene.remove(this.mesh);
    this.state = "gone";
  }
}

export class Moth {
  constructor(game, home) {
    this.game = game;
    this.home = home;                  // where it circles when nothing lures it
    this.centre = { ...home };
    this.pos = new THREE.Vector3(home.x, home.y, home.z);
    this.state = "hidden";             // hidden | fly | circle | sink | written
    this.radius = 2.2;
    this.stun = 0;
    this.bored = 0;
    this.ang = 0;
    this.t = 0;
    this.mesh = mothModel();
    this.mesh.visible = false;
    game.scene.add(this.mesh);
    this.next = new THREE.Vector3();
  }

  get alive() { return this.state === "fly" || this.state === "circle"; }

  appear() {
    this.state = "circle";
    this.mesh.visible = true;
    this.mesh.scale.setScalar(1);
  }

  flyTo(centre) {
    this.centre = { ...centre };
    this.state = "fly";
    this.bored = 0;
  }

  sinkInto(point) {
    this.centre = { ...point };
    this.state = "sink";
    this.t = 0;
  }

  zap() {
    this.stun = 3;
    return "stun";
  }

  update(dt) {
    if (this.state === "hidden" || this.state === "written") return;
    const m = this.mesh, c = this.centre;
    this.t += dt;
    const flap = Math.sin(this.t * (this.stun > 0 ? 3 : 9)) * 0.7;
    m.userData.wings[0].rotation.z = flap;
    m.userData.wings[1].rotation.z = -flap;
    if (this.stun > 0) {
      this.stun -= dt;
      return;
    }
    if (this.state === "sink") {
      this.next.set(c.x, c.y, c.z);
      this.pos.lerp(this.next, 1 - Math.exp(-2.5 * dt));
      const s = Math.max(0, 1 - this.t / 2.4);
      m.scale.setScalar(s);
      m.rotation.y += dt * 8;
      m.position.copy(this.pos);
      if (s <= 0) {
        this.state = "written";
        m.visible = false;
      }
      return;
    }
    this.ang += dt * 0.9;
    this.next.set(c.x + Math.cos(this.ang) * 4, c.y + Math.sin(this.ang * 2) * 0.8, c.z + Math.sin(this.ang) * 4);
    if (this.state === "fly") {
      const d = this.pos.distanceTo(this.next);
      if (d < 0.6) this.state = "circle";
      else this.pos.addScaledVector(this.next.clone().sub(this.pos).divideScalar(d), Math.min(d, 11 * dt));
    } else {
      this.pos.lerp(this.next, 1 - Math.exp(-6 * dt));
      this.bored += dt;
    }
    m.lookAt(this.next);
    m.position.copy(this.pos);
  }
}

export class Blink {
  constructor(game) {
    this.game = game;
    this.mesh = blinkModel();
    this.pos = this.mesh.position;
    this.t = 0;
    game.scene.add(this.mesh);
  }

  jump(p) { this.pos.set(p.x, p.y + 2.2, p.z); }

  update(dt, target, yaw) {
    this.t += dt;
    if (target) {
      const k = 1 - Math.exp(-2.2 * dt);
      this.pos.x += (target.x - this.pos.x) * k;
      this.pos.z += (target.z - this.pos.z) * k;
      this.pos.y += (target.y + 2.2 + Math.sin(this.t * 1.7) * 0.15 - this.pos.y) * k;
    }
    this.mesh.rotation.y = yaw;
    // A slow cursor pulse, not an on/off blink.
    this.mesh.material.opacity = 0.7 + Math.sin(this.t * 3.2) * 0.3;
  }
}
