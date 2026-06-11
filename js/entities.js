// Sea Raiders — ships, cannonballs, loot, barrels, rocks, particles (MIT)
// Simulation/state lives here; all drawing is in render3d.js.
import { TAU, clamp, lerp, rand } from './utils.js';

// ============================================================ Ship

export const SHIP_TYPES = {
  player:  { len: 64, wid: 26, hp: 100, speed: 230, turn: 2.3, reload: 0.9, damage: 12, cannons: 2, range: 360 },
  sloop:   { len: 50, wid: 20, hp: 35,  speed: 200, turn: 2.6, reload: 1.7, damage: 6,  cannons: 1, range: 300 },
  brig:    { len: 66, wid: 27, hp: 70,  speed: 165, turn: 1.9, reload: 1.4, damage: 10, cannons: 2, range: 340 },
  galleon: { len: 92, wid: 38, hp: 190, speed: 120, turn: 1.2, reload: 1.6, damage: 16, cannons: 3, range: 400 },
};

const BRACE_DURATION = 2.0;
const BRACE_COOLDOWN = 6.0;

export class Ship {
  constructor(x, y, type = 'player', palette = {}) {
    const base = SHIP_TYPES[type];
    this.type = type;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.heading = rand(TAU);
    this.stats = { ...base };
    this.hp = base.hp;
    this.maxHp = base.hp;

    this.sail = 0;            // visual sail fill 0..1
    this.reloadTimer = 0;
    this.braceTimer = 0;      // active brace remaining
    this.braceCd = 0;
    this.flash = 0;           // white hit flash
    this.dead = false;
    this.sinkTime = 0;        // grows after death for sinking animation
    this.wakePhase = rand(TAU);
    this.bob = rand(TAU);     // gentle idle bobbing phase
    this.alert = 0;           // "!" indicator when this ship spots the player

    this.palette = {
      hull: '#6d4524', hullDark: '#4e2f15', deck: '#9c7044',
      sail: '#f3ead2', flag: '#d63031', trim: '#caa64f',
      ...palette,
    };
    this.name = '';
  }

  get speed() { return Math.hypot(this.vx, this.vy); }
  get braced() { return this.braceTimer > 0; }

