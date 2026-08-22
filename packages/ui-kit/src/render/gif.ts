import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { decodePng } from "./png";

/**
 * Numbered PNG frames, stitched in process.
 *
 * In process and pure JS, because the prior art
 * (`packages/components/scripts/render-navball-gif.ts`) shells out to
 * ImageMagick `convert`: an undeclared system dependency a third-party author
 * will not have, and the only system requirement this tool may impose is a
 * Playwright browser, which it already imposes.
 *
 * GIF rather than mp4, and the tension is real rather than resolved by taste:
 * the deliverable is an Uplink's README, read on GitHub or SpaceDock, where GIF
 * embeds and mp4 does not. Playwright's own `recordVideo` writes webm on
 * WALL-CLOCK timing, so it cannot use the pinned clock and would not be
 * reproducible. `--frames` keeps the numbered PNGs, and stitching those to mp4
 * for a review relay stays a convenience outside this tool.
 */
export function encodeGif(
  frames: readonly Buffer[],
  opts: { fps: number; pingPong: boolean },
): Buffer {
  if (frames.length === 0) {
    throw new Error("encodeGif: no frames");
  }
  const ordered = opts.pingPong
    ? [...frames, ...[...frames].slice(1, -1).reverse()]
    : frames;
  const delay = Math.max(2, Math.round(1000 / opts.fps));
  const encoder = GIFEncoder();
  let size: { width: number; height: number } | undefined;
  for (const frame of ordered) {
    const png = decodePng(frame);
    if (!size) size = { width: png.width, height: png.height };
    if (png.width !== size.width || png.height !== size.height) {
      throw new Error(
        `encodeGif: frame sizes differ (${png.width}x${png.height} after ` +
          `${size.width}x${size.height}). Every frame of one scene has to be ` +
          "the same box, or the animation is a slideshow of crops.",
      );
    }
    const palette = quantize(png.data, 256);
    const index = applyPalette(png.data, palette);
    encoder.writeFrame(index, png.width, png.height, { palette, delay });
  }
  encoder.finish();
  return Buffer.from(encoder.bytes());
}
