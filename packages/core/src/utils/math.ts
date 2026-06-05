export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Like clamp(), but returns `min` for non-finite inputs (NaN, ±Infinity).
 *  Use this when a graceful zero/baseline is preferable to NaN propagation —
 *  e.g. UI percentages that must render even with bad input. */
export function clampSafe(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return clamp(value, min, max);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