  update(dt, control) {
    if (this.dead) { this.sinkTime += dt; return; }

    this.bob += dt;
    this.reloadTimer = Math.max(0, this.reloadTimer - dt);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.braceCd = Math.max(0, this.braceCd - dt);
    this.braceTimer = Math.max(0, this.braceTimer - dt);
    this.alert = Math.max(0, this.alert - dt);

    if (control.brace && this.braceCd <= 0) {
      this.braceTimer = BRACE_DURATION;
      this.braceCd = BRACE_COOLDOWN;
    }

    // sails ease toward the throttle — ships don't stop on a dime
    this.sail = lerp(this.sail, clamp(control.throttle, 0, 1), 1 - Math.exp(-2.5 * dt));

    // turning authority grows with speed (a drifting ship barely answers the helm)
    const spdFactor = 0.35 + 0.65 * clamp(this.speed / this.stats.speed, 0, 1);
    this.heading += control.steer * this.stats.turn * spdFactor * dt;

    // thrust along heading; bracing furls the sails a bit
    const thrust = this.stats.speed * this.sail * (this.braced ? 0.55 : 1) * 1.6;
    this.vx += Math.cos(this.heading) * thrust * dt;
    this.vy += Math.sin(this.heading) * thrust * dt;

    // anisotropic drag: ships carve forward, resist sliding sideways
    const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
    let fwd = this.vx * fx + this.vy * fy;
    let lat = -this.vx * fy + this.vy * fx;
    fwd *= Math.exp(-1.6 * dt);
    lat *= Math.exp(-5.5 * dt);
    this.vx = fx * fwd - fy * lat;
    this.vy = fy * fwd + fx * lat;

    const sp = this.speed;
    if (sp > this.stats.speed) {
      this.vx *= this.stats.speed / sp;
      this.vy *= this.stats.speed / sp;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  /** Fire a broadside from one side (-1 = port, +1 = starboard). Returns cannonballs. */
  fireBroadside(side, ownerId = 'local') {
    const balls = [];
    const n = this.stats.cannons;
    const perp = this.heading + side * Math.PI / 2;
    for (let i = 0; i < n; i++) {
      // space the cannons along the hull
      const along = (i - (n - 1) / 2) * (this.stats.len * 0.55 / Math.max(1, n - 1) || 0);
      const bx = this.x + Math.cos(this.heading) * along + Math.cos(perp) * this.stats.wid * 0.5;
      const by = this.y + Math.sin(this.heading) * along + Math.sin(perp) * this.stats.wid * 0.5;
      const spread = rand(-0.07, 0.07);
      balls.push(new Cannonball(bx, by, perp + spread, this.stats.range, this.stats.damage, ownerId, this.vx, this.vy));
    }
    this.reloadTimer = this.stats.reload;
    return balls;
  }

  takeDamage(dmg) {
    if (this.dead) return 0;
    const dealt = this.braced ? dmg * 0.4 : dmg;
    this.hp -= dealt;
    this.flash = 1;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; }
    return dealt;
  }
}

// ============================================================ Cannonball

const BALL_SPEED = 420;

export class Cannonball {
  constructor(x, y, angle, range, damage, ownerId, inheritVx = 0, inheritVy = 0) {
    this.x = x; this.y = y;
    this.vx = Math.cos(angle) * BALL_SPEED + inheritVx * 0.5;
    this.vy = Math.sin(angle) * BALL_SPEED + inheritVy * 0.5;
    this.maxLife = range / BALL_SPEED;
    this.life = this.maxLife;
    this.damage = damage;
    this.ownerId = ownerId;
    this.dead = false;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
}

// ============================================================ Loot

export const LOOT_KINDS = {
  gold:   { icon: '🪙', label: 'Gold' },
  repair: { icon: '🛠', label: 'Repairs' },
  rapid:  { icon: '⚡', label: 'Rapid Fire' },
  spread: { icon: '✸', label: 'Grapeshot' },
};

export class Loot {
  constructor(x, y, kind, value = 0) {
    this.x = x; this.y = y;
    this.kind = kind;
    this.value = value;
    this.bob = rand(TAU);
    this.age = 0;
    this.dead = false;
  }

  update(dt) {
    this.age += dt;
    this.bob += dt * 2;
    if (this.age > 25) this.dead = true; // drifts away eventually
  }
}

// ============================================================ Barrel (explosive)

export const BARREL_RADIUS = 110;  // blast radius
export const BARREL_DAMAGE = 25;

export class Barrel {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.bob = rand(TAU);
    this.fuse = 0;       // > 0 means lit (chain reaction delay)
    this.dead = false;
  }

  update(dt) {
    this.bob += dt * 2;
    // drift from being nudged by hulls, damped by the water
    const d = Math.exp(-1.8 * dt);
    this.vx *= d; this.vy *= d;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.fuse > 0) this.fuse -= dt;
  }
}

// ============================================================ Rocks

export class Rock {
  constructor(x, y, r) {
    this.x = x; this.y = y; this.r = r;
    // faceted mesh is built lazily by the renderer (rock._mesh)
  }
}

// ============================================================ Particles

export class Particles {
  constructor() { this.list = []; }

  spawn(x, y, opts = {}) {
    this.list.push({
      x, y,
      z: opts.z ?? 0,
      vx: opts.vx ?? rand(-30, 30),
      vy: opts.vy ?? rand(-30, 30),
      vz: opts.vz ?? 0,
      life: opts.life ?? 0.8,
      maxLife: opts.life ?? 0.8,
      size: opts.size ?? 4,
      grow: opts.grow ?? 0,
      color: opts.color ?? '255,255,255',
      alpha: opts.alpha ?? 0.8,
      drag: opts.drag ?? 1.5,
    });
  }

