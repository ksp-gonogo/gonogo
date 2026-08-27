#!/usr/bin/env tsx
/**
 * Render this Uplink's surfaces through a real Chromium page.
 *
 * Run: `pnpm --filter @ksp-gonogo/gonogo-rp1-uplink render`
 * Output: local_docs/renders/rp1/ (RP1_RENDER_OUT overrides), one PNG per scene.
 *
 * Every scene is POPULATED, deliberately. An empty surface renders the same
 * whether it works or not, so a render of one tells a reviewer nothing about the
 * format. The one empty scene here is the state a fresh career genuinely sits
 * in, and it is worth a picture precisely because it has to READ as an answer
 * rather than as a section that failed to draw.
 *
 * A jsdom test proves the markup and never the paint: elements laid out at zero
 * pixels pass every snapshot assertion in the vitest suite. That is what this is
 * for.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { RSS_CALENDAR } from "./probe/rssCalendar";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "probe-entry.tsx");
const PROBE_HTML = join(PROBE_DIR, "probe.html");

/**
 * The theme package's SOURCE tokens.css, not the app's global.css. `global.css`
 * only `@import`s this file, so a driver pointing at it finds no `:root` to
 * extract and every probe renders unthemed.
 */
const THEME_TOKENS_CSS = resolve(
  HERE,
  "../../../../packages/theme/src/tokens.css",
);

/**
 * Where the renders land. Overridable, because a render is a thing somebody is
 * asked to APPROVE: a reviewer needs it at a path they were given, and a
 * worktree that is pruned takes its own `local_docs` with it.
 */
const OUT_DIR =
  process.env.RP1_RENDER_OUT ??
  resolve(HERE, "../../../../local_docs/renders/rp1");

/** The same day the probe renders in, so a fixture cannot disagree with its picture. */
const DAY = RSS_CALENDAR.day;

const CENTRES = [
  {
    kscName: "Cape",
    isActive: true,
    engineers: 24,
    unassignedEngineers: 6,
    launchComplexCount: 2,
    anyOperational: true,
    groundStation: "us_cape_canaveral",
  },
];

const CAREER = {
  economy: { funds: 289_848, reputation: 62, science: 340 },
};

/** One construction row, with every key the wire carries. */
function construction(overrides: Record<string, unknown> = {}) {
  return {
    kscName: "Cape",
    lcId: null,
    kind: "FacilityUpgrade",
    name: "VehicleAssemblyBuilding",
    facilityType: "VehicleAssemblyBuilding",
    currentLevel: 2,
    targetLevel: 3,
    isModify: null,
    engineersToReadd: null,
    padId: null,
    progress: 250,
    totalPoints: 1_000,
    progressRatio: 0.25,
    workRate: 1,
    rate: 1_000 / (120 * DAY),
    timeLeftSeconds: 90 * DAY,
    stalled: false,
    cost: 40_000,
    spentCost: 10_000,
    spentRushCost: 0,
    ...overrides,
  };
}

const COMPLEXES = [
  {
    kscName: "Cape",
    lcId: "lc-1",
    name: "LC-1",
    lcType: "Pad",
    isOperational: true,
    isRushing: false,
    engineers: 18,
    maxEngineers: 60,
    efficiency: 0.72,
    canIntegrate: true,
    rate: 1_000 / (60 * DAY),
    humanRated: false,
    massMin: 6,
    massMax: 180,
  },
  {
    kscName: "Cape",
    lcId: "lc-2",
    name: "LC-2",
    lcType: "Pad",
    isOperational: true,
    isRushing: false,
    engineers: 6,
    maxEngineers: 40,
    efficiency: 0.4,
    canIntegrate: true,
    rate: 0,
    humanRated: false,
    massMin: 3,
    massMax: 90,
  },
];

/** One vehicle the space centre holds, with every key the wire carries. */
function vehicle(overrides: Record<string, unknown> = {}) {
  return {
    id: "vp-atlas-1",
    // The id an OPERATION joins on, which is not the id a command addresses.
    // Absent here and the rollout controls draw against a vehicle that can never
    // be found to be moving, which paints a plausible scene of a wrong state.
    shipId: "ship-atlas-1",
    kscName: "Cape",
    lcId: "lc-1",
    shipName: "Atlas",
    cost: 40_000,
    mass: 120,
    humanRated: false,
    launchSite: "LaunchPad",
    projectType: "VAB",
    ...overrides,
  };
}

