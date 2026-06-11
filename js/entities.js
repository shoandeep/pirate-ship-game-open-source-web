// Sea Raiders — ships, cannonballs, loot, rocks, particles (MIT)
import { TAU, clamp, lerp, rand, angleDiff } from './utils.js';

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

/** Procedural top-down sailing ship. All "art" is canvas paths — zero assets. */
export function drawShip(ctx, s, t) {
  const { len, wid } = s.stats;
  const p = s.palette;
  const sinking = s.dead ? clamp(s.sinkTime / 2.2, 0, 1) : 0;
  if (sinking >= 1) return;

  const bobY = Math.sin(s.bob * 1.7) * 1.5;

  ctx.save();
  ctx.translate(s.x, s.y + bobY);
  if (sinking > 0) {
    ctx.globalAlpha = 1 - sinking;
    ctx.scale(1 - sinking * 0.35, 1 - sinking * 0.35);
    ctx.rotate(sinking * 0.6);
  }
  ctx.rotate(s.heading);

  const L = len / 2, W = wid / 2;

  // shadow on the water
  ctx.fillStyle = 'rgba(0,20,35,0.3)';
  ctx.beginPath();
  ctx.ellipse(2, 4, L * 1.02, W * 1.15, 0, 0, TAU);
  ctx.fill();

  // hull — pointed bow (+x), rounded stern
  ctx.fillStyle = s.flash > 0.5 ? '#ffffff' : p.hull;
  ctx.strokeStyle = p.hullDark;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(L, 0);
  ctx.quadraticCurveTo(L * 0.45, -W * 1.15, -L * 0.55, -W);
  ctx.quadraticCurveTo(-L * 1.05, -W * 0.55, -L * 1.05, 0);
  ctx.quadraticCurveTo(-L * 1.05, W * 0.55, -L * 0.55, W);
  ctx.quadraticCurveTo(L * 0.45, W * 1.15, L, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // deck inset with plank lines
  ctx.fillStyle = s.flash > 0.5 ? '#ffffff' : p.deck;
  ctx.beginPath();
  ctx.moveTo(L * 0.78, 0);
  ctx.quadraticCurveTo(L * 0.38, -W * 0.82, -L * 0.5, -W * 0.68);
  ctx.quadraticCurveTo(-L * 0.85, -W * 0.4, -L * 0.85, 0);
  ctx.quadraticCurveTo(-L * 0.85, W * 0.4, -L * 0.5, W * 0.68);
  ctx.quadraticCurveTo(L * 0.38, W * 0.82, L * 0.78, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(-L * 0.8, i * W * 0.28);
    ctx.lineTo(L * 0.6, i * W * 0.28);
    ctx.stroke();
  }

  // cannon stubs along the gunwales
  ctx.fillStyle = '#222';
  const n = s.stats.cannons;
  for (let i = 0; i < n; i++) {
    const along = (i - (n - 1) / 2) * (L * 1.1 / Math.max(1, n - 1) || 0);
    ctx.fillRect(along - 2, -W - 3, 4, 6);
    ctx.fillRect(along - 2, W - 3, 4, 6);
  }

  // masts + sails: square sails billow with sail amount, luff when idle
  const billow = 0.25 + s.sail * 0.75;
  const flutter = Math.sin(t * 6 + s.wakePhase) * (1 - s.sail) * 2;
  const masts = s.stats.len > 80 ? [-L * 0.45, 0.0, L * 0.42] : s.stats.len > 56 ? [-L * 0.35, L * 0.35] : [0];
  for (const mx of masts) {
    const sw = W * 1.7;
    ctx.fillStyle = p.sail;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mx, -sw / 2);
    ctx.quadraticCurveTo(mx - 9 * billow - flutter, 0, mx, sw / 2);
    ctx.quadraticCurveTo(mx - 3 * billow, 0, mx, -sw / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // mast cap
    ctx.fillStyle = p.hullDark;
    ctx.beginPath();
    ctx.arc(mx, 0, 2.5, 0, TAU);
    ctx.fill();
  }

  // stern flag, streaming aft
  ctx.strokeStyle = p.flag;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-L * 1.0, 0);
  const wave = Math.sin(t * 8 + s.wakePhase) * 3;
  ctx.quadraticCurveTo(-L * 1.0 - 8, wave, -L * 1.0 - 15, -wave);
  ctx.stroke();

  // bow trim
  ctx.strokeStyle = p.trim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(L * 0.96, 0);
  ctx.lineTo(L * 0.55, 0);
  ctx.stroke();

  ctx.restore();

  // brace shield ring
  if (s.braced && !s.dead) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.globalAlpha = 0.5 + Math.sin(t * 10) * 0.18;
    ctx.strokeStyle = '#7ed6ff';
    ctx.lineWidth = 3.5;
    ctx.setLineDash([10, 7]);
    ctx.lineDashOffset = -t * 40;
    ctx.beginPath();
    ctx.arc(0, 0, len * 0.72, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // health bar + name (skip for healthy unnamed ships to reduce clutter)
  if (!s.dead && (s.hp < s.maxHp || s.name)) {
    const bw = 46;
    const yy = s.y - s.stats.len * 0.75;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(s.x - bw / 2, yy, bw, 5);
    ctx.fillStyle = s.hp / s.maxHp > 0.35 ? '#2ed573' : '#e84118';
    ctx.fillRect(s.x - bw / 2, yy, bw * (s.hp / s.maxHp), 5);
    if (s.name) {
      ctx.fillStyle = '#f5e9d0';
      ctx.font = 'bold 12px Trebuchet MS';
      ctx.textAlign = 'center';
      ctx.fillText(s.name, s.x, yy - 5);
    }
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

  draw(ctx) {
    // parabolic flight: ball rises then falls, shadow stays on the water
    const prog = 1 - this.life / this.maxLife;
    const height = Math.sin(prog * Math.PI) * 14;

    ctx.fillStyle = 'rgba(0,20,35,0.35)';
    ctx.beginPath();
    ctx.arc(this.x, this.y + 3, 3.5, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#1d1d1d';
    ctx.beginPath();
    ctx.arc(this.x, this.y - height, 4.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(this.x - 1.5, this.y - height - 1.5, 1.6, 0, TAU);
    ctx.fill();
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

  draw(ctx, t) {
    const by = Math.sin(this.bob) * 3;
    ctx.save();
    ctx.translate(this.x, this.y + by);
    if (this.age > 21) ctx.globalAlpha = Math.max(0, 1 - (this.age - 21) / 4);

    if (this.kind === 'gold') {
      // floating crate of coins
      ctx.fillStyle = '#7a5230';
      ctx.strokeStyle = '#4e2f15';
      ctx.lineWidth = 2;
      ctx.save();
      ctx.rotate(Math.sin(this.bob * 0.7) * 0.15);
      ctx.fillRect(-9, -9, 18, 18);
      ctx.strokeRect(-9, -9, 18, 18);
      ctx.strokeStyle = '#caa64f';
      ctx.beginPath();
      ctx.moveTo(-9, 0); ctx.lineTo(9, 0);
      ctx.moveTo(0, -9); ctx.lineTo(0, 9);
      ctx.stroke();
      ctx.restore();
    } else {
      // glowing barrel powerup
      const glow = 0.5 + Math.sin(t * 5 + this.bob) * 0.3;
      ctx.fillStyle = `rgba(255, 209, 102, ${glow * 0.35})`;
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, TAU);
      ctx.fill();
      ctx.font = '18px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(LOOT_KINDS[this.kind].icon, 0, 1);
    }
    ctx.restore();
  }
}

// ============================================================ Rocks

export class Rock {
  constructor(x, y, r) {
    this.x = x; this.y = y; this.r = r;
    // pre-bake a jagged outline
    this.pts = [];
    const n = 9 + ((r / 8) | 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      this.pts.push({ a, d: r * rand(0.75, 1.1) });
    }
  }

  draw(ctx, t) {
    ctx.save();
    ctx.translate(this.x, this.y);

    // foam ring lapping at the base
    ctx.strokeStyle = 'rgba(220, 240, 255, 0.35)';
    ctx.lineWidth = 5 + Math.sin(t * 2 + this.x) * 2;
    ctx.beginPath();
    ctx.arc(0, 0, this.r + 6, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = '#5d6d7e';
    ctx.strokeStyle = '#34495e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    this.pts.forEach((p, i) => {
      const x = Math.cos(p.a) * p.d, y = Math.sin(p.a) * p.d;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // highlight facet
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.ellipse(-this.r * 0.25, -this.r * 0.3, this.r * 0.45, this.r * 0.3, -0.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

// ============================================================ Particles

export class Particles {
  constructor() { this.list = []; }

  spawn(x, y, opts = {}) {
    this.list.push({
      x, y,
      vx: opts.vx ?? rand(-30, 30),
      vy: opts.vy ?? rand(-30, 30),
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
      });
    }
  }

  splash(x, y) {
    for (let i = 0; i < 8; i++) {
      const a = rand(TAU);
      this.spawn(x, y, {
        vx: Math.cos(a) * rand(20, 90), vy: Math.sin(a) * rand(20, 90) - 40,
        life: rand(0.3, 0.6), size: rand(2, 5),
        color: '210,240,255', alpha: 0.85, drag: 2,
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
      });
    }
  }

  /** smoke trickle from a damaged ship */
  damageSmoke(ship) {
    if (ship.dead || ship.hp / ship.maxHp > 0.4 || Math.random() > 0.25) return;
    this.spawn(ship.x + rand(-8, 8), ship.y + rand(-8, 8), {
      vx: rand(-12, 12), vy: rand(-26, -10),
      life: rand(0.8, 1.6), size: rand(4, 8), grow: 10,
      color: '60,60,60', alpha: 0.5, drag: 1,
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
      p.size += p.grow * dt;
    }
  }

  draw(ctx) {
    for (const p of this.list) {
      ctx.fillStyle = `rgba(${p.color},${(p.life / p.maxLife) * p.alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
  }
}
