/**
 * Shared playwright + esbuild widget-screenshot harness. Every widget
 * driver delegates to `renderWidgets(configs)`; per-widget driver files
 * shrink to a config export. Adding a widget = new config, no new driver
 * script, no new package.json entry.
 *
 * The harness bundles `scripts/probe/probe-entry.tsx` ONCE per invocation
 * and reuses the same Chromium page across every widget when running
 * `--all`, so 10 widgets render in one launch instead of 10.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, firefox, type Page, webkit } from "playwright";

const require = createRequire(import.meta.url);

type Engine = "chromium" | "firefox" | "webkit";
const ENGINES = { chromium, firefox, webkit };
// Every suffix `renderWidgets` can produce (chromium's default is empty).
// Used to scope stale-artifact cleanup to one engine's own files so a
// firefox/webkit render doesn't delete a sibling engine's PNGs that share
// the same output directory.
const ENGINE_SUFFIXES = [
  "",
  ...Object.keys(ENGINES).map((e) => `--${e}`),
] as const;

/** True if `name` was produced by a render using exactly `suffix` (not a
 *  different, more specific engine suffix that happens to end the same way
 *  once `.png` is appended). */
function artifactMatchesSuffix(name: string, suffix: string): boolean {
  if (!name.endsWith(`${suffix}.png`)) return false;
  if (suffix !== "") return true;
  return !ENGINE_SUFFIXES.some(
    (other) => other !== "" && name.endsWith(`${other}.png`),
  );
}

// Pin the page clock so time-based widgets render byte-deterministically.
// The graph derives its X-axis domain (and tick labels) from Date.now(), so
// without this two runs seconds apart differ — enough to trip the visual
// gate's tight threshold on every run. A fixed epoch makes every render of a
// given fixture reproducible across runs and machines. Chosen arbitrarily
// (2023-11-14T22:13:20Z); only its stability matters.
const FIXED_EPOCH_MS = 1_700_000_000_000;

/** Freeze `Date.now()` in the page before any script runs, so `Date.now()`-
 *  derived layout (the graph's time axis) renders reproducibly. Added via
 *  addInitScript so it lands before the probe module and the widgets it
 *  mounts read the clock. Note: only `Date.now()` is pinned — a future widget
 *  deriving layout from `new Date()` / `performance.now()` would reintroduce
 *  nondeterminism and need handling here. */
async function installFixedClock(page: Page): Promise<void> {
  await page.addInitScript((fixed) => {
    Date.now = () => fixed;
  }, FIXED_EPOCH_MS);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "probe-entry.tsx");
const PROBE_HTML_TEMPLATE = join(PROBE_DIR, "probe.html");
const SCREEN_ENTRY = join(PROBE_DIR, "screen-entry.tsx");
const SCREEN_HTML_TEMPLATE = join(PROBE_DIR, "screen-probe.html");
const COMPONENTS_SRC = resolve(HERE, "../src");
const LOCAL_DOCS = resolve(HERE, "../../../local_docs");
const GLOBAL_CSS = resolve(HERE, "../../app/src/styles/global.css");
const ARTIFACT_EXTS = new Set([".png"]);

// Dashboard grid constants — mirrors packages/app/src/components/Dashboard/
// layoutNormalization.ts (ROW_HEIGHT, margin) plus a colWidth approximating
// `lg` (cols=36) at a comfortable viewport.
const COL_WIDTH = 32;
const ROW_HEIGHT = 25;
const GRID_MARGIN = 8;

export interface SizeMode {
  /** Slug used in the output filename. */
  name: string;
  w: number;
  h: number;
  /** Per-mode config overlay merged onto the widget's defaultConfig. */
  config?: Record<string, unknown>;
  /**
   * Optional synthetic clicks dispatched after mount + emit + settle.
   * Captures interactive states (arm-then-confirm, dropdown open,
   * modal). Runs in order; selectors target the live DOM via
   * `document.querySelector`. Missing selectors throw so brittle
   * fixtures get caught instead of producing misleading screenshots.
   */
  clicks?: ReadonlyArray<{ selector: string; awaitMs?: number }>;
  /**
   * Restrict the mode to a subset of fixtures. Useful for click-driven
   * modes that only make sense against specific scenarios (e.g. the
   * arm-recover click only applies to fixtures that actually have a
   * recoverable vessel). When omitted, the mode runs for every fixture.
   */
  forFixtures?: readonly string[];
}

export interface WidgetRenderConfig {
  /** Registered widget id passed to the probe (matches `registerComponent({ id: ... })`). */
  widgetId: string;
  /** Filename slug used for the tmpdir probe HTML; defaults to widgetId. */
  slug?: string;
  /** Fixtures directory path relative to `packages/components/src/`. */
  fixturesPath: string;
  /** Output directory path relative to `local_docs/`. */
  outPath: string;
  /** Grid-size variants to render every fixture at. */
  modes: SizeMode[];
}

