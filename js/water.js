// Sea Raiders — animated procedural ocean, tilted-camera version (MIT)
import { hash2 } from './utils.js';
import { TILT_C } from './render3d.js';

const CELL = 96; // wave-glint grid size in world px

/**
 * Draws the sea under the tilted camera: depth gradient, slow rolling swell
 * bands, and a grid of low-poly wave glints anchored in world space so the
 * water visibly streams past as you sail.
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

  // world-anchored wave glints — small foreshortened triangles for the poly look
  const viewH = h / TILT_C;
  const x0 = Math.floor(cam.x / CELL) - 1;
  const y0 = Math.floor(cam.y / CELL) - 1;
  const nx = Math.ceil(w / CELL) + 2;
  const ny = Math.ceil(viewH / CELL) + 2;

  ctx.save();
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
      const wy = ((gy + 0.15 + r2 * 0.7) * CELL - cam.y) * TILT_C;
      const len = (14 + r * 26) / 2;
      const bobZ = Math.sin(phase * 0.7) * 2.5;

      ctx.fillStyle = `rgba(191,232,255,${pulse * 0.3})`;
      ctx.beginPath();
      ctx.moveTo(wx - len, wy + bobZ);
      ctx.lineTo(wx + len, wy + bobZ);
      ctx.lineTo(wx + len * 0.2, wy + bobZ - 3 - r * 3);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}
