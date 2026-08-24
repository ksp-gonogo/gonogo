#!/usr/bin/env tsx
/**
 * Render the attitude and manoeuvre marker set as one contact sheet, through a
 * real Chromium page.
 *
 * Run: `pnpm --filter @ksp-gonogo/ui-kit render:markers`
 * Output: local_docs/renders/icons/markers.png
 *
 * The sheet is the evidence for the two rules `MarkerIcons.tsx` is built on,
 * rather than a gallery. Each row is one viewing condition: the dark surface,
 * a light surface, both again through a greyscale filter, and the dark surface
 * as seen with each of the three dichromacies (Machado, Oliveira and Fernandes
 * 2009 simulation matrices at full severity). A marker that cannot be told from
 * its pair in every row has failed, whatever it looks like in the first one.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "render-markers.entry.tsx");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");
const OUT_DIR = resolve(HERE, "../../../local_docs/renders/icons");
const OUT = join(OUT_DIR, "markers.png");

function rootBlock(css: string): string {
  const match = css.match(/:root\s*\{[\s\S]*?\}/);
  if (!match) throw new Error(`${THEME_TOKENS_CSS}: no :root block`);
  return match[0];
}

async function main(): Promise<void> {
  const bundle = await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const js = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const tokens = rootBlock(await readFile(THEME_TOKENS_CSS, "utf8"));
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>${tokens}
html, body { margin: 0; background: #444; font-family: ui-monospace, Menlo, monospace; }
</style></head><body><div id="root"></div>
<script type="module">${js}</script></body></html>`;
  const page = join(tmpdir(), `gonogo-markers-${process.pid}.html`);
  await writeFile(page, html, "utf8");
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  let failures = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: 1100, height: 1400 },
      deviceScaleFactor: 2,
    });
    const tab = await context.newPage();
    tab.on("pageerror", (err) => {
      failures++;
      console.error("  [page error]", err.message);
    });
    await tab.goto(pathToFileURL(page).toString(), {
      waitUntil: "domcontentloaded",
    });
    await tab.waitForSelector("[data-sheet-ready]", { timeout: 10_000 });
    const root = await tab.$("#root");
    if (!root) throw new Error("#root missing");
    await root.screenshot({ path: OUT });
    console.log(`  ✓ markers → ${OUT}`);
  } finally {
    await browser.close();
  }
  if (failures > 0) throw new Error(`${failures} page error(s); see above`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
