// Sea Raiders — game world: waves, combat, loot, camera, shop, multiplayer wiring (MIT)
import { TAU, clamp, lerp, dist, angleTo, angleDiff, rand, pick } from './utils.js';
import { Ship, drawShip, Loot, LOOT_KINDS, Rock, Particles } from './entities.js';
import { EnemyAI, waveSpec } from './enemy.js';
import { drawWater, drawWorldEdge } from './water.js';

export const WORLD_SIZE = 4200;

const PLAYER_PALETTES = [
  { hull: '#6d4524', flag: '#d63031', sail: '#f3ead2' },
  { hull: '#37506d', flag: '#0984e3', sail: '#e8eef5' },
  { hull: '#4d6b3c', flag: '#00b894', sail: '#eef5e8' },
  { hull: '#6b3c5e', flag: '#a55eea', sail: '#f5e8f2' },
];

const UPGRADES = [
  { key: 'hull',    name: 'Reinforced Hull', desc: '+25 max hull & full repair', base: 60,
    apply: (s) => { s.maxHp += 25; s.hp = s.maxHp; } },
  { key: 'cannons', name: 'Extra Cannons',   desc: '+1 cannon per broadside',    base: 90, max: 4,
    apply: (s) => { s.stats.cannons += 1; } },
  { key: 'powder',  name: 'Fine Powder',     desc: '+20% cannon damage',         base: 70,
    apply: (s) => { s.stats.damage = Math.round(s.stats.damage * 1.2); } },
  { key: 'sails',   name: 'Silk Sails',      desc: '+12% top speed',             base: 65, max: 5,
    apply: (s) => { s.stats.speed *= 1.12; } },
  { key: 'crew',    name: 'Drilled Crew',    desc: '15% faster reloads',         base: 75, max: 5,
    apply: (s) => { s.stats.reload *= 0.85; } },
  { key: 'patch',   name: 'Quick Patch',     desc: 'Repair 40 hull now',         base: 30, repeat: true,
    apply: (s) => { s.hp = Math.min(s.maxHp, s.hp + 40); } },
];

export class Game {
  constructor(canvas, input, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.ui = ui;

    this.mode = 'single';
    this.net = null;
    this.running = false;
    this.t = 0;

    this.cam = { x: 0, y: 0 };
    this.shake = 0;
    this.particles = new Particles();
  }

  // ---------------------------------------------------------- setup

  startSingle() {
    this.mode = 'single';
    this._resetWorld();
    this.wave = 0;
    this.gold = 0;
    this.kills = 0;
    this.upgradeLevels = {};
    this._nextWave();
    this.running = true;
  }

  startMulti(net, name) {
    this.mode = 'multi';
    this.net = net;
    this._resetWorld();
    this.player.name = name;
    this.player.palette = { ...this.player.palette, ...pick(PLAYER_PALETTES) };
    this.gold = 0;
    this.kills = 0;
    this.running = true;

    net.onFire = (msg) => this._remoteFire(msg);
    net.onDamage = (msg) => {
      if (msg.target === net.id && !this.player.dead) {
        this._hitShip(this.player, msg.dmg, msg.from);
      }
    };
    net.onKill = (msg) => {
      this.ui.announce(`☠ ${msg.victimName} sunk by ${msg.killerName}!`);
      if (msg.killer === net.id) this.kills++;
    };
    net.onClose = () => {
      if (this.running) {
        this.running = false;
        this.ui.showGameOver('Lost connection to the sea…', this._statsLine());
      }
    };
  }

  _resetWorld() {
    this.player = new Ship(WORLD_SIZE / 2, WORLD_SIZE / 2, 'player', pick(PLAYER_PALETTES));
    this.player.heading = -Math.PI / 2;
    this.enemies = [];
    this.balls = [];
    this.loot = [];
    this.powerups = { rapid: 0, spread: 0 };
    this.particles = new Particles();
    this.cam.x = this.player.x - this.canvas.width / 2;
    this.cam.y = this.player.y - this.canvas.height / 2;
    this.respawnTimer = 0;
    this.waveDelay = 0;

    // scatter rocky islets, keeping the centre spawn clear
    this.rocks = [];
    for (let i = 0; i < 26; i++) {
      const x = rand(250, WORLD_SIZE - 250);
      const y = rand(250, WORLD_SIZE - 250);
      if (dist(x, y, WORLD_SIZE / 2, WORLD_SIZE / 2) < 500) continue;
      this.rocks.push(new Rock(x, y, rand(35, 95)));
    }
  }

