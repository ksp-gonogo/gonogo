#!/usr/bin/env tsx
/**
 * Render the add-widget picker's provenance card (base description + the
 * `+ <Uplink>` addition lines + derived tags) to a PNG under
 * `local_docs/renders/provenance-tags/`, so the provenance UI is showable
 * (ComponentOverlay is not renderable through the widget probe). Same
 * esbuild -> injected HTML -> playwright pipeline as `render-delay-rail.ts`.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "provenance-card-probe");
const PROBE_ENTRY = join(PROBE_DIR, "provenance-card-probe-entry.tsx");
const PROBE_HTML_TEMPLATE = join(PROBE_DIR, "provenance-card-probe.html");
const OUT_DIR = resolve(HERE, "../../../local_docs/renders/provenance-tags");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

const VIEWPORT_W = 420;
const VIEWPORT_H = 360;

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await cleanArtifacts(OUT_DIR);

  console.log("Bundling provenance-card-probe-entry with esbuild…");
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
  const escapedBundle = bundleJs.replace(/<\/script/gi, "<\\/script");
  const htmlWithBundle = htmlTemplate
    .replace(
      '<style id="probe-theme">/* injected by render-provenance-card driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${themeCss}</style>`,
    )
    .replace(
      '<script type="module" src="./provenance-card-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escapedBundle}</script>`,
    );

  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-provenance-card-probe-${process.pid}.html`,
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
    page.on("pageerror", (err) => console.error("  [page error]", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error")
        console.error("  [console error]", msg.text());
    });
    await page.goto(pathToFileURL(probeHtmlOut).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __renderProvenanceCard?: unknown })
          .__renderProvenanceCard === "function",
      undefined,
      { timeout: 10_000 },
    );

    await page.evaluate(
      (payload) =>
        (
          window as unknown as {
            __renderProvenanceCard: (p: unknown) => Promise<void>;
          }
        ).__renderProvenanceCard(payload),
      { pxW: VIEWPORT_W, pxH: VIEWPORT_H },
    );
    const outName = "widget-picker-cards.png";
    await page.screenshot({ path: join(OUT_DIR, outName), fullPage: false });
    console.log(`  ${outName}`);
    console.log(`\nRendered provenance card -> ${OUT_DIR}`);
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
