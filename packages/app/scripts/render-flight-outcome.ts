#!/usr/bin/env tsx
/**
 * Render the flight-outcome banner and its two detail modals through a real
 * Chromium page.
 *
 * Run: `pnpm --filter @ksp-gonogo/app render-flight-outcome`
 * Output: local_docs/renders/flight-outcome/ (FLIGHT_OUTCOME_RENDER_OUT
 * overrides, which is what a worktree wants: a reviewer needs the shots at the
 * path they were given, and a pruned worktree takes its own local_docs with
 * it).
 *
 * Every scene publishes the WIRE shape: bare numbers, wrapped into `Value`s by
 * the SDK on decode. That is the whole subject here. The banner read those
 * wrapped objects with `typeof v === "number"` and substituted zero for every
 * quantity, so a recovery that paid 1,035 funds announced a total loss and a
 * crash that came after a recovery was never announced at all.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "flight-outcome-probe-entry.tsx");
const PROBE_HTML = join(PROBE_DIR, "flight-outcome-probe.html");

/**
 * The theme package's SOURCE tokens.css. `global.css` only `@import`s it, so a
 * driver pointing at that file finds no `:root` and every probe renders
 * unthemed.
 */
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

const OUT_DIR =
  process.env.FLIGHT_OUTCOME_RENDER_OUT ??
  resolve(HERE, "../../../local_docs/renders/flight-outcome");

/** A recovery that actually paid, in the shape the mod publishes. */
const RECOVERY = {
  capturedAtUT: 1_000_000,
  vesselName: "Kerbal I",
  recoveryLocation: "KSC",
  recoveryFactor: "100 %",
  scienceEarned: 12.5,
  totalScience: 5011,
  fundsEarned: 1035,
  totalFunds: 289_848,
  reputationEarned: 7.5,
  totalReputation: 976,
  displayReputation: true,
  scienceBreakdown: [
    {
      subjectId: "crewReport@KerbinSrfLandedLaunchPad",
      subjectTitle: "Crew Report from the Launch Pad",
      dataGathered: 8,
      scienceAmount: 4.5,
    },
    {
      subjectId: "mysteryGoo@KerbinFlyingLow",
      subjectTitle: "Mystery Goo Observation while flying over Kerbin",
      dataGathered: 10,
      scienceAmount: 8,
    },
  ],
  partBreakdown: [
    {
      partName: "solidBooster",
      partTitle: "RT-10 Hammer",
      count: 8,
      partValue: 3200,
      resourcesValue: 90,
      totalValue: 3290,
    },
    {
      partName: "mk1pod.v2",
      partTitle: "Mk1 Command Pod",
      count: 1,
      partValue: 600,
      resourcesValue: 0,
      totalValue: 600,
    },
  ],
  resourceBreakdown: [
    {
      resourceName: "LiquidFuel",
      amount: 42.6,
      unitValue: 0.8,
      totalValue: 34.08,
    },
  ],
  crewBreakdown: [
    {
      name: "Jebediah Kerman",
      trait: "Pilot",
      isTourist: false,
      xpGained: 2,
      levelsGained: 1,
      newLevel: 2,
    },
  ],
};

/** A crash AFTER that recovery, which is the pick the banner used to get wrong. */
const CRASH = {
  ut: 1_004_200,
  vesselName: "Ares IV",
  vesselType: "Ship",
  eventKind: "Crash",
  body: "Kerbin",
  situation: "FLYING",
  what: "Kerbin",
  latitude: -0.09,
  longitude: -74.55,
  altitude: 12,
  msg: "",
  vesselId: "ares-4",
  events: [],
  partsLost: [
    { partId: 1, partName: "mk1pod.v2", partTitle: "Mk1 Command Pod", msg: "" },
    { partId: 2, partName: "parachuteSingle", partTitle: "Mk16", msg: "" },
    { partId: 3, partName: "fuelTankSmall", partTitle: "FL-T200", msg: "" },
  ],
  kerbalsKilled: ["Bill Kerman"],
  crewAboard: ["Bill Kerman", "Bob Kerman"],
  flightStats: {
    highestAltitude: 12_400,
    highestSpeed: 620,
    highestSpeedOverLand: 610,
    highestGee: 4.2,
    groundDistance: 3100,
    totalDistance: 18_200,
    missionTime: 412,
    kerbalsKilled: 1,
    partsLost: 3,
    flightEndMode: "CATASTROPHIC_FAILURE",
    missionEnd: true,
    liftOff: true,
  },
};

