#!/usr/bin/env tsx
/**
 * Render the settings surface through a real Chromium page.
 *
 * Run: `pnpm --filter @ksp-gonogo/app render-settings`
 * Output: local_docs/renders/settings/ (SETTINGS_RENDER_OUT overrides, which is
 * what a worktree wants: its own local_docs goes with it when it is pruned, and
 * a reviewer needs the shots at the path they were given).
 *
 * The registry grew four axes (read-only rows, `text` and `number` types, named
 * groups inside a category, and a `stream-backed` value with no writer at all)
 * and the only way to judge those is to look at them. So every scene here is a
 * state a reviewer has to make a call about rather than a happy path: a
 * category with six groups in it, the same category with the Topic silent, a
 * quantity beside a bare count, and a writable row gone inert under its parent.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { STOCK_KERBIN_CALENDAR } from "@ksp-gonogo/sitrep-sdk";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "settings-probe-entry.tsx");
const PROBE_HTML = join(PROBE_DIR, "settings-probe.html");

/**
 * The theme package's SOURCE tokens.css. `global.css` only `@import`s it now,
 * so a driver pointing at that file finds no `:root` to extract and every
 * probe renders unthemed.
 */
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

/**
 * Where the renders land. Overridable, because a render is a thing somebody is
 * asked to APPROVE: a reviewer needs it at a path they were given, and a
 * worktree that is pruned takes its own `local_docs` with it.
 */
const OUT_DIR =
  process.env.SETTINGS_RENDER_OUT ??
  resolve(HERE, "../../../local_docs/renders/settings");

const VIEW_UT = 1_000_000;
/**
 * A KSP day, in seconds, from the unit model's own calendar rather than
 * ui-kit's `KSP_DAY_SECONDS`. Same number, and it is the same source: this is
 * the NODE half of the harness, and importing the design system here pulls
 * styled-components into a runtime with no DOM for it.
 */
const KSP_DAY = STOCK_KERBIN_CALENDAR.day;
const TOPIC = "principia.settings";

/** A quantity as it arrives off the wire, already wrapped. */
const q = (unit: string, magnitude: number) => ({ magnitude, unit });

/** A session mid-flight: Kerbin-centred inertial, journal off, reading. */
const PRINCIPIA_LIVE = {
  observedAtUt: q("ut", VIEW_UT),
  pluginVersion: "principia 2026080123-Grassmann",
  readingSuspended: false,
  plottingFrame: {
    selector: "Plotting frame",
    type: 6000,
    centreBody: "Kerbin",
    primaryBodies: ["Kerbin"],
    secondaryBodies: [],
    targetFrameSelected: false,
  },
  burnFrames: [
    {
      type: 6000,
      centreBody: "Kerbin",
    },
    {
      type: 6002,
      primaryBody: "Kerbol",
      secondaryBody: "Kerbin",
    },
  ],
  selectingTargetVessel: false,
  targetVesselId: "88888888-4444-4444-4444-121212121212",
  targetVesselName: "Ares IV",
  selectingTargetCelestial: false,
  targetCelestialBody: undefined,
  displayPatchedConics: true,
  predictionVesselId: "Ares-IV",
  predictionToleranceMetres: q("m", 1),
  predictionMaxSteps: q("count", 1_000_000),
  analysisMissionDurationRequestedSeconds: q("s", 28 * KSP_DAY),
  recurrenceAutodetect: true,
  recurrenceRevolutionsPerCycle: q("count", 43),
  recurrenceDaysPerCycle: q("count", 3),
  groundTrackRevolution: q("count", 1),
  stabilityGridMaxEccentricityMinInclination: true,
  stabilityGridMinEccentricityMaxInclination: false,
  showElementGraphs: true,
  historyLengthSeconds: q("s", 3 * 3600),
  unpinnedMarkersHiddenHere: true,
  framesHidingUnpinnedMarkers: q("count", 2),
  unpinnedCelestialsHiddenHere: false,
  framesHidingUnpinnedCelestials: q("count", 0),
  pinnedCelestials: ["Mun", "Minmus"],
  targetPinned: false,
  showManoeuvreOnNavball: true,
  planToleranceMetres: q("m", 10),
  planMaxSteps: q("count", 1_048_576),
  planInitialTimeUt: q("ut", VIEW_UT + 600),
  planDesiredFinalTimeUt: q("ut", VIEW_UT + 30 * KSP_DAY),
  planActualFinalTimeUt: q("ut", VIEW_UT + 12 * KSP_DAY),
  flightPlanCount: q("count", 2),
  selectedFlightPlan: q("count", 0),
  optimiserTargetAltitudeMetres: q("m", 250_000),
  optimiserTargetInclinationDegrees: q("°", 51.6),
  verboseLevel: q("count", 0),
  logThreshold: q("count", 0),
  stderrThreshold: q("count", 2),
  flushThreshold: q("count", 3),
  recordJournalRequested: false,
  journaling: false,
};

