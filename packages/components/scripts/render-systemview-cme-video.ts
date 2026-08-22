#!/usr/bin/env tsx
/**
 * Records SystemView's CME / solar-activity overlay (Task 8, the Kerbalism-
 * owned `system-view.entities` contribution in
 * `mod/GonogoKerbalismUplink/client/src/SystemViewCme/contribution.ts`) as
 * mp4 video, via a REAL live clock and Playwright's `recordVideo` context
 * option, same mechanics as `render-systemview-traffic-video.ts` (Task 6),
 * but through `capture-entry-kerbalism.tsx`: the CME entity only exists once
 * the Kerbalism Uplink client has self-registered, which `capture-entry.tsx`
 * deliberately never imports.
 *
 * Scene: the "root" (whole-system) frame, Kerbin and Duna orbiting Kerbol,
 * plus two heliocentric relay probes (an ordinary interplanetary comms
 * pattern) so the CME blob is shown stacking alongside a REAL vessel-orbit
 * ring and a REAL CommNet connection-line, the built-in contributions this
 * task must not cut off. Storm samples over the recording: none (the
 * baseline degrade), an inbound storm targeting Kerbin, Kerbin arrived
 * (stormState 2, warn-tinted), then a fresh storm inbound toward Duna once
 * Kerbin's has passed. Always ONE entry in `storms` at a time: it's scoped
 * to the active vessel's current SOI, one entry per star, so a real feed can
 * never carry two simultaneous entries for the same star; the sequence here
 * is sequential, not simultaneous, to stay representative of that.
 *
 * The inbound storms' `dist` RAMPS UP over a couple of real seconds before
 * settling at the body's true distance. This is test-fixture dramatization
 * only: `KerbalismStormEntry.dist` is a constant (the live sun-to-body
 * distance) in real Kerbalism telemetry, never a travelling value, see the
 * contribution's own module doc comment for why a literal expanding
 * shockwave can't be computed from the wire. The ramp exists purely so this
 * capture reads as "propagating outward" on video; the contribution code
 * itself always just draws whatever `dist` the wire reports, verbatim.
 *
 * Output: `local_docs/inbox/systemview-cme/*.mp4` (+ a couple of PNG stills).
 *
 * Run via `pnpm --filter @ksp-gonogo/components render-systemview-cme-video`.
 * Requires ffmpeg on PATH (webm -> mp4; the Claude app cannot render webm).
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
// Absolute main-repo path (not derived from this file's own location): a
// worktree-isolated run must still land the artifact where the task asks
// for it, same as any other gitignored local_docs output this repo's
// tooling writes.
const OUT_DIR =
  "/Users/jon.pepler/personal/gonogo/local_docs/inbox/systemview-cme";

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;
const KERBIN_SMA = 13_599_840_256;
const DUNA_SMA = 20_726_155_264;
const STORM_EJECTION_SPEED_MPS = 99_000_000; // stock default 0.33c

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
        orbit: {
          sma: KERBIN_SMA,
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
        name: "Duna",
        parentIndex: 0,
        radius: 320_000,
        gravParameter: 3.0136321e11,
        orbit: {
          sma: DUNA_SMA,
          ecc: 0.051,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0.9,
          epoch: 0,
        },
      },
    ],
  };
}

function heliocentricOrbit(sma: number, meanAnomalyAtEpoch: number) {
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
 * The shared scene: two heliocentric relay probes (bodyIndex 0, Kerbol's own
 * SOI), a real interplanetary comms pattern, linked by one active edge, plus
 * Kerbin and Duna as the CME's possible targets. Neither vessel carries
 * `vessel.identity`/`vessel.orbit` (no "active" craft in this capture): the
 * point is the built-in CONTRIBUTED entities (the roster's faint orbit rings,
 * the CommNet edge) stacking with the CME blob, not the widget's own
 * dedicated active-vessel ring.
 */
function sceneEmits(): Array<{ topic: string; value: unknown }> {
  return [
    { topic: "system.bodies", value: kerbolSystem() },
    {
      topic: "system.vessels",
      value: {
        vessels: [
          {
            vesselId: "v-relay-1",
            name: "Interplanetary Relay 1",
            vesselType: 6,
            situation: 3,
            bodyIndex: 0,
            crewCount: 0,
            crewCapacity: 0,
            commsControlSource: 2,
            orbit: heliocentricOrbit(16_000_000_000, 0.4),
          },
          {
            vesselId: "v-relay-2",
            name: "Interplanetary Relay 2",
            vesselType: 6,
            situation: 3,
            bodyIndex: 0,
            crewCount: 0,
            crewCapacity: 0,
            commsControlSource: 2,
            orbit: heliocentricOrbit(19_000_000_000, 2.6),
          },
        ],
      },
    },
    {
      topic: "comms.network",
      value: {
        nodes: [
          { id: "v-relay-1", displayName: "Interplanetary Relay 1", kind: 1 },
          { id: "v-relay-2", displayName: "Interplanetary Relay 2", kind: 1 },
        ],
        edges: [{ a: "v-relay-1", b: "v-relay-2", active: true }],
      },
    },
    { topic: "kerbalism.available", value: true },
  ];
}

