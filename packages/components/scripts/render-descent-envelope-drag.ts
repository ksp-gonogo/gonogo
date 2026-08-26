#!/usr/bin/env tsx
/**
 * Render DescentEnvelope's drag-to-weight PROTOTYPE
 * (`dragToWeight`/`dragDisplay`) at every fixture in
 * `scripts/descent-envelope-probe/__fixtures__/` to a PNG under
 * `local_docs/renders/descent-envelope-drag/`.
 *
 * Uses a dedicated probe (mirrors `render-alarm-banner.ts`'s pattern)
 * rather than the shared widget-fixture harness in `scripts/probe/`:
 * DescentEnvelope is a plain presentational component (props in, SVG
 * out, no data hooks, no LandingStatus config plumbing), so it mounts
 * directly with explicit props instead of going through the full
 * LandingStatus widget + telemetry-fixture pipeline. `dragToWeight` has
 * no wire field yet, these renders exist purely to compare the ARROW
 * vs. TEXT visual treatments before any mod/contract work happens.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "descent-envelope-probe");
const PROBE_ENTRY = join(PROBE_DIR, "descent-envelope-probe-entry.tsx");
const PROBE_HTML_TEMPLATE = join(PROBE_DIR, "descent-envelope-probe.html");
const FIXTURES_DIR = join(PROBE_DIR, "__fixtures__");
const OUT_DIR = resolve(
  HERE,
  "../../../local_docs/renders/descent-envelope-drag",
);
/*
 * The theme package's SOURCE tokens.css, which is plain text, needs no bundler
 * resolution and does not depend on `@ksp-gonogo/theme` having been built.
 * `global.css` only `@import`s the theme, so it carries no `:root` block for
 * `extractRootBlock` to match and this driver threw on every run.
 */
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

// DescentEnvelope is a fixed 160×160 square (see SIZE in the component);
// pad the viewport a little so the panel doesn't touch the frame edge.
const PANEL_SIZE = 160;
const PADDING = 24;
const VIEWPORT_W = PANEL_SIZE + PADDING * 2;
const VIEWPORT_H = PANEL_SIZE + PADDING * 2;

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await cleanArtifacts(OUT_DIR);

  const fixtureFiles = (await readdir(FIXTURES_DIR)).filter((f) =>
    f.endsWith(".json"),
  );
  if (fixtureFiles.length === 0) {
    console.error(`No fixtures in ${FIXTURES_DIR}`);
    process.exit(1);
  }

  console.log("Bundling descent-envelope-probe-entry with esbuild…");
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
  const themeCss = extractRootBlock(await readFile(THEME_TOKENS_CSS, "utf8"));
  // Same `$&` / `</script>` escaping as the widget harness, bundled
  // React code contains literal `$&` (sanitisation helpers) and
  // string-form .replace would treat that as a backreference.
  const escapedBundle = bundleJs.replace(/<\/script/gi, "<\\/script");
  const htmlWithBundle = htmlTemplate
    .replace(
      '<style id="probe-theme">/* injected by render-descent-envelope-drag driver from packages/app/src/styles/global.css */</style>',
      () => `<style id="probe-theme">${themeCss}</style>`,
    )
    .replace(
      '<script type="module" src="./descent-envelope-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escapedBundle}</script>`,
    );

  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-descent-envelope-probe-${process.pid}.html`,
  );
  await writeFile(probeHtmlOut, htmlWithBundle, "utf8");

  console.log("Launching Chromium…");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
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
        typeof (window as unknown as { __renderDescentEnvelope?: unknown })
          .__renderDescentEnvelope === "function",
      undefined,
      { timeout: 10_000 },
    );

    for (const file of fixtureFiles) {
      const raw = await readFile(join(FIXTURES_DIR, file), "utf8");
      const fixture = JSON.parse(raw) as {
        _meta?: unknown;
        props: Record<string, unknown>;
      };
      await page.evaluate(
        (payload) =>
          (
            window as unknown as {
              __renderDescentEnvelope: (p: unknown) => Promise<void>;
            }
          ).__renderDescentEnvelope(payload),
        { props: fixture.props, pxW: VIEWPORT_W, pxH: VIEWPORT_H },
      );
      const outName = file.replace(/\.json$/, ".png");
      const outPath = join(OUT_DIR, outName);
      await page.screenshot({ path: outPath, fullPage: false });
      console.log(`  ${outName}`);
    }
    console.log(
      `\nRendered ${fixtureFiles.length} DescentEnvelope drag-prototype shot(s) → ${OUT_DIR}`,
    );
  } finally {
    await browser.close();
  }
}

function extractRootBlock(css: string): string {
  const m = css.match(/:root\s*\{[\s\S]*?\}/);
  if (!m) throw new Error("tokens.css: no :root block found");
  return m[0];
}

async function cleanArtifacts(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  let removed = 0;
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".png")) continue;
    await rm(join(dir, e.name));
    removed++;
  }
  if (removed > 0) console.log(`Cleaned ${removed} stale PNG(s) from ${dir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
