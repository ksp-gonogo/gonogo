// Background paint for MapView's world canvas.
//
// The map is a BACKGROUND, with everything else (overlays, POIs, trajectory,
// vessel marker) drawn on top of it. A `map-view.base` augment is a REPLACEMENT
// background, not an overlay: when one is active it owns the background
// entirely, so MapView must NOT paint its own stock body texture underneath it.
//
// Why this matters (2026-07-20): the previous shape painted the stock texture
// first, unconditionally, then composited the augment over the top --
// "replacing its visible pixels wherever the augment's canvas is opaque". A
// coverage-gated background augment paints NOTHING for unsurveyed tiles, so
// those tiles stayed transparent and the stock texture showed straight
// through. The background could therefore never be withheld: the coverage gate
// could only ever REPLACE pixels, never leave them unpainted. Skipping the stock
// paint while a replacement background is active lets unsurveyed regions fall
// through to the dark panel fill already on the canvas, and every future
// background augment inherits that for free instead of hand-painting black tiles.
//
// The no-augment path is deliberately unchanged: an unset or unmatched
// `baseLayerId` still gets the plain stock texture, ungated.

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

export interface BaseSurfaceInput {
  /** The body's stock texture, or null if none is loaded. */
  textureImage: CanvasImageSource | null;
  /** Last-resort colour wash for bodies with no texture loaded yet. */
  bodyColor: string | undefined;
  /**
   * The canvas supplied by the active `map-view.base` augment, or null when no
   * augment is active. Non-null ONLY when a registered augment's own id matches
   * `baseLayerId` and it has handed back a canvas.
   */
  augmentCanvas: CanvasImageSource | null;
  worldW: number;
  worldH: number;
}

/**
 * Paint the map's base surface. When `augmentCanvas` is present it is the ONLY
 * thing drawn -- the replacement augment owns the surface. Otherwise the stock
 * texture (plus its dimming wash) is painted, falling back to a body-colour wash.
 */
export function paintBaseSurface(
  ctx: BaseSurfaceCtx,
  { textureImage, bodyColor, augmentCanvas, worldW, worldH }: BaseSurfaceInput,
): void {
  if (augmentCanvas) {
    // Replacement base layer: it owns the surface. Anything it leaves
    // transparent intentionally falls through to the dark fill beneath.
    ctx.drawImage(augmentCanvas, 0, 0, worldW, worldH);
    return;
  }

  if (textureImage) {
    ctx.drawImage(textureImage, 0, 0, worldW, worldH);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 0, worldW, worldH);
    return;
  }

  if (bodyColor) {
    ctx.fillStyle = `${bodyColor}22`;
    ctx.fillRect(0, 0, worldW, worldH);
  }
}