/** A viewport size the screen harness renders a screen at. Unlike a widget
 *  `SizeMode` (grid units → `#root` pixels), a screen breakpoint sizes the
 *  whole PAGE viewport so the screen's own `@media` rules engage. */
export interface ScreenBreakpoint {
  /** Slug used in the output filename. */
  name: string;
  /** Page viewport width in CSS px. */
  width: number;
  /** Page viewport height in CSS px. */
  height: number;
  /** Emulate a touch / coarse-pointer device so `@media (pointer: coarse)`
   *  matches. Defaults to true for sub-tablet widths. */
  touch?: boolean;
}

/** One visual state of a screen — selects the prop set passed to the screen
 *  view (idle / error / reconnecting). */
export interface ScreenState {
  /** Slug used in the output filename. */
  name: string;
  /** Prop set forwarded to the screen probe. Shape matches the screen view. */
  props: Record<string, unknown>;
}

export interface ScreenRenderConfig {
  /** Marks this as a screen entry (vs. a widget) for the unified registry. */
  isScreen: true;
  /** Screen id the screen-entry probe dispatches on. */
  screenId: string;
  /** Output directory path relative to `local_docs/`. */
  outPath: string;
  /** Viewport breakpoints to render every state at. */
  breakpoints: ScreenBreakpoint[];
  /** Visual states (prop sets) to render at every breakpoint. */
  states: ScreenState[];
}

interface ProbeSeriesSample {
  t: number;
  v: unknown;
}

interface ProbePayload {
  widgetId: string;
  fixture: Record<string, unknown>;
  w: number;
  h: number;
  pxW: number;
  pxH: number;
  config?: Record<string, unknown>;
  instanceId?: string;
  series?: Record<string, readonly ProbeSeriesSample[]>;
  clicks?: ReadonlyArray<{ selector: string; awaitMs?: number }>;
}

/** Render every (fixture × mode) for one widget — convenience wrapper for
 *  the common single-widget invocation. */
export async function renderWidget(config: WidgetRenderConfig): Promise<void> {
  await renderWidgets([config]);
}

/** Render every fixture/mode across multiple widgets in a single Chromium
 *  session. Bundle is built once, page is reused. */
export async function renderWidgets(
  configs: WidgetRenderConfig[],
  opts: { engine?: Engine; outSuffix?: string; outBase?: string } = {},
): Promise<void> {
  if (configs.length === 0) {
    console.error("renderWidgets: no widget configs provided");
    process.exit(1);
  }

  const engine = opts.engine ?? "chromium";
  const outSuffix = opts.outSuffix ?? "";
  const outBase = opts.outBase ?? LOCAL_DOCS;

  const slug =
    configs.length === 1 ? (configs[0].slug ?? configs[0].widgetId) : "all";
  const probeHtmlOut = await prepareProbePage({
    entry: PROBE_ENTRY,
    htmlTemplate: PROBE_HTML_TEMPLATE,
    scriptSrcPlaceholder:
      '<script type="module" src="./probe-entry.bundle.js"></script>',
    slug,
  });

  console.log(`Launching ${engine}…`);
  const browser = await ENGINES[engine].launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 800, height: 800 },
      deviceScaleFactor: 2,
      // Several widgets pulse with `animation: … infinite` guarded by
      // `@media (prefers-reduced-motion: no-preference)`. Emulate reduce so
      // those guards suppress the animation — otherwise a pulsing state is
      // captured at an arbitrary opacity phase and the visual gate flakes.
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => {
      console.error("  [page error]", err.message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error("  [console error]", msg.text());
      }
    });

    await installFixedClock(page);
    await page.goto(pathToFileURL(probeHtmlOut).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __renderProbe?: unknown })
          .__renderProbe === "function",
      undefined,
      { timeout: 10_000 },
    );

    for (const config of configs) {
      await renderOneWidget(page, config, outSuffix, outBase);
    }
  } finally {
    await browser.close();
  }
}

/**
 * Render every (state × breakpoint) for one or more screen-level views in a
 * single Chromium session. The screen-entry bundle is built once and reused.
 *
 * The defining difference from `renderWidgets`: a screen owns the whole
 * viewport, so this resizes the PAGE viewport per breakpoint (and toggles
 * touch emulation) rather than sizing `#root`. That is what makes a screen's
 * `@media (max-width: …)` / `(pointer: coarse)` rules actually engage —
 * those match against the viewport + device, not an element's box. A fresh
 * browser CONTEXT is created per breakpoint because `hasTouch` is a
 * context-level option (it can't be flipped on a live page).
 */