  _nextWave() {
    this.wave++;
    const spec = waveSpec(this.wave);
    for (const type of spec.ships) {
      // spawn around the player but outside sight
      const a = rand(TAU);
      const d = rand(900, 1400);
      const x = clamp(this.player.x + Math.cos(a) * d, 150, WORLD_SIZE - 150);
      const y = clamp(this.player.y + Math.sin(a) * d, 150, WORLD_SIZE - 150);
      this.enemies.push(new EnemyAI(x, y, type, spec.scale));
    }
    this.ui.announce(spec.boss ? `⚔ WAVE ${this.wave} — A GALLEON LOOMS!` : `⚔ WAVE ${this.wave}`);
    this.ui.setWave(this.wave);
  }

  // ---------------------------------------------------------- update

  update(dt) {
    if (!this.running) return;
    this.t += dt;
    this.shake = Math.max(0, this.shake - dt * 18);

    const p = this.player;

    // --- player ---
    if (!p.dead) {
      const control = this.input.getControl(p.heading);
      p.update(dt, control);
      this._keepInWorld(p);
      this._rockCollisions(p, dt);
      this.particles.wake(p);
      this.particles.damageSmoke(p);

      if (control.fire && p.reloadTimer <= 0) this._playerFire();
    } else {
      p.update(dt, { steer: 0, throttle: 0, fire: false, brace: false });
      this.respawnTimer -= dt;
      if (this.mode === 'multi' && this.respawnTimer <= 0) this._respawn();
    }

    // --- enemies (single player) ---
    if (this.mode === 'single') {
      for (const e of this.enemies) {
        const out = [];
        const control = e.update(dt, p.dead ? null : p, out);
        e.ship.update(dt, control);
        this._keepInWorld(e.ship);
        this._rockCollisions(e.ship, dt);
        this.particles.wake(e.ship);
        this.particles.damageSmoke(e.ship);
        if (out.length) {
          this.balls.push(...out);
          this.particles.muzzleFlash(out.fired.x, out.fired.y, out.fired.angle);
        }
      }
      // sweep fully-sunk wrecks
      this.enemies = this.enemies.filter((e) => !(e.ship.dead && e.ship.sinkTime > 2.5));

      // wave cleared → open shop after a beat
      if (!p.dead && this.enemies.length === 0) {
        this.waveDelay += dt;
        if (this.waveDelay > 1.2) {
          this.waveDelay = 0;
          this.ui.openShop(this);
        }
      } else {
        this.waveDelay = 0;
      }
    }

    // --- cannonballs ---
    for (const b of this.balls) {
      b.update(dt);
      if (b.dead && b.life <= 0) this.particles.splash(b.x, b.y);
    }
    this._ballHits();
    this.balls = this.balls.filter((b) => !b.dead);

    // --- loot ---
    for (const l of this.loot) {
      l.update(dt);
      if (!l.dead && !p.dead && dist(l.x, l.y, p.x, p.y) < 42) {
        this._collectLoot(l);
        l.dead = true;
      }
    }
    this.loot = this.loot.filter((l) => !l.dead);

    // powerup timers
    for (const k of Object.keys(this.powerups)) {
      this.powerups[k] = Math.max(0, this.powerups[k] - dt);
    }

    this.particles.update(dt);

    // --- camera: lead slightly in the direction of travel ---
    const lookX = p.x + p.vx * 0.4 - this.canvas.width / 2;
    const lookY = p.y + p.vy * 0.4 - this.canvas.height / 2;
    const ease = 1 - Math.exp(-3.5 * dt);
    this.cam.x = lerp(this.cam.x, lookX, ease);
    this.cam.y = lerp(this.cam.y, lookY, ease);

    // --- multiplayer sync ---
    if (this.mode === 'multi' && this.net) this.net.update(dt, p);

    this.ui.updateHUD(this);
  }

