/** An analog input clamped to the axis, or `null` when not finite: a NaN read as 0 would cut the engine. */
export function analogValue(
  p: { kind: string; value: unknown },
  lo: number,
  hi: number,
): number | null {
  if (p.kind !== "analog") return null;
  if (typeof p.value !== "number" || !Number.isFinite(p.value)) return null;
  return clamp(p.value, lo, hi);
}

export function isButtonPress(p: { kind: string; value: unknown }): boolean {
  return p.kind === "button" && p.value === true;
}

export function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
