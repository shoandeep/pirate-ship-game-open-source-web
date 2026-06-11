// Sea Raiders — enemy captain AI (MIT)
import { clamp, dist, angleTo, angleDiff, rand, pick } from './utils.js';
import { Ship } from './entities.js';

const ENEMY_PALETTES = [
  { hull: '#4a3b2a', hullDark: '#2e2418', deck: '#6e5840', sail: '#cfc4ad', flag: '#2c3e50' },
  { hull: '#52302e', hullDark: '#331c1b', deck: '#7a4a45', sail: '#d9c8b8', flag: '#111111' },
  { hull: '#3e4a3a', hullDark: '#272f24', deck: '#5e6e57', sail: '#c9d2bd', flag: '#6c3483' },
];

/**
 * State machine captain: patrols until it spots you, then closes in,
 * turns to present a broadside, and pounds away. Damaged sloops may
 * break off and run.
 */
export class EnemyAI {
  constructor(x, y, type, waveScale = 1) {
    this.ship = new Ship(x, y, type, pick(ENEMY_PALETTES));
    // waves make pirates meaner: more hull, faster reloads, harder hits
    this.ship.maxHp = this.ship.hp = Math.round(this.ship.hp * waveScale);
    this.ship.stats.damage = Math.round(this.ship.stats.damage * (0.8 + waveScale * 0.2));
    this.ship.stats.reload /= 0.85 + waveScale * 0.15;

    this.state = 'patrol';
    this.wanderAngle = rand(Math.PI * 2);
    this.wanderTimer = 0;
    this.fleeing = false;

    this.sightRange = 620;
    this.broadsideRange = this.ship.stats.range * 0.8;
  }

  /** returns a control object for the ship + may push cannonballs into `out` */
  update(dt, player, out) {
    const s = this.ship;
    const control = { steer: 0, throttle: 0.6, fire: false, brace: false };
    if (s.dead || !player || player.dead) {
      control.throttle = 0;
      return control;
    }

    const d = dist(s.x, s.y, player.x, player.y);
    const toPlayer = angleTo(s.x, s.y, player.x, player.y);

    // panic check — light ships cut and run below 25% hull
    if (!this.fleeing && s.type === 'sloop' && s.hp / s.maxHp < 0.25 && Math.random() < 0.5) {
      this.fleeing = true;
    }

    if (this.fleeing) {
      this.state = 'flee';
    } else if (d < this.sightRange) {
      this.state = d < this.broadsideRange ? 'broadside' : 'chase';
    } else {
      this.state = 'patrol';
    }

    let want = s.heading;
    switch (this.state) {
      case 'patrol':
        this.wanderTimer -= dt;
        if (this.wanderTimer <= 0) {
          this.wanderTimer = rand(2, 5);
          this.wanderAngle += rand(-1.2, 1.2);
        }
        want = this.wanderAngle;
        control.throttle = 0.45;
        break;

      case 'chase':
        want = toPlayer;
        control.throttle = 1;
        break;

      case 'broadside': {
        // sail perpendicular to the player so the guns bear; pick the closer parallel
        const a = toPlayer + Math.PI / 2;
        const b = toPlayer - Math.PI / 2;
        want = Math.abs(angleDiff(s.heading, a)) < Math.abs(angleDiff(s.heading, b)) ? a : b;
        // drift in/out to hold ideal gun range
        const ideal = this.broadsideRange * 0.7;
        want += clamp((d - ideal) / 220, -0.5, 0.5) * Math.sign(angleDiff(want, toPlayer) || 1) * -1;
        control.throttle = 0.75;

        // fire whichever side faces the player, with a little aim wobble
        if (s.reloadTimer <= 0 && d < s.stats.range) {
          const rel = angleDiff(s.heading, toPlayer);
          if (Math.abs(Math.abs(rel) - Math.PI / 2) < 0.55) {
            const side = rel > 0 ? 1 : -1;
            out.push(...s.fireBroadside(side, 'enemy'));
            out.fired = { x: s.x, y: s.y, angle: s.heading + side * Math.PI / 2 };
          }
        }
        break;
      }

      case 'flee':
        want = toPlayer + Math.PI;
        control.throttle = 1;
        break;
    }

    control.steer = clamp(angleDiff(s.heading, want) * 2.5, -1, 1);
    return control;
  }
}

/** wave composition: which pirates show up as the game escalates */
export function waveSpec(wave) {
  const ships = [];
  const boss = wave % 5 === 0;
  const budget = 2 + wave;

  let left = budget;
  if (boss) {
    ships.push('galleon');
    left -= 4;
  }
  while (left > 0) {
    if (left >= 3 && wave >= 4 && Math.random() < 0.4) { ships.push('brig'); left -= 2; }
    else { ships.push('sloop'); left -= 1; }
  }
  return { ships, scale: 1 + wave * 0.08, boss };
}