  _playerFire() {
    const p = this.player;
    // fire the side facing the nearest threat; both sides if nothing near
    const target = this._nearestEnemyTo(p.x, p.y);
    let sides;
    if (target) {
      const rel = angleDiff(p.heading, angleTo(p.x, p.y, target.x, target.y));
      sides = [rel > 0 ? 1 : -1];
    } else {
      sides = [-1, 1];
    }

    for (const side of sides) {
      const balls = p.fireBroadside(side, 'player');
      // grapeshot powerup: double the volley
      if (this.powerups.spread > 0) balls.push(...p.fireBroadside(side, 'player'));
      this.balls.push(...balls);
      const a = p.heading + side * Math.PI / 2;
      this.particles.muzzleFlash(
        p.x + Math.cos(a) * p.stats.wid * 0.6,
        p.y + Math.sin(a) * p.stats.wid * 0.6, a);
      if (this.mode === 'multi' && this.net) this.net.sendFire(side, p.x, p.y, p.heading);
    }
    if (this.powerups.rapid > 0) p.reloadTimer *= 0.45;
    this.shake = Math.max(this.shake, 2.5);
  }

  _remoteFire(msg) {
    // rebuild the remote player's volley locally so everyone sees the same shots
    const rp = this.net.players.get(msg.id);
    const ghost = new Ship(msg.x, msg.y, 'player');
    ghost.heading = msg.h;
    const balls = ghost.fireBroadside(msg.side, msg.id);
    this.balls.push(...balls);
    const a = msg.h + msg.side * Math.PI / 2;
    this.particles.muzzleFlash(msg.x + Math.cos(a) * 14, msg.y + Math.sin(a) * 14, a);
    if (rp) rp.lastFire = this.t;
  }

  _ballHits() {
    const p = this.player;
    for (const b of this.balls) {
      if (b.dead) continue;

      // vs player
      if (b.ownerId !== 'player' && b.ownerId !== this.net?.id && !p.dead &&
          dist(b.x, b.y, p.x, p.y) < p.stats.wid * 0.9) {
        b.dead = true;
        this._hitShip(p, b.damage, b.ownerId);
        continue;
      }

      // vs AI enemies
      if (b.ownerId === 'player') {
        for (const e of this.enemies) {
          const s = e.ship;
          if (s.dead || dist(b.x, b.y, s.x, s.y) > s.stats.wid * 0.95) continue;
          b.dead = true;
          const dealt = s.takeDamage(b.damage);
          this.particles.woodHit(b.x, b.y);
          if (s.dead) this._enemySunk(e);
          break;
        }
        // vs remote players: report the hit, server relays the damage
        if (!b.dead && this.mode === 'multi' && this.net) {
          for (const [id, rp] of this.net.players) {
            if (rp.dead || !rp.render) continue;
            if (dist(b.x, b.y, rp.render.x, rp.render.y) < 24) {
              b.dead = true;
              this.particles.woodHit(b.x, b.y);
              this.net.sendHit(id, this.player.stats.damage);
              break;
            }
          }
        }
      }

      // vs rocks
      if (!b.dead) {
        for (const r of this.rocks) {
          if (dist(b.x, b.y, r.x, r.y) < r.r) {
            b.dead = true;
            this.particles.splash(b.x, b.y);
            break;
          }
        }
      }
    }
  }

  _hitShip(ship, dmg, fromId) {
    const dealt = ship.takeDamage(dmg);
    this.particles.woodHit(ship.x + rand(-10, 10), ship.y + rand(-10, 10));
    if (ship === this.player) {
      this.shake = Math.max(this.shake, 5);
      if (ship.dead) this._playerSunk(fromId);
    }
    return dealt;
  }

  _enemySunk(e) {
    const s = e.ship;
    this.kills++;
    this.particles.explosion(s.x, s.y, s.type === 'galleon' ? 1.8 : 1);
    this.shake = Math.max(this.shake, 4);

    // loot scatter: gold always, powerups sometimes
    const goldDrops = s.type === 'galleon' ? 5 : s.type === 'brig' ? 3 : 2;
    for (let i = 0; i < goldDrops; i++) {
      this.loot.push(new Loot(s.x + rand(-40, 40), s.y + rand(-40, 40), 'gold', 8 + this.wave * 2));
    }
    if (Math.random() < (s.type === 'galleon' ? 0.9 : 0.25)) {
      this.loot.push(new Loot(s.x + rand(-30, 30), s.y + rand(-30, 30), pick(['repair', 'rapid', 'spread'])));
    }
  }