interface Scene {
  name: string;
  emit: Record<string, unknown>;
  openDetail?: boolean;
  pxW: number;
  pxH: number;
  /** Shoot the whole page rather than `#root`: a modal is portalled out. */
  fullPage?: boolean;
}

const SCENES: Scene[] = [
  {
    // The headline falsehood: this recovery paid 1,035 funds, 12.5 science and
    // 7.5 reputation, and the banner reported three zeros.
    name: "recovery-banner",
    emit: { "recovery.hasRecent": true, "recovery.lastSummary": RECOVERY },
    pxW: 720,
    pxH: 110,
  },
  {
    // The wrong pick. Both outcomes are on their topics, the crash is 4,200
    // seconds the later, and `0 > 0` announced the recovery instead.
    name: "crash-after-recovery",
    emit: {
      "recovery.hasRecent": true,
      "recovery.lastSummary": RECOVERY,
      "crash.hasRecent": true,
      "crash.lastCrash": CRASH,
    },
    pxW: 720,
    pxH: 110,
  },
  {
    // Every row of the breakdown came off the same substitution, one level
    // down: the part group of eight rendered as "×1" at 0 funds.
    name: "recovery-detail",
    emit: { "recovery.hasRecent": true, "recovery.lastSummary": RECOVERY },
    openDetail: true,
    pxW: 900,
    pxH: 900,
    fullPage: true,
  },
  {
    // The flight statistics, from `flightStats`, wrapped by the same walk.
    name: "crash-detail",
    emit: { "crash.hasRecent": true, "crash.lastCrash": CRASH },
    openDetail: true,
    pxW: 900,
    pxH: 760,
    fullPage: true,
  },
  {
    // A producer that sent no `fundsEarned`. The banner states the absence
    // instead of reporting a payout of nothing.
    name: "recovery-funds-absent",
    emit: {
      "recovery.hasRecent": true,
      "recovery.lastSummary": { ...RECOVERY, fundsEarned: undefined },
    },
    pxW: 720,
    pxH: 110,
  },
];

/** The theme sheet whole, checked to be the tokens file. */
function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error("tokens.css: no :root block found");
  }
  return css;
}

async function prepareProbePage(): Promise<string> {
  console.log("Bundling flight-outcome probe with esbuild...");
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
  const theme = themeCss(await readFile(THEME_TOKENS_CSS, "utf8"));
  const escaped = bundleJs.replace(/<\/script/gi, "<\\/script");
  const out = html
    .replace(
      '<style id="probe-theme">/* injected by the render driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${theme}</style>`,
    )
    .replace(
      '<script type="module" src="./flight-outcome-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escaped}</script>`,
    );
  const file = join(tmpdir(), `flight-outcome-probe-${process.pid}.html`);
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

  console.log("Launching Chromium...");
  const browser = await chromium.launch();
  let failures = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: 960, height: 1000 },
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
        typeof (window as unknown as { __renderFlightOutcome?: unknown })
          .__renderFlightOutcome === "function",
      undefined,
      { timeout: 15_000 },
    );

    for (const { name, emit, openDetail, pxW, pxH, fullPage } of SCENES) {
      await page.setViewportSize({ width: Math.max(pxW, 400), height: pxH });
      await page.evaluate(
        (s) =>
          (
            window as unknown as {
              __renderFlightOutcome: (p: unknown) => Promise<void>;
            }
          ).__renderFlightOutcome(s),
        { emit, openDetail, pxW, pxH },
      );
      await page.waitForTimeout(200);
      const out = join(OUT_DIR, `${name}.png`);
      if (fullPage) {
        await page.screenshot({ path: out, fullPage: true });
      } else {
        const root = await page.$("#root");
        if (!root) throw new Error("#root missing after render");
        await root.screenshot({ path: out });
      }
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
