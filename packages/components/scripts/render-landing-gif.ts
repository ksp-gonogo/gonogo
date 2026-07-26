#!/usr/bin/env tsx
/**
 * Render the LandingStatus widget animating through a synthetic Mun descent and
 * assemble the frames into a looping GIF (~15s): cruise → suicide burn →
 * touchdown, with the altitude rail, cross-section, site marker and commit
 * clocks all updating.
 *
 * Pipeline (reuses the playwright widget-render harness — no new probe code):
 *   1. Integrate the descent (shared with synthesize-landing-descent.ts), sample
 *      ~N evenly-spaced frames, write each as a `_stream` render fixture into a
 *      temp dir under `src/` (fixturesPath is relative to src/).
 *   2. `renderWidgets` with `fullContent` (grow `#root` to the content height
 *      before capture) so the WHOLE widget is captured, nothing clipped below
 *      the fold → one PNG per frame at that frame's natural height.
 *   3. Pad every frame to the tallest frame's height (top-aligned, panel bg) so
 *      the GIF has uniform frames, then stitch into a looping GIF (ImageMagick).
 *   4. Clean up the temp fixtures + scratch PNGs.
 *
 * Output: `local_docs/renders/landing-widget/landing-descent-15s.gif`
 * Run via `pnpm --filter @ksp-gonogo/components render-landing-gif`.
 * Requires ImageMagick (`convert`) on PATH.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  type Frame,
  integrate,
  streamFixture,
} from "./synthesize-landing-descent";
import { renderWidgets } from "./widgetRenderHarness";

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS_SRC = resolve(HERE, "../src");
const LOCAL_DOCS = resolve(HERE, "../../../local_docs");

// Frames over the whole descent, played as a ~15s loop. The eased sampler may
// drop a few near the dense tail, so the per-frame delay is computed from the
// ACTUAL frame count to keep total playback ≈ TARGET_SECONDS.
const TARGET_FRAMES = 48;
const TARGET_SECONDS = 15;
const ONE_WAY_SECONDS = 2; // a delayed regime so the commit clocks are live

/**
 * Sample the descent down to ~TARGET_FRAMES evenly in ALTITUDE (not in time).
 * A ~250s descent spends its first two thirds dropping fast and its last third
 * crawling the final few hundred metres; sampling evenly in time would waste
 * most frames on that slow tail (vessel barely moving) and skip the fast upper
 * descent. Even-in-altitude gives a constant visual descent rate AND covers the
 * window where the ground-track drift shrinks, so both the side-on descent and
 * the top-down marker-tracks-in read smoothly. Frames are monotonic-decreasing
 * in agl, so each altitude rung maps to its nearest frame.
 */
function sampleFrames(frames: Frame[], target: number): Frame[] {
  if (frames.length <= target) return frames;
  const maxAgl = frames[0].aglMeters;
  const out: Frame[] = [];
  let prevIdx = -1;
  for (let i = 0; i < target; i++) {
    const targetAgl = maxAgl * (1 - i / (target - 1)); // maxAgl → 0
    let best = 0;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let j = 0; j < frames.length; j++) {
      const delta = Math.abs(frames[j].aglMeters - targetAgl);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = j;
      }
    }
    if (best !== prevIdx) {
      out.push(frames[best]);
      prevIdx = best;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const all = integrate();
  const frames = sampleFrames(all, TARGET_FRAMES);
  console.log(
    `Descent: ${all.length} integrated → ${frames.length} gif frames`,
  );

  const fixturesAbs = await mkdtemp(join(COMPONENTS_SRC, "_landing-gif-"));
  const fixturesRel = fixturesAbs.slice(COMPONENTS_SRC.length + 1);
  const outRel = "renders/_landing-gif-frames";
  const outAbs = resolve(LOCAL_DOCS, outRel);

  try {
    for (let i = 0; i < frames.length; i++) {
      const fixture = streamFixture(
        frames[i],
        ONE_WAY_SECONDS,
        `descent-gif-${i}`,
        "GIF frame (synthetic descent).",
      );
      await writeFile(
        join(fixturesAbs, `frame-${String(i).padStart(4, "0")}.json`),
        JSON.stringify(fixture, null, 2),
        "utf8",
      );
    }

    // fullContent grows #root to the natural content height before capture, so
    // the whole widget is in frame (nothing clipped below the fold). Width is
    // fixed by the mode (w=12); only height varies frame to frame.
    await renderWidgets(
      [
        {
          widgetId: "landing-status",
          slug: "landing-gif",
          fixturesPath: fixturesRel,
          outPath: outRel,
          modes: [{ name: "frame", w: 12, h: 20 }],
        },
      ],
      { fullContent: true },
    );

    const frameFiles = (await readdir(outAbs))
      .filter((f) => f.endsWith("--frame.png"))
      .sort()
      .map((f) => join(outAbs, f));
    if (frameFiles.length === 0) {
      throw new Error(`No frame PNGs found in ${outAbs}`);
    }

    // fullContent frames vary in height; the GIF needs uniform frames. Pad every
    // frame up to the TALLEST frame's box, top-aligned, filling the extra space
    // with the panel background (sampled from a frame corner) so the padding is
    // seamless. Width is already uniform.
    const dims = await execFileAsync("magick", [
      "identify",
      "-format",
      "%w %h\n",
      ...frameFiles,
    ]);
    let maxW = 0;
    let maxH = 0;
    for (const line of dims.stdout.trim().split("\n")) {
      const [w, h] = line.trim().split(/\s+/).map(Number);
      if (w > maxW) maxW = w;
      if (h > maxH) maxH = h;
    }
    const bg = (
      await execFileAsync("magick", [
        frameFiles[0],
        "-format",
        "%[pixel:p{2,2}]",
        "info:",
      ])
    ).stdout.trim();

    const outDir = resolve(LOCAL_DOCS, "renders/landing-widget");
    await mkdir(outDir, { recursive: true });
    const gifOut = join(outDir, "landing-descent-15s.gif");
    const delayCs = Math.max(
      4,
      Math.round((TARGET_SECONDS * 100) / frameFiles.length),
    );
    await execFileAsync("magick", [
      "-loop",
      "0",
      "-delay",
      String(delayCs),
      ...frameFiles,
      "-gravity",
      "north",
      "-background",
      bg,
      "-extent",
      `${maxW}x${maxH}`,
      "+repage",
      "-layers",
      "optimize",
      gifOut,
    ]);
    console.log(
      `\nWrote ${gifOut} (${frameFiles.length} frames @ ${delayCs}cs ≈ ${((frameFiles.length * delayCs) / 100).toFixed(1)}s, ${maxW}x${maxH})`,
    );
  } finally {
    await rm(fixturesAbs, { recursive: true, force: true });
    await rm(outAbs, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