/** Two pads at LC-1, one usable. The state decides which controls draw. */
const PADS = [
  {
    kscName: "Cape",
    lcId: "lc-1",
    padId: "pad-1",
    name: "LaunchPad",
    launchSiteName: "LaunchPad",
    level: 2,
    fractionalLevel: 2,
    state: "Free",
  },
  {
    kscName: "Cape",
    lcId: "lc-1",
    padId: "pad-2",
    name: "LaunchPad 2",
    launchSiteName: "LaunchPad 2",
    level: 1,
    fractionalLevel: 1,
    state: "Reconditioning",
  },
];

/** One rollout, attached the way RP-1 attaches one: by shipID. */
function rollout(overrides: Record<string, unknown> = {}) {
  return {
    kscName: "Cape",
    lcId: "lc-1",
    launchPadId: "LaunchPad",
    type: "Rollout",
    progress: 300,
    totalPoints: 1_000,
    progressRatio: 0.3,
    rate: 1_000 / (14 * DAY),
    timeLeftSeconds: 10 * DAY,
    stalled: false,
    blockingPeers: 0,
    cost: 4_200,
    associatedVesselId: "ship-atlas-1",
    ...overrides,
  };
}

interface Scene {
  name: string;
  scene: Record<string, unknown>;
  /**
   * Text this scene must actually PAINT, each with a box wider than nothing.
   *
   * <p>Not a duplicate of the vitest assertions. jsdom computes no layout, so a
   * label squeezed to zero width by a neighbour that wrapped is present in the
   * DOM, findable by role and name, and invisible on screen. That is exactly
   * what happened here: a modification's detail sentence took the whole width of
   * its row and the complex's own name rendered at nothing.</p>
   */
  paints: string[];
}

