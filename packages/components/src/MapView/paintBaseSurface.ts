/*
 * Background paint for MapView's world canvas: the stock texture or colour
 * wash, then every active `map-view.base` layer in the order it is handed.
 *
 * Whether the stock texture paints is a separate, declared decision
 * (`suppressVanilla`), independent of whether any layer currently has a
 * canvas: with suppression on and every layer off the surface stays black,
 * never falling back to the stock texture. Inferring suppression from a
 * returned canvas would make "hide vanilla, draw nothing" unreachable.
 */

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
  /** The contributing augment's own id, for callers and tests; drawing does not need it. */
  id: string;
  canvas: CanvasImageSource;
}

export interface BaseSurfaceInput {
  /** The body's stock texture, or null if none is loaded. */
  textureImage: CanvasImageSource | null;
  /** Last-resort colour wash for bodies with no texture loaded yet. */
  bodyColor: string | undefined;
  /**
   * True when a registered `map-view.base` augment declares
   * `suppressesVanillaBase` and its Domain is live. Resolved by the caller,
   * independent of `layers`, and no setting overrides it.
   */
  suppressVanilla: boolean;
  /** Every active layer's canvas, in draw order: later entries composite on top. */
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

/**
 * Whether {@link paintBaseSurface} drew any surface pixels for these inputs,
 * mirroring its decision exactly, so a suppressed and empty map takes the dark
 * grid even with a stock texture loaded.
 */
export function baseSurfacePainted({
  textureImage,
  bodyColor,
  suppressVanilla,
  layers,
}: Pick<
  BaseSurfaceInput,
  "textureImage" | "bodyColor" | "suppressVanilla" | "layers"
>): boolean {
  const vanillaPainted =
    !suppressVanilla && (textureImage != null || bodyColor != null);
  return vanillaPainted || layers.length > 0;
}
