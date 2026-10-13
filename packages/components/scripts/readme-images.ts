#!/usr/bin/env tsx
/**
 * Regenerates every picture the README shows, from committed fixtures and
 * playback models alone: no running game, no dev server, no hand steps.
 *
 * Each picture is a stage (see `readmeStages.ts`): several widgets mounted on
 * one page of the render harness's probe bundle, on its pinned clock. An
 * animation is rendered frame by frame, every instance moved to the same frame
 * before one screenshot of the whole stage, then encoded with ffmpeg.
 *
 *   pnpm readme-images                    write docs/assets/*
 *   pnpm readme-images --check            fail if an image the README references is missing
 *   pnpm readme-images --review <dir>     also write the H.264 twins and the hero proposals there
 *
 * Committed images must come from Linux: the font rasteriser differs by
 * platform, so a macOS run is for review only.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium, type Page } from "playwright";
import type { StageSpec } from "./probe/readme-entry";
import { HERO_STAGES, navballSizesStage } from "./readmeStages";
import { installFixedClock, prepareProbePage } from "./widgetRenderHarness";

const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const ASSETS = resolve(REPO_ROOT, "docs/assets");

/** The proposal whose render is written to the README's hero and takeoff images. */
const README_HERO = "a";

/** Frames per second of every animation. A GIF is written at the stage's CSS width, half of what the H.264 twin keeps. */
const FPS = 15;
/** Every Nth model frame is rendered: frame N is at the same model instant in every instance. */
const SIZES_STRIDE = 2;
const LOOP_STRIDE = 3;
/** Seconds the last frame is held before the loop restarts. */
const HOLD_SECONDS = 1.5;

/** What a run writes into docs/assets. */
const GENERATED = [
  "docs/assets/navball-sizes.gif",
  "docs/assets/hero-dashboard.png",
  "docs/assets/takeoff-ascent.gif",
];

async function readmeReferences(): Promise<string[]> {
  const text = await readFile(join(REPO_ROOT, "README.md"), "utf8");
  return [...text.matchAll(/src="(docs\/assets\/[^"]+)"/g)].map((m) => m[1]);
}

async function check(): Promise<void> {
  const refs = await readmeReferences();
  const missing = refs.filter((r) => !existsSync(join(REPO_ROOT, r)));
  for (const r of refs)
    console.log(`${missing.includes(r) ? "MISSING" : "ok     "} ${r}`);
  for (const g of GENERATED) {
    if (!existsSync(join(REPO_ROOT, g)))
      console.log(`pending ${g} (written by the next Linux run)`);
  }
  if (missing.length > 0) {
    console.error(
      `\n${missing.length} image(s) the README references are missing. Run \`pnpm readme-images\`.`,
    );
    process.exit(1);
  }
}

interface Session {
  page: Page;
  close: () => Promise<void>;
}

async function openSession(dsf: number): Promise<Session> {
  const html = await prepareProbePage({
    entry: join(HERE, "probe/readme-entry.tsx"),
    htmlTemplate: join(HERE, "probe/readme.html"),
    scriptSrcPlaceholder:
      '<script type="module" src="./readme-entry.bundle.js"></script>',
    slug: "readme",
  });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: dsf,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (err) => {
    throw err;
  });
  await installFixedClock(page);
  await page.goto(pathToFileURL(html).toString(), {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => typeof window.__stage === "object");
  return { page, close: () => browser.close() };
}

async function mountStage(page: Page, spec: StageSpec): Promise<void> {
  await page.setViewportSize({ width: spec.width, height: spec.height });
  await page.evaluate((s) => window.__stage.mount(s), spec);
}

async function still(page: Page, spec: StageSpec, out: string): Promise<void> {
  await mountStage(page, spec);
  if (spec.stillAt) {
    const indices = Object.fromEntries(
      Object.entries(spec.stillAt).map(([k, f]) => [
        k,
        Math.round(f * (spec.tracks[k].length - 1)),
      ]),
    );
    await page.evaluate((idx) => window.__stage.step(idx), indices);
  }
  await mkdir(dirname(out), { recursive: true });
  await page.locator("#root").screenshot({ path: out });
  console.log(`wrote ${out}`);
}

