// Sea Raiders — low-poly fake-3D renderer (MIT)
//
// A tiny flat-shaded polygon engine on Canvas 2D. The camera looks down at
// the sea from an angle: world (x, y) is the sea plane, z points up.
//
//   screenX = wx - cam.x
//   screenY = (wy - cam.y) * TILT_C - z * TILT_S
//
// Faces are 3D polygons, lit by a fixed sun and painter-sorted by view depth
// (y * TILT_S + z * TILT_C — larger means nearer the camera, drawn last).

import { TAU, clamp, rand, hash2 } from './utils.js';

export const TILT_C = 0.75; // y foreshortening (camera tilt)
export const TILT_S = 0.66; // z lift on screen

const LIGHT = normalize([-0.45, -0.5, 0.74]);
const TOWARD_CAM = [0, -TILT_S, TILT_C];

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function project(p, cam) {
  return [p[0] - cam.x, (p[1] - cam.y) * TILT_C - p[2] * TILT_S];
}

const hexCache = new Map();
export function hexToRgb(hex) {
  let c = hexCache.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    hexCache.set(hex, c);
  }
  return c;
}

/** face: { pts: [[x,y,z],...], rgb: [r,g,b], alpha?, flat? (skip lighting) } */
export function drawFaces(ctx, faces, cam) {
  for (const f of faces) {
    let y = 0, z = 0;
    for (const p of f.pts) { y += p[1]; z += p[2]; }
    const n = f.pts.length;
    f._depth = (y / n) * TILT_S + (z / n) * TILT_C;
  }
  faces.sort((a, b) => a._depth - b._depth);

  for (const f of faces) {
    const pts = f.pts;
    let bright = 1;
    if (!f.flat) {
      // Newell normal, flipped to face the camera, lit by the sun
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      if (nx * TOWARD_CAM[0] + ny * TOWARD_CAM[1] + nz * TOWARD_CAM[2] < 0) {
        nx = -nx; ny = -ny; nz = -nz;
      }
      bright = 0.55 + 0.45 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    }
    const [r, g, b] = f.rgb;
    const col = `rgba(${(r * bright) | 0},${(g * bright) | 0},${(b * bright) | 0},${f.alpha ?? 1})`;
    ctx.fillStyle = col;
    ctx.strokeStyle = col; // seal anti-aliasing seams between facets
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [sx, sy] = project(pts[0], cam);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < pts.length; i++) {
      const [px, py] = project(pts[i], cam);
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/** flattened ellipse on the water plane (shadows, foam, glows) */
export function waterEllipse(ctx, cam, x, y, rx, color, ryScale = 1) {
  const [sx, sy] = project([x, y, 0], cam);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, rx * TILT_C * ryScale, 0, 0, TAU);
  ctx.fill();
}

// ============================================================ ship

export function drawShip3D(ctx, s, t, cam) {
  const sink = s.dead ? clamp(s.sinkTime / 2.2, 0, 1) : 0;
  if (sink >= 1) return;

  const { len, wid } = s.stats;
  const L = len / 2, W = wid / 2;
  const Hd = wid * 0.42;                       // deck height above water
  const scale = 1 - sink * 0.3;
  const roll = sink * 0.8;
  const drop = sink * Hd * 1.6;
  const cos = Math.cos(s.heading), sin = Math.sin(s.heading);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const bob = Math.sin(s.bob * 1.7) * 1.2;

  // local (lx fore/aft, ly port/stbd, lz up) -> world, with sinking roll
  const pt = (lx, ly, lz) => {
    lx *= scale; ly *= scale; lz *= scale;
    const ry = ly * cr - lz * sr;
    const rz = ly * sr + lz * cr - drop;
    return [s.x + lx * cos - ry * sin, s.y + lx * sin + ry * cos + bob * 0.3, rz];
  };

  const p = s.palette;
  const hull = s.flash > 0.5 ? [255, 255, 255] : hexToRgb(p.hull);
  const hullD = hexToRgb(p.hullDark);
  const deck = s.flash > 0.5 ? [255, 255, 255] : hexToRgb(p.deck);
  const sailC = hexToRgb(p.sail);
  const flagC = hexToRgb(p.flag);
  const alpha = 1 - sink;

  // hull shadow on the water
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(...project([s.x, s.y, 0], cam));
  ctx.rotate(Math.atan2(sin * TILT_C, cos));
  ctx.fillStyle = 'rgba(0,18,32,0.3)';
  ctx.beginPath();
  ctx.ellipse(2, 3, L * 1.05, W * 1.2 * TILT_C, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  const faces = [];
  const F = (pts, rgb, opt = {}) => faces.push({ pts, rgb, alpha, ...opt });

  // deck outline (z = Hd) and keel outline (z = 0, pinched inward)
  const ring = [
    [L, 0], [L * 0.45, -W], [-L * 0.62, -W], [-L * 0.95, -W * 0.6],
    [-L * 0.95, W * 0.6], [-L * 0.62, W], [L * 0.45, W],
  ];
  const top = ring.map(([x, y]) => pt(x, y, Hd));
  const bot = ring.map(([x, y]) => pt(x * 0.97, y * 0.35, 0));

  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    F([top[i], top[j], bot[j], bot[i]], hull);
  }
  F(top, deck);

  // raised quarterdeck at the stern
  {
    const x0 = -L * 0.9, x1 = -L * 0.38, yw = W * 0.62, z1 = Hd + wid * 0.16;
    const q = [
      pt(x1, -yw, Hd), pt(x0, -yw, Hd), pt(x0, yw, Hd), pt(x1, yw, Hd),
      pt(x1, -yw, z1), pt(x0, -yw, z1), pt(x0, yw, z1), pt(x1, yw, z1),
    ];
    F([q[4], q[5], q[6], q[7]], hullD);              // top
    F([q[0], q[1], q[5], q[4]], hull);               // starboard
    F([q[3], q[2], q[6], q[7]], hull);               // port
    F([q[0], q[4], q[7], q[3]], hull);               // front
  }

  // bowsprit
  F([pt(L * 0.92, -1.2, Hd), pt(L * 1.45, 0, Hd + 3), pt(L * 0.92, 1.2, Hd)], hullD);

  // gun ports along both sides
  const nC = s.stats.cannons;
  for (let i = 0; i < nC; i++) {
    const cx = (i - (nC - 1) / 2) * (L * 1.0 / Math.max(1, nC - 1) || 0);
    for (const side of [-1, 1]) {
      const yy = side * W * 1.02, z = Hd * 0.55;
      F([pt(cx - 2.6, yy, z - 2.2), pt(cx + 2.6, yy, z - 2.2),
         pt(cx + 2.6, yy, z + 2.2), pt(cx - 2.6, yy, z + 2.2)], [25, 25, 25]);
    }
  }

  // masts, square sails, flag
  const mastTop = Hd + wid * 1.55;
  const masts = len > 80 ? [-L * 0.45, 0, L * 0.42] : len > 56 ? [-L * 0.33, L * 0.36] : [0];
  const billow = (0.25 + s.sail * 0.75) * W * 0.7;
  const flutter = Math.sin(t * 6 + s.wakePhase) * (1 - s.sail) * 2;

  for (const mx of masts) {
    // mast: two thin crossed quads read as a pole from any angle
    F([pt(mx - 0.9, 0, Hd), pt(mx + 0.9, 0, Hd), pt(mx + 0.9, 0, mastTop), pt(mx - 0.9, 0, mastTop)], hullD);
    F([pt(mx, -0.9, Hd), pt(mx, 0.9, Hd), pt(mx, 0.9, mastTop), pt(mx, -0.9, mastTop)], hullD);

    // sail: vertical quad split into 4 triangles around a bellied centre
    const sw = W * 1.3, zb = Hd + wid * 0.4, zt = mastTop - wid * 0.12;
    const c1 = pt(mx, -sw, zb), c2 = pt(mx, sw, zb), c3 = pt(mx, sw, zt), c4 = pt(mx, -sw, zt);
    const mid = pt(mx + billow + flutter, 0, (zb + zt) / 2);
    F([c1, c2, mid], sailC);
    F([c2, c3, mid], sailC);
    F([c3, c4, mid], sailC);
    F([c4, c1, mid], sailC);
  }

  // flag streaming aft from the tallest mast
  {
    const fx = masts[masts.length - 1];
    const wave = Math.sin(t * 8 + s.wakePhase) * 2.5;
    F([pt(fx, 0, mastTop + 5), pt(fx - 13, wave, mastTop + 2.5), pt(fx, 0, mastTop)], flagC, { flat: true });
  }

  drawFaces(ctx, faces, cam);

  // brace shield — flattened ring on the water
  if (s.braced && !s.dead) {
    const [sx, sy] = project([s.x, s.y, 0], cam);
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(t * 10) * 0.18;
    ctx.strokeStyle = '#7ed6ff';
    ctx.lineWidth = 3.5;
    ctx.setLineDash([10, 7]);
    ctx.lineDashOffset = -t * 40;
    ctx.beginPath();
    ctx.ellipse(sx, sy, len * 0.72, len * 0.72 * TILT_C, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // floating UI: detection alert, health bar, name — anchored above the mast
  const [ux, uy] = project([s.x, s.y, mastTop + 10], cam);

  if (s.alert > 0 && !s.dead) {
    ctx.save();
    ctx.font = `bold ${22 + Math.sin(t * 14) * 3}px Trebuchet MS`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff4d4d';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    ctx.strokeText('!', ux, uy - 14);
    ctx.fillText('!', ux, uy - 14);
    ctx.restore();
  }

  if (!s.dead && (s.hp < s.maxHp || s.name)) {
    const bw = 46;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(ux - bw / 2, uy, bw, 5);
    ctx.fillStyle = s.hp / s.maxHp > 0.35 ? '#2ed573' : '#e84118';
    ctx.fillRect(ux - bw / 2, uy, bw * (s.hp / s.maxHp), 5);
    if (s.name) {
      ctx.fillStyle = '#f5e9d0';
      ctx.font = 'bold 12px Trebuchet MS';
      ctx.textAlign = 'center';
      ctx.fillText(s.name, ux, uy - 4);
    }
  }
}

// ============================================================ rocks

export function drawRock3D(ctx, rock, t, cam) {
  if (!rock._mesh) {
    // faceted crag: jagged base ring rising to an offset apex
    const n = 8;
    const base = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const d = rock.r * rand(0.72, 1.08);
      base.push([rock.x + Math.cos(a) * d, rock.y + Math.sin(a) * d, 0]);
    }
    const apex = [rock.x + rand(-0.3, 0.3) * rock.r, rock.y + rand(-0.3, 0.3) * rock.r, rock.r * rand(0.55, 0.9)];
    const faces = [];
    for (let i = 0; i < n; i++) {
      faces.push({ pts: [base[i], base[(i + 1) % n], apex], rgb: [93, 109, 126] });
    }
    rock._mesh = faces;
  }

  // foam lapping at the base
  const [sx, sy] = project([rock.x, rock.y, 0], cam);
  ctx.strokeStyle = 'rgba(220,240,255,0.35)';
  ctx.lineWidth = 5 + Math.sin(t * 2 + rock.x) * 2;
  ctx.beginPath();
  ctx.ellipse(sx, sy, rock.r + 6, (rock.r + 6) * TILT_C, 0, 0, TAU);
  ctx.stroke();

  drawFaces(ctx, rock._mesh, cam);
}

// ============================================================ loot & barrels

const GEM_COLORS = { repair: [46, 213, 115], rapid: [126, 214, 255], spread: [255, 159, 67] };

export function drawLoot3D(ctx, l, t, cam) {
  const lift = Math.sin(l.bob) * 2;
  const fade = l.age > 21 ? Math.max(0, 1 - (l.age - 21) / 4) : 1;

  if (l.kind === 'gold') {
    // bobbing wooden crate
    const r = 8, z0 = lift, z1 = 10 + lift;
    const a = Math.sin(l.bob * 0.7) * 0.3;
    const ca = Math.cos(a), sa = Math.sin(a);
    const c = (dx, dy, z) => [l.x + dx * ca - dy * sa, l.y + dx * sa + dy * ca, z];
    const faces = [];
    const corners = [[-r, -r], [r, -r], [r, r], [-r, r]];
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = corners[i], [x2, y2] = corners[(i + 1) % 4];
      faces.push({ pts: [c(x1, y1, z0), c(x2, y2, z0), c(x2, y2, z1), c(x1, y1, z1)], rgb: [122, 82, 48], alpha: fade });
    }
    faces.push({ pts: corners.map(([x, y]) => c(x, y, z1)), rgb: [156, 112, 68], alpha: fade });
    // gold glint peeking out the top
    faces.push({ pts: [c(-3, -3, z1 + 0.5), c(4, -1, z1 + 0.5), c(0, 4, z1 + 0.5)], rgb: [255, 209, 102], alpha: fade, flat: true });
    waterEllipse(ctx, cam, l.x, l.y, r + 3, `rgba(0,18,32,${0.22 * fade})`);
    drawFaces(ctx, faces, cam);
  } else {
    // spinning low-poly gem powerup
    const rgb = GEM_COLORS[l.kind] || [255, 209, 102];
    waterEllipse(ctx, cam, l.x, l.y, 15, `rgba(${rgb},${(0.25 + Math.sin(t * 5 + l.bob) * 0.12) * fade})`);
    const z = 9 + lift, h = 8;
    const faces = [];
    const ringR = 7, a0 = t * 1.8 + l.bob;
    const ring = [];
    for (let i = 0; i < 4; i++) {
      const a = a0 + (i / 4) * TAU;
      ring.push([l.x + Math.cos(a) * ringR, l.y + Math.sin(a) * ringR, z]);
    }
    const topP = [l.x, l.y, z + h], botP = [l.x, l.y, z - h * 0.7];
    for (let i = 0; i < 4; i++) {
      faces.push({ pts: [ring[i], ring[(i + 1) % 4], topP], rgb, alpha: fade });
      faces.push({ pts: [ring[i], ring[(i + 1) % 4], botP], rgb, alpha: fade });
    }
    drawFaces(ctx, faces, cam);
  }
}

export function drawBarrel3D(ctx, b, t, cam) {
  const lift = Math.sin(b.bob) * 1.5;
  const n = 8, r = 9, z0 = lift, z1 = 14 + lift;
  const faces = [];
  const ring = (rad, z) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.39;
      pts.push([b.x + Math.cos(a) * rad, b.y + Math.sin(a) * rad, z]);
    }
    return pts;
  };
  const lo = ring(r, z0), m1 = ring(r * 1.06, z0 + 5), m2 = ring(r * 1.06, z0 + 9), hi = ring(r, z1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push({ pts: [lo[i], lo[j], m1[j], m1[i]], rgb: [110, 76, 43] });
    faces.push({ pts: [m1[i], m1[j], m2[j], m2[i]], rgb: [190, 60, 50] }); // warning band
    faces.push({ pts: [m2[i], m2[j], hi[j], hi[i]], rgb: [110, 76, 43] });
  }
  faces.push({ pts: hi, rgb: [80, 55, 30] });
  // fuse spark hint
  faces.push({ pts: [[b.x - 2, b.y, z1 + 3], [b.x + 2, b.y, z1 + 3], [b.x, b.y, z1 + 7]],
               rgb: b.fuse > 0 ? [255, 230, 120] : [40, 40, 40], flat: true });
  waterEllipse(ctx, cam, b.x, b.y, r + 4, 'rgba(0,18,32,0.25)');
  drawFaces(ctx, faces, cam);
}

