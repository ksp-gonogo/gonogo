#!/usr/bin/env tsx
/**
 * Records SystemView's command-traffic decoration as mp4 video,
 * via a REAL live clock and Playwright's `recordVideo` context option:
 * unlike the deterministic PNG/visual-gate path, animation actually runs
 * here (see `scripts/probe/capture-entry.tsx`'s own doc comment).
 *
 * Two captures, because the two things worth showing want opposite clock
 * speeds:
 * - `traffic`: warpRate=1 (real time), so a `system.uplink.pending` entry's
 *   real one-way-delay leg animates smoothly over several real seconds.
 *   Also fires a mid-capture click to select a SEPARATE vessel, showing the
 *   coloured CommNet path decoration appear alongside the pulsing traffic.
 * - `orbits`: warpRate elevated (~400x), so vessels visibly sweep along
 *   their faint orbits over a short capture; traffic wouldn't read as
 *   anything but a flicker at this speed, so this capture skips it.
 *
 * Output: `local_docs/inbox/systemview-traffic/*.mp4` (+ a couple of PNG
 * stills), also copied to `local_docs/inbox/systemview-contributions/`.
 *
 * Run via `pnpm --filter @ksp-gonogo/components render-systemview-traffic-video`.
 * Requires ffmpeg on PATH (webm -> mp4; the Claude app cannot render webm).
 */
import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium, type Page } from "playwright";
import { prepareProbePage } from "./widgetRenderHarness";

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const REPO_ROOT = resolve(HERE, "../../..");
const OUT_DIRS = [
  resolve(REPO_ROOT, "local_docs/inbox/systemview-traffic"),
  resolve(REPO_ROOT, "local_docs/inbox/systemview-contributions"),
];

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
      // Kerbin needs at least one CHILD body, or `SystemDiagram` bails out to
      // its "No bodies orbiting Kerbin yet" empty state before ever computing
      // the overlay projection `SystemEntitiesLayer` (and so every vessel
      // orbit / comms-edge / traffic pulse) depends on.
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

function orbit(sma: number, meanAnomalyAtEpoch = 0) {
  return {
    sma,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch,
    epoch: 0,
  };
}

/**
 * The shared scene: the active vessel reaches home over one relay hop
 * (home -> v-relay -> v-active), while a separate, selectable vessel
 * (v-other) sits on a direct one-hop link (home -> v-other). Two distinct
 * routes on the same diagram: traffic rides the relayed one, selection
 * highlights the direct one, so a viewer can tell the two decorations apart.
 */
function sceneEmits(): Array<{ topic: string; value: unknown }> {
  return [
    { topic: "system.bodies", value: kerbolSystem() },
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
    {
      topic: "vessel.orbit",
      value: {
        referenceBodyIndex: 1,
        sma: 4_000_000,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 0,
        mu: KERBIN_MU,
      },
    },
    {
      topic: "system.vessels",
      value: {
        vessels: [
          {
            vesselId: "v-active",
            name: "Active Craft",
            vesselType: 0,
            situation: 3,
            bodyIndex: 1,
            crewCount: 1,
            crewCapacity: 2,
            commsControlSource: 1,
            orbit: orbit(4_000_000),
          },
          {
            vesselId: "v-relay",
            name: "Comsat Relay-1",
            vesselType: 6,
            situation: 3,
            bodyIndex: 1,
            crewCount: 0,
            crewCapacity: 0,
            commsControlSource: 2,
            orbit: orbit(6_000_000, 1.4),
          },
          {
            vesselId: "v-other",
            name: "Munar Transfer Stage",
            vesselType: 0,
            situation: 3,
            bodyIndex: 1,
            crewCount: 2,
            crewCapacity: 2,
            commsControlSource: 2,
            orbit: orbit(8_000_000, 3.7),
          },
        ],
      },
    },
    {
      topic: "comms.network",
      value: {
        nodes: [
          { id: "home", displayName: "KSC", kind: 0 },
          { id: "v-relay", displayName: "Comsat Relay-1", kind: 1 },
          { id: "v-active", displayName: "Active Craft", kind: 2 },
          { id: "v-other", displayName: "Munar Transfer Stage", kind: 2 },
        ],
        edges: [
          { a: "home", b: "v-relay", active: true },
          { a: "v-relay", b: "v-active", active: true },
          { a: "home", b: "v-other", active: true },
        ],
      },
    },
  ];
}

function pendingEntry(id: string, dispatchedAt: number, oneWaySeconds: number) {
  return {
    id,
    command: "kos.run",
    label: "Deploy solar panels",
    topic: "",
    vantage: "ksc",
    dispatchedAt,
    oneWaySeconds,
  };
}

const CARRIED_CHANNELS = [
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
  "system.vessels",
  "comms.network",
  "system.uplink.pending",
];

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

/**
 * Selects a vessel's `orbit-path` ring the way an operator actually can: a
 * plain `page.click()` targets the shape's BOUNDING-BOX CENTRE, which for a
 * hollow, `fill:none` ellipse is empty space, not the stroked path itself
 * (the same reason a real mouse click there would miss too). Clicks the top
 * of the ring's bounding box instead, safely inside the entity's own wide
 * invisible `data-hit-target` stroke (`SystemEntitiesLayer`'s `strokeWidth:
 * 14` hit ring).
 */