  _playerSunk(fromId) {
    this.particles.explosion(this.player.x, this.player.y, 1.6);
    this.shake = 8;
    if (this.mode === 'multi' && this.net) {
      this.net.sendDied(fromId);
      this.respawnTimer = 4;
      this.ui.announce('☠ Sunk! Respawning…');
    } else {
      setTimeout(() => {
        this.running = false;
        this.ui.showGameOver('Sunk to the Depths', this._statsLine());
      }, 1800);
    }
  }

  _respawn() {
    const p = this.player;
    p.dead = false;
    p.sinkTime = 0;
    p.hp = p.maxHp;
    p.x = rand(400, WORLD_SIZE - 400);
    p.y = rand(400, WORLD_SIZE - 400);
    p.vx = p.vy = 0;
    if (this.net) this.net.sendRespawn();
  }

  _collectLoot(l) {
    if (l.kind === 'gold') {
      this.gold += l.value;
      this.ui.popGold(l.value);
    } else if (l.kind === 'repair') {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 30);
      this.ui.announce('🛠 Hull patched!', 1.2);
    } else {
      this.powerups[l.kind] = 12;
      this.ui.announce(`${LOOT_KINDS[l.kind].icon} ${LOOT_KINDS[l.kind].label}!`, 1.2);
    }
  }

  _statsLine() {
    return this.mode === 'single'
      ? `You reached wave ${this.wave} · sank ${this.kills} ships · plundered 🪙 ${this.gold}`
      : `You sank ${this.kills} ships this voyage`;
  }

  _nearestEnemyTo(x, y) {
    let best = null, bd = Infinity;
    for (const e of this.enemies) {
      if (e.ship.dead) continue;
      const d = dist(x, y, e.ship.x, e.ship.y);
      if (d < bd) { bd = d; best = e.ship; }
    }
    if (this.mode === 'multi' && this.net) {
      for (const rp of this.net.players.values()) {
        if (rp.dead || !rp.render) continue;
        const d = dist(x, y, rp.render.x, rp.render.y);
        if (d < bd) { bd = d; best = rp.render; }
      }
    }
    return bd < 700 ? best : null;
  }

  _keepInWorld(ship) {
    const M = 60;
    if (ship.x < M) { ship.x = M; ship.vx = Math.abs(ship.vx) * 0.4; }
    if (ship.y < M) { ship.y = M; ship.vy = Math.abs(ship.vy) * 0.4; }
    if (ship.x > WORLD_SIZE - M) { ship.x = WORLD_SIZE - M; ship.vx = -Math.abs(ship.vx) * 0.4; }
    if (ship.y > WORLD_SIZE - M) { ship.y = WORLD_SIZE - M; ship.vy = -Math.abs(ship.vy) * 0.4; }
  }

  _rockCollisions(ship, dt) {
    for (const r of this.rocks) {
      const d = dist(ship.x, ship.y, r.x, r.y);
      const minD = r.r + ship.stats.wid * 0.8;
      if (d < minD && d > 0.001) {
        // soft push out + scrape slows you down
        const nx = (ship.x - r.x) / d, ny = (ship.y - r.y) / d;
        ship.x = r.x + nx * minD;
        ship.y = r.y + ny * minD;
        const dot = ship.vx * nx + ship.vy * ny;
        if (dot < 0) {
          ship.vx -= nx * dot * 1.5;
          ship.vy -= ny * dot * 1.5;
          if (Math.abs(dot) > 80 && !ship.dead) {
            ship.takeDamage(3);
            this.particles.woodHit(ship.x - nx * ship.stats.wid, ship.y - ny * ship.stats.wid);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------- shop

  shopItems() {
    return UPGRADES.map((u) => {
      const lvl = this.upgradeLevels[u.key] || 0;
      const cost = Math.round(u.base * Math.pow(1.5, u.repeat ? 0 : lvl));
      const maxed = u.max !== undefined && lvl >= u.max;
      return { ...u, lvl, cost, maxed, affordable: this.gold >= cost };
    });
  }

  buyUpgrade(key) {
    const u = UPGRADES.find((x) => x.key === key);
    if (!u) return false;
    const lvl = this.upgradeLevels[u.key] || 0;
    const cost = Math.round(u.base * Math.pow(1.5, u.repeat ? 0 : lvl));
    if ((u.max !== undefined && lvl >= u.max) || this.gold < cost) return false;
    this.gold -= cost;
    if (!u.repeat) this.upgradeLevels[u.key] = lvl + 1;
    u.apply(this.player);
    return true;
  }

  resumeFromShop() {
    this._nextWave();
  }

  // ---------------------------------------------------------- draw

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;

    const shakeX = this.shake > 0 ? rand(-this.shake, this.shake) : 0;
    const shakeY = this.shake > 0 ? rand(-this.shake, this.shake) : 0;
    const cam = { x: this.cam.x + shakeX, y: this.cam.y + shakeY };

    drawWater(ctx, cam, this.t, w, h);

    ctx.save();
    ctx.translate(-cam.x, -cam.y);

    const inView = (x, y, m = 160) =>
      x > cam.x - m && x < cam.x + w + m && y > cam.y - m && y < cam.y + h + m;

    for (const r of this.rocks) if (inView(r.x, r.y, r.r + 60)) r.draw(ctx, this.t);
    for (const l of this.loot) if (inView(l.x, l.y)) l.draw(ctx, this.t);

    this.particles.draw(ctx);

    // remote players
    if (this.mode === 'multi' && this.net) {
      for (const [id, rp] of this.net.players) {
        const st = this.net.remoteState(rp);
        if (!st) continue;
        if (!rp.ship) {
          rp.ship = new Ship(st.x, st.y, 'player', pick(PLAYER_PALETTES));
          rp.ship.name = rp.name;
        }
        const s = rp.ship;
        s.x = st.x; s.y = st.y; s.heading = st.h; s.sail = st.sail;
        // approximate velocity so wakes render for remote ships
        s.vx = Math.cos(st.h) * st.sail * s.stats.speed;
        s.vy = Math.sin(st.h) * st.sail * s.stats.speed;
        s.hp = rp.hp; s.dead = rp.dead;
        if (rp.dead) s.sinkTime = Math.min(s.sinkTime + 1 / 60, 2);
        else s.sinkTime = 0;
        s.bob += 1 / 60;
        rp.render = s; // hit detection uses the rendered position
        if (inView(s.x, s.y)) {
          drawShip(ctx, s, this.t);
          if (!s.dead && s.sail > 0.15) this.particles.wake(s);
        }
      }
    }

    for (const e of this.enemies) if (inView(e.ship.x, e.ship.y)) drawShip(ctx, e.ship, this.t);
    drawShip(ctx, this.player, this.t);

    for (const b of this.balls) if (inView(b.x, b.y)) b.draw(ctx);

    ctx.restore();

    drawWorldEdge(ctx, cam, WORLD_SIZE, w, h);
    this._drawMinimap(ctx, w, h);
    this.input.drawJoystick(ctx);
  }

  _drawMinimap(ctx, w, h) {
    const R = 52;
    const cx = w - R - 14, cy = R + 14;
    const scale = (R * 2) / WORLD_SIZE;

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(5, 30, 50, 0.75)';
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.clip();

    const dot = (x, y, color, size = 2.5) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx - R + x * scale, cy - R + y * scale, size, 0, TAU);
      ctx.fill();
    };

    for (const r of this.rocks) dot(r.x, r.y, '#5d6d7e', Math.max(1.5, r.r * scale));
    for (const l of this.loot) dot(l.x, l.y, '#ffd166', 1.8);
    for (const e of this.enemies) if (!e.ship.dead) dot(e.ship.x, e.ship.y, '#ff4d4d', e.ship.type === 'galleon' ? 4 : 2.5);
    if (this.mode === 'multi' && this.net) {
      for (const rp of this.net.players.values()) {
        if (rp.render && !rp.dead) dot(rp.render.x, rp.render.y, '#ff4d4d', 3);
      }
    }
    if (!this.player.dead) dot(this.player.x, this.player.y, '#2ed573', 3.5);

    ctx.restore();
  }
}
