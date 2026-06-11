// Sea Raiders — animated procedural ocean (MIT)
import { hash2 } from './utils.js';

const CELL = 96; // wave-glint grid size in world px

/**
 * Draws the sea: depth gradient, slow rolling swell bands, and a grid of
 * twinkling wave glints anchored in world space so the water visibly
 * streams past as you sail.
 */
export function drawWater(ctx, cam, t, w, h) {
  // base depth gradient
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#1567a0');
  g.addColorStop(0.55, '#0f5586');
  g.addColorStop(1, '#0a3d62');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // large slow swell bands (subtle diagonal brightness waves)
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#9fd8ff';
  const band = 260;
  const off = ((cam.x * 0.4 + cam.y * 0.25 + t * 30) % band + band) % band;
  ctx.translate(-off, 0);
  ctx.rotate(-0.18);
  for (let x = -band * 2; x < w + h; x += band) {
    ctx.fillRect(x, -h, band * 0.4, h * 3);
  }
  ctx.restore();

  // world-anchored wave glints
  const x0 = Math.floor(cam.x / CELL) - 1;
  const y0 = Math.floor(cam.y / CELL) - 1;
  const nx = Math.ceil(w / CELL) + 2;
  const ny = Math.ceil(h / CELL) + 2;

  ctx.save();
  ctx.lineCap = 'round';
  for (let gy = y0; gy < y0 + ny; gy++) {
    for (let gx = x0; gx < x0 + nx; gx++) {
      const r = hash2(gx, gy);
      const r2 = hash2(gx + 911, gy + 313);
      // each glint pulses on its own phase; skip ~35% of cells for irregularity
      if (r > 0.65) continue;
      const phase = t * (0.6 + r2 * 0.8) + r * 12;
      const pulse = Math.sin(phase);
      if (pulse < 0.1) continue;

      const wx = (gx + 0.15 + r * 0.7) * CELL - cam.x;
      const wy = (gy + 0.15 + r2 * 0.7) * CELL - cam.y;
      const len = 14 + r * 26;
      const bob = Math.sin(phase * 0.7) * 3;

      ctx.globalAlpha = pulse * 0.35;
      ctx.strokeStyle = '#bfe8ff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(wx - len / 2, wy + bob);
      ctx.quadraticCurveTo(wx, wy + bob - 4, wx + len / 2, wy + bob);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** soft vignette + world boundary warning haze */
export function drawWorldEdge(ctx, cam, worldSize, w, h) {
  const FADE = 320;
  ctx.save();
  ctx.fillStyle = 'rgba(4, 20, 34, 0.55)';
  // left / top / right / bottom hazes where the map ends
  const edges = [
    { vis: -cam.x, rect: () => ctx.fillRect(0, 0, -cam.x, h) },
    { vis: -cam.y, rect: () => ctx.fillRect(0, 0, w, -cam.y) },
    { vis: cam.x + w - worldSize, rect: () => ctx.fillRect(worldSize - cam.x, 0, cam.x + w - worldSize, h) },
    { vis: cam.y + h - worldSize, rect: () => ctx.fillRect(0, worldSize - cam.y, w, cam.y + h - worldSize) },
  ];
  for (const e of edges) if (e.vis > -FADE) e.rect();
  ctx.restore();
}