interface Scene {
  name: string;
  emit?: Record<string, unknown>;
  prefs?: Record<string, unknown>;
  pxW: number;
  pxH: number;
  /**
   * A row label to scroll into view before the shot.
   *
   * By label rather than by pixel offset: the panel is its own scroller and a
   * hard offset silently photographs the wrong rows the moment a description
   * gains a line.
   */
  scrollToLabel?: string;
}

const SCENES: Scene[] = [
  {
    // Six named groups under one heading. The thing forty flat rows would not
    // have been.
    name: "principia-grouped",
    emit: { [TOPIC]: PRINCIPIA_LIVE },
    pxW: 900,
    pxH: 700,
    scrollToLabel: "Frame kind",
  },
  {
    // The same category, further down: the quantity rows (a tolerance in
    // metres, a window in days, a history in hours) beside the bare counts,
    // and the severities named rather than numbered.
    name: "principia-quantities",
    emit: { [TOPIC]: PRINCIPIA_LIVE },
    pxW: 900,
    pxH: 700,
    scrollToLabel: "Prediction step limit",
  },
  {
    // The Flight plan group: a step limit next to a tolerance, both of them the
    // plugin's own, and the plan reaching short of where it was asked to.
    name: "principia-flight-plan",
    emit: { [TOPIC]: PRINCIPIA_LIVE },
    pxW: 900,
    pxH: 700,
    scrollToLabel: "In-game plan step limit",
  },
  {
    // Two groups that were widget-only until the settings surface became the
    // floor: the pin exemptions that make the hide settings falsifiable, and
    // the in-game navball guidance toggle, which is about the PLAYER's navball
    // and not ours.
    name: "principia-drawing-and-navball",
    emit: { [TOPIC]: PRINCIPIA_LIVE },
    pxW: 900,
    pxH: 700,
    scrollToLabel: "Guidance shown on the in-game navball",
  },
  {
    // The Diagnostics group: the three sink thresholds by NAME, and the two
    // journal rows that are deliberately not the same fact.
    name: "principia-diagnostics",
    emit: { [TOPIC]: PRINCIPIA_LIVE },
    pxW: 900,
    pxH: 700,
    scrollToLabel: "Journal recording now",
  },
  {
    // Nothing on the wire. Every row shows its null placeholder rather than a
    // zero, which is the whole standard for a read-only row: a panel full of
    // zeroes reads as a plugin configured to zero.
    name: "principia-topic-silent",
    pxW: 900,
    pxH: 700,
    scrollToLabel: "Frame kind",
  },
  {
    // Reading is suspended, so the plugin sends the gate and nothing else. The
    // health row and its reason carry, everything below them goes absent.
    name: "principia-reading-suspended",
    emit: {
      [TOPIC]: {
        readingSuspended: true,
        readingSuspendedReason:
          "Principia is recording a journal; reading it would write us into the recording",
      },
    },
    pxW: 900,
    pxH: 700,
  },
  {
    // A Lagrange frame: lengths in it are not lengths, and there are no
    // apsides at all. Two rows that are consequences of the frame rather than
    // facts about it.
    name: "principia-pulsating-frame",
    emit: {
      [TOPIC]: {
        ...PRINCIPIA_LIVE,
        plottingFrame: {
          selector: "Plotting frame",
          type: 6004,
          primaryBody: "Kerbol",
          secondaryBody: "Kerbin",
          primaryBodies: ["Kerbol"],
          secondaryBodies: ["Kerbin"],
          targetFrameSelected: false,
        },
      },
    },
    pxW: 900,
    pxH: 700,
    scrollToLabel: "Lengths pulsate in this frame",
  },
  {
    // `dependsOn`, both ways. The parent is on: the two children are live
    // switches an operator can reach.
    name: "dependson-parent-on",
    prefs: { "mission.historyEnabled": true },
    pxW: 900,
    pxH: 460,
  },
  {
    // The parent is off: the children indent under it and go inert, because
    // the consuming hook AND-combines them and a switch that would change
    // nothing must not look like one that would.
    name: "dependson-parent-off",
    prefs: { "mission.historyEnabled": false },
    pxW: 900,
    pxH: 460,
  },
];