export async function renderScreens(
  configs: ScreenRenderConfig[],
): Promise<void> {
  if (configs.length === 0) {
    console.error("renderScreens: no screen configs provided");
    process.exit(1);
  }

  const probeHtmlOut = await prepareProbePage({
    entry: SCREEN_ENTRY,
    htmlTemplate: SCREEN_HTML_TEMPLATE,
    scriptSrcPlaceholder:
      '<script type="module" src="./screen-entry.bundle.js"></script>',
    slug: configs.length === 1 ? configs[0].screenId : "screens",
  });
  const probeUrl = pathToFileURL(probeHtmlOut).toString();

  console.log("Launching Chromium…");
  const browser = await chromium.launch();
  try {
    for (const config of configs) {
      await renderOneScreen(browser, probeUrl, config);
    }
  } finally {
    await browser.close();
  }
}

async function renderOneScreen(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  probeUrl: string,
  config: ScreenRenderConfig,
): Promise<void> {
  const outDir = resolve(LOCAL_DOCS, config.outPath);
  await mkdir(outDir, { recursive: true });
  await cleanArtifacts(outDir, ARTIFACT_EXTS);

  console.log(`\n── screen: ${config.screenId} ──`);
  let count = 0;
  for (const bp of config.breakpoints) {
    // hasTouch is a context-level option — a new context per breakpoint is
    // the only way to flip coarse-pointer emulation. deviceScaleFactor=2
    // mirrors the widget harness for crisp retina-density PNGs.
    const touch = bp.touch ?? bp.width <= 768;
    const context = await browser.newContext({
      viewport: { width: bp.width, height: bp.height },
      deviceScaleFactor: 2,
      hasTouch: touch,
      isMobile: touch,
      // Suppress prefers-reduced-motion-guarded pulses for deterministic shots.
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => {
      console.error("  [page error]", err.message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error("  [console error]", msg.text());
      }
    });

    await installFixedClock(page);
    await page.goto(probeUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __renderScreen?: unknown })
          .__renderScreen === "function",
      undefined,
      { timeout: 10_000 },
    );

    for (const state of config.states) {
      await page.evaluate(
        (p) =>
          (
            window as unknown as {
              __renderScreen: (payload: unknown) => Promise<void>;
            }
          ).__renderScreen(p),
        { screenId: config.screenId, props: state.props },
      );
      const outName = `${state.name}--${bp.name}.png`;
      // Full-page screenshot (not `#root`) so the captured frame is exactly
      // the breakpoint viewport — the whole point of a screen render.
      await page.screenshot({
        path: join(outDir, outName),
        animations: "disabled",
      });
      count++;
    }
    await context.close();
  }
  console.log(`Rendered ${count} screen shots → ${outDir}`);
}

async function renderOneWidget(
  page: Page,
  config: WidgetRenderConfig,
  outSuffix = "",
  outBase: string = LOCAL_DOCS,
): Promise<void> {
  const fixturesDir = resolve(COMPONENTS_SRC, config.fixturesPath);
  const outDir = resolve(outBase, config.outPath);

  await mkdir(outDir, { recursive: true });
  await cleanArtifacts(outDir, ARTIFACT_EXTS, (name) =>
    artifactMatchesSuffix(name, outSuffix),
  );

  const fixtureFiles = (await readdir(fixturesDir)).filter((e) =>
    e.endsWith(".json"),
  );
  if (fixtureFiles.length === 0) {
    console.error(`[${config.widgetId}] No fixtures found in ${fixturesDir}`);
    return;
  }

  const fixtures: { name: string; data: Record<string, unknown> }[] = [];
  for (const file of fixtureFiles) {
    const raw = await readFile(join(fixturesDir, file), "utf8");
    fixtures.push({
      name: file.replace(/\.json$/, ""),
      data: JSON.parse(raw) as Record<string, unknown>,
    });
  }

  console.log(`\n── ${config.widgetId} ──`);
  let count = 0;
  for (const fixture of fixtures) {
    // Fixtures may include an `_series` block keyed by data-source key,
    // each entry an array of {t, v} samples. The harness lifts that out
    // of the fixture and into the probe payload so useDataSeries-backed
    // sparklines / live trace dots render with seeded history.
    const seriesData = (
      fixture.data as { _series?: Record<string, readonly ProbeSeriesSample[]> }
    )._series;
    for (const mode of config.modes) {
      if (mode.forFixtures && !mode.forFixtures.includes(fixture.name)) {
        continue;
      }
      const pxW = mode.w * COL_WIDTH + (mode.w - 1) * GRID_MARGIN;
      const pxH = mode.h * ROW_HEIGHT + (mode.h - 1) * GRID_MARGIN;
      const payload: ProbePayload = {
        widgetId: config.widgetId,
        fixture: fixture.data,
        w: mode.w,
        h: mode.h,
        pxW,
        pxH,
        config: mode.config,
        series: seriesData,
        clicks: mode.clicks,
      };
      await page.evaluate(
        (p) =>
          (
            window as unknown as {
              __renderProbe: (payload: ProbePayload) => Promise<void>;
            }
          ).__renderProbe(p),
        payload as unknown as Record<string, unknown>,
      );
      const root = await page.$("#root");
      if (!root) throw new Error("Probe: #root missing after render");
      const outName = `${fixture.name}--${mode.name}${outSuffix}.png`;
      const outPath = join(outDir, outName);
      // animations:"disabled" cancels any still-running CSS animation to its
      // initial state and fast-forwards finite transitions, so the capture is
      // deterministic even for anything not covered by reducedMotion.
      await root.screenshot({ path: outPath, animations: "disabled" });
      count++;
    }
  }
  console.log(`Rendered ${count} widget shots → ${outDir}`);
}

