/** Compose + diff helpers for the cross-browser visual gate. `stitch3up`
 *  builds the human-review composite; `diffRatio` powers the per-engine
 *  baseline comparison (ratio, not fixed pixel count). */
import { readFile, writeFile } from "node:fs/promises";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

async function read(path: string): Promise<PNG> {
  return PNG.sync.read(await readFile(path));
}

/** Pad both images to a shared canvas so a size delta counts as a difference
 *  rather than throwing inside pixelmatch. Returns the common dimensions and
 *  the two padded buffers. */
function alignPair(
  a: PNG,
  b: PNG,
): { width: number; height: number; a: PNG; b: PNG } {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const pad = (src: PNG) => {
    if (src.width === width && src.height === height) return src;
    const dst = new PNG({ width, height });
    PNG.bitblt(src, dst, 0, 0, src.width, src.height, 0, 0);
    return dst;
  };
  return { width, height, a: pad(a), b: pad(b) };
}

export async function diffRatio(aPath: string, bPath: string): Promise<number> {
  const { width, height, a, b } = alignPair(
    await read(aPath),
    await read(bPath),
  );
  const mismatched = pixelmatch(a.data, b.data, null, width, height, {
    threshold: 0.1,
  });
  return mismatched / (width * height);
}

/**
 * Write a highlighted diff PNG (mismatched pixels tinted) between two images
 * to `outPath` and return the mismatched-pixel ratio. Used by the visual gate
 * to emit a reviewable artifact when a render drifts from its baseline.
 */
export async function writeDiff(
  aPath: string,
  bPath: string,
  outPath: string,
): Promise<number> {
  const { width, height, a, b } = alignPair(
    await read(aPath),
    await read(bPath),
  );
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: 0.1,
  });
  await writeFile(outPath, PNG.sync.write(diff));
  return mismatched / (width * height);
}

export async function stitch3up(
  pngPaths: [string, string, string],
  outPath: string,
): Promise<void> {
  const imgs = await Promise.all(pngPaths.map(read));
  // No gap between panels: the composite's width must be exactly the sum
  // of the three panel widths (verified by crossBrowserComposite.test.ts).
  const gap = 0;
  const width =
    imgs.reduce((sum, i) => sum + i.width, 0) + gap * (imgs.length - 1);
  const height = Math.max(...imgs.map((i) => i.height));
  const out = new PNG({ width, height, fill: true });
  let x = 0;
  for (const img of imgs) {
    PNG.bitblt(img, out, 0, 0, img.width, img.height, x, 0);
    x += img.width + gap;
  }
  await writeFile(outPath, PNG.sync.write(out));
}
