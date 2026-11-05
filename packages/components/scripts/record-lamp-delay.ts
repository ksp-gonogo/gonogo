#!/usr/bin/env tsx
/**
 * Records the Crew Status EVA lamp on a main screen and a station of one command
 * centre side by side as H.264 video, 10 s each way: the lamp pressed on the
 * main screen, in flight, predicted to have arrived, and confirmed. Writes
 * `<label>--lamp.mp4` to `--out` (default `.renders/cmdfix`). Needs an ffmpeg
 * with libx264, named by `FFMPEG` or found on the path.
 */
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium, type Page } from "playwright";
import { tilePixels } from "./probe/payload";
import type { SharedStep } from "./probe/shared-rail-entry";
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
  flag("--out") ?? resolve(HERE, "../../../.renders/cmdfix"),
);
const LABEL = flag("--label") ?? "after";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const D = 10;
const W = Number(flag("--w") ?? 5);
const H = Number(flag("--h") ?? 8);

const EVA_NAME = flag("--name") ?? "Bob Kerman";
const WIDGET = flag("--widget") === "navball" ? "navball" : "crew-status";
const TARGET = WIDGET === "navball" ? "craft" : "kerbal";
const SUBJECT = WIDGET === "navball" ? "RCS" : `${EVA_NAME}'s lamp`;
const FPS = 10;

const shot = (page: Page, state: string) =>
  page.screenshot({ path: join(OUT_DIR, `${LABEL}-${state}.png`) });
const step = (page: Page, s: SharedStep) =>
  page.evaluate((s) => window.__sharedScene.step(s, "main"), s);

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const html = await prepareProbePage({
    entry: join(HERE, "probe", "shared-rail-entry.tsx"),
    htmlTemplate: PROBE_PAGES.widget.htmlTemplate,
    scriptSrcPlaceholder: PROBE_PAGES.widget.scriptSrcPlaceholder,
    slug: "lamp-delay",
  });
  const browser = await chromium.launch();
  try {
    const px = tilePixels(W, H);
    const size = {
      width: Math.ceil((2 * px.pxW + 16 + 24) / 2) * 2,
      height: Math.ceil((px.pxH + 100) / 2) * 2,
    };
    /*
     * A recorded video is at the viewport's CSS size whatever the device scale
     * factor, so the 2x clip is assembled from 2x screenshots taken as the
     * scene plays, each held for the time it took.
     */
    const framesDir = join(OUT_DIR, `.frames-${LABEL}`);
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(framesDir, { recursive: true });
    const context = await browser.newContext({
      viewport: size,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await installFixedClock(page);
    page.on("pageerror", (err) => console.error(`[page] ${err.message}`));
    await page.goto(pathToFileURL(html).toString());
    await page.waitForFunction(() => Boolean(window.__sharedScene));
    await page.evaluate((o) => window.__sharedScene.mount(o), {
      widget: WIDGET as "crew-status" | "navball",
      w: W,
      h: H,
      pxW: px.pxW,
      delaySeconds: D,
      evaName: EVA_NAME,
    });
    /* On a tile this small the kerbal outside is below the fold, so the list is scrolled to it as the operator would. */
    const reveal = () =>
      page.evaluate((n) => {
        for (const li of document.querySelectorAll(
          "#screen-main li, #screen-station li",
        )) {
          if (li.textContent?.includes(n))
            li.scrollIntoView({ block: "center" });
        }
      }, EVA_NAME);
    const frames: Array<{ file: string; at: number }> = [];
    const frame = async () => {
      const file = join(
        framesDir,
        `f${String(frames.length).padStart(5, "0")}.png`,
      );
      await page.screenshot({ path: file });
      frames.push({ file, at: Date.now() });
    };
    const pause = async (ms: number) => {
      const until = Date.now() + ms;
      await reveal();
      await frame();
      while (Date.now() < until) await frame();
    };
    const note = (text: string) =>
      page.evaluate(
        ([label, t]) => window.__sharedScene.caption(`${label}. ${t}`),
        [LABEL, text],
      );
    await pause(800);
    await note(
      `${SUBJECT} is off. One-way delay ${D} s. Pressing it on the main screen.`,
    );
    await pause(1500);
    await step(page, "press");
    await pause(500);
    await note("The press has gone; the mod has not answered it yet.");
    await pause(1500);
    await step(page, "accept");
    await step(page, "travel");
    await note("The mod has answered. The command is in flight.");
    await pause(300);
    await shot(page, "1-sent");
    let answered = false;
    for (let s = 0; s <= 2 * D + 3; s += 0.5) {
      await page.evaluate((x) => window.__sharedScene.at(x), s);
      if (s === 5) {
        await note(`5 s: still on its way to the ${TARGET}.`);
        await pause(300);
        await shot(page, "2-in-flight");
      }
      if (s === D + 0.5) {
        await note(
          `10 s: the command should have reached the ${TARGET}. Its reply is still on the way back.`,
        );
        await pause(300);
        await shot(page, "3-modelled");
      }
      if (s >= 2 * D && !answered) {
        answered = true;
        await page.evaluate(() => window.__sharedScene.answer("done"));
        await note("20 s: the reply lands and the reading confirms.");
        await pause(300);
        await shot(page, "4-confirmed");
      }
      await pause(500);
    }
    await pause(1500);
    await frame();
    await context.close();
    const list = frames
      .map((f, i) => {
        const next = frames[i + 1]?.at ?? f.at + 100;
        return `file '${f.file}'\nduration ${((next - f.at) / 1000).toFixed(3)}`;
      })
      .join("\n");
    const listFile = join(framesDir, "frames.txt");
    await writeFile(listFile, `${list}\nfile '${frames.at(-1)?.file}'\n`);
    const mp4 = join(OUT_DIR, `${LABEL}--lamp.mp4`);
    await execFileAsync(FFMPEG, [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-vf",
      `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mp4,
    ]);
    await rm(framesDir, { recursive: true, force: true });
    console.log(`wrote ${mp4}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
