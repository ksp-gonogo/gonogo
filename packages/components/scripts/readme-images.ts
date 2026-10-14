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
 *   pnpm readme-images --review <dir>     write every composition, with and without the screen's chrome, as still, GIF and H.264 there instead
 *   pnpm readme-images --only hero|sizes  one picture; with --hero <composition> one composition; with --stills no animations
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
import type { HeroSpec } from "./probe/hero-entry";
import type { StageSpec } from "./probe/readme-entry";
import { HERO_COMPOSITIONS, heroSpec } from "./readmeHero";
import { navballSizesStage } from "./readmeStages";
import { installFixedClock, prepareProbePage } from "./widgetRenderHarness";

const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const ASSETS = resolve(REPO_ROOT, "docs/assets");

/** The composition and chrome whose render is written to the README's hero and takeoff images. */
const README_HERO = { composition: "systemview", chrome: "today" } as const;

/** How far into the flight a hero still is taken, from 0 to 1. */
const HERO_STILL_AT = 0.66;
/** Every Nth recorded frame is rendered into a hero animation. */
const HERO_STRIDE = 1;

/** Frames per second of every animation. A GIF is written at the stage's CSS width, half of what the H.264 twin keeps. */
const FPS = 15;
/** Every Nth model frame is rendered: frame N is at the same model instant in every instance. */
const SIZES_STRIDE = 2;
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

async function openSession(
  dsf: number,
  kind: "stage" | "hero",
  viewport = { width: 1600, height: 1000 },
): Promise<Session> {
  const html = await prepareProbePage({
    entry: join(HERE, `probe/${kind === "hero" ? "hero" : "readme"}-entry.tsx`),
    htmlTemplate: join(
      HERE,
      `probe/${kind === "hero" ? "hero" : "readme"}.html`,
    ),
    scriptSrcPlaceholder: `<script type="module" src="./${kind === "hero" ? "hero" : "readme"}-entry.bundle.js"></script>`,
    slug: kind === "hero" ? "hero" : "readme",
    alias:
      kind === "hero"
        ? {
            "@ksp-gonogo/components": join(HERE, "../src/index.ts"),
          }
        : undefined,
  });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport,
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
  await page.waitForFunction(
    (name) => typeof (window as never)[name] === "object",
    kind === "hero" ? "__hero" : "__stage",
  );
  return { page, close: () => browser.close() };
}

async function mountStage(page: Page, spec: StageSpec): Promise<void> {
  await page.setViewportSize({ width: spec.width, height: spec.height });
  await page.evaluate((s) => window.__stage.mount(s), spec);
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

async function mountHero(page: Page, spec: HeroSpec): Promise<void> {
  await page.setViewportSize({ width: spec.width, height: spec.height });
  await page.evaluate((s) => window.__hero.mount(s), spec);
}

/** The frame a hero still is taken at: the craft in orbit with the ascent still on the graph. */
function stillIndex(spec: HeroSpec): number {
  return Math.round((spec.frames.length - 1) * HERO_STILL_AT);
}

async function heroStill(
  page: Page,
  spec: HeroSpec,
  out: string,
): Promise<void> {
  await mountHero(page, spec);
  await page.evaluate((i) => window.__hero.seek(i), stillIndex(spec));
  await mkdir(dirname(out), { recursive: true });
  await page.locator("#root").screenshot({ path: out });
  console.log(`wrote ${out}`);
}

async function heroAnimate(
  page: Page,
  spec: HeroSpec,
  name: string,
  gif: string | undefined,
  mp4: string | undefined,
): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), "readme-hero-"));
  try {
    await mountHero(page, spec);
    const root = page.locator("#root");
    const steps = Math.floor(spec.frames.length / HERO_STRIDE);
    for (let i = 0; i < steps; i++) {
      const index = Math.min(spec.frames.length - 1, i * HERO_STRIDE);
      await page.evaluate((n) => window.__hero.seek(n), index);
      await root.screenshot({
        path: join(tmp, `f${String(i).padStart(4, "0")}.png`),
      });
    }
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
  const heroFlag = args.indexOf("--hero");
  const heroFilter = heroFlag === -1 ? undefined : args[heroFlag + 1];
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

  if (only === undefined || only === "sizes") {
    const session = await openSession(2, "stage");
    try {
      const layouts = review
        ? (["row", "stacked"] as const)
        : (["row"] as const);
      for (const layout of layouts) {
        await animate(
          session.page,
          navballSizesStage(layout),
          SIZES_STRIDE,
          `navball sizes ${layout}`,
          review
            ? join(review, `navball-sizes-${layout}.gif`)
            : join(ASSETS, "navball-sizes.gif"),
          review && join(review, `navball-sizes-${layout}.mp4`),
        );
      }
    } finally {
      await session.close();
    }
  }

  if (only === undefined || only === "hero") {
    const session = await openSession(2, "hero");
    try {
      if (review) {
        const names = Object.keys(HERO_COMPOSITIONS).filter(
          (n) => !heroFilter || n === heroFilter,
        );
        for (const name of names) {
          for (const chrome of ["today", "clean"] as const) {
            const label = `hero-${name}-${chrome}`;
            const spec = heroSpec(name, chrome);
            try {
              await heroStill(session.page, spec, join(review, `${label}.png`));
              if (!args.includes("--stills"))
                await heroAnimate(
                  session.page,
                  spec,
                  label,
                  join(review, `${label}.gif`),
                  join(review, `${label}.mp4`),
                );
            } catch (err) {
              console.error(`${label} skipped: ${(err as Error).message}`);
            }
          }
        }
      } else {
        const spec = heroSpec(README_HERO.composition, README_HERO.chrome);
        await heroStill(session.page, spec, join(ASSETS, "hero-dashboard.png"));
        await heroAnimate(
          session.page,
          spec,
          "hero",
          join(ASSETS, "takeoff-ascent.gif"),
          undefined,
        );
      }
    } finally {
      await session.close();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
