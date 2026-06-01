#!/usr/bin/env tsx
/**
 * Render the SAME Navball widget at four grid footprints and assemble them
 * into one side-by-side PNG showing how a gonogo widget reflows and adapts to
 * its container — from a bare numeric readout at the tiniest size up to the
 * full GNC control surface (attitude dial + heading tape + throttle + SAS /
 * fly-by-wire controls) at a large footprint.
 *
 * Pipeline (reuses the existing playwright widget-render harness):
 *   1. Render one mid-ascent fixture at four sizes via `renderWidget`.
 *   2. Scale each frame to a common height and montage the four panels
 *      left-to-right with ImageMagick, framed in a margin of background.
 *
 * Using a common height (rather than honest pixel footprint) keeps the strip
 * readable as a README hero — the tiniest panel is ~5× shorter than the full
 * control surface, which would otherwise render as an unreadable sliver.
 *
 * Output: `docs/assets/navball-adaptive-scaling.png`
 *
 * Run via `pnpm --filter @gonogo/components render-navball-scaling`.
 * Requires ImageMagick (`convert` / `montage`) on PATH.
 */
import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { renderWidget } from "./widgetRenderHarness";

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCAL_DOCS = resolve(HERE, "../../../local_docs");
const REPO_ROOT = resolve(HERE, "../../..");
const DOCS_ASSETS = resolve(REPO_ROOT, "docs/assets");

// Single fixture rendered at every size so the only thing that changes across
// the strip is the footprint-driven layout.
const FIXTURE = "gravity-turn-east";

// (mode slug, grid label) — the harness writes `<fixture>--<mode>.png`. These
// four modes already exist in widgets.ts; we re-derive them here so the strip
// is self-contained and doesn't depend on the full --all render having run.
const PANELS: ReadonlyArray<{
  mode: string;
  w: number;
  h: number;
  label: string;
  config?: Record<string, unknown>;
}> = [
  { mode: "tiny-3x4", w: 3, h: 4, label: "3x4  ·  readout" },
  { mode: "medium-4x7", w: 4, h: 7, label: "4x7  ·  dial + tape" },
  { mode: "wide-5x8", w: 5, h: 8, label: "5x8  ·  dial + throttle" },
  {
    mode: "full-7x20",
    w: 7,
    h: 20,
    label: "7x20  ·  full GNC control",
    config: { controlMode: true },
  },
];

const COMMON_HEIGHT = 760; // px the dial panels are scaled to before montage
const OUTER_PAD = 64; // px of background margin framing the whole strip
const BG = "#050505";

// A concrete monospace font file — ImageMagick's named-font lookup ("Courier")
// is unreliable on a fresh Homebrew install (no fontconfig aliases), but a
// direct path to a system font always resolves. Menlo ships on every macOS.
const FONT_PATH = "/System/Library/Fonts/Menlo.ttc";

async function main(): Promise<void> {
  const outRel = "renders/_navball-scaling-frames";
  const outAbs = resolve(LOCAL_DOCS, outRel);

  try {
    // 1. Render the four panels.
    await renderWidget({
      widgetId: "navball",
      slug: "navball-scaling",
      fixturesPath: "Navball/__fixtures__",
      outPath: outRel,
      modes: PANELS.map((p) => ({
        name: p.mode,
        w: p.w,
        h: p.h,
        config: p.config,
      })),
    });

    await mkdir(DOCS_ASSETS, { recursive: true });

    // 2. Scale each panel to the common height (no captions — the strip
    //    speaks for itself; footprints are described in the surrounding prose).
    const panels: string[] = [];
    for (const p of PANELS) {
      const src = join(outAbs, `${FIXTURE}--${p.mode}.png`);
      const dst = join(outAbs, `panel-${p.mode}.png`);
      await execFileAsync("convert", [
        src,
        "-resize",
        `x${COMMON_HEIGHT}`,
        dst,
      ]);
      panels.push(dst);
    }

    // 3. Montage the panels left-to-right, bottom-aligned with a comfortable
    //    gap so distinct footprints read as one progression, then frame the
    //    whole strip in a uniform margin so it has room to breathe beside the
    //    navball gif on the README hero line.
    const montaged = join(outAbs, "montage.png");
    await execFileAsync("montage", [
      // montage resolves a font even when no tile labels are drawn; point it at
      // the same concrete file so a missing fontconfig alias can't fail it.
      "-font",
      FONT_PATH,
      ...panels,
      "-tile",
      `${panels.length}x1`,
      "-geometry",
      "+24+0",
      "-gravity",
      "south",
      "-background",
      BG,
      montaged,
    ]);
    const out = join(DOCS_ASSETS, "navball-adaptive-scaling.png");
    await execFileAsync("convert", [
      montaged,
      "-bordercolor",
      BG,
      "-border",
      `${OUTER_PAD}x${OUTER_PAD}`,
      out,
    ]);
    console.log(`\nWrote ${out}`);
  } finally {
    await rm(outAbs, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