// Raw numbers, not `{ magnitude }`-wrapped: `StubTransport` auto-wraps a
// Topic's declared `Value<Unit>` fields from plain numbers (the same
// pre-decode shape the real wire sends), same convention the traffic-video
// script's own `orbit()` helper follows. Wrapping here too would double-wrap.
function stormEntry(
  star: string,
  state: number,
  dist: number,
  arrivalUt: number,
  durationS: number,
) {
  return {
    star,
    stormState: state,
    stormTime: arrivalUt,
    stormDuration: durationS,
    dist,
  };
}

function spaceWeather(storms: ReturnType<typeof stormEntry>[]) {
  return {
    stormEjectionSpeed: STORM_EJECTION_SPEED_MPS,
    storms,
  };
}

const CARRIED_CHANNELS = [
  "system.bodies",
  "system.vessels",
  "comms.network",
  "kerbalism.available",
  "kerbalism.spaceweather",
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

/** Ramps a single storm's `dist` from near-zero up to `finalDist` over a
 *  handful of real-time steps, dramatizing "the front crossing the gap" for
 *  the video (see this file's own top doc comment for why the real wire
 *  value never actually does this). */
async function rampStormDist(
  page: Page,
  star: string,
  finalDist: number,
  arrivalUt: number,
  durationS: number,
  steps: number,
  stepMs: number,
): Promise<void> {
  for (let i = 1; i <= steps; i++) {
    const dist = finalDist * (i / steps);
    await evalCaptureEmit(
      page,
      "kerbalism.spaceweather",
      spaceWeather([stormEntry(star, 1, dist, arrivalUt, durationS)]),
    );
    await page.waitForTimeout(stepMs);
  }
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

async function finalizeVideo(page: Page, outName: string): Promise<void> {
  const video = page.video();
  if (!video) throw new Error("Capture: no video recorded");
  const webmPath = await video.path();
  const mp4Path = join(OUT_DIR, outName);
  await convertToMp4(webmPath, mp4Path);
  console.log(`Wrote ${mp4Path}`);
}

async function captureCme(probeHtmlOut: string): Promise<void> {
  console.log("\n── CME overlay capture ──");
  const browser = await chromium.launch();
  const videoDir = join(OUT_DIR, "_video-tmp");
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
      config: { frame: "root" },
      w: 10,
      h: 12,
      pxW: 900,
      pxH: 900,
      carriedChannels: CARRIED_CHANNELS,
      streamEmits: sceneEmits(),
      warpRate: 1,
    });

    // Baseline: Kerbalism present, no active storm. Confirms the "degrades
    // to nothing" contract while the vessel orbits + CommNet edge already
    // draw, so the diff against the next shot is purely the CME appearing.
    await page.waitForTimeout(500);
    await page.screenshot({
      path: join(OUT_DIR, "cme-baseline-no-storm.png"),
    });

    const utNow = await evalUtNow(page);

    // Kerbin storm, inbound, ramping out from Kerbol over ~2s.
    await rampStormDist(
      page,
      "Kerbol",
      KERBIN_SMA,
      utNow + 300,
      3_600,
      12,
      160,
    );
    await page.screenshot({ path: join(OUT_DIR, "cme-inbound.png") });

    await page.waitForTimeout(1_000);

    // Kerbin's storm arrives (stormState 2, warn-tinted). Still a single
    // `storms` entry, same as every other sample in this capture.
    await evalCaptureEmit(
      page,
      "kerbalism.spaceweather",
      spaceWeather([stormEntry("Kerbol", 2, KERBIN_SMA, utNow, 1_800)]),
    );
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: join(OUT_DIR, "cme-two-storms.png") });

    // Kerbin's storm passes, then a fresh one begins inbound toward Duna,
    // sequential rather than simultaneous.
    await evalCaptureEmit(page, "kerbalism.spaceweather", spaceWeather([]));
    await page.waitForTimeout(500);
    await rampStormDist(
      page,
      "Kerbol",
      DUNA_SMA,
      utNow + 2_400,
      2_400,
      10,
      150,
    );
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: join(OUT_DIR, "cme-full-reach.png") });

    // Storm passes: confirms the overlay clears again.
    await evalCaptureEmit(page, "kerbalism.spaceweather", spaceWeather([]));
    await page.waitForTimeout(1_500);

    await context.close();
    await finalizeVideo(page, "systemview-cme.mp4");
  } finally {
    await browser.close();
    await rm(videoDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const probeHtmlOut = await prepareProbePage({
    entry: join(PROBE_DIR, "capture-entry-kerbalism.tsx"),
    htmlTemplate: join(PROBE_DIR, "capture.html"),
    scriptSrcPlaceholder:
      '<script type="module" src="./capture-entry.bundle.js"></script>',
    slug: "systemview-cme-video",
  });

  await captureCme(probeHtmlOut);

  console.log(`\nDone. Artifacts in:\n  ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
