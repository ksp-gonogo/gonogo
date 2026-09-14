#!/usr/bin/env tsx
/**
 * Render the dashboard header (`MissionBanner`) through a real Chromium page,
 * across the states its signal delay readout distinguishes.
 *
 * Run: `pnpm --filter @ksp-gonogo/app render-header-delay`
 * Output: local_docs/renders/header-delay/ (HEADER_DELAY_RENDER_OUT overrides)
 *
 * `HEADER_DELAY_CODE=before` renders the header as it was before the delay
 * field, with the pre-change `MissionBanner` checked out, so a before and after
 * pair come from the same scenes. Each shot waits for the header's text to
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
 * Which header the harness is rendering: `after` has the delay field, `before`
 * is the header as it was, rendered through this same harness for comparison.
 */
type CodeState = "before" | "after";
const CODE_STATE: CodeState =
  process.env.HEADER_DELAY_CODE === "before" ? "before" : "after";

const KSC = "ground:Kerbal Space Center";
const GS1 = "ground:Ground Station 1";

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
];

/** `CommsDelaySource.SignalDelay`, spelled as the wire carries it. */
const SIGNAL_DELAY = 1;

interface Scene {
  name: string;
  vantage: string;
  emit: [string, unknown][];
  /**
   * How the header's text ends once the scene has settled, for each code
   * state, give or take the one null token a dash draws. The shot is taken
   * only once it does, so a render cannot capture a reading that has not
   * arrived yet.
   */
  settled: Record<CodeState, string>;
}

const SCENES: Scene[] = [
  {
    // A craft a little over three light-minutes from home, observed from home.
    name: "flight-at-delay",
    vantage: KSC,
    settled: { after: "DelaySignal delay 3min 7s", before: "CCKSCHome" },
    emit: [
      ["commandCentre.roster", ROSTER],
      ["spaceCenter.scene", { scene: "Flight" }],
      ["comms.delay", { oneWaySeconds: 187.4, source: SIGNAL_DELAY }],
      ["comms.link", { connected: true }],
    ],
  },
  {
    // The path home is gone. The authority holds the last light-time, and the
    // header must not present that held figure as a live one.
    name: "flight-disconnected",
    vantage: KSC,
    settled: {
      after: "DelaySignal delay: disconnected",
      before: "CCKSCHome",
    },
    emit: [
      ["commandCentre.roster", ROSTER],
      ["spaceCenter.scene", { scene: "Flight" }],
      ["comms.delay", { oneWaySeconds: 187.4, source: SIGNAL_DELAY }],
      ["comms.delay", { source: 0 }],
      ["comms.link", { connected: false }],
    ],
  },
  {
    // Observed from a centre the wire carries no delay for.
    name: "flight-non-home-centre",
    vantage: GS1,
    settled: {
      after: "Signal delay from this command centre is not reported",
      before: "CCGround Station 1",
    },
    emit: [
      ["commandCentre.roster", ROSTER],
      ["spaceCenter.scene", { scene: "Flight" }],
      ["comms.delay", { oneWaySeconds: 187.4, source: SIGNAL_DELAY }],
      ["comms.link", { connected: true }],
    ],
  },
  {
    name: "no-active-vessel",
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

    for (const { name, vantage, emit, settled } of SCENES) {
      const flying = emit.some(
        ([topic, payload]) =>
          topic === "spaceCenter.scene" &&
          (payload as { scene?: string }).scene === "Flight",
      );
      /*
       * What the header under test subscribes. The header as it was reads only
       * the roster, plus the `comms.delay` the provider's authority always
       * holds; the delay field adds the scene, and reads the link only in flight.
       */
      const awaitTopics =
        CODE_STATE === "before"
          ? ["commandCentre.roster", "comms.delay"]
          : [
              "commandCentre.roster",
              "comms.delay",
              "spaceCenter.scene",
              ...(flying ? ["comms.link"] : []),
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
          vantage,
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