async function clickRingTop(page: Page, entityId: string): Promise<void> {
  const locator = page.locator(`[data-entity-id="${entityId}"]`);
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Capture: no bounding box for ${entityId}`);
  await page.mouse.click(box.x + box.width / 2, box.y + 5);
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

async function captureTraffic(probeHtmlOut: string): Promise<void> {
  console.log("\n── traffic capture (warpRate=1) ──");
  const browser = await chromium.launch();
  const videoDir = join(OUT_DIRS[0], "_video-tmp-traffic");
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

    await evalRenderCapture(page, {
      widgetId: "system-view",
      config: { frame: "Kerbin" },
      w: 10,
      h: 12,
      pxW: 900,
      pxH: 900,
      carriedChannels: CARRIED_CHANNELS,
      streamEmits: sceneEmits(),
      warpRate: 1,
    });

    // Let the clock anchor on a real sample before reading it.
    await page.waitForTimeout(300);
    const utNow = await evalUtNow(page);

    // Three staggered pulses, already at different points along the route
    // when the video opens, plus long enough legs (10s one-way = 20s round
    // trip) to stay in flight across the whole ~14s capture.
    await evalCaptureEmit(page, "system.uplink.pending", {
      pending: [
        pendingEntry("cmd-1", utNow, 10),
        pendingEntry("cmd-2", utNow - 4, 10),
        pendingEntry("cmd-3", utNow - 8, 10),
      ],
    });

    await page.screenshot({
      path: join(OUT_DIRS[0], "systemview-traffic-pulsing.png"),
    });

    // Midway through: select the OTHER vessel (not the one traffic is
    // riding) so the coloured CommNet path decoration appears alongside the
    // still-pulsing traffic, on a visibly different route.
    await page.waitForTimeout(4_000);
    await clickRingTop(page, "vessel-orbit:v-other");
    await page.waitForTimeout(500);

    await page.screenshot({
      path: join(OUT_DIRS[0], "systemview-traffic-with-selection.png"),
    });

    // Refresh the pending queue partway through so traffic keeps animating
    // (rather than fading out) for the remainder of the recording.
    await page.waitForTimeout(3_000);
    const utNow2 = await evalUtNow(page);
    await evalCaptureEmit(page, "system.uplink.pending", {
      pending: [
        pendingEntry("cmd-4", utNow2, 10),
        pendingEntry("cmd-5", utNow2 - 5, 10),
      ],
    });

    await page.waitForTimeout(6_000);

    await context.close();
    await finalizeVideo(page, "systemview-traffic.mp4");
  } finally {
    await browser.close();
    await rm(videoDir, { recursive: true, force: true });
  }
}

async function captureOrbits(probeHtmlOut: string): Promise<void> {
  console.log("\n── orbit-tracking capture (warpRate=400) ──");
  const browser = await chromium.launch();
  const videoDir = join(OUT_DIRS[0], "_video-tmp-orbits");
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

    await evalRenderCapture(page, {
      widgetId: "system-view",
      config: { frame: "Kerbin" },
      w: 10,
      h: 12,
      pxW: 900,
      pxH: 900,
      carriedChannels: CARRIED_CHANNELS,
      streamEmits: sceneEmits(),
      warpRate: 400,
    });

    // `useViewUt()` (what positions the active vessel's + Mun's dots) is the
    // CONFIRMED view: it only advances as far as the newest sample's own
    // `validAt`, so the one-shot mount emit above leaves it pinned however
    // fast `warpRate` runs. Re-stamp the position-bearing topics on a real
    // interval so the confirmed edge keeps pace with the clock, the way a
    // live mod connection's steady sample stream would.
    const positionEmits = sceneEmits().filter(
      (e) => e.topic === "vessel.orbit" || e.topic === "system.bodies",
    );
    await page.evaluate(
      (args) =>
        (
          window as unknown as {
            __captureStartLiveSamples: (
              emits: unknown,
              intervalMs: number,
            ) => void;
          }
        ).__captureStartLiveSamples(args.emits, args.intervalMs),
      { emits: positionEmits, intervalMs: 100 },
    );

    await page.waitForTimeout(500);
    await page.screenshot({
      path: join(OUT_DIRS[0], "systemview-orbits-tracking.png"),
    });
    await page.waitForTimeout(7_000);

    await context.close();
    await finalizeVideo(page, "systemview-orbits-tracking.mp4");
  } finally {
    await browser.close();
    await rm(videoDir, { recursive: true, force: true });
  }
}

async function finalizeVideo(page: Page, outName: string): Promise<void> {
  const video = page.video();
  if (!video) throw new Error("Capture: no video recorded");
  const webmPath = await video.path();
  const mp4Path = join(OUT_DIRS[0], outName);
  await convertToMp4(webmPath, mp4Path);
  console.log(`Wrote ${mp4Path}`);
}

async function main(): Promise<void> {
  for (const dir of OUT_DIRS) await mkdir(dir, { recursive: true });

  const probeHtmlOut = await prepareProbePage({
    entry: join(PROBE_DIR, "capture-entry.tsx"),
    htmlTemplate: join(PROBE_DIR, "capture.html"),
    scriptSrcPlaceholder:
      '<script type="module" src="./capture-entry.bundle.js"></script>',
    slug: "systemview-traffic-video",
  });

  await captureTraffic(probeHtmlOut);
  await captureOrbits(probeHtmlOut);

  // Mirror every artifact this run produced into the plan's own output path.
  const produced = (await readdir(OUT_DIRS[0])).filter(
    (f) => f.endsWith(".mp4") || f.endsWith(".png"),
  );
  for (const f of produced) {
    await copyFile(join(OUT_DIRS[0], f), join(OUT_DIRS[1], f));
  }
  console.log(
    `\nDone. ${produced.length} artifact(s) in both:\n  ${OUT_DIRS[0]}\n  ${OUT_DIRS[1]}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
