#!/usr/bin/env tsx
/**
 * Render the AlarmBanner at every fixture in
 * `scripts/banner-probe/__fixtures__/` to a PNG under
 * `local_docs/renders/alarm-banner/`. Uses a dedicated probe entry
 * because the banner is an app-level component (not a registered
 * dashboard widget) and needs `AlarmHostContext` + `BannerStack`
 * around it, not `useDataValue` mocks.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "banner-probe");
const PROBE_ENTRY = join(PROBE_DIR, "banner-probe-entry.tsx");
const PROBE_HTML_TEMPLATE = join(PROBE_DIR, "banner-probe.html");
const FIXTURES_DIR = join(PROBE_DIR, "__fixtures__");
const OUT_DIR = resolve(HERE, "../../../local_docs/renders/alarm-banner");
const GLOBAL_CSS = resolve(HERE, "../../app/src/styles/global.css");

// Viewport sized to match the bottom-right portion of a real dashboard
// where the BannerStack lives. Wide enough that the banner doesn't get
// horizontally clipped at any reasonable state.
const VIEWPORT_W = 1100;
const VIEWPORT_H = 320;

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

  console.log("Bundling banner-probe-entry with esbuild…");
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
  // Same `$&` / `</script>` escaping as the widget harness — bundled
  // React code contains literal `$&` (sanitisation helpers) and
  // string-form .replace would treat that as a backreference.
  const escapedBundle = bundleJs.replace(/<\/script/gi, "<\\/script");
  const htmlWithBundle = htmlTemplate
    .replace(
      '<style id="probe-theme">/* injected by render-alarm-banner driver from packages/app/src/styles/global.css */</style>',
      () => `<style id="probe-theme">${themeCss}</style>`,
    )
    .replace(
      '<script type="module" src="./banner-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escapedBundle}</script>`,
    );

  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-banner-probe-${process.pid}.html`,
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
        typeof (window as unknown as { __renderBanner?: unknown })
          .__renderBanner === "function",
      undefined,
      { timeout: 10_000 },
    );

    for (const file of fixtureFiles) {
      const raw = await readFile(join(FIXTURES_DIR, file), "utf8");
      const fixture = JSON.parse(raw) as { _meta?: unknown };
      const { _meta, ...snapshot } = fixture as Record<string, unknown>;
      void _meta;
      await page.evaluate(
        (payload) =>
          (
            window as unknown as {
              __renderBanner: (p: unknown) => Promise<void>;
            }
          ).__renderBanner(payload),
        { snapshot, pxW: VIEWPORT_W, pxH: VIEWPORT_H },
      );
      const outName = file.replace(/\.json$/, ".png");
      const outPath = join(OUT_DIR, outName);
      await page.screenshot({ path: outPath, fullPage: false });
      console.log(`  ${outName}`);
    }
    console.log(`\nRendered ${fixtureFiles.length} banner shots → ${OUT_DIR}`);
  } finally {
    await browser.close();
  }
}

function extractRootBlock(css: string): string {
  const m = css.match(/:root\s*\{[\s\S]*?\}/);
  if (!m) throw new Error("global.css: no :root block found");
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
