#!/usr/bin/env tsx
/**
 * Render the Commcast widget through a real Chromium page.
 *
 * Run: `pnpm --filter @ksp-gonogo/app render-commcast`
 * Output: local_docs/renders/commcast/ (COMMCAST_RENDER_OUT overrides, which
 * is what a worktree wants: a reviewer needs the shots at the path they were
 * given, and a pruned worktree takes its own local_docs with it).
 *
 * Every scene here is a state somebody has to make a call about, and the first
 * three are two-pane because the widget's entire subject is that two seats
 * disagree. A single-pane shot of a delayed thread looks exactly like an
 * undelayed one: you cannot see what the other end is NOT showing.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "commcast-probe-entry.tsx");
const PROBE_HTML = join(PROBE_DIR, "commcast-probe.html");

/**
 * The theme package's SOURCE tokens.css. `global.css` only `@import`s it, so a
 * driver pointing at that file finds no `:root` and every probe renders
 * unthemed. Same file the settings driver reads, for the same reason.
 */
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

const OUT_DIR =
  process.env.COMMCAST_RENDER_OUT ??
  resolve(HERE, "../../../local_docs/renders/commcast");

/** Where the two ends of the headline scene are. */
const KSC = "ksc";
const ARES = "vessel:ares-4";
/** A second command centre, downrange and at its own vantage. */
const WOOMERA = "ground:woomera";

const PILOT = {
  stationKey: "pilot-1",
  name: "Jeb",
  seat: "pilot" as const,
  vantageId: ARES,
};
const FLIGHT = {
  stationKey: "ksc-1",
  name: "Kennedy Flight",
  seat: "mission-control" as const,
  vantageId: KSC,
};
const RANGE = {
  stationKey: "woomera-1",
  name: "Woomera Range",
  seat: "mission-control" as const,
  vantageId: WOOMERA,
};

/** Four minutes each way, the separation the headline scenes are built on. */
const LIGHT_TIME = 240;

interface Pane {
  seat: "mission-control" | "pilot";
  vantage?: string;
  name: string;
}

interface Scene {
  name: string;
  panes: Pane[];
  messages?: {
    author: typeof PILOT | typeof FLIGHT | typeof RANGE;
    body: string;
    sentAt: number;
    oneWaySeconds: number | null;
  }[];
  separation?: { from: string; to: string; oneWaySeconds: number }[];
  oneWaySeconds?: number;
  noThread?: boolean;
  pxW: number;
  pxH: number;
}

/** Every ordered pair between the ground and the craft, plus each centre's zero. */
const GROUND_TO_CRAFT = [
  { from: KSC, to: KSC, oneWaySeconds: 0 },
  { from: ARES, to: ARES, oneWaySeconds: 0 },
  { from: KSC, to: ARES, oneWaySeconds: LIGHT_TIME },
  { from: ARES, to: KSC, oneWaySeconds: LIGHT_TIME },
];