// ============================================================ cannonballs

export function drawBall3D(ctx, ball, cam) {
  const prog = 1 - ball.life / ball.maxLife;
  const z = Math.sin(prog * Math.PI) * 22;
  waterEllipse(ctx, cam, ball.x, ball.y, 3.5, 'rgba(0,18,32,0.35)');
  const [sx, sy] = project([ball.x, ball.y, z], cam);
  ctx.fillStyle = '#1d1d1d';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + prog * 4;
    i === 0 ? ctx.moveTo(sx + Math.cos(a) * 4.5, sy + Math.sin(a) * 4.5)
            : ctx.lineTo(sx + Math.cos(a) * 4.5, sy + Math.sin(a) * 4.5);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(sx - 2, sy - 2, 2, 2);
}

// ============================================================ particles

/**
 * layer 'low' = on the water (wakes, foam) drawn under entities;
 * layer 'high' = airborne (smoke, debris, spray) drawn over them.
 */
export function drawParticles(ctx, list, cam, layer) {
  for (const p of list) {
    const airborne = p.z > 0.5;
    if (layer === 'low' && airborne) continue;
    if (layer === 'high' && !airborne) continue;
    const [sx, sy] = project([p.x, p.y, p.z], cam);
    ctx.fillStyle = `rgba(${p.color},${(p.life / p.maxLife) * p.alpha})`;
    ctx.beginPath();
    ctx.arc(sx, sy, p.size, 0, TAU);
    ctx.fill();
  }
}

