#!/usr/bin/env tsx
/**
 * Render the screen header's banner strip through a real Chromium page, across
 * the states a header badge distinguishes.
 *
 * Run: `pnpm --filter @ksp-gonogo/app render-header-badges`
 * Output: local_docs/renders/header-badges/ (HEADER_BADGES_RENDER_OUT overrides)
 *
 * Each scene is what a stand-in contributor hands the `app.header-badges` slot
 * and whether its Domain is present. Each shot waits for the strip's text to
 * settle on the scene's expected text, and fails naming what it read instead.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "header-badges-probe-entry.tsx");
const PROBE_HTML = join(PROBE_DIR, "header-badges-probe.html");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

const OUT_DIR =
  process.env.HEADER_BADGES_RENDER_OUT ??
  resolve(HERE, "../../../local_docs/renders/header-badges");

interface Scene {
  name: string;
  /** The entries the stand-in contributor returns; nothing registers when absent. */
  entries?: { id: string; label: string; tone?: string; held?: string }[];
  /** Whether the contributor's Domain is announced. */
  domainPresent: boolean;
  /** The strip's whole text once settled. */
  settled: string;
}

const SCENES: Scene[] = [
  { name: "none-contributed", domainPresent: true, settled: "" },
  {
    name: "one-badge",
    entries: [{ id: "a", label: "BADGE A", tone: "caution" }],
    domainPresent: true,
    settled: "BADGE A",
  },
  {
    name: "two-badges-mixed-tones",
    entries: [
      { id: "a", label: "BADGE A", tone: "caution" },
      { id: "b", label: "BADGE B", tone: "info" },
    ],
    domainPresent: true,
    settled: "BADGE ABADGE B",
  },
  {
    name: "held-badge",
    entries: [
      { id: "a", label: "BADGE A", tone: "caution" },
      { id: "b", label: "BADGE B", tone: "go", held: "held" },
    ],
    domainPresent: true,
    settled: "BADGE AHELD",
  },
  {
    name: "requires-absent-domain",
    entries: [{ id: "a", label: "BADGE A", tone: "caution" }],
    domainPresent: false,
    settled: "",
  },
];

const PX_W = 640;
const PX_H = 96;

async function prepareProbePage(): Promise<string> {
  console.log("Bundling header-badges probe with esbuild...");
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
      '<script type="module" src="./header-badges-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escaped}</script>`,
    );
  const file = join(tmpdir(), `header-badges-probe-${process.pid}.html`);
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
        typeof (window as unknown as { __renderHeaderBadges?: unknown })
          .__renderHeaderBadges === "function",
      undefined,
      { timeout: 15_000 },
    );

    for (const scene of SCENES) {
      await page.evaluate(
        (s) =>
          (
            window as unknown as {
              __renderHeaderBadges: (p: unknown) => Promise<void>;
            }
          ).__renderHeaderBadges(s),
        scene,
      );
      try {
        await page.waitForFunction(
          (expected) =>
            (document.getElementById("root")?.textContent ?? "") === expected,
          scene.settled,
          { timeout: 10_000 },
        );
      } catch {
        const text = await page.evaluate(
          () => document.getElementById("root")?.textContent,
        );
        throw new Error(
          `${scene.name}: strip never settled on "${scene.settled}", last read "${text}"`,
        );
      }
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
