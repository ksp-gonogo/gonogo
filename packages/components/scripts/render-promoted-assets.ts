#!/usr/bin/env tsx
/**
 * Render the PROMOTED widgets' release/docs assets, each producing an animated
 * GIF and/or static stills: into the tracked `docs/assets/` dir, so
 * README / release / marketing assets stay fresh. Driven entirely by the
 * `promoted-widgets.ts` manifest; this script is scenario-agnostic.
 *
 * Pipeline (reuses the playwright widget-render harness, no new probe code):
 *   • STILLS : render each manifest still fixture full-height (`fullContent`,
 *     so the whole widget is captured, nothing clipped) → one PNG per still.
 *   • GIF    : write the manifest's ordered frames as `_stream` render
 *     fixtures, render each full-height, pad every frame up to the tallest
 *     (top-aligned, panel bg) for uniform frames, stitch into a looping GIF.
 *
 * Output: `docs/assets/<name>.{png,gif}` (flat, matching the existing assets).
 *
 * Run: `pnpm --filter @ksp-gonogo/components render-promoted-assets [--widget <id>] [--list]`
 * Requires ImageMagick (`magick`, or v6 `convert`/`identify`) on PATH.
 *
 * ⚠️ Do NOT commit assets rendered on macOS, OS font rasterisation differs
 * (same rule as the visual baselines). The committed assets are produced on
 * Linux by the refresh-promoted-assets CI workflow.
 */
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PROMOTED_WIDGETS, type PromotedWidget } from "./promoted-widgets";
import { renderWidgets } from "./widgetRenderHarness";

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS_SRC = resolve(HERE, "../src");
const LOCAL_DOCS = resolve(HERE, "../../../local_docs");
const DOCS_ASSETS = resolve(HERE, "../../../docs/assets");

// ── ImageMagick binary resolver ────────────────────────────────────────────
// v7 ships a single `magick` dispatcher (`magick identify …`, `magick … out`);
// v6 (what `apt-get install imagemagick` gives on the CI runner) ships separate
// `identify` / `convert`. Prefer `magick`, fall back to the v6 pair.
interface ImTools {
  identify: (args: string[]) => Promise<string>;
  convert: (args: string[]) => Promise<void>;
}

async function resolveImageMagick(): Promise<ImTools> {
  const has = async (bin: string): Promise<boolean> => {
    try {
      await execFileAsync(bin, ["-version"]);
      return true;
    } catch {
      return false;
    }
  };
  if (await has("magick")) {
    return {
      identify: async (args) =>
        (await execFileAsync("magick", ["identify", ...args])).stdout,
      convert: async (args) => {
        await execFileAsync("magick", args);
      },
    };
  }
  if ((await has("identify")) && (await has("convert"))) {
    return {
      identify: async (args) => (await execFileAsync("identify", args)).stdout,
      convert: async (args) => {
        await execFileAsync("convert", args);
      },
    };
  }
  throw new Error(
    "ImageMagick not found on PATH (need `magick`, or v6 `convert`+`identify`).",
  );
}

/**
 * Render a set of named `_stream` fixture objects for one widget, full-height,
 * into a scratch dir under local_docs, and return the produced PNG paths sorted
 * by fixture name. Writes each fixture to a temp fixturesPath under `src/`
 * (fixturesPath is resolved relative to `packages/components/src`), renders with
 * `fullContent`, then cleans the temp fixtures up (the caller cleans the PNGs).
 */
async function renderFullHeight(
  widgetId: string,
  fixtures: { name: string; fixture: Record<string, unknown> }[],
  modeName: string,
  w: number,
  h: number,
  scratchRel: string,
): Promise<string[]> {
  const fixturesAbs = await mkdtemp(join(COMPONENTS_SRC, "_promoted-"));
  const fixturesRel = fixturesAbs.slice(COMPONENTS_SRC.length + 1);
  const outAbs = resolve(LOCAL_DOCS, scratchRel);
  try {
    for (const { name, fixture } of fixtures) {
      await writeFile(
        join(fixturesAbs, `${name}.json`),
        JSON.stringify(fixture, null, 2),
        "utf8",
      );
    }
    await renderWidgets(
      [
        {
          widgetId,
          slug: `promoted-${widgetId}`,
          fixturesPath: fixturesRel,
          outPath: scratchRel,
          modes: [{ name: modeName, w, h }],
        },
      ],
      { fullContent: true },
    );
    const suffix = `--${modeName}.png`;
    return (await readdir(outAbs))
      .filter((f) => f.endsWith(suffix))
      .sort()
      .map((f) => join(outAbs, f));
  } finally {
    await rm(fixturesAbs, { recursive: true, force: true });
  }
}

