#!/usr/bin/env tsx
/**
 * Render the dashboard header (`MissionBanner`) through a real Chromium page,
 * across the states its signal delay readout distinguishes.
 *
 * Run: `pnpm --filter @ksp-gonogo/app render-header-delay`
 * Output: local_docs/renders/header-delay/ (HEADER_DELAY_RENDER_OUT overrides)
 *
 * `HEADER_DELAY_CODE=before` renders the header as it was before each command
 * centre's own delay reached it, with the pre-change header checked out, so a
 * before and after pair come from the same scenes. Each shot waits for the header's text to
 * settle on what that code state should show, and fails naming what it read
 * instead.
 *
 * Every scene publishes the wire shape, bare numbers the SDK wraps on decode,
 * and the delay reaches the header through the provider's own `DelayAuthority`
 * rather than being handed to it.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "header-delay-probe-entry.tsx");
const PROBE_HTML = join(PROBE_DIR, "header-delay-probe.html");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

const OUT_DIR =
  process.env.HEADER_DELAY_RENDER_OUT ??
  resolve(HERE, "../../../local_docs/renders/header-delay");

/**
 * Which header the harness is rendering: `after` reads each command centre's
 * own delay to the active craft, `before` is the header as it was when the wire
 * carried only the home centre's, rendered through this same harness from the
 * code as it stood.
 */
type CodeState = "before" | "after";
const CODE_STATE: CodeState =
  process.env.HEADER_DELAY_CODE === "before" ? "before" : "after";

const KSC = "ground:Kerbal Space Center";
const GS1 = "ground:Ground Station 1";
const GS2 = "ground:Ground Station 2";
const MUN_STATION = "vessel:mun-station";
const CRAFT = "vessel:kerbal-x";

const ROSTER = [
  {
    id: KSC,
    displayName: "KSC",
    kind: "GroundStation",
    active: true,
    isHome: true,
    isHomeFallback: false,
  },
  {
    id: GS1,
    displayName: "Ground Station 1",
    kind: "GroundStation",
    active: true,
    isHome: false,
    isHomeFallback: false,
  },
  {
    id: GS2,
    displayName: "Ground Station 2",
    kind: "GroundStation",
    active: true,
    isHome: false,
    isHomeFallback: false,
  },
  {
    id: MUN_STATION,
    displayName: "Mun Station",
    kind: "CrewedVessel",
    active: true,
    isHome: false,
    isHomeFallback: false,
  },
  {
    id: CRAFT,
    displayName: "Kerbal X",
    kind: "CrewedVessel",
    active: true,
    isHome: false,
    isHomeFallback: false,
  },
];

/** `CommsDelaySource.SignalDelay`, spelled as the wire carries it. */
const SIGNAL_DELAY = 1;

/**
 * Each centre's own route to the active craft, as the mod publishes it: home is
 * absent because its delay is `comms.delay`, Ground Station 2 is absent because
 * it has no route of its own, and the craft itself is its own zero.
 */
const CENTRE_DELAYS = {
  centres: [
    { id: GS1, oneWaySeconds: 42.5 },
    { id: MUN_STATION, oneWaySeconds: 3.9 },
    { id: CRAFT, oneWaySeconds: 0 },
  ],
};

/** The active craft's orbit, naming itself so a pilot's session knows it is aboard. */
const CRAFT_ORBIT = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0.01,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 10,
  mu: 3.5316e12,
  meta: { source: CRAFT, quality: 0 },
};

const flight = (connected: boolean): [string, unknown][] => [
  ["commandCentre.roster", ROSTER],
  ["spaceCenter.scene", { scene: "Flight" }],
  ["comms.delay", { oneWaySeconds: 187.4, source: SIGNAL_DELAY }],
  ...(connected
    ? []
    : ([["comms.delay", { source: 0 }]] as [string, unknown][])),
  ["commandCentre.activeVesselDelay", CENTRE_DELAYS],
  ["comms.link", { connected }],
];

interface Scene {
  name: string;
  screen: "main" | "pilot";
  vantage: string;
  select?: string;
  hostCentre?: string;
  emit: [string, unknown][];
  /**
   * How the header's text ends once the scene has settled, for each code
   * state, give or take the one null token a dash draws. The shot is taken
   * only once it does, so a render cannot capture a reading that has not
   * arrived yet.
   */
  settled: Record<CodeState, string>;
}

const NOT_REPORTED = "Signal delay from this command centre is not reported";