const SCENES: Scene[] = [
  {
    // The whole feature in one picture: ONE thread, two seats, and the pilot's
    // last line is on screen at the craft and still four minutes out from the
    // ground. At the ground seat that line sits in the PINNED transit strip
    // below the thread with no body at all, which is the design's central
    // claim and the thing no assertion can photograph.
    name: "in-flight-two-seats",
    panes: [
      { seat: "mission-control", vantage: KSC, name: "Kennedy Flight" },
      { seat: "pilot", vantage: ARES, name: "Jeb" },
    ],
    messages: [
      {
        author: FLIGHT,
        body: "Ares, Kennedy. You are go for the insertion burn.",
        sentAt: -900,
        oneWaySeconds: LIGHT_TIME,
      },
      {
        author: PILOT,
        body: "Copy go. Starting the sequence.",
        sentAt: -600,
        oneWaySeconds: LIGHT_TIME,
      },
      {
        author: PILOT,
        body: "Burn complete. Orbit is 249 by 251, residuals under a tenth.",
        sentAt: -30,
        oneWaySeconds: LIGHT_TIME,
      },
    ],
    separation: GROUND_TO_CRAFT,
    oneWaySeconds: LIGHT_TIME,
    pxW: 900,
    pxH: 620,
  },
  {
    // Three vantages in one thread, read from the two ground ones. Neither
    // centre has a published separation to the other, so each shows the
    // other's line with "separation to that centre is unpublished" rather
    // than a measured zero: the case the seat axis alone gets wrong, since
    // both of these are `mission-control`.
    name: "two-centres-one-thread",
    panes: [
      { seat: "mission-control", vantage: KSC, name: "Kennedy Flight" },
      { seat: "mission-control", vantage: WOOMERA, name: "Woomera Range" },
    ],
    messages: [
      {
        author: FLIGHT,
        body: "Woomera, Kennedy. Handing you the pass at AOS plus two.",
        sentAt: -1200,
        oneWaySeconds: LIGHT_TIME,
      },
      {
        author: RANGE,
        body: "Kennedy, Woomera. We have the pass. Tracking is locked.",
        sentAt: -900,
        oneWaySeconds: LIGHT_TIME,
      },
      {
        author: PILOT,
        body: "Woomera, Ares. Reading you loud and clear over the range.",
        sentAt: -60,
        oneWaySeconds: LIGHT_TIME,
      },
    ],
    separation: GROUND_TO_CRAFT,
    oneWaySeconds: LIGHT_TIME,
    pxW: 900,
    pxH: 620,
  },
  {
    // Somebody spoke with no path home. It is UNREACHABLE at the ground seat
    // (heading, body withheld) and revealed at the craft's own, where the
    // author is standing next to it and is told nobody else received it. The
    // two halves of the same failure, side by side.
    name: "no-path-home",
    panes: [
      { seat: "mission-control", vantage: KSC, name: "Kennedy Flight" },
      { seat: "pilot", vantage: ARES, name: "Jeb" },
    ],
    messages: [
      {
        author: FLIGHT,
        body: "Ares, Kennedy. We have you at loss of signal in thirty.",
        sentAt: -900,
        oneWaySeconds: LIGHT_TIME,
      },
      {
        author: PILOT,
        body: "Kennedy, Ares. Attitude is drifting, do you copy.",
        sentAt: -300,
        oneWaySeconds: null,
      },
    ],
    separation: GROUND_TO_CRAFT,
    oneWaySeconds: LIGHT_TIME,
    pxW: 900,
    pxH: 620,
  },
  {
    /*
     * The link is CONFIRMED gone. Everything above the marker reached this
     * seat; past it there may be words nobody here has heard, which is why the
     * thread gets a terminator rather than a row. It has to be tellable at a
     * glance from the in-transit strip below it, which is one named utterance
     * with an instant it lands at: this is a rule across the column, in the
     * error tone, saying only where knowledge stops.
     */
    name: "no-signal-terminator",
    panes: [
      { seat: "mission-control", vantage: KSC, name: "Kennedy Flight" },
      { seat: "pilot", vantage: ARES, name: "Jeb" },
    ],
    messages: [
      {
        author: FLIGHT,
        body: "Ares, Kennedy. Expect loss of signal on the far side.",
        sentAt: -1800,
        oneWaySeconds: LIGHT_TIME,
      },
      {
        author: PILOT,
        body: "Kennedy, Ares. Copy, see you on the other side.",
        sentAt: -1500,
        oneWaySeconds: LIGHT_TIME,
      },
    ],
    linkLost: true,
    separation: GROUND_TO_CRAFT,
    oneWaySeconds: LIGHT_TIME,
    pxW: 900,
    pxH: 620,
  },
  {
    // A thread with a route and nothing in it, on a screen with no craft: no
    // `comms.delay` on the wire, so the composer turns error-toned, flags NO
    // PATH and names its own cost as "no path" rather than implying an instant
    // one. The separation emit is empty and exists only to anchor the clock,
    // which is why the composer is live rather than "No clock yet".
    name: "empty-no-vessel",
    panes: [{ seat: "mission-control", vantage: KSC, name: "Kennedy Flight" }],
    separation: [],
    pxW: 460,
    pxH: 460,
  },
  {
    // The other empty: this screen has no route to a thread at all, which is
    // a station whose host has gone rather than a mission with nothing said.
    // The two must not read the same and this is the pair that shows it: this
    // one reads "No host connection", the one above "Nothing spoken yet".
    name: "no-route",
    panes: [{ seat: "mission-control", vantage: KSC, name: "Kennedy Flight" }],
    noThread: true,
    separation: [],
    pxW: 460,
    pxH: 460,
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
  console.log("Bundling Commcast probe with esbuild...");
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
      '<script type="module" src="./commcast-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escaped}</script>`,
    );
  const file = join(tmpdir(), `commcast-probe-${process.pid}.html`);
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
      viewport: { width: 960, height: 700 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => {
      failures++;
      console.error("  [page error]", err.message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("  [console]", msg.text());
      // Warnings too: the probe reports an unsettled scene this way, and a
      // report nobody prints is the same as no report.
      if (msg.type() === "warning") console.warn("  [console]", msg.text());
    });

    /*
     * ONE SCENE PER FRESH PAGE LOAD, and that is load-bearing rather than
     * tidiness.
     *
     * The reveal does not always release: a scene can end with its thread empty
     * and every message parked in the transit strip with no countdown to print,
     * which is the widget's feed and its own `deliveryFor` disagreeing about
     * them. On one page rendering all six in turn, only the first thread scene
     * came out right. A fresh document per scene plus the warm-up below took it
     * from one scene in six to five in six.
     *
     * What it is NOT is scene-specific: which scene loses moves between runs,
     * so do not read the surviving warning as a fact about that scene. The
     * underlying defect wants a failing unit test on the feed and is not fixed
     * here.
     *
     * A reload costs a couple of seconds per scene. This harness exists to
     * photograph states nothing else can assert, and a picture of a thread that
     * never revealed is exactly the kind of wrong that reaches a reviewer
     * looking like the real thing, which is why the run says so out loud when
     * it happens.
     */
    for (const scene of SCENES) {
      const { name } = scene;
      await page.goto(pathToFileURL(probeHtml).toString(), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(
        () =>
          typeof (window as unknown as { __renderCommcast?: unknown })
            .__renderCommcast === "function",
        undefined,
        { timeout: 15_000 },
      );
      /*
       * A beat after the entry point exists, before the first scene mounts.
       * `__renderCommcast` being defined says the bundle EVALUATED, not that
       * everything it set up at module scope is running: the widget registry
       * and the view clock are both module-level. This was being supplied by
       * accident before, as the seconds a shared page spent bundling and
       * launching ahead of its first scene, and rendering the instant the page
       * was ready is what removed it.
       */
      await page.waitForTimeout(1_500);
      // The whole scene, name included: the probe prints it when a scene does not settle, and a warning that cannot say which scene it is about is no better than silence.
      await page.evaluate(
        (s) =>
          (
            window as unknown as {
              __renderCommcast: (p: unknown) => Promise<void>;
            }
          ).__renderCommcast(s),
        scene,
      );
      await page.waitForTimeout(200);
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
