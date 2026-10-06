import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { decodePng } from "./png";

/**
 * Stitches PNG frames into a GIF at `fps`, in plain JavaScript with no system
 * tools needed. With `pingPong` the frames play forward and then back. Throws
 * on an empty list.
 *
 * A GIF, because an Uplink's README is read on GitHub and SpaceDock, where a
 * GIF embeds and a video does not. `--frames` keeps the numbered PNGs for
 * anything else.
 *
 * @category Rendering scenes
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