const SCENES: Scene[] = [
  {
    // A craft a little over three light-minutes from home, observed from home.
    name: "home-centre",
    screen: "main",
    vantage: KSC,
    settled: {
      after: "DelaySignal delay 3min 7s",
      before: "DelaySignal delay 3min 7s",
    },
    emit: flight(true),
  },
  {
    // The path home is gone. The authority holds the last light-time, and the
    // header must not present that held figure as a live one.
    name: "home-centre-disconnected",
    screen: "main",
    vantage: KSC,
    settled: {
      after: "DelaySignal delay: disconnected",
      before: "DelaySignal delay: disconnected",
    },
    emit: flight(false),
  },
  {
    // A second ground station with a route of its own to the craft.
    name: "ground-station",
    screen: "main",
    vantage: GS1,
    select: GS1,
    settled: { after: "DelaySignal delay 42s", before: NOT_REPORTED },
    emit: flight(true),
  },
  {
    // A crewed forward centre, a few light-seconds from the craft.
    name: "non-home-centre",
    screen: "main",
    vantage: MUN_STATION,
    select: MUN_STATION,
    settled: { after: "DelaySignal delay 3s", before: NOT_REPORTED },
    emit: flight(true),
  },
  {
    // A centre with no route of its own to the craft: its traffic still
    // arrives, timed by home's delay.
    name: "non-home-centre-unrouted",
    screen: "main",
    vantage: GS2,
    select: GS2,
    settled: {
      after: "DelaySignal delay 3min 7s via home",
      before: NOT_REPORTED,
    },
    emit: flight(true),
  },
  {
    // The same centre once the link itself is down.
    name: "non-home-centre-unrouted-disconnected",
    screen: "main",
    vantage: GS2,
    select: GS2,
    settled: { after: "DelaySignal delay: disconnected", before: NOT_REPORTED },
    emit: flight(false),
  },
  {
    // A pilot aboard the craft, mission control at home.
    name: "pilot-aboard",
    screen: "pilot",
    vantage: CRAFT,
    select: CRAFT,
    hostCentre: KSC,
    settled: {
      after: "DelaySignal delay 3min 7s",
      before: "DelaySignal delay 0s",
    },
    emit: [...flight(true), ["vessel.orbit", CRAFT_ORBIT]],
  },
  {
    // A pilot aboard the craft, mission control at a second ground station.
    name: "pilot-aboard-ground-station",
    screen: "pilot",
    vantage: CRAFT,
    select: CRAFT,
    hostCentre: GS1,
    settled: {
      after: "DelaySignal delay 42s",
      before: "DelaySignal delay 0s",
    },
    emit: [...flight(true), ["vessel.orbit", CRAFT_ORBIT]],
  },
  {
    // A pilot aboard, mission control at a centre with no route of its own.
    name: "pilot-aboard-unrouted",
    screen: "pilot",
    vantage: CRAFT,
    select: CRAFT,
    hostCentre: GS2,
    settled: {
      after: "DelaySignal delay 3min 7s via home",
      before: "DelaySignal delay 0s",
    },
    emit: [...flight(true), ["vessel.orbit", CRAFT_ORBIT]],
  },
  {
    // A pilot aboard a craft that has lost its path to mission control.
    name: "pilot-blackout",
    screen: "pilot",
    vantage: CRAFT,
    select: CRAFT,
    hostCentre: KSC,
    settled: {
      after: "DelaySignal delay: disconnected",
      before: "DelaySignal delay 0s",
    },
    emit: [...flight(false), ["vessel.orbit", CRAFT_ORBIT]],
  },
  {
    name: "no-active-vessel",
    screen: "main",
    vantage: KSC,
    settled: { after: "CCKSCHome", before: "CCKSCHome" },
    emit: [
      ["commandCentre.roster", ROSTER],
      ["spaceCenter.scene", { scene: "SpaceCenter" }],
      ["comms.link", { connected: false }],
    ],
  },
];

const PX_W = 640;
const PX_H = 70;

function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error("tokens.css: no :root block found");
  }
  return css;
}

async function prepareProbePage(): Promise<string> {
  console.log("Bundling header-delay probe with esbuild...");
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
      '<script type="module" src="./header-delay-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escaped}</script>`,
    );
  const file = join(tmpdir(), `header-delay-probe-${process.pid}.html`);
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
      viewport: { width: PX_W, height: PX_H },
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
        typeof (window as unknown as { __renderHeaderDelay?: unknown })
          .__renderHeaderDelay === "function",
      undefined,
      { timeout: 15_000 },
    );

    for (const scene of SCENES) {
      const { name, emit, settled } = scene;
      const flying = emit.some(
        ([topic, payload]) =>
          topic === "spaceCenter.scene" &&
          (payload as { scene?: string }).scene === "Flight",
      );
      /*
       * What the header under test subscribes, beyond the `comms.delay` the
       * provider's authority always holds: the roster and the scene, the link
       * in flight, and the centres' own delays once the header reads them. A
       * pilot's session also has to learn it is aboard, off the craft's orbit.
       */
      const awaitTopics = [
        "commandCentre.roster",
        "comms.delay",
        "spaceCenter.scene",
        ...(flying ? ["comms.link"] : []),
        ...(flying && CODE_STATE === "after"
          ? ["commandCentre.activeVesselDelay"]
          : []),
        ...(scene.screen === "pilot" ? ["vessel.orbit"] : []),
      ];
      await page.evaluate(
        (s) =>
          (
            window as unknown as {
              __renderHeaderDelay: (p: unknown) => Promise<void>;
            }
          ).__renderHeaderDelay(s),
        {
          emit,
          vantage: scene.vantage,
          screen: scene.screen,
          select: scene.select,
          hostCentre: scene.hostCentre,
          awaitTopics,
          pxW: PX_W,
          pxH: PX_H,
        },
      );
      const expected = settled[CODE_STATE];
      try {
        await page.waitForFunction(
          (tail) => {
            const text = document.getElementById("root")?.textContent ?? "";
            const at = text.lastIndexOf(tail);
            return at >= 0 && text.length - (at + tail.length) <= 1;
          },
          expected,
          { timeout: 10_000 },
        );
      } catch {
        const text = await page.evaluate(
          () => document.getElementById("root")?.textContent,
        );
        throw new Error(
          `${name}: header never settled on "${expected}", last read "${text}"`,
        );
      }
      const out = join(OUT_DIR, `${name}.png`);
      const root = await page.$("#root");
      if (!root) throw new Error("#root missing after render");
      await root.screenshot({ path: out });
      console.log(`  ✓ ${name} → ${out}`);
    }
  } finally {
    await browser.close();
  }

  if (failures > 0) {
    throw new Error(`${failures} page error(s) during rendering; see above`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
