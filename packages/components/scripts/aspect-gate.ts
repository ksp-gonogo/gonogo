#!/usr/bin/env tsx
/**
 * The checkered-flag aspect gate. Paints a checkerboard of square cells into a
 * `FramedDisplay` the way a camera augment paints its video, at landscape,
 * portrait and square tiles, and measures a cell's rendered width and height
 * off the engine's own pixels.
 *
 * It asserts, per case, that a cell is as wide as it is tall (no distortion)
 * and that the visible cell count on each axis is the one `object-fit: cover`
 * predicts (the crop is the expected one, not a reshaped field of view). A
 * planted stretched case must read as distorted, or the gate fails as blind.
 *
 * Not a pixel baseline: every assertion is a ratio the engine either honours
 * or does not, so it holds on any engine and any machine.
 *
 * Run via `pnpm --filter @ksp-gonogo/components aspect-gate [--engine <e>]`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, firefox, webkit } from "playwright";
import { PNG } from "pngjs";
import { type AspectCase, CASES, coverCells } from "./aspect/cases";
import { measureCheckerCells } from "./aspect/checkerCells";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "aspect/aspect-entry.tsx");
const TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

/** A cell may round to one pixel either way on each axis. */
const SQUARE_TOLERANCE_PX = 1;
/** Visible cells may differ from the cover model by a quarter cell, the rounding of a whole-pixel cell. */
const COUNT_TOLERANCE_CELLS = 0.25;

const ENGINES = { chromium, firefox, webkit } as const;

async function main(): Promise<void> {
  const engineArg = process.argv[process.argv.indexOf("--engine") + 1];
  const engineName = (
    process.argv.includes("--engine") ? engineArg : "chromium"
  ) as keyof typeof ENGINES;
  const engine = ENGINES[engineName];
  if (!engine) throw new Error(`aspect-gate: unknown engine ${engineArg}`);

  const bundle = await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    logLevel: "error",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const tokens = await readFile(TOKENS_CSS, "utf8");
  const script = bundle.outputFiles[0].text.replace(
    /<\/script/gi,
    "<\\/script",
  );
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><style>${tokens}</style>` +
    "<style>html,body{margin:0;background:var(--color-surface-app)}</style></head>" +
    `<body><div id="root"></div><script type="module">${script}</script></body></html>`;
  const htmlPath = join(tmpdir(), `gonogo-aspect-gate-${process.pid}.html`);
  await writeFile(htmlPath, html, "utf8");

  const browser = await engine.launch();
  const failures: string[] = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1200 },
      deviceScaleFactor: 1,
    });
    page.on("pageerror", (err) => failures.push(`page error: ${err.message}`));
    await page.goto(pathToFileURL(htmlPath).toString());
    await page.waitForFunction(
      () => typeof window.__renderAspectCases === "function",
    );
    await page.evaluate((cases) => window.__renderAspectCases?.(cases), CASES);
    await page.waitForFunction(
      (count) =>
        [
          ...document.querySelectorAll<HTMLImageElement>(
            "img[data-aspect-case]",
          ),
        ].filter((img) => img.complete && img.naturalWidth > 0).length ===
        count,
      CASES.length,
    );

    console.log(`aspect-gate (${engineName})`);
    for (const spec of CASES) {
      const failure = await checkCase(page, spec);
      if (failure) failures.push(failure);
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(
      `\naspect-gate: ${failures.length} failure(s)\n  ${failures.join("\n  ")}`,
    );
    process.exit(1);
  }
  console.log(
    `\naspect-gate: ${CASES.length} case(s), every cell square where it must be, the plant caught.`,
  );
}

async function checkCase(
  page: import("playwright").Page,
  spec: AspectCase,
): Promise<string | null> {
  const img = page.locator(`img[data-aspect-case="${spec.name}"]`);
  const box = await img.boundingBox();
  if (!box) return `${spec.name}: the picture has no box`;
  const cells = measureCheckerCells(PNG.sync.read(await img.screenshot()));
  const expected = coverCells(box, spec);
  const square =
    Math.abs(cells.cellWidth - cells.cellHeight) <= SQUARE_TOLERANCE_PX;
  console.log(
    `  ${spec.name.padEnd(22)} box ${box.width}x${box.height}  cell ${cells.cellWidth.toFixed(2)}x${cells.cellHeight.toFixed(2)}  ` +
      `visible ${cells.columns.toFixed(2)} x ${cells.rows.toFixed(2)} (cover predicts ` +
      `${expected.columns.toFixed(2)} x ${expected.rows.toFixed(2)})`,
  );
  if (spec.plant) {
    return square
      ? `${spec.name}: the planted stretched picture read as square, so the gate cannot see distortion (BLIND)`
      : null;
  }
  if (!square) {
    return `${spec.name}: a cell renders ${cells.cellWidth.toFixed(2)}x${cells.cellHeight.toFixed(2)}, so the picture is distorted`;
  }
  const off =
    Math.abs(cells.columns - expected.columns) > COUNT_TOLERANCE_CELLS ||
    Math.abs(cells.rows - expected.rows) > COUNT_TOLERANCE_CELLS;
  return off
    ? `${spec.name}: shows ${cells.columns.toFixed(2)} x ${cells.rows.toFixed(2)} cells where cover shows ${expected.columns.toFixed(2)} x ${expected.rows.toFixed(2)}, so the field of view is reshaped`
    : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