interface PreparePageOpts {
  /** esbuild entry point (probe-entry.tsx or screen-entry.tsx). */
  entry: string;
  /** HTML template path with the `probe-theme` style + script placeholder. */
  htmlTemplate: string;
  /** The exact `<script …></script>` string in the template to replace with
   *  the inlined bundle. */
  scriptSrcPlaceholder: string;
  /** Filename slug for the tmpdir HTML. */
  slug: string;
}

/** Build a probe bundle, inline it + the theme CSS into the HTML template,
 *  write to tmpdir. Shared by the widget and screen render paths — they
 *  differ only in entry point + HTML template. Returns the generated HTML
 *  path. */
async function prepareProbePage(opts: PreparePageOpts): Promise<string> {
  console.log(`Bundling ${opts.entry} with esbuild…`);
  const bundleResult = await build({
    entryPoints: [opts.entry],
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
  const bundleJs = bundleResult.outputFiles[0].text;

  const htmlTemplate = await readFile(opts.htmlTemplate, "utf8");
  const themeCss = extractRootBlock(await readFile(GLOBAL_CSS, "utf8"));
  const fontFace = await jetbrainsMonoFontFace();

  // Inline-script payload may contain `</script>` (rare but possible in
  // bundled React code embedded as strings); escape so the host page
  // doesn't terminate the script tag early. Use a function-form `.replace`
  // so the replacement string is treated literally — String.replace's
  // string form interprets `$&`, `$1`, etc. as backreferences, which would
  // corrupt the bundle (React's sanitisation helpers use `$&` extensively).
  const escapedBundle = bundleJs.replace(/<\/script/gi, "<\\/script");
  const htmlWithBundle = htmlTemplate
    .replace(
      /<style id="probe-theme">[\s\S]*?<\/style>/,
      () => `<style id="probe-theme">${fontFace}${themeCss}</style>`,
    )
    .replace(
      opts.scriptSrcPlaceholder,
      () => `<script type="module">${escapedBundle}</script>`,
    );

  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-probe-${opts.slug}-${process.pid}.html`,
  );
  await writeFile(probeHtmlOut, htmlWithBundle, "utf8");
  return probeHtmlOut;
}

/** Inline JetBrains Mono as a data-URI @font-face so file:// renders use the
 *  locked font deterministically, matching the app's self-hosted face. */
async function jetbrainsMonoFontFace(): Promise<string> {
  // @fontsource ships the woff2 under files/. Resolve via the package.
  const regular = require.resolve(
    "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
  );
  const bold = require.resolve(
    "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2",
  );
  const b64 = async (p: string) => (await readFile(p)).toString("base64");
  return `
    @font-face{font-family:"JetBrains Mono";font-weight:400;font-style:normal;
      src:url(data:font/woff2;base64,${await b64(regular)}) format("woff2");}
    @font-face{font-family:"JetBrains Mono";font-weight:700;font-style:normal;
      src:url(data:font/woff2;base64,${await b64(bold)}) format("woff2");}
  `;
}

function extractRootBlock(css: string): string {
  const match = css.match(/:root\s*\{[\s\S]*?\}/);
  if (!match) {
    throw new Error("global.css: no :root block found");
  }
  return match[0];
}

/** Wipe stale artifacts from the output dir before regenerating. Only
 *  touches top-level files whose extension is in the allowlist so a stray
 *  sibling directory is never recursively destroyed. */
async function cleanArtifacts(
  dir: string,
  allow: ReadonlySet<string>,
  matches: (name: string) => boolean = () => true,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const dot = entry.name.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = entry.name.slice(dot).toLowerCase();
    if (!allow.has(ext)) continue;
    if (!matches(entry.name)) continue;
    await rm(join(dir, entry.name));
    removed++;
  }
  if (removed > 0) {
    console.log(`Cleaned ${removed} stale artifact(s) from ${dir}`);
  }
}
