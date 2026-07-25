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
 *   2. `renderWidget` at one FIXED-size mode (so every frame is the same pixel
 *      box — the GIF needs uniform frames) → one PNG per frame.
 *   3. Stitch the PNGs into a looping GIF with ImageMagick (`convert`).
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
import { integrate, streamFixture } from "./synthesize-landing-descent";
import { renderWidget } from "./widgetRenderHarness";

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
 * Sample the descent down to ~TARGET_FRAMES, eased so the tail (suicide burn +
 * touchdown) is dense and the long cruise is sparse. Without this, a linear
 * sample over a ~250s descent spends most frames on the static coast and skips
 * through the burn. p(u) = 1-(1-u)^2 has dp/du → 0 as u → 1, i.e. small
 * time-steps near the end. First and last frames are always kept.
 */
function sampleFrames<T>(frames: T[], target: number): T[] {
  if (frames.length <= target) return frames;
  const last = frames.length - 1;
  const out: T[] = [];
  let prevIdx = -1;
  for (let i = 0; i < target; i++) {
    const u = i / (target - 1);
    const p = 1 - (1 - u) ** 2;
    const idx = Math.round(p * last);
    if (idx !== prevIdx) {
      out.push(frames[idx]);
      prevIdx = idx;
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

    // Fixed-size mode (NOT full-content) so every frame is the same box.
    await renderWidget({
      widgetId: "landing-status",
      slug: "landing-gif",
      fixturesPath: fixturesRel,
      outPath: outRel,
      modes: [{ name: "frame", w: 12, h: 20 }],
    });

    const frameFiles = (await readdir(outAbs))
      .filter((f) => f.endsWith("--frame.png"))
      .sort();
    if (frameFiles.length === 0) {
      throw new Error(`No frame PNGs found in ${outAbs}`);
    }

    const outDir = resolve(LOCAL_DOCS, "renders/landing-widget");
    await mkdir(outDir, { recursive: true });
    const gifOut = join(outDir, "landing-descent-15s.gif");
    const delayCs = Math.max(
      4,
      Math.round((TARGET_SECONDS * 100) / frameFiles.length),
    );
    await execFileAsync("convert", [
      "-loop",
      "0",
      "-delay",
      String(delayCs),
      ...frameFiles.map((f) => join(outAbs, f)),
      "-layers",
      "optimize",
      gifOut,
    ]);
    console.log(
      `\nWrote ${gifOut} (${frameFiles.length} frames @ ${delayCs}cs ≈ ${((frameFiles.length * delayCs) / 100).toFixed(1)}s)`,
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