/** One screenshot per step, every track moved to the frame `indicesFor` names for that step. */
async function renderFrames(
  page: Page,
  spec: StageSpec,
  indicesFor: (step: number) => Record<string, number>,
  steps: number,
  dir: string,
): Promise<void> {
  await mountStage(page, spec);
  await mkdir(dir, { recursive: true });
  const root = page.locator("#root");
  for (let i = 0; i < steps; i++) {
    await page.evaluate((idx) => window.__stage.step(idx), indicesFor(i));
    await root.screenshot({
      path: join(dir, `f${String(i).padStart(4, "0")}.png`),
    });
  }
}

async function encode(
  frames: string,
  gifWidth: number,
  gif: string | undefined,
  mp4: string | undefined,
): Promise<void> {
  const hold = Math.round(HOLD_SECONDS * FPS);
  const input = ["-framerate", String(FPS), "-i", join(frames, "f%04d.png")];
  // Hold the last frame by cloning it, so the loop rests before it restarts.
  const tail = `tpad=stop_mode=clone:stop=${hold}`;
  if (gif) {
    await mkdir(dirname(gif), { recursive: true });
    await run("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      ...input,
      "-vf",
      `${tail},scale=${gifWidth}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      "-loop",
      "0",
      gif,
    ]);
    console.log(`wrote ${gif}`);
  }
  if (mp4) {
    await mkdir(dirname(mp4), { recursive: true });
    await run("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      ...input,
      "-vf",
      `${tail},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "16",
      "-movflags",
      "+faststart",
      mp4,
    ]);
    console.log(`wrote ${mp4}`);
  }
}

async function animate(
  page: Page,
  spec: StageSpec,
  stride: number,
  name: string,
  gif: string | undefined,
  mp4: string | undefined,
): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), "readme-frames-"));
  try {
    const lengths = Object.fromEntries(
      Object.entries(spec.tracks).map(([k, v]) => [k, v.length]),
    );
    const steps = Math.floor(Math.max(...Object.values(lengths)) / stride);
    await renderFrames(
      page,
      spec,
      (i) =>
        Object.fromEntries(
          Object.entries(lengths).map(([k, n]) => [
            k,
            Math.min(n - 1, Math.round((i / (steps - 1)) * (n - 1))),
          ]),
        ),
      steps,
      tmp,
    );
    console.log(`${name}: ${steps} frames at ${FPS} fps`);
    await encode(tmp, spec.width, gif, mp4);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--check")) return check();
  const onlyFlag = args.indexOf("--only");
  const only = onlyFlag === -1 ? undefined : args[onlyFlag + 1];
  const reviewFlag = args.indexOf("--review");
  const review =
    reviewFlag === -1 ? undefined : resolve(args[reviewFlag + 1] ?? "");
  if (reviewFlag !== -1 && !args[reviewFlag + 1])
    throw new Error("--review needs a directory");

  if (platform() !== "linux") {
    console.warn(
      "WARNING: not running on Linux. Fonts rasterise differently here, so these pictures are for review only. Do not commit them.",
    );
  }

  const session = await openSession(2);
  try {
    if (only === undefined || only === "sizes")
      await animate(
        session.page,
        navballSizesStage(),
        SIZES_STRIDE,
        "navball sizes",
        join(ASSETS, "navball-sizes.gif"),
        review && join(review, "navball-sizes.mp4"),
      );
    if (only !== undefined && only !== "heroes") return;
    for (const [letter, stage] of Object.entries(HERO_STAGES)) {
      const spec = stage();
      const readme = letter === README_HERO;
      if (readme)
        await still(session.page, spec, join(ASSETS, "hero-dashboard.png"));
      if (review)
        await still(session.page, spec, join(review, `hero-${letter}.png`));
      if (Object.keys(spec.tracks).length === 0) continue;
      await animate(
        session.page,
        spec,
        LOOP_STRIDE,
        `hero ${letter} loop`,
        readme ? join(ASSETS, "takeoff-ascent.gif") : undefined,
        review && join(review, `hero-${letter}-loop.mp4`),
      );
    }
  } finally {
    await session.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
