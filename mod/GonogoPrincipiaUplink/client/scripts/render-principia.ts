#!/usr/bin/env tsx
/**
 * Render this Uplink's surfaces through a real Chromium page.
 *
 * Run: `pnpm --filter @ksp-gonogo/gonogo-principia-uplink render`
 * Output: local_docs/renders/principia/<scene>.png
 *
 * Every scene is POPULATED, deliberately. An empty widget renders the same
 * whether it works or not, so a render of one tells a reviewer nothing about the
 * format: the fixtures below carry a plan with burns, a failed integration and a
 * stale observation, which are the states worth looking at.
 *
 * The three `PropagationProvenance` scenes are gone with that widget, which the
 * operator rejected on sight of these renders: "the user shouldn't have a concept
 * of a propagator". Recorded because it is the harness working as intended, a
 * surface reviewed before four more were built on the same assumption.
 *
 * The one thing this cannot do: render `FlightPlanSection` inside the real
 * `ManeuverPlanner`. That widget lives in a package an Uplink may not import, so
 * the section is rendered inside a stand-in ui-kit `Panel` carrying the host's
 * title. The layout of the section is faithful; how it sits under the host's own
 * rows is not shown. Rendering the true composition needs a harness on the app
 * side, which is a gap in what an Uplink author can preview rather than a
 * shortcut taken here.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "probe-entry.tsx");
const PROBE_HTML = join(PROBE_DIR, "probe.html");
/**
 * The theme package's SOURCE tokens.css, not the app's global.css.
 *
 * `global.css` used to carry its own `:root` block; it now just
 * `@import`s this file, so a driver pointing at it finds no `:root` to
 * extract and every probe renders unthemed. Reading the source rather than
 * `dist/` means this needs no prior build of `@ksp-gonogo/theme`.
 *
 * One sibling Uplink's render driver still points at `global.css` and fails the
 * same way; noted rather than fixed from here.
 */
const THEME_TOKENS_CSS = resolve(
  HERE,
  "../../../../packages/theme/src/tokens.css",
);
const OUT_DIR = resolve(HERE, "../../../../local_docs/renders/principia");

/** Must match the probe entry's pinned view instant. */
const VIEW_UT = 1_000_000;
const HOUR = 3_600;

/** A plan mid-mission: one burn done, one imminent, one later. */
const BURNS = [
  {
    index: 0,
    ignitionUt: VIEW_UT - 2 * HOUR,
    cutoffUt: VIEW_UT - 2 * HOUR + 96,
    durationSeconds: 96,
    deltaV: 842.7,
    anomalous: false,
  },
  {
    index: 1,
    ignitionUt: VIEW_UT + 22 * 60,
    cutoffUt: VIEW_UT + 22 * 60 + 143,
    durationSeconds: 143,
    deltaV: 1_204.3,
    anomalous: false,
  },
  {
    index: 2,
    ignitionUt: VIEW_UT + 31 * HOUR,
    cutoffUt: VIEW_UT + 31 * HOUR + 38,
    durationSeconds: 38,
    deltaV: 61.9,
    anomalous: false,
  },
];

const HEALTHY_PLAN = {
  vesselId: "Ares-IV",
  observedAtUt: VIEW_UT,
  planExists: true,
  reachedDeadline: false,
  planIntegrated: true,
  anomalousBurnCount: 0,
  firstFutureBurnIndex: 1,
  finalTimeUt: VIEW_UT + 40 * HOUR,
  burns: BURNS,
};

interface Scene {
  name: string;
  scene: Record<string, unknown>;
}

