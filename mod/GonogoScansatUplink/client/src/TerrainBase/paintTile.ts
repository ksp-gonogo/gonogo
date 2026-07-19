// Shared tile→pixel-rect paint loop for the `map-view.base` colormap
// augments (AltimetryBase, BiomeBase — T8c,
// docs/superpowers/plans/2026-07-18-mapview-overlay-host-foundation.md).
//
// Ported near-verbatim from the per-cell block-fill loop in
// packages/components/src/MapView/useScanLayerCanvas.ts's
// `paintBiomeCanvas`/`paintHeightCanvas` (the loop itself is generic body-
// texture geometry, not SCANsat-specific — only the per-cell colour lookup
// differs between altimetry and biome). The one behavioural change from
// that pre-T8c code: each tile's alpha is now modulated by the T4 coverage
// paint-gate instead of being baked in as a fixed ramp opacity, per the
// settled "no fog layer" model (packages/components/src/MapView/
// useCoverageGate.ts's own header comment) — covered tiles paint at (up to)
// full opacity, uncovered tiles paint nothing.
//
// PAINT-RESOLUTION SEMANTICS (the preflight's flagged ambiguity —
// .superpowers/sdd/preflight-T6-T9.md, T8c section):
//
// `MapBaseLayerContext.width`/`height` (threaded onto `SlotProps<
// "map-view.base">`) are MapView's LIVE viewport/container pixel size —
// `containerSize.w`/`h` in packages/components/src/MapView/index.tsx,
// which changes on every resize and zoom tick. They are NOT a paint
// resolution and MUST NOT be used to size the canvas this module paints
// into: doing so would repaint the full 720×360-cell scan grid (the
// payload's own declared width/height) on every resize, a real perf
// regression versus the fixed-resolution convention every other
// base-layer painter in this codebase already uses.
//
// Instead, `BASE_LAYER_CANVAS_W`/`H` below are a FIXED internal paint
// resolution, independent of the viewport, matching two existing
// conventions that already agree on this exact number:
//   1. `BIOME_CANVAS_W`/`H` (2048×1024) in the pre-T8c
//      `useBiomeCanvas`/`useHeightCanvas` this module replaces.
//   2. `DEFAULT_MASK_WIDTH`/`HEIGHT` (2048×1024) in
//      packages/data/src/fog/FogMaskCache.ts — the resolution the T4
//      coverage gate's own composite `Uint8Array` is built at.
// MapView's own composite step already scales whatever canvas an augment
// hands back to `WORLD_W`×`WORLD_H` via `ctx.drawImage(canvas, 0, 0,
// WORLD_W, WORLD_H)` (see index.tsx's `map-view.base composite` comment) —
// exactly the same scale-on-composite treatment the old fixed-resolution
// `useBiomeCanvas`/`useHeightCanvas` canvases already got. So a fixed
// paint resolution here needs no special-casing on MapView's side, and
// `ctx.width`/`ctx.height` are correctly left unused for canvas sizing.
export const BASE_LAYER_CANVAS_W = 2048;
export const BASE_LAYER_CANVAS_H = 1024;

/**
 * Structural subset of `useCoverageGate`'s `CoverageGate` this module
 * needs. Not imported from `@ksp-gonogo/components` directly — that type
 * isn't part of the package's public barrel (by design: it's MapView-
 * internal plumbing threaded onto `SlotProps<"map-view.base">`, not a
 * general-purpose export). `SlotProps<"map-view.base">["coverageGate"]`
 * satisfies this shape structurally at the augment call site.
 */
export interface CoverageGateLike {
  data: Uint8Array | null;
  hasAnySource: boolean;
  width: number;
  height: number;
}

export interface BodyOffsets {
  longitudeOffset?: number;
  latitudeOffset?: number;
}

/**
 * Translate a (ilon, ilat) 1°×1° tile coordinate to a rectangular pixel
 * range on a `(maskW, maskH)` texture-space canvas, honouring the body's
 * texture offsets. Direct copy of `../FogReveal/scanDecode.ts`'s
 * `tileToPixelRect` (itself T7's mod-local copy of the shared
 * `@ksp-gonogo/data` utility) — re-declared here rather than imported so
 * this module has no dependency on the FogReveal decode module, only on
 * the coverage-gate shape. Kept byte-for-byte identical; a future task
 * could hoist a single shared copy without changing behaviour.
 */
export interface TilePixelRect {
  x0: number;
  x1: number;
  x2?: number;
  x3?: number;
  y0: number;
  y1: number;
}

function wrapLon(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === 180 ? -180 : wrapped;
}