// ============================================================ cloud border

const cloudCache = new Map();

function buildClouds(worldSize) {
  const clouds = [];
  const step = 270;
  const lay = (x, y, seed, dirX, dirY) => clouds.push({ x, y, seed, dirX, dirY });
  for (let d = 0, i = 0; d <= worldSize; d += step, i++) {
    lay(d, -40 - hash2(i, 1) * 60, hash2(i, 11), 1, 0);                       // top
    lay(d, worldSize + 40 + hash2(i, 2) * 60, hash2(i, 12), 1, 0);            // bottom
    lay(-40 - hash2(i, 3) * 60, d, hash2(i, 13), 0, 1);                       // left
    lay(worldSize + 40 + hash2(i, 4) * 60, d, hash2(i, 14), 0, 1);            // right
  }
  return clouds;
}

/** the world ends in a wall of drifting low-poly clouds instead of a hard border */
export function drawCloudBorder(ctx, cam, t, w, h, worldSize) {
  const FOG = 230;
  const viewH = h / TILT_C;

  // soft white mist creeping in from each edge
  const mist = (x0, y0, x1, y1, horizontal) => {
    const g = horizontal
      ? ctx.createLinearGradient(0, y0, 0, y1)
      : ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, 'rgba(232,240,248,0.75)');
    g.addColorStop(1, 'rgba(232,240,248,0)');
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || w, Math.abs(y1 - y0) || h);
  };
  if (cam.x < FOG) mist(-cam.x, 0, -cam.x + FOG, h, false), ctx.fillRect(0, 0, Math.max(0, -cam.x), h);
  if (cam.x + w > worldSize - FOG) mist(worldSize - cam.x, 0, worldSize - cam.x - FOG, h, false);
  const topSy = (0 - cam.y) * TILT_C, botSy = (worldSize - cam.y) * TILT_C;
  if (topSy > -FOG * TILT_C) mist(0, topSy, 0, topSy + FOG * TILT_C, true);
  if (botSy < h + FOG * TILT_C) mist(0, botSy, 0, botSy - FOG * TILT_C, true);

  // the clouds themselves
  let clouds = cloudCache.get(worldSize);
  if (!clouds) { clouds = buildClouds(worldSize); cloudCache.set(worldSize, clouds); }

  for (const c of clouds) {
    const drift = Math.sin(t * 0.07 + c.seed * 9) * 45;
    const cx = c.x + c.dirX * drift;
    const cy = c.y + c.dirY * drift;
    if (cx < cam.x - 200 || cx > cam.x + w + 200) continue;
    if (cy < cam.y - 250 || cy > cam.y + viewH + 250) continue;

    // 3 stacked puffs per cloud, each a wobbly low-poly ring
    for (let k = 0; k < 3; k++) {
      const pr = (55 + c.seed * 55) * (1 - k * 0.22);
      const ox = (hash2((c.seed * 97) | 0, k) - 0.5) * pr * 1.3;
      const oy = (hash2((c.seed * 53) | 0, k + 5) - 0.5) * pr * 0.8;
      const z = 60 + k * 22;
      const [sx, sy] = project([cx + ox, cy + oy, z], cam);
      const shade = 222 + k * 11;
      ctx.fillStyle = `rgba(${shade},${shade + 6},${Math.min(255, shade + 14)},0.93)`;
      ctx.beginPath();
      const sides = 9;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * TAU;
        const rr = pr * (0.72 + hash2((c.seed * 31) | 0 + i, k) * 0.36 + Math.sin(t * 0.8 + i * 2 + c.seed * 6) * 0.04);
        const px = sx + Math.cos(a) * rr;
        const py = sy + Math.sin(a) * rr * 0.55;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}

// ============================================================ gulls

export class Gulls {
  constructor(count = 4) {
    this.birds = [];
    for (let i = 0; i < count; i++) {
      this.birds.push({ x: rand(4200), y: rand(4200), a: rand(TAU), flap: rand(TAU), turn: 0 });
    }
  }

  update(dt, px, py) {
    for (const b of this.birds) {
      b.flap += dt * 9;
      b.turn += rand(-2, 2) * dt;
      b.turn = clamp(b.turn, -1, 1);
      b.a += b.turn * dt;
      b.x += Math.cos(b.a) * 70 * dt;
      b.y += Math.sin(b.a) * 70 * dt;
      // keep the flock loosely near the player so the sky never feels empty
      if (Math.hypot(b.x - px, b.y - py) > 1300) {
        const back = Math.atan2(py - b.y, px - b.x);
        b.a = back + rand(-0.5, 0.5);
      }
    }
  }

  draw(ctx, cam, w, h) {
    for (const b of this.birds) {
      const [sx, sy] = project([b.x, b.y, 85], cam);
      if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;
      waterEllipse(ctx, cam, b.x, b.y, 5, 'rgba(0,18,32,0.12)');
      const f = Math.sin(b.flap) * 4;
      ctx.strokeStyle = 'rgba(245,248,252,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - 7, sy - f);
      ctx.quadraticCurveTo(sx, sy + 3, sx, sy);
      ctx.quadraticCurveTo(sx, sy + 3, sx + 7, sy - f);
      ctx.stroke();
    }
  }
}
