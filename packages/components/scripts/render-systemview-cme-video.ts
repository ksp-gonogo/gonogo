#!/usr/bin/env tsx
/**
 * Records SystemView's CME / solar-activity overlay (the Kerbalism-owned
 * `system-view.entities` contribution in
 * `mod/GonogoKerbalismUplink/client/src/SystemViewCme/contribution.ts`) as
 * mp4 video, via a REAL live clock and Playwright's `recordVideo` context
 * option, same mechanics as `render-systemview-traffic-video.ts`, but
 * through `capture-entry-kerbalism.tsx`: the CME entity only exists once the
 * Kerbalism Uplink client has self-registered, which `capture-entry.tsx`
 * deliberately never imports.
 *
 * Scene: the "root" (whole-system) frame, Kerbin and Duna orbiting Kerbol,
 * plus two heliocentric relay probes (an ordinary interplanetary comms
 * pattern) so the travelling pulse is shown stacking alongside a REAL
 * vessel-orbit ring and a REAL CommNet connection-line, the built-in
 * contributions this capture must not cut off. Storm samples over the
 * recording: none (the baseline degrade), an inbound storm targeting Kerbin
 * (stormState 1, faint), Kerbin arrived (stormState 2, brighter, same
 * yellow), then a fresh storm inbound toward Duna once Kerbin's has fully
 * passed. Always ONE entry in `storms` at a time: it's scoped to the active
 * vessel's current SOI, one entry per star, so a real feed can never carry
 * two simultaneous entries for the same star; the sequence here is
 * sequential, not simultaneous, to stay representative of that.
 *
 * Round 5: the wave is now a SINGLE, non-looping pass driven by real UT
 * (`SystemEntitiesLayer.tsx`'s `Primitive` "travelling-pulse" case), not a
 * decorative CSS loop, so this capture emits each storm's `stormTime`
 * (arrival UT) as a REAL point in the future/past relative to the clock's
 * own `utNow`, and waits out the actual departure->arrival->clear window in
 * WALL time (`warpRate`-scaled) rather than just dwelling long enough for a
 * loop to visibly repeat. `warpRate: 40` compresses Kerbin's real transit
 * (dist/`stormEjectionSpeed`, ~137s of storm-UT) and Duna's (~209s) into a
 * manageable clip; both storm durations stay short enough relative to their
 * transit that `segmentLengthMetres` (`stormEjectionSpeed * stormDuration`)
 * lands well under the star->body distance, unclamped, so the two pulses
 * still visibly differ in LENGTH the way the previous round's fixture
 * intended. A screenshot lands mid-transit, another right at arrival, and
 * the capture keeps rolling past `clearUt` for each storm to show the far
 * portion of the wave fading out rather than cutting off hard.
 *
 * Output: `local_docs/inbox/systemview-cme/*.mp4` (+ a couple of PNG
 * stills), also copied to `local_docs/inbox/systemview-contributions/`.
 *
 * Run via `pnpm --filter @ksp-gonogo/components render-systemview-cme-video`.
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
// Absolute main-repo paths (not derived from this file's own location): a
// worktree-isolated run must still land the artifact where the task asks
// for it, same as any other gitignored local_docs output this repo's
// tooling writes. Mirrors both, same convention as
// `render-systemview-traffic-video.ts`'s own `OUT_DIRS`.
const OUT_DIRS = [
  "/Users/jon.pepler/personal/gonogo/local_docs/inbox/systemview-cme",
  "/Users/jon.pepler/personal/gonogo/local_docs/inbox/systemview-contributions",
];
const OUT_DIR = OUT_DIRS[0];

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;
const KERBIN_SMA = 13_599_840_256;
const DUNA_SMA = 20_726_155_264;
const STORM_EJECTION_SPEED_MPS = 99_000_000; // stock default 0.33c
// Chosen so each storm's segment length (speed * duration, clamped to the
// star->body distance) reads as a PARTIAL segment riding a longer line, not
// a pulse that immediately clamps to the full apex->tip span: 44% of
// Kerbin's distance, 57% of Duna's, visibly different lengths so the video
// demonstrates the length<->duration mapping, not just the travel.
const KERBIN_STORM_DURATION_S = 60;
const DUNA_STORM_DURATION_S = 120;
// Compresses storm-UT into wall time: the wave's real transit (dist /
// STORM_EJECTION_SPEED_MPS) is ~137s of storm-UT for Kerbin and ~209s for
// Duna, both far too long to wait out at 1x. `utNowEstimate` scales linearly
// with this (`view-clock-formula.ts`'s `computeUtNowEstimate`), the same
// mechanism `captureOrbits` in `render-systemview-traffic-video.ts` uses.
const WARP_RATE = 40;
/** Real transit time (storm-UT seconds) at the fixture's own ejection speed. */
function transitSeconds(distMetres: number): number {
  return distMetres / STORM_EJECTION_SPEED_MPS;
}
/** Wall-clock ms for a span of storm-UT seconds at `WARP_RATE`. */
function wallMs(stormUtSeconds: number): number {
  return (stormUtSeconds / WARP_RATE) * 1000;
}

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

