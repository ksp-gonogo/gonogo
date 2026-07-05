import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import { diffRatio, stitch3up, writeDiff } from "./crossBrowserComposite";

const made: string[] = [];
async function solidPng(
  w: number,
  h: number,
  rgba: [number, number, number, number],
) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < png.data.length; i += 4) {
    [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]] = rgba;
  }
  const p = join(tmpdir(), `cbc-${made.length}-${w}x${h}.png`);
  await writeFile(p, PNG.sync.write(png));
  made.push(p);
  return p;
}

afterEach(async () => {
  await Promise.all(made.map((p) => rm(p, { force: true })));
  made.length = 0;
});

describe("crossBrowserComposite", () => {
  it("diffRatio is 0 for identical images and ~1 for opposite", async () => {
    const black = await solidPng(4, 4, [0, 0, 0, 255]);
    const black2 = await solidPng(4, 4, [0, 0, 0, 255]);
    const white = await solidPng(4, 4, [255, 255, 255, 255]);
    expect(await diffRatio(black, black2)).toBe(0);
    expect(await diffRatio(black, white)).toBeGreaterThan(0.9);
  });

  it("stitch3up writes an image 3x the width of one input", async () => {
    const a = await solidPng(10, 8, [255, 0, 0, 255]);
    const out = join(tmpdir(), `cbc-out-${made.length}.png`);
    made.push(out);
    await stitch3up([a, a, a], out);
    const png = PNG.sync.read(await readFile(out));
    expect(png.width).toBe(30);
    expect(png.height).toBe(8);
  });

  it("writeDiff writes a same-size diff image and returns the mismatch ratio", async () => {
    const black = await solidPng(4, 4, [0, 0, 0, 255]);
    const white = await solidPng(4, 4, [255, 255, 255, 255]);
    const out = join(tmpdir(), `cbc-diff-${made.length}.png`);
    made.push(out);

    const ratio = await writeDiff(black, white, out);
    expect(ratio).toBeGreaterThan(0.9);
    const png = PNG.sync.read(await readFile(out));
    expect(png.width).toBe(4);
    expect(png.height).toBe(4);

    // Identical inputs → zero mismatch.
    const black2 = await solidPng(4, 4, [0, 0, 0, 255]);
    const zeroOut = join(tmpdir(), `cbc-diff-zero-${made.length}.png`);
    made.push(zeroOut);
    expect(await writeDiff(black, black2, zeroOut)).toBe(0);
  });
});
