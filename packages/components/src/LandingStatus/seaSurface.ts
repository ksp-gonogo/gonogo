import type { PlotLayer, PlotPoint } from "@ksp-gonogo/sitrep-sdk";

/**
 * Small wave strokes on open water, so a sea reads as liquid rather than as a flat plain, in the water's own tone and thinner than any line the plots draw for data, so they are never taken for relief.
 *
 * They are fixed to the body's surface, not to the window: each stroke stands on a lattice in metres measured from the body's own origin, so as the window follows the craft the waves slide past with the ground under it. Nothing animates.
 *
 * The lattice spacing is a power of two metres chosen from the window's width, so the count across stays about the same at every zoom. The lattices nest, so zooming in only adds strokes between the ones already drawn and never moves one. Seen from above every other row is set half a step along, and a share of the points is left bare by where it stands, so the water does not read as a printed grid.
 */

/** About how many strokes stand across the window. */
const STROKES_ACROSS = 5;
/** Seen from above, fewer: a field of them fills the whole window. */
const STROKES_ACROSS_FROM_ABOVE = 4;
/** The share of the points seen from above left without a stroke. */
const BARE_SHARE = 0.35;
/** The strokes' line weight, under any line the plots draw for data. */
const WAVE_WEIGHT = 0.6;
const WAVE_POINTS = 9;
const WAVE_DESCRIPTION = "sea surface";

/** The lattice spacing for a window this wide: a power of two metres, giving between one and two times `across` strokes across it. */
export function waveStepMeters(
  spanMeters: number,
  across = STROKES_ACROSS,
): number {
  const target = Math.max(spanMeters, 1) / across;
  return 2 ** Math.floor(Math.log2(target));
}

/** A number in [0, 1) that depends only on where a stroke stands, so a stroke looks the same in every frame it is drawn in. */
function scatter(...at: number[]): number {
  let h = 2166136261;
  for (const v of at) {
    h ^= Math.round(v) | 0;
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

function wave(
  index: number,
  points: PlotPoint[],
): PlotLayer & { kind: "series" } {
  return {
    kind: "series",
    id: `sea-wave-${index}`,
    points,
    tone: "info",
    emphasis: "bright",
    weight: WAVE_WEIGHT,
    // One name for the whole surface: thirty strokes are one fact.
    ...(index === 1 ? { description: WAVE_DESCRIPTION } : {}),
  };
}

/**
 * Ripples just under the water line of a side view: short arcs inside each stretch of sea, at a depth and length that vary from stroke to stroke.
 * `spans` are the stretches of sea in the plot's own x, and `originAlongMeters` is how far along the track the plot's x origin stands from the body's own origin.
 */
export function crossSectionWaves(inputs: {
  spans: readonly { x0: number; x1: number }[];
  originAlongMeters: number;
  xSpan: number;
  ySpan: number;
}): PlotLayer[] {
  const { spans, originAlongMeters, xSpan, ySpan } = inputs;
  const step = waveStepMeters(xSpan);
  const layers: PlotLayer[] = [];
  for (const span of spans) {
    const first = Math.ceil((originAlongMeters + span.x0) / step);
    const last = Math.floor((originAlongMeters + span.x1) / step);
    for (let n = first; n <= last; n++) {
      const along = n * step;
      const centre = along - originAlongMeters;
      const half = (xSpan * (0.04 + 0.03 * scatter(along))) / 2;
      if (centre - half < span.x0 || centre + half > span.x1) continue;
      const depth = ySpan * (0.03 + 0.05 * scatter(along, 1));
      const rise = ySpan * 0.005;
      layers.push(
        wave(
          layers.length + 1,
          Array.from({ length: WAVE_POINTS }, (_, i) => {
            const u = i / (WAVE_POINTS - 1);
            return {
              x: centre - half + 2 * half * u,
              y: -depth + rise * Math.sin(Math.PI * u),
            };
          }),
        ),
      );
    }
  }
  return layers;
}

/**
 * Wavelets seen from above: a short squiggle at each point of the lattice that stands on water inside the window.
 * `origin` is where the plot's own origin stands, in metres east and north of the body's origin, and `isWater` says whether a point of the plot is over the sea.
 */
export function topDownWaves(inputs: {
  window: { x0: number; x1: number; y0: number; y1: number };
  origin: { east: number; north: number };
  isWater: (x: number, y: number) => boolean;
}): PlotLayer[] {
  const { window, origin, isWater } = inputs;
  const span = window.x1 - window.x0;
  const step = waveStepMeters(span, STROKES_ACROSS_FROM_ABOVE);
  const half = span * 0.025;
  const rise = span * 0.007;
  const layers: PlotLayer[] = [];
  const northFrom = Math.ceil((origin.north + window.y0 + rise) / step);
  const northTo = Math.floor((origin.north + window.y1 - rise) / step);
  for (let j = northFrom; j <= northTo; j++) {
    // Every other row half a step along: a coarser lattice's rows all fall on this one's unshifted rows, at points it also holds, so the lattices still nest.
    const shift = Math.abs(j) % 2 === 1 ? step / 2 : 0;
    const eastFrom = Math.ceil((origin.east + window.x0 + half - shift) / step);
    const eastTo = Math.floor((origin.east + window.x1 - half - shift) / step);
    for (let i = eastFrom; i <= eastTo; i++) {
      const east = i * step + shift;
      const north = j * step;
      if (scatter(east, north, 2) < BARE_SHARE) continue;
      const x = east - origin.east;
      const y = north - origin.north;
      if (!isWater(x, y)) continue;
      const sign = scatter(east, north) < 0.5 ? 1 : -1;
      layers.push(
        wave(
          layers.length + 1,
          Array.from({ length: WAVE_POINTS }, (_, k) => {
            const u = k / (WAVE_POINTS - 1);
            return {
              x: x - half + 2 * half * u,
              y: y + sign * rise * Math.sin(2 * Math.PI * u),
            };
          }),
        ),
      );
    }
  }
  return layers;
}

/** Metres east and north of the body's own origin, at a latitude and longitude in degrees on a body of this radius. */
export function surfaceMeters(
  latDeg: number,
  lonDeg: number,
  radiusMeters: number,
): { east: number; north: number } {
  const rad = Math.PI / 180;
  return {
    east: lonDeg * rad * radiusMeters * Math.cos(latDeg * rad),
    north: latDeg * rad * radiusMeters,
  };
}