const SCENES: Scene[] = [
  // ---- FlightPlanSection ------------------------------------------------
  {
    name: "flight-plan-healthy",
    scene: {
      kind: "section",
      hostTitle: "MANEUVER PLANNER",
      topic: "principia.flightPlan",
      pxW: 440,
      pxH: 340,
      identity: {
        vesselId: "Ares-IV",
        name: "Ares IV",
        vesselType: 0,
        situation: 0,
      },
      payload: HEALTHY_PLAN,
    },
  },
  {
    // The surface that wakes you, in the state that matters: the plan silently
    // failed to integrate and burn 3 is the one that broke it.
    name: "flight-plan-integration-failed",
    scene: {
      kind: "section",
      hostTitle: "MANEUVER PLANNER",
      topic: "principia.flightPlan",
      pxW: 440,
      pxH: 340,
      identity: {
        vesselId: "Ares-IV",
        name: "Ares IV",
        vesselType: 0,
        situation: 0,
      },
      payload: {
        ...HEALTHY_PLAN,
        planIntegrated: false,
        statusError: 11,
        firstErrorBurnIndex: 2,
        reachedDeadline: true,
        anomalousBurnCount: 1,
        burns: BURNS.map((b, i) => ({ ...b, anomalous: i === 2 })),
      },
    },
  },
  {
    // Observed six hours ago, so the imminent-looking burn is long past. This is
    // the render that shows whether the age reads clearly enough to stop someone
    // trusting the countdown.
    //
    // `validAt` is set as well as the payload field, and the first version of
    // this scene set only the field: it produced a byte-identical image to the
    // healthy one, which is how the two instants were found to be different
    // facts. Setting both is what a real producer does, since it publishes the
    // sample AT the instant it observed.
    name: "flight-plan-stale-observation",
    scene: {
      kind: "section",
      hostTitle: "MANEUVER PLANNER",
      topic: "principia.flightPlan",
      validAt: VIEW_UT - 6 * HOUR,
      pxW: 440,
      pxH: 340,
      identity: {
        vesselId: "Ares-IV",
        name: "Ares IV",
        vesselType: 0,
        situation: 0,
      },
      payload: { ...HEALTHY_PLAN, observedAtUt: VIEW_UT - 6 * HOUR },
    },
  },
  {
    // Never observed. The one that must not read as "no flight plan".
    name: "flight-plan-unobserved",
    scene: {
      kind: "section",
      hostTitle: "MANEUVER PLANNER",
      topic: "vessel.identity",
      pxW: 440,
      pxH: 260,
      payload: {
        vesselId: "Ares-IV",
        name: "Ares IV",
        vesselType: 0,
        situation: 0,
      },
    },
  },
  {
    // The plan belongs to another craft: the attribution guard, on screen.
    name: "flight-plan-other-vessel",
    scene: {
      kind: "section",
      hostTitle: "MANEUVER PLANNER",
      topic: "principia.flightPlan",
      pxW: 440,
      pxH: 340,
      identity: {
        vesselId: "Kerbin-Station",
        name: "Kerbin Station",
        vesselType: 0,
        situation: 0,
      },
      payload: HEALTHY_PLAN,
    },
  },

  // ---- the trajectory-currency badge ------------------------------------
  {
    name: "badge-beyond-integration",
    scene: {
      kind: "badge",
      hostTitle: "CURRENT ORBIT",
      severity: "warning",
      label: "BEYOND INTEGRATION",
      pxW: 360,
      pxH: 120,
    },
  },
  {
    name: "badge-no-horizon-stated",
    scene: {
      kind: "badge",
      hostTitle: "CURRENT ORBIT",
      severity: "caution",
      label: "NO HORIZON STATED",
      pxW: 360,
      pxH: 120,
    },
  },
  {
    name: "badge-exact-at-sample",
    scene: {
      kind: "badge",
      hostTitle: "CURRENT ORBIT",
      severity: "info",
      label: "EXACT AT SAMPLE",
      pxW: 360,
      pxH: 120,
    },
  },
];

function extractRootBlock(css: string): string {
  const match = css.match(/:root\s*\{[\s\S]*?\}/);
  if (!match) throw new Error("tokens.css: no :root block found");
  return match[0];
}

async function prepareProbePage(): Promise<string> {
  console.log("Bundling probe-entry with esbuild…");
  const result = await build({
    entryPoints: [PROBE_ENTRY],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    sourcemap: "inline",
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "text" },
  });
  const bundleJs = result.outputFiles[0].text;
  const html = await readFile(PROBE_HTML, "utf8");
  const themeCss = extractRootBlock(await readFile(THEME_TOKENS_CSS, "utf8"));
  const escaped = bundleJs.replace(/<\/script/gi, "<\\/script");
  const out = html
    .replace(
      '<style id="probe-theme">/* injected by the render driver from packages/app/src/styles/global.css */</style>',
      () => `<style id="probe-theme">${themeCss}</style>`,
    )
    .replace(
      '<script type="module" src="./probe-entry.bundle.js"></script>',
      () => `<script type="module">${escaped}</script>`,
    );
  const file = join(tmpdir(), `principia-probe-${process.pid}.html`);
  await writeFile(file, out, "utf8");
  return file;
}

async function cleanPngs(dir: string): Promise<void> {
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
  await cleanPngs(OUT_DIR);

  console.log("Launching Chromium…");
  const browser = await chromium.launch();
  let failures = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: 720, height: 720 },
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
        typeof (window as unknown as { __renderPrincipia?: unknown })
          .__renderPrincipia === "function",
      undefined,
      { timeout: 10_000 },
    );

    for (const { name, scene } of SCENES) {
      await page.evaluate(
        (s) =>
          (
            window as unknown as {
              __renderPrincipia: (p: unknown) => Promise<void>;
            }
          ).__renderPrincipia(s),
        scene,
      );
      const root = await page.$("#root");
      if (!root) throw new Error("#root missing after render");
      await page.waitForTimeout(120);
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
