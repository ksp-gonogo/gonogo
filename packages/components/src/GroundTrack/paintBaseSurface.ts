/*
 * Background paint for GroundTrack's world canvas: the pencil sketch when the
 * base is the sketch, else the stock texture or colour wash, then every active
 * `ground-track.base` layer in the order it is handed.
 *
 * Whether the stock texture paints is a separate, declared decision
 * (`suppressVanilla`), independent of whether any layer currently has a
 * canvas. Suppression withholds the body's real picture and the colour wash,
 * never the sketch: a suppressing layer's data composites over the sketch
 * whether it has drawn everything, part or nothing.
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

/** One active `ground-track.base` layer's contributed canvas, ready to composite. */
export interface BaseSurfaceLayer {
  /** The contributing augment's own id, for callers and tests; drawing does not need it. */
  id: string;
  canvas: CanvasImageSource;
}

export interface BaseSurfaceInput {
  /** The body's stock texture, or null if none is loaded. */
  textureImage: CanvasImageSource | null;
  /**
   * The pencil sketch, set when it is the map's base. It is drawn at its own
   * brightness in place of the stock texture and the colour wash, and
   * `suppressVanilla` does not withhold it. The stock texture is dimmed under a
   * dark wash to sit behind the marks.
   */
  sketch?: CanvasImageSource | null;
  /** Last-resort colour wash for bodies with no texture loaded yet. */
  bodyColor: string | undefined;
  /**
   * True when a registered `ground-track.base` augment declares
   * `suppressesVanillaBase` and its Domain is live: the stock texture and
   * colour wash are not painted. Resolved by the caller, independent of
   * `layers`, and no setting overrides it.
   */
  suppressVanilla: boolean;
  /** Every active layer's canvas, in draw order: later entries composite on top. */
  layers: readonly BaseSurfaceLayer[];
  worldW: number;
  worldH: number;
}

/**
 * Paint the map's base surface: the sketch if there is one, else the stock
 * texture/colour-wash (skipped when `suppressVanilla` is true), followed by
 * every active `ground-track.base` layer's canvas, in the given order.
 */
export function paintBaseSurface(
  ctx: BaseSurfaceCtx,
  {
    textureImage,
    sketch = null,
    bodyColor,
    suppressVanilla,
    layers,
    worldW,
    worldH,
  }: BaseSurfaceInput,
): void {
  if (sketch) ctx.drawImage(sketch, 0, 0, worldW, worldH);
  if (!sketch && !suppressVanilla)
    paintVanilla(ctx, textureImage, bodyColor, worldW, worldH);

  for (const layer of layers) {
    ctx.drawImage(layer.canvas, 0, 0, worldW, worldH);
  }
}

/** The stock texture under a dimming wash, else a colour wash, else nothing. */
function paintVanilla(
  ctx: BaseSurfaceCtx,
  textureImage: CanvasImageSource | null,
  bodyColor: string | undefined,
  worldW: number,
  worldH: number,
): void {
  if (textureImage) {
    ctx.drawImage(textureImage, 0, 0, worldW, worldH);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 0, worldW, worldH);
    return;
  }
  if (!bodyColor) return;
  ctx.fillStyle = `${bodyColor}22`;
  ctx.fillRect(0, 0, worldW, worldH);
}

/**
 * Whether {@link paintBaseSurface} drew any surface pixels for these inputs,
 * mirroring its decision exactly, so a suppressed map with no sketch and no
 * layer takes the dark grid even with a stock texture loaded.
 */
export function baseSurfacePainted({
  textureImage,
  sketch = null,
  bodyColor,
  suppressVanilla,
  layers,
}: Pick<
  BaseSurfaceInput,
  "textureImage" | "sketch" | "bodyColor" | "suppressVanilla" | "layers"
>): boolean {
  const vanillaPainted =
    !suppressVanilla && (textureImage != null || bodyColor != null);
  return sketch != null || vanillaPainted || layers.length > 0;
}