/** Read a committed render fixture (path relative to `packages/components/src`). */
async function loadFixture(
  fixtureFile: string,
): Promise<Record<string, unknown>> {
  const raw = await readFile(resolve(COMPONENTS_SRC, fixtureFile), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function renderStills(widget: PromotedWidget): Promise<string[]> {
  const written: string[] = [];
  for (const still of widget.stills ?? []) {
    const scratchRel = `renders/_promoted/${widget.widgetId}-still-${still.name}`;
    const scratchAbs = resolve(LOCAL_DOCS, scratchRel);
    try {
      const fixture = await loadFixture(still.fixtureFile);
      const pngs = await renderFullHeight(
        widget.widgetId,
        [{ name: still.name, fixture }],
        "still",
        still.w,
        still.h,
        scratchRel,
      );
      if (pngs.length === 0) {
        throw new Error(`still "${still.name}": no PNG produced`);
      }
      const dest = join(DOCS_ASSETS, `${still.name}.png`);
      await copyFile(pngs[0], dest);
      written.push(dest);
      console.log(`  still  → ${dest}`);
    } finally {
      await rm(scratchAbs, { recursive: true, force: true });
    }
  }
  return written;
}

async function renderGif(
  widget: PromotedWidget,
  im: ImTools,
): Promise<string | null> {
  const gif = widget.gif;
  if (!gif) return null;
  const scratchRel = `renders/_promoted/${widget.widgetId}-gif`;
  const scratchAbs = resolve(LOCAL_DOCS, scratchRel);
  try {
    const frames = gif.frames().map((fixture, i) => ({
      name: `frame-${String(i).padStart(4, "0")}`,
      fixture,
    }));
    const pngs = await renderFullHeight(
      widget.widgetId,
      frames,
      "frame",
      gif.w,
      gif.h,
      scratchRel,
    );
    if (pngs.length === 0)
      throw new Error(`gif "${gif.name}": no frames produced`);

    // fullContent frames vary in height; the GIF needs uniform frames. Pad every
    // frame up to the tallest (top-aligned) with the panel bg (sampled from a
    // frame corner) so the padding is seamless. Width is already uniform.
    const dims = await im.identify(["-format", "%w %h\n", ...pngs]);
    let maxW = 0;
    let maxH = 0;
    for (const line of dims.trim().split("\n")) {
      const [w, h] = line.trim().split(/\s+/).map(Number);
      if (w > maxW) maxW = w;
      if (h > maxH) maxH = h;
    }
    const bg = (
      await im.identify(["-format", "%[pixel:p{2,2}]", pngs[0]])
    ).trim();
    // (identify with -format reads the pixel too; keeps to one IM surface.)

    await mkdir(DOCS_ASSETS, { recursive: true });
    const dest = join(DOCS_ASSETS, `${gif.name}.gif`);
    const delayCs = Math.max(
      4,
      Math.round((gif.targetSeconds * 100) / pngs.length),
    );
    await im.convert([
      "-loop",
      "0",
      "-delay",
      String(delayCs),
      ...pngs,
      "-gravity",
      "north",
      "-background",
      bg,
      "-extent",
      `${maxW}x${maxH}`,
      "+repage",
      "-layers",
      "optimize",
      dest,
    ]);
    console.log(
      `  gif    → ${dest} (${pngs.length} frames @ ${delayCs}cs ≈ ${(
        (pngs.length * delayCs) / 100
      ).toFixed(1)}s, ${maxW}x${maxH})`,
    );
    return dest;
  } finally {
    await rm(scratchAbs, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    for (const w of PROMOTED_WIDGETS) {
      const bits = [
        w.gif ? `gif:${w.gif.name}` : null,
        w.stills?.length
          ? `stills:${w.stills.map((s) => s.name).join(",")}`
          : null,
      ].filter(Boolean);
      console.log(`${w.widgetId.padEnd(20)} ${bits.join("  ")}`);
    }
    return;
  }

  const widgetFlag = args.indexOf("--widget");
  const only = widgetFlag !== -1 ? args[widgetFlag + 1] : undefined;
  const targets = only
    ? PROMOTED_WIDGETS.filter((w) => w.widgetId === only)
    : PROMOTED_WIDGETS;
  if (only && targets.length === 0) {
    console.error(
      `Unknown promoted widget "${only}". Known: ${PROMOTED_WIDGETS.map((w) => w.widgetId).join(", ")}`,
    );
    process.exit(1);
  }

  const im = await resolveImageMagick();
  await mkdir(DOCS_ASSETS, { recursive: true });

  for (const widget of targets) {
    console.log(`\n── ${widget.widgetId} ──`);
    await renderStills(widget);
    await renderGif(widget, im);
  }
  console.log(`\nPromoted assets refreshed → ${DOCS_ASSETS}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
