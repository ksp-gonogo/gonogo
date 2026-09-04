#!/usr/bin/env tsx
/**
 * Render the three states a trace can be in, at every fixture in
 * `scripts/chart-provenance-probe/__fixtures__/`, to a PNG under
 * `local_docs/renders/reckoning/`.
 *
 * Uses a dedicated probe (the pattern `render-descent-envelope-drag.ts` sets)
 * rather than the widget-fixture harness, for a reason that is the point of
 * the renders: the reckoned state has NO PRODUCER on the stream, so no
 * telemetry fixture can drive it. `LineChart` is presentational (arrays in,
 * SVG out), so it mounts here with explicit props and the picture shows the
 * presentation the moment a model exists to fill it.
 */
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "chart-provenance-probe");
const PROBE_ENTRY = join(PROBE_DIR, "chart-provenance-probe-entry.tsx");
const PROBE_HTML_TEMPLATE = join(PROBE_DIR, "chart-provenance-probe.html");
const FIXTURES_DIR = join(PROBE_DIR, "__fixtures__");
const OUT_DIR = resolve(HERE, "../../../local_docs/renders/reckoning");
/*
 * The theme package's SOURCE tokens.css: plain text, no bundler resolution,
 * and no dependency on `@ksp-gonogo/theme` having been built.
 */
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");
const UI_SRC = resolve(HERE, "../../ui/src");
const UI_DIST_ENTRY = resolve(HERE, "../../ui/dist/index.js");

const PADDING = 24;

async function main(): Promise<void> {
  await assertUiDistIsCurrent();
  await mkdir(OUT_DIR, { recursive: true });
  await cleanArtifacts(OUT_DIR);

  const fixtureFiles = (await readdir(FIXTURES_DIR))
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (fixtureFiles.length === 0) {
    console.error(`No fixtures in ${FIXTURES_DIR}`);
    process.exit(1);
  }

  console.log("Bundling chart-provenance-probe-entry with esbuild...");
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
  const theme = themeCss(await readFile(THEME_TOKENS_CSS, "utf8"));
  // Same `$&` / `</script>` escaping as the widget harness: bundled React code
  // contains a literal `$&`, which string-form .replace reads as a
  // backreference.
  const escapedBundle = bundleJs.replace(/<\/script/gi, "<\\/script");
  const htmlWithBundle = htmlTemplate
    .replace(
      '<style id="probe-theme">/* injected by render-chart-provenance driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${theme}</style>`,
    )
    .replace(
      '<script type="module" src="./chart-provenance-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escapedBundle}</script>`,
    );

  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-chart-provenance-probe-${process.pid}.html`,
  );
  await writeFile(probeHtmlOut, htmlWithBundle, "utf8");

  console.log("Launching Chromium...");
  const browser = await chromium.launch();
  try {
    for (const file of fixtureFiles) {
      const raw = await readFile(join(FIXTURES_DIR, file), "utf8");
      const fixture = JSON.parse(raw) as {
        _meta?: unknown;
        props: { width: number; height: number } & Record<string, unknown>;
      };
      const viewportW = fixture.props.width + PADDING * 2;
      const viewportH = fixture.props.height + PADDING * 2;
      const context = await browser.newContext({
        viewport: { width: viewportW, height: viewportH },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      page.on("pageerror", (err) => {
        console.error("  [page error]", err.message);
      });
      page.on("console", (msg) => {
        if (msg.type() === "error")
          console.error("  [console error]", msg.text());
      });
      await page.goto(pathToFileURL(probeHtmlOut).toString(), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(
        () =>
          typeof (window as unknown as { __renderChartProvenance?: unknown })
            .__renderChartProvenance === "function",
        undefined,
        { timeout: 10_000 },
      );
      await page.evaluate(
        (payload) =>
          (
            window as unknown as {
              __renderChartProvenance: (p: unknown) => Promise<void>;
            }
          ).__renderChartProvenance(payload),
        {
          props: fixture.props,
          pxW: fixture.props.width,
          pxH: fixture.props.height,
        },
      );
      const outName = file.replace(/\.json$/, ".png");
      await page.screenshot({ path: join(OUT_DIR, outName), fullPage: false });
      console.log(`  ${outName}`);
      await context.close();
    }
    console.log(
      `\nRendered ${fixtureFiles.length} chart-provenance shot(s) → ${OUT_DIR}`,
    );
  } finally {
    await browser.close();
  }
}

/**
 * Refuse to render against a `@ksp-gonogo/ui` build older than its own source.
 *
 * `packages/ui` resolves through `dist`, and esbuild bundles whatever is there
 * without a word. The first run of this driver produced a picture of the
 * PREVIOUS chart's rules and looked entirely plausible, which is the failure
 * mode a render is least able to show you: a shot that predates the change it
 * is offered as evidence of. Cheap to detect, so detected.
 */
async function assertUiDistIsCurrent(): Promise<void> {
  const dist = await stat(UI_DIST_ENTRY).catch(() => null);
  if (!dist) {
    throw new Error(
      "packages/ui is not built. Run `pnpm --filter @ksp-gonogo/ui build` first.",
    );
  }
  const newest = await newestMtime(UI_SRC);
  if (newest > dist.mtimeMs) {
    throw new Error(
      "packages/ui/dist is older than packages/ui/src: the render would show " +
        "the previous chart. Run `pnpm --filter @ksp-gonogo/ui build` first.",
    );
  }
}

async function newestMtime(dir: string): Promise<number> {
  let newest = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    newest = Math.max(
      newest,
      e.isDirectory() ? await newestMtime(p) : (await stat(p)).mtimeMs,
    );
  }
  return newest;
}

/** The theme sheet whole, checked to be the tokens file. */
function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error("tokens.css: no :root block found");
  }
  return css;
}

async function cleanArtifacts(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  let removed = 0;
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".png")) continue;
    await rm(join(dir, e.name));
    removed++;
  }
  if (removed > 0) console.log(`Cleaned ${removed} stale PNG(s) from ${dir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
