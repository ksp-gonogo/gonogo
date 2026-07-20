// Background paint for MapView's world canvas.
//
// The map is a BACKGROUND, with everything else (overlays, POIs, trajectory,
// vessel marker) drawn on top of it. `map-view.base` is a STACKABLE slot
// (local_docs/spec-mapview-stackable-layers.md): any number of augments may
// each contribute a canvas, and every currently-active one is composited in
// draw order — this module doesn't decide that order (see orderBaseLayers.ts)
// or which augments count as "active" (that's config/settings, resolved by
// the caller); it only paints what it's handed.
//
// Whether the host's own stock body texture paints at all is a SEPARATE,
// declarative decision (`suppressVanilla`, sourced from any registered
// augment's `suppressesVanillaBase` flag — see augments.ts) — independent of
// whether any layer currently has a canvas to contribute. That split matters
// for the "all layers toggled off" case: if suppression is on, the surface
// stays black (the dark panel fill already on the canvas shows through),
// never falling back to the stock texture just because nothing is currently
// painting (spec §5) — "don't like it, don't have the Uplink" is meant
// literally: the Uplink's mere presence, not its current per-layer
// visibility, decides this.
//
// Why the OLD single-augment shape had to change (2026-07-20): the previous
// design let exactly one `map-view.base` augment "win" (an `activeLayerId`
// picker with no UI to ever set it), and treated "did the winning augment
// hand back a canvas" as the suppression signal. That conflated two
// concepts a real base-layer Uplink keeps separate (an opaque base surface
// plus a translucent layer ON TOP of it) and made "hide vanilla, draw
// nothing" unreachable — a coverage-gated layer that paints nothing for
// unsurveyed tiles could only ever REPLACE pixels, never intentionally
// withhold the whole surface.
//
// The no-suppression, no-layers path is unchanged from before this rework:
// the stock texture (or a body-colour wash, or nothing) paints exactly as
// it always did.

/** The subset of the 2D context this module touches. */
export interface BaseSurfaceCtx {
  fillStyle: string | CanvasGradient | CanvasPattern;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** One active `map-view.base` layer's contributed canvas, ready to composite. */
export interface BaseSurfaceLayer {
  /** The contributing augment's own id — carried through for callers/tests; drawing itself doesn't need it. */
  id: string;
  canvas: CanvasImageSource;
}

export interface BaseSurfaceInput {
  /** The body's stock texture, or null if none is loaded. */
  textureImage: CanvasImageSource | null;
  /** Last-resort colour wash for bodies with no texture loaded yet. */
  bodyColor: string | undefined;
  /**
   * True when at least one registered `map-view.base` augment declares
   * `suppressesVanillaBase` (spec: the Uplink's mere presence suppresses
   * the host surface, non-optional, no setting overrides it back on) —
   * independent of `layers` below, which only reflects what's CURRENTLY
   * painting. See this module's header comment for the all-off case.
   */
  suppressVanilla: boolean;
  /**
   * Every currently-active layer's canvas, already in draw order (earliest
   * first, so later entries composite on top) — see orderBaseLayers.ts for
   * how that order is derived.
   */
  layers: readonly BaseSurfaceLayer[];
  worldW: number;
  worldH: number;
}

/**
 * Paint the map's base surface: the stock texture/colour-wash (skipped
 * outright when `suppressVanilla` is true), followed by every active
 * `map-view.base` layer's canvas, in the given order.
 */
export function paintBaseSurface(
  ctx: BaseSurfaceCtx,
  {
    textureImage,
    bodyColor,
    suppressVanilla,
    layers,
    worldW,
    worldH,
  }: BaseSurfaceInput,
): void {
  if (!suppressVanilla) {
    if (textureImage) {
      ctx.drawImage(textureImage, 0, 0, worldW, worldH);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, worldW, worldH);
    } else if (bodyColor) {
      ctx.fillStyle = `${bodyColor}22`;
      ctx.fillRect(0, 0, worldW, worldH);
    }
  }

  for (const layer of layers) {
    ctx.drawImage(layer.canvas, 0, 0, worldW, worldH);
  }
}