function extractRootBlock(css: string): string {
  const match = css.match(/:root\s*\{[\s\S]*?\}/);
  if (!match) throw new Error("tokens.css: no :root block found");
  return match[0];
}

async function prepareProbePage(): Promise<string> {
  console.log("Bundling settings probe with esbuild…");
  const result = await build({
    entryPoints: [PROBE_ENTRY],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    sourcemap: "inline",
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.env.DEV": "false",
      "import.meta.env.PROD": "true",
      "import.meta.env.MODE": '"production"',
    },
    loader: { ".css": "text", ".svg": "dataurl", ".png": "dataurl" },
  });
  const bundleJs = result.outputFiles[0].text;
  const html = await readFile(PROBE_HTML, "utf8");
  const themeCss = extractRootBlock(await readFile(THEME_TOKENS_CSS, "utf8"));
  const escaped = bundleJs.replace(/<\/script/gi, "<\\/script");
  const out = html
    .replace(
      '<style id="probe-theme">/* injected by the render driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${themeCss}</style>`,
    )
    .replace(
      '<script type="module" src="./settings-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escaped}</script>`,
    );
  const file = join(tmpdir(), `settings-probe-${process.pid}.html`);
  await writeFile(file, out, "utf8");
  return file;
}

async function cleanRenders(dir: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.endsWith(".png")) await rm(join(dir, e));
  }
}

async function main(): Promise<void> {
  const probeHtml = await prepareProbePage();
  await mkdir(OUT_DIR, { recursive: true });
  await cleanRenders(OUT_DIR);

  console.log("Launching Chromium…");
  const browser = await chromium.launch();
  let failures = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: 960, height: 1400 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => {
      failures++;
      console.error("  [page error]", err.message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("  [console]", msg.text());
    });

    await page.goto(pathToFileURL(probeHtml).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __renderSettings?: unknown })
          .__renderSettings === "function",
      undefined,
      { timeout: 15_000 },
    );

    for (const { name, emit, prefs, pxW, pxH, scrollToLabel } of SCENES) {
      await page.evaluate(
        (s) =>
          (
            window as unknown as {
              __renderSettings: (p: unknown) => Promise<void>;
            }
          ).__renderSettings(s),
        { emit, prefs, pxW, pxH },
      );
      if (scrollToLabel !== undefined) {
        await page
          .getByText(scrollToLabel, { exact: true })
          .first()
          .scrollIntoViewIfNeeded();
      }
      await page.waitForTimeout(150);
      const root = await page.$("#root");
      if (!root) throw new Error("#root missing after render");
      const out = join(OUT_DIR, `${name}.png`);
      await root.screenshot({ path: out });
      console.log(`  ✓ ${name} → ${out}`);
    }
  } finally {
    await browser.close();
  }

  // A page error means a scene rendered wrong, and a silently wrong render is
  // worse than no render: it goes to a reviewer looking like the real thing.
  if (failures > 0) {
    throw new Error(`${failures} page error(s) during rendering; see above`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
