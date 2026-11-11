#!/usr/bin/env tsx
/**
 * Records a Commcast message crossing as seen on TrackingStation, as one
 * real-time capture: the Fleet Comms Traffic overlay draws the pending entry as
 * a pulse along the active craft's comm path, a second message is cancelled
 * mid-crossing and its pulse goes, and the first is delivered and leaves.
 *
 * The pulse is the only thing TrackingStation draws for a message: the queue
 * entry's words and recipient are not shown there.
 *
 * Output: COMMCAST_TRAFFIC_RENDER_OUT (default `local_docs/renders/commcast-traffic`),
 * a `tracking-station.mp4` and the marks (seconds from the start of the video) as
 * `marks.json`, for the caption pass.
 */
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium, type Page } from "playwright";
import { prepareProbePage } from "./widgetRenderHarness";

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const OUT_DIR =
  process.env.COMMCAST_TRAFFIC_RENDER_OUT ??
  resolve(HERE, "../../../local_docs/renders/commcast-traffic");

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
        // `computeCommsNetworkEntities`'s `homeBodyName` resolves "home" off
        // this flag, not a fixed body index: without it, EVERY edge
        // touching the home node (both `home<->v-relay` and `home<->v-other`
        // in this scene) fails to resolve a position and is silently
        // omitted, leaving only the relay<->active hop drawn. This was the
        // actual cause of round 1's "route reads as a single disconnected
        // stub" defect, not just the collinear `argPe` geometry below.
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
      /* Kerbin needs at least one child body, or SystemDiagram shows its empty state and never computes the overlay the pulses are drawn on. */
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

/**
 * `argPe` defaults to 0 for the active vessel's own orbit, and
 * `vesselOrbitsContribution`'s `connection-line`/traffic-pulse endpoints join a
 * vessel where it is at the instant on screen, carried from its `epoch` and
 * `meanAnomalyAtEpoch`. Giving v-relay/v-other distinct `argPe` and mean
 * anomalies spreads their join points around the diagram so the route reads as
 * a real bent path.
 */
function orbit(sma: number, meanAnomalyAtEpoch = 0, argPe = 0) {
  return {
    sma,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe,
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
      topic: "trackingStation.catalog",
      value: {
        entries: [
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
            orbit: orbit(6_000_000, 1.4, 70),
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
            orbit: orbit(8_000_000, 3.7, -60),
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

/**
 * The `traffic` capture's own scene: everything `sceneEmits()` carries
 * except `vessel.orbit`, so SystemDiagram never draws the active vessel's
 * own dedicated ring/live-trajectory patch (both solid accent-green,
 * unrelated to selection, see this file's own doc comment). `v-active`
 * still carries a full orbit on its roster entry (`trackingStation.catalog`, above),
 * so the traffic route's own endpoint still resolves a real position for
 * the connection-line to join, and (round-4 fix) picks up the same faint
 * `orbit-path` ring/dot `tracking-station-vessel-orbits` draws for every other
 * roster vessel, since the active-vessel suppression in `index.tsx` no
 * longer fires without a real `vessel.orbit` sample. v-active just doesn't
 * get its own extra dedicated bright ring on top of that.
 */
function sceneEmitsForTraffic(): Array<{ topic: string; value: unknown }> {
  return sceneEmits().filter((e) => e.topic !== "vessel.orbit");
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

const MESSAGE = "Ares 4: Confirm residuals when you have them.";
const CANCELLED = "Ares 4: Stand by for a manoeuvre update.";

function messageEntry(id: string, label: string, dispatchedAt: number) {
  return {
    id,
    command: "commcast.message.deliver",
    label,
    topic: "",
    vantage: "ground:Kerbal Space Center",
    craft: "v-active",
    laneSeq: 1,
    attempts: 1,
    members: [id],
    dispatchedAt,
    oneWaySeconds: 10,
  };
}

async function capture(probeHtmlOut: string): Promise<void> {
  const browser = await chromium.launch();
  const videoDir = join(OUT_DIR, "_video-tmp");
  await mkdir(videoDir, { recursive: true });
  try {
    const started = Date.now();
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
      widgetId: "tracking-station",
      config: { frame: "Kerbin" },
      w: 10,
      h: 12,
      pxW: 900,
      pxH: 900,
      streamEmits: sceneEmitsForTraffic(),
      warpRate: 1,
    });
    await page.waitForTimeout(300);
    const marks: Record<string, number> = {};
    const mark = (name: string) => {
      marks[name] = (Date.now() - started) / 1000;
    };
    mark("idle");
    await page.waitForTimeout(1_500);

    const t0 = await evalUtNow(page);
    mark("sent");
    await evalCaptureEmit(page, "system.uplink.pending", {
      pending: [messageEntry("m1", MESSAGE, t0)],
    });
    await page.screenshot({ path: join(OUT_DIR, "crossing.png") });

    await page.waitForTimeout(3_000);
    const t1 = await evalUtNow(page);
    mark("second");
    await evalCaptureEmit(page, "system.uplink.pending", {
      pending: [
        messageEntry("m1", MESSAGE, t0),
        messageEntry("m2", CANCELLED, t1),
      ],
    });
    await page.waitForTimeout(2_500);
    mark("cancel");
    await evalCaptureEmit(page, "system.uplink.pending", {
      pending: [messageEntry("m1", MESSAGE, t0)],
    });
    await page.screenshot({ path: join(OUT_DIR, "cancelled.png") });

    await page.waitForTimeout(5_000);
    mark("delivered");
    await evalCaptureEmit(page, "system.uplink.pending", { pending: [] });
    await page.waitForTimeout(2_500);
    mark("end");
    await page.screenshot({ path: join(OUT_DIR, "delivered.png") });

    await context.close();
    await finalizeVideo(page, "tracking-station.mp4");
    await writeFile(
      join(OUT_DIR, "marks.json"),
      JSON.stringify(marks, null, 2),
    );
  } finally {
    await browser.close();
    await rm(videoDir, { recursive: true, force: true });
  }
}

async function finalizeVideo(page: Page, outName: string): Promise<void> {
  const video = page.video();
  if (!video) throw new Error("Capture: no video recorded");
  const webmPath = await video.path();
  const mp4Path = join(OUT_DIR, outName);
  await convertToMp4(webmPath, mp4Path);
  console.log(`Wrote ${mp4Path}`);
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const probeHtmlOut = await prepareProbePage({
    entry: join(PROBE_DIR, "capture-entry.tsx"),
    htmlTemplate: join(PROBE_DIR, "capture.html"),
    scriptSrcPlaceholder:
      '<script type="module" src="./capture-entry.bundle.js"></script>',
    slug: "commcast-traffic-video",
  });
  await capture(probeHtmlOut);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
