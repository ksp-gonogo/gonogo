#!/usr/bin/env tsx
/**
 * Records the Experiments card on a main screen and a station of one command
 * centre side by side as H.264 video in real time, 27 s each way: Deploy pressed on the main
 * screen, and Transmit pressed and confirmed there, from the press to the reply.
 * Writes one MP4 per scenario to `--out` (default `.renders/expdelay`), named by
 * `--label`. Needs an ffmpeg with libx264, named by `FFMPEG` or found on the path.
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium, type Page } from "playwright";
import { tilePixels } from "./probe/payload";
import type {
  ExperimentsScenario,
  SharedStep,
} from "./probe/shared-rail-entry";
import {
  installFixedClock,
  PROBE_PAGES,
  prepareProbePage,
} from "./widgetRenderHarness";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}
const OUT_DIR = resolve(
  flag("--out") ?? resolve(HERE, "../../../.renders/expdelay"),
);
const LABEL = flag("--label") ?? "after";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const D = 27;
const W = 6;
const H = 16;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (page: Page, s: SharedStep) =>
  page.evaluate((s) => window.__sharedScene.step(s, "main"), s);
const caption = (page: Page, text: string) =>
  page.evaluate((t) => window.__sharedScene.caption(t), text);

const CLIPS: ReadonlyArray<{
  scenario: ExperimentsScenario;
  press: string;
  reply: string;
}> = [
  {
    scenario: "deploy",
    press: "Deploy pressed on the main screen",
    reply: "The reply lands: data aboard on both screens.",
  },
  {
    scenario: "transmit",
    press: "Transmit pressed and confirmed on the main screen",
    reply: "The reply lands: the data is transmitted on both screens.",
  },
];

async function play(
  page: Page,
  clip: (typeof CLIPS)[number],
  label: string,
): Promise<void> {
  const note = (text: string) => caption(page, `${label}. ${text}`);
  await note(`${clip.press}, ${D} s each way.`);
  await pause(1200);
  await step(page, "press");
  await pause(500);
  await note("The press has gone; the mod has not answered it yet.");
  await pause(1500);
  await step(page, "accept");
  await note("The mod has answered the press.");
  await step(page, "travel");
  await step(page, "grow");
  let answered = false;
  for (let s = 0; s <= 2 * D + 3; s += 0.5) {
    await page.evaluate((x) => window.__sharedScene.at(x), s);
    if (s === 12) await note(`${s} s after the press.`);
    if (s === 31) await note("31 s after the press.");
    if (s >= 2 * D && !answered) {
      answered = true;
      await page.evaluate(() => window.__sharedScene.answer("done"));
      await note(`${2 * D} s. ${clip.reply}`);
    }
    await pause(500);
  }
  await pause(1500);
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const html = await prepareProbePage({
    entry: join(HERE, "probe", "shared-rail-entry.tsx"),
    htmlTemplate: PROBE_PAGES.widget.htmlTemplate,
    scriptSrcPlaceholder: PROBE_PAGES.widget.scriptSrcPlaceholder,
    slug: "experiments-delay",
  });
  const browser = await chromium.launch();
  try {
    for (const clip of CLIPS) {
      const px = tilePixels(W, H);
      const size = {
        width: Math.ceil((2 * px.pxW + 16 + 24) / 2) * 2,
        height: Math.ceil((px.pxH + 100) / 2) * 2,
      };
      const videoDir = join(OUT_DIR, `.video-${clip.scenario}`);
      await rm(videoDir, { recursive: true, force: true });
      const context = await browser.newContext({
        viewport: size,
        recordVideo: { dir: videoDir, size },
      });
      const page = await context.newPage();
      await installFixedClock(page);
      page.on("pageerror", (err) => console.error(`[page] ${err.message}`));
      await page.goto(pathToFileURL(html).toString());
      await page.waitForFunction(() => Boolean(window.__sharedScene));
      await page.evaluate((o) => window.__sharedScene.mount(o), {
        widget: "experiments" as const,
        w: W,
        h: H,
        pxW: px.pxW,
        delaySeconds: D,
        scenario: clip.scenario,
      });
      await pause(800);
      await play(page, clip, LABEL);
      await context.close();
      const [webm] = (await readdir(videoDir)).filter((f) =>
        f.endsWith(".webm"),
      );
      const mp4 = join(OUT_DIR, `${LABEL}--${clip.scenario}.mp4`);
      await execFileAsync(FFMPEG, [
        "-y",
        "-loglevel",
        "error",
        "-i",
        join(videoDir, webm),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        mp4,
      ]);
      await rm(videoDir, { recursive: true, force: true });
      console.log(`wrote ${mp4}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
