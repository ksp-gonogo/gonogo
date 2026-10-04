import { gridToPixels } from "@ksp-gonogo/ui-kit";

/** The tile a scene mounts at: a mode's own size, with each dimension a control has set laid over it. */
export function resolveTile<Tile extends { w: number; h: number }>(
  chosen: Tile,
  w: number | undefined,
  h: number | undefined,
): Tile {
  if (w === undefined && h === undefined) return chosen;
  // Per dimension: a control moved on its own still resizes, the other staying at the mode's size.
  const width = w ?? chosen.w;
  const height = h ?? chosen.h;
  return { ...chosen, w: width, h: height, ...gridToPixels(width, height) };
}