export function tileToPixelRect(
  iLon: number,
  iLat: number,
  maskW: number,
  maskH: number,
  longitudeOffset = 0,
  latitudeOffset = 0,
): TilePixelRect {
  const physLonLo = iLon - 180;
  const physLatLo = iLat - 90;
  const texLonLo = wrapLon(physLonLo + longitudeOffset);
  const texLonHi = wrapLon(physLonLo + 1 + longitudeOffset);
  const texLatLo = physLatLo + latitudeOffset;
  const texLatHi = physLatLo + 1 + latitudeOffset;

  const y0 = Math.max(0, Math.floor(((90 - texLatHi) / 180) * maskH));
  const y1 = Math.min(maskH, Math.ceil(((90 - texLatLo) / 180) * maskH));

  const x0raw = ((texLonLo + 180) / 360) * maskW;
  const x1raw = ((texLonHi + 180) / 360) * maskW;
  if (x1raw > x0raw) {
    return {
      x0: Math.floor(x0raw),
      x1: Math.min(maskW, Math.ceil(x1raw)),
      y0,
      y1,
    };
  }
  return {
    x0: Math.floor(x0raw),
    x1: maskW,
    x2: 0,
    x3: Math.min(maskW, Math.ceil(x1raw)),
    y0,
    y1,
  };
}

/**
 * Per-tile coverage alpha, `[0, 1]`. Looks up the gate's composite byte at
 * the tile's top-left pixel in GATE space (`gate.width`/`height` —
 * typically also 2048×1024, but computed independently from the canvas
 * paint resolution rather than assumed equal to it).
 *
 * `hasAnySource: false` (no fog reveal source registered, or no
 * `FogMaskCacheProvider` mounted) degrades to fully-open (alpha 1)
 * unconditionally — the paint-gate's own documented degenerate case, not
 * an error state. Same for a not-yet-resolved gate (`data: null`).
 */
export function coverageAlphaForTile(
  iLon: number,
  iLat: number,
  body: BodyOffsets,
  gate: CoverageGateLike,
): number {
  if (!gate.hasAnySource) return 1;
  if (!gate.data || gate.width === 0 || gate.height === 0) return 1;
  const rect = tileToPixelRect(
    iLon,
    iLat,
    gate.width,
    gate.height,
    body.longitudeOffset ?? 0,
    body.latitudeOffset ?? 0,
  );
  const x = Math.min(gate.width - 1, Math.max(0, rect.x0));
  const y = Math.min(gate.height - 1, Math.max(0, rect.y0));
  const byte = gate.data[y * gate.width + x] ?? 0;
  return byte / 255;
}

/** `"r, g, b"` (no wrapping `rgb(...)`) → an rgba() string at the given alpha. */
export function withAlpha(rgbComponents: string, alpha: number): string {
  return `rgba(${rgbComponents}, ${alpha})`;
}

/**
 * Paint every `(iLon, iLat)` cell in a `gridWidth`×`gridHeight` scan grid
 * (the payload's own declared dims — 720×360 for height/biome as of the
 * res-aware terrain bump) onto `ctx`, gated per-tile by the coverage
 * gate's alpha. `colourAt` returns `null` to skip a cell entirely (no data
 * for that tile — e.g. biome index 0xFF); otherwise an `"r, g, b"` colour
 * component string, composited at the gate-derived alpha via `withAlpha`.
 *
 * Always paints at the fixed `BASE_LAYER_CANVAS_W`×`H` resolution unless a
 * caller explicitly overrides it (tests only — production call sites never
 * pass `canvasW`/`canvasH`, see this module's header comment).
 */
export function paintTile(
  ctx: Pick<CanvasRenderingContext2D, "clearRect" | "fillRect" | "fillStyle">,
  gridWidth: number,
  gridHeight: number,
  body: BodyOffsets,
  gate: CoverageGateLike,
  colourAt: (iLon: number, iLat: number) => string | null,
  canvasW: number = BASE_LAYER_CANVAS_W,
  canvasH: number = BASE_LAYER_CANVAS_H,
): void {
  ctx.clearRect(0, 0, canvasW, canvasH);
  for (let iLon = 0; iLon < gridWidth; iLon++) {
    for (let iLat = 0; iLat < gridHeight; iLat++) {
      const colour = colourAt(iLon, iLat);
      if (!colour) continue;
      const alpha = coverageAlphaForTile(iLon, iLat, body, gate);
      if (alpha <= 0) continue;
      const rect = tileToPixelRect(
        iLon,
        iLat,
        canvasW,
        canvasH,
        body.longitudeOffset ?? 0,
        body.latitudeOffset ?? 0,
      );
      ctx.fillStyle = withAlpha(colour, alpha);
      ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
      if (rect.x2 !== undefined && rect.x3 !== undefined) {
        ctx.fillRect(rect.x2, rect.y0, rect.x3 - rect.x2, rect.y1 - rect.y0);
      }
    }
  }
}