/**
 * A vessel-to-star unit vector for `weather.stars`, in Kerbalism's own
 * `VesselData.SunInfo.Direction` convention: the contribution negates it for
 * the pulse's bearing (star-to-body). Chosen so the two storms in this
 * capture visibly point at the body they're actually scoped to:
 * `KERBIN_DIRECTION` negates to roughly Kerbin's own angle at this scene's
 * `meanAnomalyAtEpoch` (~180 deg, ecc=0 so exact), `DUNA_DIRECTION` to
 * Duna's (~51.6 deg, close enough at ecc=0.051 for a video fixture). Real
 * Kerbalism telemetry supplies this from the vessel's actual position; nothing
 * in the contribution itself changes, this is purely fixture geometry so the
 * capture reads as "the pulse points at the threatened body".
 */
function starDirection(x: number, y: number, z: number) {
  return { x, y, z };
}
const KERBIN_DIRECTION = starDirection(1, 0, 0);
const DUNA_DIRECTION = starDirection(-0.6225, 0, -0.7826);

function spaceWeather(
  storms: ReturnType<typeof stormEntry>[],
  direction: ReturnType<typeof starDirection> = KERBIN_DIRECTION,
) {
  return {
    stormEjectionSpeed: STORM_EJECTION_SPEED_MPS,
    stars: [{ star: "Kerbol", direction }],
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
      warpRate: WARP_RATE,
    });

    // Baseline: Kerbalism present, no active storm. Confirms the "degrades
    // to nothing" contract while the vessel orbits + CommNet edge already
    // draw, so the diff against the next shot is purely the pulse appearing.
    await page.waitForTimeout(500);
    await page.screenshot({
      path: join(OUT_DIR, "cme-baseline-no-storm.png"),
    });

    // -- Kerbin storm: single real UT window, ONE emit for its whole
    // lifecycle (no mid-flight update). `StubTransport.emit()` stamps
    // `deliveredAt: 0` by default, and `ViewClock.observeSample` resets its
    // wall<->UT anchor to (deliveredAt, thisWallMoment) on EVERY delivered
    // sample regardless of topic (`view-clock.ts`): a second emit partway
    // through a storm's window would silently rebase `utNowEstimate()` back
    // toward zero, corrupting the wave's own timing rather than just its
    // style. So `stormTime` is set as an ABSOLUTE UT offset (`transitS`, not
    // `utNow + transitS`): the reset THIS emit itself triggers is exactly
    // what makes wall-time-zero-from-here equal storm-UT-zero, so the wave
    // departs the star at roughly this call's own wall-clock moment and
    // reaches Kerbin `transitS` storm-UT-seconds later, scaled to wall time
    // by `WARP_RATE`. Held at stormState 2 (arrived) for its whole window so
    // Duna's storm (below) can carry state 1 (inbound) instead, still
    // showing both style states across the capture without a disruptive
    // re-emit.
    const kerbinTransitS = transitSeconds(KERBIN_SMA);
    await evalCaptureEmit(
      page,
      "kerbalism.spaceweather",
      spaceWeather(
        [
          stormEntry(
            "Kerbol",
            2,
            KERBIN_SMA,
            kerbinTransitS,
            KERBIN_STORM_DURATION_S,
          ),
        ],
        KERBIN_DIRECTION,
      ),
    );
    // Mid-transit: the wave is under way, well short of the target.
    await page.waitForTimeout(wallMs(kerbinTransitS * 0.5));
    await page.screenshot({ path: join(OUT_DIR, "cme-inbound.png") });
    // Out to arrival: the leading edge should now sit at Kerbin itself.
    await page.waitForTimeout(wallMs(kerbinTransitS * 0.5));
    await page.screenshot({ path: join(OUT_DIR, "cme-crossing-kerbin.png") });
    // Halfway through the crossing window: the wave has slid on past Kerbin
    // (never a second wave, the SAME segment), its far portion fading
    // rather than staying full-strength. `clearUt` sits at the FULL
    // duration past arrival, so this is deliberately short of that, or
    // there would be nothing left to screenshot.
    await page.waitForTimeout(wallMs(KERBIN_STORM_DURATION_S * 0.5));
    await page.screenshot({ path: join(OUT_DIR, "cme-fading-kerbin.png") });
    // Out past `clearUt`: confirms the wave finishes cleanly rather than
    // lingering, before the next storm begins.
    await page.waitForTimeout(wallMs(KERBIN_STORM_DURATION_S * 0.5) + 800);

    // Kerbin's storm has fully passed: clear it, then a fresh one begins
    // inbound toward Duna, sequential rather than simultaneous (matches the
    // "one entry per star" contract this fixture's own doc comment notes).
    // Bearing swings from Kerbin's direction to Duna's, and a LONGER
    // `stormDuration` gives this pulse a visibly longer segment than
    // Kerbin's, demonstrating the length<->duration mapping alongside a
    // SECOND full single-pass (proving the wave isn't a one-shot fluke). The
    // CLEAR emit itself resets the clock's anchor again, which is exactly
    // what the next storm's own absolute `stormTime` (below) is anchored to.
    await evalCaptureEmit(page, "kerbalism.spaceweather", spaceWeather([]));
    await page.waitForTimeout(500);
    const dunaTransitS = transitSeconds(DUNA_SMA);
    await evalCaptureEmit(
      page,
      "kerbalism.spaceweather",
      spaceWeather(
        [
          stormEntry(
            "Kerbol",
            1,
            DUNA_SMA,
            dunaTransitS,
            DUNA_STORM_DURATION_S,
          ),
        ],
        DUNA_DIRECTION,
      ),
    );
    await page.waitForTimeout(wallMs(dunaTransitS * 0.5));
    await page.screenshot({ path: join(OUT_DIR, "cme-inbound-duna.png") });
    await page.waitForTimeout(wallMs(dunaTransitS * 0.5));
    await page.screenshot({ path: join(OUT_DIR, "cme-crossing-duna.png") });
    await page.waitForTimeout(wallMs(DUNA_STORM_DURATION_S * 0.5));
    await page.screenshot({ path: join(OUT_DIR, "cme-fading-duna.png") });
    await page.waitForTimeout(wallMs(DUNA_STORM_DURATION_S * 0.5) + 800);

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
  for (const dir of OUT_DIRS) await mkdir(dir, { recursive: true });

  const probeHtmlOut = await prepareProbePage({
    entry: join(PROBE_DIR, "capture-entry-kerbalism.tsx"),
    htmlTemplate: join(PROBE_DIR, "capture.html"),
    scriptSrcPlaceholder:
      '<script type="module" src="./capture-entry.bundle.js"></script>',
    slug: "systemview-cme-video",
  });

  await captureCme(probeHtmlOut);

  // Mirror every artifact this run produced into the plan's own output path.
  const produced = (await readdir(OUT_DIR)).filter(
    (f) => f.endsWith(".mp4") || f.endsWith(".png"),
  );
  for (const f of produced) {
    await copyFile(join(OUT_DIR, f), join(OUT_DIRS[1], f));
  }
  console.log(
    `\nDone. ${produced.length} artifact(s) in both:\n  ${OUT_DIRS.join("\n  ")}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
