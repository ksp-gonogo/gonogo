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
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

/** The composition and chrome whose render is written to the README's hero animation. */
const README_HERO = { composition: "compact", chrome: "clean" } as const;

/** How far into the flight a hero still is taken, from 0 to 1. */
const HERO_STILL_AT = 0.66;
/** Every Nth recorded frame is rendered into a hero animation. */
const HERO_STRIDE = 1;

/** Frames per second of every animation. A GIF is written at the stage's CSS width, half of what the H.264 twin keeps. */
const FPS = 15;
/** Frames per second of a hero animation, which spans a long flight and is kept small by the slower rate. */
const HERO_FPS = 10;
/** Every Nth model frame is rendered: frame N is at the same model instant in every instance. */
const SIZES_STRIDE = 2;
/** The app's page ground, which a transparent stage's H.264 twin is laid over. */
const PAGE_GROUND = "0x050505";
/** The colour a transparent stage's ground is carried as until it is declared transparent: absent from the widgets. */
const GROUND_KEY = 0xff00ff;
/** Seconds the last frame is held before the loop restarts. */
const HOLD_SECONDS = 1.5;

/** What a run writes into docs/assets. */
const GENERATED = [
  "docs/assets/navball-sizes.gif",
  "docs/assets/hero-dashboard.gif",
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
    // A tile whose content is taller than its scrolling body would show a clipped last line under the fade.
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("#root *")]
        .filter((el) => {
          const o = getComputedStyle(el).overflowY;
          return (
            (o === "auto" || o === "scroll" || o === "hidden") &&
            el.clientHeight > 20 &&
            el.scrollHeight > el.clientHeight + 1
          );
        })
        .map(
          (el) =>
            `${el.tagName.toLowerCase()} ${el.clientHeight}px shows ${el.scrollHeight}px at ${Math.round(el.getBoundingClientRect().left)},${Math.round(el.getBoundingClientRect().top)}`,
        ),
    );
    if (clipped.length > 0)
      throw new Error(`frame ${i} clips content: ${clipped.join("; ")}`);
    await root.screenshot({
      path: join(dir, `f${String(i).padStart(4, "0")}.png`),
      omitBackground: true,
    });
  }
}

/**
 * Lays the stage over a flat key colour after cutting its alpha to one bit.
 * ffmpeg's GIF encoder stops writing only the changed rectangle once a source
 * has alpha (or an alpha-carrying pixel format), which made every frame a full image, so the ground is carried as
 * an opaque colour and {@link keyToTransparent} declares it transparent after.
 */
const KEY_OVER_GROUND = `format=rgba,lutrgb=a='if(gte(val,128),255,0)',split[k][s];[k]drawbox=c=0x${GROUND_KEY.toString(16).padStart(6, "0")}:t=fill[g];[g][s]overlay=format=auto,format=rgb24`;

/**
 * Marks the ground colour transparent in a GIF written with a global palette.
 * The first frame is the one image that draws the ground: the encoder writes
 * every later frame as the rectangle that changed, with its own transparent
 * index standing for the pixels that did not, so the ground stays clear in them
 * too. The ground's index is the first pixel's, read from the first compressed code.
 */
async function keyToTransparent(path: string, key: number): Promise<void> {
  const buf = await readFile(path);
  if (buf.length < 13 || (buf[10] & 0x80) === 0)
    throw new Error(`${path} has no global palette to find the ground in`);
  const tableSize = 3 * (1 << ((buf[10] & 7) + 1));
  let at = 13 + tableSize;
  const skipSubBlocks = (from: number): number => {
    let p = from;
    while (buf[p] !== 0) p += buf[p] + 1;
    return p + 1;
  };
  let gce = -1;
  while (buf[at] !== 0x2c) {
    if (buf[at] !== 0x21)
      throw new Error(`${path}: unexpected block ${buf[at]}`);
    if (buf[at + 1] === 0xf9) gce = at;
    at = skipSubBlocks(at + 2);
  }
  if (gce === -1) throw new Error(`${path} has no graphic control block`);
  const local = buf[at + 9] & 0x80 ? 3 * (1 << ((buf[at + 9] & 7) + 1)) : 0;
  const minCodeSize = buf[at + 10 + local];
  // After the clear code comes the first pixel as a literal, both (minCodeSize + 1) bits wide, least significant bit first.
  const data = at + 10 + local + 2;
  const width = minCodeSize + 1;
  let bits = 0;
  for (let i = 0; i < 2 * width; i++) {
    const byte = buf[data + (i >> 3)];
    bits |= ((byte >> (i & 7)) & 1) << i;
  }
  const index = bits >> width;
  const palette = at - tableSize + 3 * index;
  const colour =
    (buf[palette] << 16) + (buf[palette + 1] << 8) + buf[palette + 2];
  if (colour !== key)
    throw new Error(
      `${path}: the first pixel is ${colour.toString(16)}, not the ground colour`,
    );
  buf[gce + 3] |= 1;
  buf[gce + 6] = index;
  await writeFile(path, buf);
}

async function encode(
  frames: string,
  gifWidth: number,
  gif: string | undefined,
  mp4: string | undefined,
  fps = FPS,
  transparent = false,
): Promise<void> {
  const hold = Math.round(HOLD_SECONDS * fps);
  const input = ["-framerate", String(fps), "-i", join(frames, "f%04d.png")];
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
      `${tail},scale=${gifWidth}:-1:flags=lanczos${transparent ? `,${KEY_OVER_GROUND}` : ""},split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=${transparent ? "dither=none" : "dither=bayer:bayer_scale=5"}:diff_mode=rectangle`,
      "-loop",
      "0",
      gif,
    ]);
    if (transparent) await keyToTransparent(gif, GROUND_KEY);
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
      // H.264 has no alpha: a transparent stage is laid over the app's own ground.
      transparent
        ? `${tail},format=rgba,split[a][b];[a]drawbox=c=${PAGE_GROUND}:t=fill[g];[g][b]overlay,scale=trunc(iw/2)*2:trunc(ih/2)*2`
        : `${tail},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
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
    await encode(tmp, spec.width, gif, mp4, FPS, true);
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
    console.log(`${name}: ${steps} frames at ${HERO_FPS} fps`);
    await encode(tmp, spec.width, gif, mp4, HERO_FPS);
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
        await heroAnimate(
          session.page,
          spec,
          "hero",
          join(ASSETS, "hero-dashboard.gif"),
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