  /** churning white wake behind a moving ship */
  wake(ship) {
    const sp = ship.speed;
    if (sp < 25) return;
    const back = ship.heading + Math.PI;
    const sx = ship.x + Math.cos(back) * ship.stats.len * 0.5;
    const sy = ship.y + Math.sin(back) * ship.stats.len * 0.5;
    const count = sp > 140 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const side = rand(-1, 1);
      this.spawn(sx + rand(-4, 4), sy + rand(-4, 4), {
        vx: Math.cos(back) * sp * 0.25 + Math.cos(ship.heading + Math.PI / 2) * side * 22,
        vy: Math.sin(back) * sp * 0.25 + Math.sin(ship.heading + Math.PI / 2) * side * 22,
        life: rand(0.7, 1.4), size: rand(3, 7), grow: 6,
        color: '225,243,255', alpha: 0.5, drag: 2.2,
      });
    }
    // bow spray at high speed
    if (sp > 170 && Math.random() < 0.5) {
      const bx = ship.x + Math.cos(ship.heading) * ship.stats.len * 0.5;
      const by = ship.y + Math.sin(ship.heading) * ship.stats.len * 0.5;
      this.spawn(bx, by, {
        vx: Math.cos(ship.heading + rand(-1, 1)) * 50,
        vy: Math.sin(ship.heading + rand(-1, 1)) * 50,
        life: 0.4, size: 3, color: '235,250,255', alpha: 0.7,
        z: 4, vz: rand(20, 50),
      });
    }
  }

  muzzleFlash(x, y, angle) {
    for (let i = 0; i < 6; i++) {
      const a = angle + rand(-0.4, 0.4);
      this.spawn(x, y, {
        vx: Math.cos(a) * rand(60, 180), vy: Math.sin(a) * rand(60, 180),
        life: rand(0.15, 0.4), size: rand(3, 6),
        color: i < 2 ? '255,200,80' : '160,160,160', alpha: 0.9, grow: 14, drag: 4,
        z: 8, vz: rand(0, 30),
      });
    }
  }

  splash(x, y) {
    for (let i = 0; i < 8; i++) {
      const a = rand(TAU);
      this.spawn(x, y, {
        vx: Math.cos(a) * rand(20, 90), vy: Math.sin(a) * rand(20, 90),
        life: rand(0.3, 0.6), size: rand(2, 5),
        color: '210,240,255', alpha: 0.85, drag: 2,
        vz: rand(40, 110),
      });
    }
  }

  woodHit(x, y) {
    for (let i = 0; i < 10; i++) {
      const a = rand(TAU);
      this.spawn(x, y, {
        vx: Math.cos(a) * rand(40, 150), vy: Math.sin(a) * rand(40, 150),
        life: rand(0.3, 0.7), size: rand(2, 4),
        color: i < 6 ? '150,100,50' : '255,180,80', alpha: 0.95, drag: 3,
        z: 10, vz: rand(20, 90),
      });
    }
  }

  explosion(x, y, scale = 1) {
    for (let i = 0; i < 26 * scale; i++) {
      const a = rand(TAU);
      const sp = rand(30, 220) * scale;
      this.spawn(x, y, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.4, 1.1), size: rand(4, 10) * scale, grow: 8,
        color: i < 8 ? '255,170,60' : i < 14 ? '255,90,40' : '90,90,90',
        alpha: 0.95, drag: 2.5,
        z: 5, vz: rand(30, 160) * scale,
      });
    }
  }

  /** smoke trickle from a damaged ship */
  damageSmoke(ship) {
    if (ship.dead || ship.hp / ship.maxHp > 0.4 || Math.random() > 0.25) return;
    this.spawn(ship.x + rand(-8, 8), ship.y + rand(-8, 8), {
      vx: rand(-12, 12), vy: rand(-8, 8),
      life: rand(0.8, 1.6), size: rand(4, 8), grow: 10,
      color: '60,60,60', alpha: 0.5, drag: 1,
      z: 12, vz: rand(25, 50),
    });
  }

  update(dt) {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // simple ballistic height: debris arcs up and falls back to the water
      if (p.z > 0 || p.vz !== 0) {
        p.vz -= 260 * dt;
        p.z = Math.max(0, p.z + p.vz * dt);
        if (p.z === 0 && p.vz < 0) p.vz = 0;
      }
      p.size += p.grow * dt;
    }
  }
}
