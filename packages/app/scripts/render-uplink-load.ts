#!/usr/bin/env tsx
/**
 * Render what a brand new browser is shown about the installed Uplinks: the
 * first-load page on the main screen and on a station, and the setup's Uplinks
 * step once the loader has run.
 *
 * Run: `pnpm --filter @ksp-gonogo/app render-uplink-load`
 * Output: local_docs/renders/uplink-load/ (UPLINK_LOAD_RENDER_OUT overrides)
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "uplink-load-probe-entry.tsx");
const PROBE_HTML = join(PROBE_DIR, "uplink-load-probe.html");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

const OUT_DIR =
  process.env.UPLINK_LOAD_RENDER_OUT ??
  resolve(HERE, "../../../local_docs/renders/uplink-load");

interface Scene {
  name: string;
  screen: "main" | "station";
  view: "prompt" | "setup";
}

const SCENES: Scene[] = [
  { name: "main-first-load", screen: "main", view: "prompt" },
  { name: "main-setup-uplinks", screen: "main", view: "setup" },
  { name: "station-first-load", screen: "station", view: "prompt" },
];

const PX_W = 720;
const PX_H = 640;

async function prepareProbePage(): Promise<string> {
  console.log("Bundling uplink-load probe with esbuild...");
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
  const theme = await readFile(THEME_TOKENS_CSS, "utf8");
  if (!/:root\s*\{/.test(theme)) {
    throw new Error("tokens.css: no :root block found");
  }
  const escaped = bundleJs.replace(/<\/script/gi, "<\\/script");
  const out = html
    .replace(
      '<style id="probe-theme">/* injected by the render driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${theme}</style>`,
    )
    .replace(
      '<script type="module" src="./uplink-load-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escaped}</script>`,
    );
  const file = join(tmpdir(), `uplink-load-probe-${process.pid}.html`);
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
        typeof (window as unknown as { __renderUplinkLoad?: unknown })
          .__renderUplinkLoad === "function",
      undefined,
      { timeout: 15_000 },
    );

    for (const scene of SCENES) {
      await page.evaluate(
        (s) =>
          (
            window as unknown as {
              __renderUplinkLoad: (p: unknown) => Promise<void>;
            }
          ).__renderUplinkLoad(s),
        scene,
      );
      await page.waitForTimeout(300);
      const out = join(OUT_DIR, `${scene.name}.png`);
      await page.screenshot({ path: out });
      console.log(`  ✓ ${scene.name} → ${out}`);
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