const SCENES: Scene[] = [
  {
    // The state a first-decade career actually sits in: a VAB upgrade, a second
    // launch complex and a pad, all running at once, which is the fact the
    // section exists to make visible.
    name: "construction-full-queue",
    paints: [
      "Vehicle Assembly Building",
      "LC-2",
      "Pad B",
      "289,848f",
      "90d",
      "310d",
      "11d",
    ],
    scene: {
      surface: "KscConstruction",
      hostTitle: "SPACE CENTRE",
      pxW: 460,
      pxH: 560,
      emits: [
        ["rp1.available", true],
        ["rp1.centres", CENTRES],
        ["career.status", CAREER],
        [
          "rp1.constructions",
          [
            construction(),
            construction({
              kind: "LaunchComplex",
              name: "LC-2",
              lcId: "lc-2",
              facilityType: null,
              currentLevel: null,
              targetLevel: null,
              isModify: false,
              engineersToReadd: 0,
              progress: 40,
              totalPoints: 2_400,
              progressRatio: 40 / 2_400,
              timeLeftSeconds: 310 * DAY,
              cost: 128_000,
              spentCost: 2_100,
            }),
            construction({
              kind: "Pad",
              name: "Pad B",
              lcId: "lc-1",
              padId: "pad-b",
              facilityType: null,
              currentLevel: null,
              targetLevel: null,
              progress: 700,
              totalPoints: 800,
              progressRatio: 0.875,
              timeLeftSeconds: 11 * DAY,
              cost: 21_400,
              spentCost: 18_700,
            }),
          ],
        ],
      ],
    },
  },
  {
    // Nothing queued. It has to read as an ANSWER rather than as a section that
    // failed to draw, which is exactly what a picture can settle and an
    // assertion cannot.
    name: "construction-empty",
    paints: ["Under construction", "nothing", "289,848f"],
    scene: {
      surface: "KscConstruction",
      hostTitle: "SPACE CENTRE",
      pxW: 460,
      pxH: 200,
      emits: [
        ["rp1.available", true],
        ["rp1.centres", CENTRES],
        ["career.status", CAREER],
        ["rp1.constructions", []],
      ],
    },
  },
  {
    // The two clock states that are not an ETA, side by side, because they must
    // not read alike: one is money being spent faster on purpose, the other is
    // a throttle wound shut.
    name: "construction-rushing-and-stalled",
    paints: ["RUSHING", "STALLED", "Vehicle Assembly Building", "Pad B"],
    scene: {
      surface: "KscConstruction",
      hostTitle: "SPACE CENTRE",
      pxW: 460,
      pxH: 440,
      emits: [
        ["rp1.available", true],
        ["rp1.centres", CENTRES],
        ["career.status", CAREER],
        [
          "rp1.constructions",
          [
            construction({ workRate: 1.5, timeLeftSeconds: 60 * DAY }),
            construction({
              kind: "Pad",
              name: "Pad B",
              padId: "pad-b",
              facilityType: null,
              currentLevel: null,
              targetLevel: null,
              workRate: 0,
              rate: 0,
              timeLeftSeconds: null,
              stalled: true,
            }),
          ],
        ],
      ],
    },
  },
  {
    // A construction RP-1 has not priced yet, which is a real state on a freshly
    // loaded save. The render is here to prove it does not read as stalled.
    name: "construction-not-costed",
    paints: ["Runway", "not costed yet"],
    scene: {
      surface: "KscConstruction",
      hostTitle: "SPACE CENTRE",
      pxW: 460,
      pxH: 300,
      emits: [
        ["rp1.available", true],
        ["rp1.centres", CENTRES],
        ["career.status", CAREER],
        [
          "rp1.constructions",
          [
            construction({
              name: "Runway",
              facilityType: "Runway",
              rate: null,
              timeLeftSeconds: null,
              stalled: false,
            }),
          ],
        ],
      ],
    },
  },
  {
    // A modification, which takes the complex out of service and idles its
    // engineers. The one row whose detail line is a warning rather than a label.
    name: "construction-complex-modify",
    paints: ["LC-1", "modification", "Engineers", "47d"],
    scene: {
      surface: "KscConstruction",
      hostTitle: "SPACE CENTRE",
      pxW: 460,
      pxH: 320,
      emits: [
        ["rp1.available", true],
        ["rp1.centres", CENTRES],
        ["career.status", CAREER],
        [
          "rp1.constructions",
          [
            construction({
              kind: "LaunchComplex",
              name: "LC-1",
              lcId: "lc-1",
              facilityType: null,
              currentLevel: null,
              targetLevel: null,
              isModify: true,
              engineersToReadd: 18,
              progress: 900,
              totalPoints: 1_500,
              progressRatio: 0.6,
              timeLeftSeconds: 47 * DAY,
              cost: 62_000,
              spentCost: 37_200,
            }),
          ],
        ],
      ],
    },
  },
  {
    // The repeat-build surface, in the state it is used in: two vehicles of the
    // SAME design, one flown-ready and one still integrating. Worth a picture
    // rather than only assertions, because the whole control is a per-row button
    // sharing a row with a name, and a name long enough to wrap takes the width
    // and leaves the control at nothing.
    name: "vehicles-repeat-build",
    paints: [
      "289,848f",
      "Atlas · LC-1",
      "BUILT",
      "INTEGRATING",
      "Build",
      "Roll out",
      "Scrap",
      "LC-1 rush",
    ],
    scene: {
      surface: "KscVehicles",
      hostTitle: "SPACE CENTRE",
      pxW: 460,
      pxH: 560,
      emits: [
        ["rp1.available", true],
        ["career.status", CAREER],
        ["rp1.complexes", COMPLEXES],
        ["rp1.pads", PADS],
        ["rp1.operations", []],
        ["rp1.warehouse", [vehicle()]],
        [
          "rp1.buildQueue",
          [
            vehicle({
              id: "vp-atlas-2",
              shipId: "ship-atlas-2",
              progress: 250,
              totalPoints: 1_000,
              progressRatio: 0.25,
              rate: 1_000 / (60 * DAY),
              timeLeftSeconds: 45 * DAY,
              stalled: false,
            }),
          ],
        ],
      ],
    },
  },
  {
    // A vehicle mid-rollout, which is the state the whole rollout/rollback pair
    // exists for and the one a screenshot settles: four controls plus a badge
    // and an ETA share one row, and the row is the first place that runs out of
    // width.
    name: "vehicles-rolling-out",
    paints: ["Atlas · LC-1", "ROLLING OUT", "Roll back", "LC-1 rush"],
    scene: {
      surface: "KscVehicles",
      hostTitle: "SPACE CENTRE",
      pxW: 460,
      pxH: 400,
      emits: [
        ["rp1.available", true],
        ["career.status", CAREER],
        ["rp1.complexes", COMPLEXES],
        ["rp1.pads", [{ ...PADS[0], state: "Rollout" }, PADS[1]]],
        ["rp1.operations", [rollout()]],
        ["rp1.warehouse", [vehicle()]],
        ["rp1.buildQueue", []],
      ],
    },
  },
  {
    // Nothing built and nothing on order, which is where a career starts. Same
    // reason the empty construction scene is here: it has to read as an answer
    // rather than as a section that failed to draw.
    name: "vehicles-empty",
    paints: ["Funds", "none built and none on order"],
    scene: {
      surface: "KscVehicles",
      hostTitle: "SPACE CENTRE",
      pxW: 460,
      pxH: 260,
      emits: [
        ["rp1.available", true],
        ["career.status", CAREER],
        ["rp1.complexes", COMPLEXES],
        ["rp1.pads", PADS],
        ["rp1.operations", []],
        ["rp1.warehouse", []],
        ["rp1.buildQueue", []],
      ],
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
      '<style id="probe-theme">/* injected by the render driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${themeCss}</style>`,
    )
    .replace(
      '<script type="module" src="./probe-entry.bundle.js"></script>',
      () => `<script type="module">${escaped}</script>`,
    );
  const file = join(tmpdir(), `rp1-probe-${process.pid}.html`);
  await writeFile(file, out, "utf8");
  return file;
}

/** Clears the previous run's output, so a stale image never sits beside a fresh one. */
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

/**
 * Every string a scene declares is on screen with a box wider than nothing.
 *
 * <p>The check the vitest suite cannot make. jsdom computes no layout, so text
 * squeezed to zero width by a neighbour that wrapped satisfies every
 * `toBeInTheDocument` while being invisible in the browser. Returns the number
 * of failures rather than throwing, so one bad scene does not hide the renders
 * after it: a reviewer needs the whole set to see which ones moved.</p>
 */
async function assertPainted(
  page: import("playwright").Page,
  scene: string,
  paints: string[],
): Promise<number> {
  let failures = 0;
  for (const text of paints) {
    const box = await page
      .getByText(text, { exact: false })
      .first()
      .boundingBox()
      .catch(() => null);
    if (box === null) {
      failures++;
      console.error(`  [${scene}] "${text}" is not on the page at all`);
    } else if (box.width <= 0 || box.height <= 0) {
      failures++;
      console.error(
        `  [${scene}] "${text}" is in the DOM but painted at ` +
          `${box.width}x${box.height}, so nobody can read it`,
      );
    }
  }
  return failures;
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
      viewport: { width: 720, height: 760 },
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
        typeof (window as unknown as { __renderRp1?: unknown }).__renderRp1 ===
        "function",
      undefined,
      { timeout: 10_000 },
    );

    for (const { name, scene, paints } of SCENES) {
      await page.evaluate(
        (s) =>
          (
            window as unknown as { __renderRp1: (p: unknown) => Promise<void> }
          ).__renderRp1(s),
        scene,
      );
      const root = await page.$("#root");
      if (!root) throw new Error("#root missing after render");
      await page.waitForTimeout(120);
      failures += await assertPainted(page, name, paints);
      const out = join(OUT_DIR, `${name}.png`);
      await root.screenshot({ path: out });
      console.log(`  ✓ ${name} → ${out}`);
    }
  } finally {
    await browser.close();
  }

  // A page error or an unpainted label means a scene rendered wrong, and a
  // silently wrong render is worse than no render: it goes to a reviewer looking
  // like the real thing.
  if (failures > 0) {
    throw new Error(`${failures} render failure(s); see above`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
