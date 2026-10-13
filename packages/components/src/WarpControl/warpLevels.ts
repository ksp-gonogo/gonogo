import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";

/**
 * KSP HIGH-warp ladder: labels match the in-game tooltip, indices are what
 * `time.setWarpIndex` takes while the game is in high warp.
 */
export const HIGH_LEVELS: ReadonlyArray<{ index: number; label: string }> = [
  { index: 0, label: "1×" },
  { index: 1, label: "5×" },
  { index: 2, label: "10×" },
  { index: 3, label: "50×" },
  { index: 4, label: "100×" },
  { index: 5, label: "1k×" },
  { index: 6, label: "10k×" },
  { index: 7, label: "100k×" },
];

/** KSP physics-warp ladder: the same index space as `HIGH_LEVELS`, but a different rate behind each index, and only four of them. */
export const PHYSICS_LEVELS: ReadonlyArray<{ index: number; label: string }> = [
  { index: 0, label: "1×" },
  { index: 1, label: "2×" },
  { index: 2, label: "3×" },
  { index: 3, label: "4×" },
];

/** The ladder the published warp index addresses: the physics one while the mode caption reads "Physics". */
export function ladderFor(
  mode: string | null,
): ReadonlyArray<{ index: number; label: string }> {
  return mode === "Physics" ? PHYSICS_LEVELS : HIGH_LEVELS;
}

/** The highest index on the ladder the mode addresses. */
export function topWarpIndex(mode: string | null): number {
  return ladderFor(mode).length - 1;
}

/** The ladder label for a warp index, or the bare index off the ladder. */
export function warpLabel(index: number, mode: string | null): string {
  return ladderFor(mode)[index]?.label ?? `${index}`;
}

/**
 * Maps the numeric `warpMode` (0 High, 1 Low, 2 Unknown) to the caption text.
 * Low is surfaced as "Physics"; Unknown or absent gives no caption and the
 * high tone.
 */
export function normalizeWarpMode(raw: number | undefined): string | null {
  if (raw === 0) return "High";
  if (raw === 1) return "Physics";
  return null;
}

export function formatRate(rate: number | null): string {
  if (rate === null) return NULL_DISPLAY;
  if (rate < 1.0001) return "1×";
  if (rate >= 1000) return `${(rate / 1000).toFixed(rate >= 10_000 ? 0 : 1)}k×`;
  if (Number.isInteger(rate)) return `${rate}×`;
  return `${rate.toFixed(2)}×`;
}
