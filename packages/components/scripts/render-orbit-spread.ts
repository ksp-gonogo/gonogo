#!/usr/bin/env tsx
/**
 * Render the orbit-spread scenes through a real Chromium page, each one twice:
 * `before` is the diagram with no spread handed over, `after` the same diagram
 * and reading with it.
 *
 * Run: `pnpm --filter @ksp-gonogo/components exec tsx scripts/render-orbit-spread.ts --out <dir>`
 * Output: `<dir>/<NN>-<scene id>-<before|after>.png`.
 *
 * Not registered in `widgets.ts`: that file is the visual gate's input, and a
 * scene added to it with no committed baseline fails the gate as missing.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { SCENES } from "./orbitSpreadScenarios";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "render-orbit-spread.entry.tsx");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

/** The theme sheet whole, checked to be the tokens file. */
function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error(`${THEME_TOKENS_CSS}: no :root block`);
  }
  return css;
}

async function main(): Promise<void> {
  const outDir = resolve(
    arg("out", resolve(HERE, "../../../local_docs/renders/orbit-spread")),
  );

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
  const tokens = themeCss(await readFile(THEME_TOKENS_CSS, "utf8"));
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>${tokens}
html, body { margin: 0; background: #000; }
</style></head><body><div id="root"></div>
<script type="module">${js}</script></body></html>`;
  const page = join(tmpdir(), `gonogo-orbit-spread-${process.pid}.html`);
  await writeFile(page, html, "utf8");
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  let failures = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: 460, height: 480 },
      deviceScaleFactor: 2,
    });
    const tab = await context.newPage();
    tab.on("pageerror", (err) => {
      failures++;
      console.error("  [page error]", err.message);
    });
    for (const [i, scene] of SCENES.entries()) {
      for (const mode of ["before", "after"]) {
        const url = `${pathToFileURL(page).toString()}?scene=${scene.id}&mode=${mode}`;
        await tab.goto(url, { waitUntil: "domcontentloaded" });
        await tab.waitForSelector("[data-sheet-ready]", { timeout: 10_000 });
        await tab.waitForTimeout(300);
        const root = await tab.$("[data-sheet]");
        if (!root) throw new Error("scene element missing");
        const n = String(i + 1).padStart(2, "0");
        const out = join(outDir, `${n}-${scene.id}-${mode}.png`);
        await root.screenshot({ path: out });
        console.log(`  ✓ ${scene.id} ${mode} → ${out}`);
      }
    }
  } finally {
    await browser.close();
  }
  if (failures > 0) throw new Error(`${failures} page error(s); see above`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
