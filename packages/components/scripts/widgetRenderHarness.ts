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
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "probe-entry.tsx");
const PROBE_HTML_TEMPLATE = join(PROBE_DIR, "probe.html");
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
): Promise<void> {
  if (configs.length === 0) {
    console.error("renderWidgets: no widget configs provided");
    process.exit(1);
  }

  const probeHtmlOut = await prepareProbePage(configs);

  console.log("Launching Chromium…");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 800, height: 800 },
      deviceScaleFactor: 2,
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
      await renderOneWidget(page, config);
    }
  } finally {
    await browser.close();
  }
}

async function renderOneWidget(
  page: Page,
  config: WidgetRenderConfig,
): Promise<void> {
  const fixturesDir = resolve(COMPONENTS_SRC, config.fixturesPath);
  const outDir = resolve(LOCAL_DOCS, config.outPath);

  await mkdir(outDir, { recursive: true });
  await cleanArtifacts(outDir, ARTIFACT_EXTS);

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
      const outName = `${fixture.name}--${mode.name}.png`;
      const outPath = join(outDir, outName);
      await root.screenshot({ path: outPath });
      count++;
    }
  }
  console.log(`Rendered ${count} widget shots → ${outDir}`);
}

/** Build the probe bundle, inline it into the HTML template, write to
 *  tmpdir. Returns the absolute path of the generated HTML. */
async function prepareProbePage(
  configs: WidgetRenderConfig[],
): Promise<string> {
  console.log("Bundling probe-entry with esbuild…");
  const bundleResult = await build({
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
  const bundleJs = bundleResult.outputFiles[0].text;

  const htmlTemplate = await readFile(PROBE_HTML_TEMPLATE, "utf8");
  const themeCss = extractRootBlock(await readFile(GLOBAL_CSS, "utf8"));

  // Inline-script payload may contain `</script>` (rare but possible in
  // bundled React code embedded as strings); escape so the host page
  // doesn't terminate the script tag early. Use a function-form `.replace`
  // so the replacement string is treated literally — String.replace's
  // string form interprets `$&`, `$1`, etc. as backreferences, which would
  // corrupt the bundle (React's sanitisation helpers use `$&` extensively).
  const escapedBundle = bundleJs.replace(/<\/script/gi, "<\\/script");
  const htmlWithBundle = htmlTemplate
    .replace(
      '<style id="probe-theme">/* injected by render-widget driver from packages/app/src/styles/global.css */</style>',
      () => `<style id="probe-theme">${themeCss}</style>`,
    )
    .replace(
      '<script type="module" src="./probe-entry.bundle.js"></script>',
      () => `<script type="module">${escapedBundle}</script>`,
    );

  const slug =
    configs.length === 1 ? (configs[0].slug ?? configs[0].widgetId) : "all";
  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-probe-${slug}-${process.pid}.html`,
  );
  await writeFile(probeHtmlOut, htmlWithBundle, "utf8");
  return probeHtmlOut;
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
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const dot = entry.name.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = entry.name.slice(dot).toLowerCase();
    if (!allow.has(ext)) continue;
    await rm(join(dir, entry.name));
    removed++;
  }
  if (removed > 0) {
    console.log(`Cleaned ${removed} stale artifact(s) from ${dir}`);
  }
}
