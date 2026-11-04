#!/usr/bin/env tsx
/**
 * Records the Tracking Station over several seconds of fresh telemetry updates, in which the craft's report and the command centre's record take turns being the newer, so the held-route line comes and goes.
 *
 * Run with `HELD_ROW_LABEL=before|after pnpm --filter @ksp-gonogo/components exec tsx scripts/render-held-route-row.ts`; output goes under `.renders/tsbounce/`.
 */
import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium, type Page } from "playwright";
import { prepareProbePage } from "./widgetRenderHarness";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const OUT_DIR = resolve(HERE, "../../../.renders/tsbounce");
const LABEL = process.env.HELD_ROW_LABEL ?? "after";

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;

function kerbolSystem() {
  return {
    bodies: [
      {
        index: 0,
        name: "Kerbol",
        parentIndex: null,
        radius: 261_600_000,
        gravParameter: KERBOL_MU,
        orbit: null,
      },
      {
        index: 1,
        name: "Kerbin",
        parentIndex: 0,
        radius: 600_000,
        gravParameter: KERBIN_MU,
        sphereOfInfluence: 84_159_286,
        isHome: true,
        orbit: {
          sma: 13_599_840_256,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 3.14,
          epoch: 0,
        },
      },
      {
        index: 2,
        name: "Mun",
        parentIndex: 1,
        radius: 200_000,
        gravParameter: 6.5138398e10,
        orbit: {
          sma: 12_000_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 1.93228,
          epoch: 0,
        },
      },
    ],
  };
}

const ORBIT = {
  referenceBodyIndex: 1,
  sma: 4_000_000,
  ecc: 0,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  mu: KERBIN_MU,
};

function updates(ut: number, held: boolean) {
  return [
    {
      topic: "trackingStation.catalog",
      value: {
        entries: [
          {
            vesselId: "v-active",
            name: "Active Craft",
            vesselType: 0,
            situation: 3,
            bodyIndex: 1,
            placeAsOfUt: ut - 0.5,
            orbit: { ...ORBIT, epoch: ut - 0.5 },
          },
        ],
      },
    },
    { topic: "vessel.orbit", value: { ...ORBIT, epoch: held ? ut - 1 : ut } },
  ];
}

async function evalRenderCapture(
  page: Page,
  payload: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    (p) =>
      (
        window as unknown as {
          __renderCapture: (payload: unknown) => Promise<void>;
        }
      ).__renderCapture(p),
    payload,
  );
}

async function evalCaptureEmit(
  page: Page,
  topic: string,
  value: unknown,
): Promise<void> {
  await page.evaluate(
    ([t, v]) =>
      (
        window as unknown as {
          __captureEmit: (topic: string, value: unknown) => void;
        }
      ).__captureEmit(t as string, v),
    [topic, value],
  );
}

async function evalUtNow(page: Page): Promise<number> {
  const ut = await page.evaluate(() =>
    (
      window as unknown as { __captureUtNow: () => number | null }
    ).__captureUtNow(),
  );
  if (ut === null) throw new Error("Capture: clock produced no utNow yet");
  return ut;
}

async function convertToMp4(webmPath: string, mp4Path: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    webmPath,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    mp4Path,
  ]);
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const probeHtmlOut = await prepareProbePage({
    entry: join(PROBE_DIR, "capture-entry.tsx"),
    htmlTemplate: join(PROBE_DIR, "capture.html"),
    scriptSrcPlaceholder:
      '<script type="module" src="./capture-entry.bundle.js"></script>',
    slug: "held-route-row",
  });
  const browser = await chromium.launch();
  const videoDir = join(OUT_DIR, `_video-tmp-${LABEL}`);
  await mkdir(videoDir, { recursive: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 900, height: 900 },
      recordVideo: { dir: videoDir, size: { width: 900, height: 900 } },
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.error("  [page error]", err.message));
    await page.goto(pathToFileURL(probeHtmlOut).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __renderCapture?: unknown })
          .__renderCapture === "function",
      undefined,
      { timeout: 10_000 },
    );
    const base = [
      { topic: "trackingStation.bodies", value: kerbolSystem() },
      {
        topic: "vessel.identity",
        value: {
          vesselId: "v-active",
          name: "Active Craft",
          vesselType: 0,
          situation: 3,
          parentBodyIndex: 1,
        },
      },
    ];
    await evalRenderCapture(page, {
      widgetId: "tracking-station",
      config: { frame: "Kerbin" },
      w: 10,
      h: 12,
      pxW: 900,
      pxH: 900,
      streamEmits: base,
      warpRate: 1,
    });
    await page.waitForTimeout(300);
    await page.evaluate((text) => {
      const el = document.createElement("div");
      el.textContent = text;
      el.style.cssText =
        "position:fixed;left:0;right:0;bottom:0;padding:6px 10px;background:#000c;color:#fff;font:14px monospace;z-index:99999";
      document.body.appendChild(el);
    }, `${LABEL.toUpperCase()}: fresh updates every 600 ms, the held-route line comes and goes`);
    const ut = await evalUtNow(page);
    let stillTaken = false;
    for (let i = 0; i < 14; i += 1) {
      const held = i % 2 === 0;
      for (const e of updates(ut + i * 0.6, held)) {
        await evalCaptureEmit(page, e.topic, e.value);
      }
      await page.waitForTimeout(600);
      if (!stillTaken && !held) {
        stillTaken = true;
        await page.screenshot({
          path: join(OUT_DIR, `${LABEL}-line-hidden.png`),
        });
      }
      if (held && i === 2) {
        await page.screenshot({
          path: join(OUT_DIR, `${LABEL}-line-shown.png`),
        });
      }
    }
    await context.close();
    const video = page.video();
    if (!video) throw new Error("no video recorded");
    const mp4 = join(OUT_DIR, `${LABEL}.mp4`);
    await convertToMp4(await video.path(), mp4);
    console.log(`Wrote ${mp4}`);
  } finally {
    await browser.close();
    await rm(videoDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
