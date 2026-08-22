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
 *   coloured CommNet path decoration appear alongside the pulsing traffic,
 *   then a SECOND click on the same ring to toggle the selection back off
 *   before the recording continues: round 2 left the selection standing for
 *   the rest of the clip, so v-other's ring stayed accent-green (the
 *   "selected" semantic) for most of the video with nothing left selected
 *   to explain it. The deselect is a second `clickRingTop`, not
 *   `page.keyboard.press("Escape")` (index.tsx's OTHER deselect path,
 *   equally valid interactively): headless Chromium was observed to update
 *   the DOM correctly on the Escape path (`aria-pressed` flips, the
 *   `stroke` attribute reads back faint) but never actually repaint the
 *   ring, so the recorded video kept showing it accent-green regardless,
 *   for the whole rest of the clip; a synthetic mouse click reliably
 *   forces the repaint the way the original select click already had to.
 *   Also withholds `vessel.orbit`
 *   for this capture specifically (`sceneEmits()` still carries it for
 *   `orbits`, below, which needs it): a real `vessel.orbit` makes
 *   SystemDiagram draw the ACTIVE vessel's own dedicated ring AND its live
 *   predicted-trajectory patch, both ALSO solid accent-green
 *   (`VesselOrbitPath`/`PredictedPatchArc` in `SystemDiagram.tsx`) and both
 *   unrelated to selection, a separate always-on "this is my ship" signal
 *   that happens to share the same colour token. That's legitimate
 *   everywhere else in the app, but this capture's whole point is faint
 *   contributed orbits + dim-white traffic pulses, so a permanent second
 *   green ring for the entire clip (present from frame one, not just after
 *   the click) reads as unexplained noise here. `deriveTraffic`'s routing
 *   still keys off `identity.vesselId` alone, so v-active stays the real
 *   traffic destination with no orbit on the wire; `index.tsx`'s
 *   contributed-ring suppression (round-4 fix) now keys off BOTH
 *   `identity.vesselId` AND `vessel.orbit`, so withholding the latter no
 *   longer leaves v-active markerless, it falls through to the same faint
 *   `orbit-path` ring `system-view-vessel-orbits` already draws for
 *   v-relay/v-other (`system.vessels`' own per-vessel `orbit` field, never
 *   filtered by this capture): every hop endpoint (home, v-relay, v-active)
 *   renders with a real marker, and the only accent-green on screen for the
 *   whole clip is the deliberate mid-capture selection of v-other.
 * - `orbits`: warpRate elevated (~400x), so vessels visibly sweep along
 *   their faint orbits over a short capture; traffic wouldn't read as
 *   anything but a flicker at this speed, so this capture skips it. This is
 *   the one capture that DOES want the active vessel's own dedicated ring
 *   and marker tracking live, so it keeps the full `sceneEmits()`.
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
// Absolute main-repo paths (not derived from this file's own location via
// `HERE`): a worktree-isolated run's `HERE` resolves to the WORKTREE's own
// copy of this script, so a relative `../../..` would land the artifact in
// a directory that gets torn down with the worktree, same trap
// `render-systemview-cme-video.ts`'s own `OUT_DIRS` doc comment calls out.
const OUT_DIRS = [
  "/Users/jon.pepler/personal/gonogo/local_docs/inbox/systemview-traffic",
  "/Users/jon.pepler/personal/gonogo/local_docs/inbox/systemview-contributions",
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

/**
 * `argPe` defaults to 0 for the active vessel's own orbit (its real,
 * live-computed position stays at a clean reference angle), but
 * `vesselOrbitsContribution`'s `connection-line`/traffic-pulse endpoints
 * always join a vessel at trueAnomaly=0 (see `vesselOrbitsContribution.ts`'s
 * own module doc), a point whose ANGLE is `lan + argPe`, not `meanAnomaly`:
 * every vessel sharing `argPe=0` would put that join point on the SAME ray
 * from Kerbin's centre regardless of `meanAnomalyAtEpoch`, collapsing a
 * multi-hop route into one overlapping line. Giving v-relay/v-other distinct
 * `argPe` values spreads their join points around the diagram so the route
 * reads as a real bent path.
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
 * EXCEPT `vessel.orbit`, so SystemDiagram never draws the active vessel's
 * own dedicated ring/live-trajectory patch (both solid accent-green,
 * unrelated to selection, see this file's own doc comment). `v-active`
 * still carries a full orbit on its ROSTER entry (`system.vessels`, above),
 * so the traffic route's own endpoint still resolves a real position for
 * the connection-line to join, AND (round-4 fix) picks up the same faint
 * `orbit-path` ring/dot `system-view-vessel-orbits` draws for every other
 * roster vessel, since the active-vessel suppression in `index.tsx` no
 * longer fires without a real `vessel.orbit` sample. v-active just doesn't
 * get its own EXTRA dedicated bright ring on top of that.
 */
function sceneEmitsForTraffic(): Array<{ topic: string; value: unknown }> {
  return sceneEmits().filter((e) => e.topic !== "vessel.orbit");
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
 * (the same reason a real mouse click there would miss too).
 *
 * Reads the ring's own `data-ring` ellipse geometry (`cx`/`cy`/`ry`, in the
 * `<g>`'s LOCAL, pre-rotation coordinate space) directly off the DOM and
 * maps its topmost point to screen coordinates via `getScreenCTM()`, rather
 * than reading the `<g>`'s `getBoundingClientRect()`/Playwright
 * `boundingBox()` and clicking a fixed pixel offset from its edge: that
 * approach is fragile because bbox measurement was observed to sometimes
 * include the wide invisible `data-hit-target` stroke and sometimes not
 * (Chromium version/rotation-dependent), so a fixed offset that happened to
 * land inside the 14px hit-target stroke for one ring radius silently
 * missed it for another. `getScreenCTM` sidesteps the ambiguity entirely: it
 * gives the EXACT screen point for a known SVG-space coordinate, independent
 * of how any particular browser reports bounding boxes for stroked,
 * possibly-rotated shapes.
 */
async function clickRingTop(page: Page, entityId: string): Promise<void> {
  const point = await page.evaluate((id) => {
    const ring = document.querySelector(
      `[data-entity-id="${id}"] [data-ring="true"]`,
    ) as SVGGraphicsElement | null;
    if (!ring) return null;
    const cx = Number(ring.getAttribute("cx"));
    const cy = Number(ring.getAttribute("cy"));
    const ry = Number(ring.getAttribute("ry"));
    const ctm = ring.getScreenCTM();
    if (!ctm) return null;
    // The topmost point of the (pre-rotation-local) ellipse, transformed by
    // its own element's CTM: this already folds in the enclosing `<g>`'s
    // `rotate(...)`, the SVG's viewBox scale, and the page's own layout
    // offset, so the result is a ready-to-click viewport coordinate.
    const svgPoint = new DOMPoint(cx, cy - ry);
    const screenPoint = svgPoint.matrixTransform(ctm);
    return { x: screenPoint.x, y: screenPoint.y };
  }, entityId);
  if (!point) throw new Error(`Capture: could not locate ring for ${entityId}`);
  await page.mouse.click(point.x, point.y);
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
      streamEmits: sceneEmitsForTraffic(),
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

    // Deselect: this still-image is the ONLY place this capture wants
    // selection-green on screen. Leaving it standing (round 2's bug) kept
    // v-other's ring accent-green for the rest of the recording with
    // nothing left selected to justify it. A second click toggles the SAME
    // ring back off (`handleEntityActivate`'s toggle: `prev === id ? null
    // : id`); this file's own doc comment explains why it's a click and
    // not `page.keyboard.press("Escape")`.
    await clickRingTop(page, "vessel-orbit:v-other");
    await page.waitForTimeout(300);

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
