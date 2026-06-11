// Sea Raiders — math & helper utilities (MIT)

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
export const angleTo = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);

/** smallest signed difference between two angles, in (-PI, PI] */
export function angleDiff(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/** deterministic pseudo-random in [0,1) from two ints — used for stable wave glints */
export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
