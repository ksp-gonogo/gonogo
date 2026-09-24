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
 * category with several groups in it, the same category with the Topic silent, a
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

/**
 * A stock Kerbin day, in seconds, taken from the unit model's own calendar
 * rather than through ui-kit's re-export: this is the NODE half of the
 * harness, and importing the design system here pulls styled-components into
 * a runtime with no DOM for it. Pinned to the stock calendar on purpose, a
 * render fixture must not shift with whatever the last test set.
 */
const KSP_DAY = STOCK_KERBIN_CALENDAR.day;

/**
 * The planted Uplink's settings Topic, spelled out rather than imported:
 * `probe/plantedSettings.ts` registers rows at module load, which throws in
 * this Node half where no host is installed.
 */
const TOPIC = "planted.settings";

/** A planted session mid-flight: every row carries a value. */
const PLANTED_LIVE = {
  status: "Reading",
  build: "0.0.0-planted",
  frameName: "Kerbin-centred inertial",
  frameCentre: "Kerbin",
  frameHasApsides: true,
  toleranceMetres: 1,
  maxSteps: 1_000_000,
  windowSeconds: 28 * KSP_DAY,
  historySeconds: 3 * 3600,
  markersHidden: 2,
  logThreshold: "ERROR",
  journaling: false,
};

/** The mod's settings Topic, and its enums as the wire carries them: ordinals. */
const KSP_TOPIC = "settings.gonogo";
const BOOL = 1;
const NUMBER = 2;
const SAVED = 0;
const MEMORY_ONLY = 1;
const RECOVERED = 2;

/**
 * What the mod publishes for a stock install with RP-1: its own four rows and
 * one Uplink's.
 */
function kspSettings(state: number, reason: string | null = null) {
  return {
    rows: [
      {
        path: "SIGNAL_DELAY/enabled",
        owner: "gonogo",
        kind: BOOL,
        label: "Apply light-time delay to commands and telemetry",
        value: "True",
        default: "True",
      },
      {
        path: "SIGNAL_DELAY/lightSpeedScale",
        owner: "gonogo",
        kind: NUMBER,
        label:
          "One-way light time as a fraction of c, where 1 is real light speed",
        value: "0.1",
        default: "1",
      },
      {
        path: "SIGNAL_DELAY/delayInSimulation",
        owner: "gonogo",
        kind: BOOL,
        label: "Apply the delay during a simulation as well as a real flight",
        value: "False",
        default: "False",
      },
      {
        path: "RECORDING/enabled",
        owner: "gonogo",
        kind: BOOL,
        label:
          "Record a development capture of this session, which costs disk and log",
        value: "False",
        default: "False",
      },
      {
        path: "Uplinks/Rp1/upgradeSlipWarningDays",
        owner: "Rp1",
        kind: NUMBER,
        label:
          "Warn before a facility upgrade whose finish date slips past this many days",
        value: "30",
        default: "30",
      },
    ],
    persistence: {
      state,
      path: "GameData/Gonogo/PluginData/gonogo.cfg",
      savedAtUt: null,
      reason,
    },
    undeclared: [],
  };
}

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
  /** The tab to open on. The General tab when unset. */
  tab?: string;
  /** The screen the modal is drawn for. The main screen when unset. */
  screen?: "main" | "station";
  /** Whether KSP reads as connected, which is what lets a KSP setting be changed. */
  connected?: boolean;
}

const SCENES: Scene[] = [
  {
    // Several named groups under one heading, rather than one flat list.
    name: "planted-grouped",
    emit: { [TOPIC]: PLANTED_LIVE },
    pxW: 900,
    pxH: 700,
    scrollToLabel: "Frame",
  },
  {
    // Further down: quantity rows (a tolerance in metres, a window in days, a
    // history in hours) beside the bare counts, and a severity by name.
    name: "planted-quantities",
    emit: { [TOPIC]: PLANTED_LIVE },
    pxW: 900,
    pxH: 700,
    scrollToLabel: "Journal recording now",
  },
  {
    // Nothing on the wire. Every row shows its null placeholder rather than a
    // zero, which is the whole standard for a read-only row: a panel full of
    // zeroes reads as a mod configured to zero.
    name: "planted-topic-silent",
    pxW: 900,
    pxH: 700,
    scrollToLabel: "Frame",
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
  {
    // The KSP tab, connected: every row drawn from the wire, grouped by who
    // declared it, and SAVE waiting for a change.
    name: "ksp-connected",
    tab: "ksp",
    connected: true,
    emit: { [KSP_TOPIC]: kspSettings(SAVED) },
    pxW: 900,
    pxH: 620,
  },
  {
    // The last save could not write the file: in force for this session only,
    // and the standing line says so and why.
    name: "ksp-memory-only",
    tab: "ksp",
    connected: true,
    emit: {
      [KSP_TOPIC]: kspSettings(MEMORY_ONLY, "Access to the path is denied"),
    },
    pxW: 900,
    pxH: 620,
  },
  {
    // The file was damaged at start-up and its backup was read.
    name: "ksp-recovered",
    tab: "ksp",
    connected: true,
    emit: { [KSP_TOPIC]: kspSettings(RECOVERED) },
    pxW: 900,
    pxH: 620,
  },
  {
    // KSP is not connected: the last values stay readable, and nothing can be
    // changed, which the footer says.
    name: "ksp-disconnected",
    tab: "ksp",
    connected: false,
    emit: { [KSP_TOPIC]: kspSettings(SAVED) },
    pxW: 900,
    pxH: 620,
  },
  {
    // A station reads the settings and has no SAVE.
    name: "ksp-station",
    tab: "ksp",
    screen: "station",
    emit: { [KSP_TOPIC]: kspSettings(SAVED) },
    pxW: 900,
    pxH: 620,
  },
  {
    // Connected, and the mod has not reported its settings yet.
    name: "ksp-waiting",
    tab: "ksp",
    connected: true,
    pxW: 900,
    pxH: 300,
  },
];

/** The theme sheet whole, checked to be the tokens file. The border-box reset
 *  the kit's primitives are drawn against sits outside the `:root` block. */
function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error("tokens.css: no :root block found");
  }
  return css;
}

async function prepareProbePage(): Promise<string> {
  console.log("Bundling settings probe with esbuild...");
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

  console.log("Launching Chromium...");
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

    for (const {
      name,
      emit,
      prefs,
      pxW,
      pxH,
      scrollToLabel,
      tab,
      screen,
      connected,
    } of SCENES) {
      await page.evaluate(
        (s) =>
          (
            window as unknown as {
              __renderSettings: (p: unknown) => Promise<void>;
            }
          ).__renderSettings(s),
        { emit, prefs, pxW, pxH, tab, screen, connected },
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
