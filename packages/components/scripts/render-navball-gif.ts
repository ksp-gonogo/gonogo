#!/usr/bin/env tsx
/**
 * Render the Navball widget across a realistic ascent attitude sweep and
 * assemble the frames into a looping GIF for the README.
 *
 * Pipeline (reuses the existing playwright widget-render harness — no new
 * probe code):
 *   1. Generate N interpolated synthetic fixtures (one per attitude frame)
 *      into a temp dir under `src/` so the harness's `fixturesPath` (relative
 *      to `src/`) resolves them.
 *   2. Run `renderWidget` with a single dial-focused mode → one PNG per frame.
 *   3. Stitch the PNGs into a looping GIF with ImageMagick (`convert`).
 *   4. Clean up the temp fixtures + scratch PNGs.
 *
 * The sweep is a gravity-turn ascent: pitch rotates from vertical (90°) down
 * to a shallow ~25° climb while heading holds east (90°) and a gentle roll
 * program banks through ±20°. The frame list ping-pongs back to the start so
 * the GIF loops seamlessly.
 *
 * Output: `docs/assets/navball-attitude-sweep.gif`
 *
 * Run via `pnpm --filter @ksp-gonogo/components render-navball-gif`.
 * Requires ImageMagick (`convert`) on PATH.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { renderWidget } from "./widgetRenderHarness";

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS_SRC = resolve(HERE, "../src");
const LOCAL_DOCS = resolve(HERE, "../../../local_docs");
const REPO_ROOT = resolve(HERE, "../../..");
const DOCS_ASSETS = resolve(REPO_ROOT, "docs/assets");

// Per-frame GIF delay in 1/100s (12 ≈ 12fps). The sweep + ping-pong gives a
// smooth ~2.7s loop.
const FRAME_DELAY_CS = 9;

interface Attitude {
  heading: number;
  pitch: number;
  roll: number;
  throttle: number;
}

/** Smoothstep ease for natural-looking motion at the sweep ends. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * One leg of the gravity turn: pitch from `fromPitch` to `toPitch`, heading
 * holding east, roll banking out and back, throttle easing. `steps` frames,
 * excluding the final endpoint so legs chain without duplicate frames.
 */
function ascentLeg(
  fromPitch: number,
  toPitch: number,
  fromRoll: number,
  toRoll: number,
  fromThrottle: number,
  toThrottle: number,
  steps: number,
): Attitude[] {
  const frames: Attitude[] = [];
  for (let i = 0; i < steps; i++) {
    const t = ease(i / steps);
    frames.push({
      heading: 90,
      pitch: lerp(fromPitch, toPitch, t),
      roll: lerp(fromRoll, toRoll, t),
      throttle: lerp(fromThrottle, toThrottle, t),
    });
  }
  return frames;
}

function buildSweep(): Attitude[] {
  // Vertical climb → pitch-over east with a gentle right bank → settle to a
  // shallow climb. Roll programs out to +20° during pitch-over, returns to
  // wings-level by the shallow-climb phase.
  const forward = [
    ...ascentLeg(88, 60, 0, 18, 1.0, 0.95, 10),
    ...ascentLeg(60, 35, 18, 8, 0.95, 0.85, 10),
    ...ascentLeg(35, 25, 8, 0, 0.85, 0.75, 8),
  ];
  // Ping-pong back to the start so the loop is seamless (drop the shared
  // endpoint at each join).
  const backward = [...forward].reverse().slice(1, -1);
  return [...forward, ...backward];
}

function fixtureFor(att: Attitude): Record<string, unknown> {
  return {
    "n.heading": Math.round(att.heading * 10) / 10,
    "n.pitch": Math.round(att.pitch * 10) / 10,
    "n.roll": Math.round(att.roll * 10) / 10,
    "f.sasMode": "Prograde",
    "f.sasEnabled": true,
    "f.precisionControl": false,
    "v.rcsValue": false,
    "f.throttle": Math.round(att.throttle * 100) / 100,
    "v.isControllable": true,
  };
}

async function main(): Promise<void> {
  const sweep = buildSweep();
  console.log(`Sweep: ${sweep.length} attitude frames`);

  // 1. Write interpolated fixtures into a temp dir under src/ so the harness
  //    (fixturesPath is relative to src/) can read them.
  const fixturesAbs = await mkdtemp(join(COMPONENTS_SRC, "_navball-gif-"));
  const fixturesRel = fixturesAbs.slice(COMPONENTS_SRC.length + 1);
  const outRel = "renders/_navball-gif-frames";
  const outAbs = resolve(LOCAL_DOCS, outRel);

  try {
    for (let i = 0; i < sweep.length; i++) {
      const name = `frame-${String(i).padStart(4, "0")}.json`;
      await writeFile(
        join(fixturesAbs, name),
        JSON.stringify(fixtureFor(sweep[i]), null, 2),
        "utf8",
      );
    }

    // 2. Render every frame at one dial-focused mode (wide-5x8: full ball +
    //    heading tape + throttle, no bulky control surface).
    await renderWidget({
      widgetId: "navball",
      slug: "navball-gif",
      fixturesPath: fixturesRel,
      outPath: outRel,
      modes: [{ name: "frame", w: 5, h: 8 }],
    });

    // 3. Assemble the GIF with ImageMagick. Frame PNGs are named
    //    `frame-NNNN--frame.png`; zero-padding makes the glob sort in order.
    const frameFiles = (await readdir(outAbs))
      .filter((f) => f.endsWith("--frame.png"))
      .sort();
    if (frameFiles.length === 0) {
      throw new Error(`No frame PNGs found in ${outAbs}`);
    }

    await mkdir(DOCS_ASSETS, { recursive: true });
    const gifOut = join(DOCS_ASSETS, "navball-attitude-sweep.gif");
    const framePaths = frameFiles.map((f) => join(outAbs, f));
    await execFileAsync("convert", [
      "-loop",
      "0",
      "-delay",
      String(FRAME_DELAY_CS),
      ...framePaths,
      "-layers",
      "optimize",
      gifOut,
    ]);
    console.log(`\nWrote ${gifOut} (${frameFiles.length} frames)`);
  } finally {
    // 4. Clean up temp fixtures + scratch frame PNGs.
    await rm(fixturesAbs, { recursive: true, force: true });
    await rm(outAbs, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
