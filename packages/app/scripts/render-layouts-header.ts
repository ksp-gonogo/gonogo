#!/usr/bin/env tsx
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
/**
 * Render the dashboard header (`MissionBanner`) with its layout actions
 * through a real Chromium page: the layout name with Undo and Redo, at desktop
 * and phone width, with and without anything to step through.
 *
 * Run: `pnpm --filter @ksp-gonogo/app render-layouts-header`
 * Output: .renders/layoutsheader/ (LAYOUTS_HEADER_RENDER_OUT overrides)
 */
import { makeTempDir } from "../../../scripts/temp-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "layouts-header-probe-entry.tsx");
const PROBE_HTML = join(PROBE_DIR, "layouts-header-probe.html");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

const OUT_DIR =
  process.env.LAYOUTS_HEADER_RENDER_OUT ??
  resolve(HERE, "../../../.renders/layoutsheader");

interface Scene {
  name: string;
  layoutName: string;
  edits: number;
  undone: boolean;
  pxW: number;
}

const SCENES: Scene[] = [
  {
    name: "desktop-nothing-to-undo",
    layoutName: "Ascent layout",
    edits: 0,
    undone: false,
    pxW: 1440,
  },
  {
    name: "desktop-undo-available",
    layoutName: "Ascent layout",
    edits: 2,
    undone: false,
    pxW: 1440,
  },
  {
    name: "desktop-redo-available",
    layoutName: "Ascent layout",
    edits: 2,
    undone: true,
    pxW: 1440,
  },
  {
    name: "narrow-nothing-to-undo",
    layoutName: "Ascent layout",
    edits: 0,
    undone: false,
    pxW: 360,
  },
  {
    name: "narrow-undo-available",
    layoutName: "Ascent layout",
    edits: 2,
    undone: false,
    pxW: 360,
  },
  {
    name: "narrow-long-name",
    layoutName: "Munar transfer and landing layout for two",
    edits: 2,
    undone: true,
    pxW: 360,
  },
];

const PX_H = 120;

function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error("tokens.css: no :root block found");
  }
  return css;
}

async function prepareProbePage(): Promise<string> {
  console.log("Bundling layouts-header probe with esbuild...");
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
  const theme = themeCss(await readFile(THEME_TOKENS_CSS, "utf8"));
  const escaped = bundleJs.replace(/<\/script/gi, "<\\/script");
  const out = html
    .replace(
      '<style id="probe-theme">/* injected by the render driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${theme}</style>`,
    )
    .replace(
      '<script type="module" src="./layouts-header-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escaped}</script>`,
    );
  const file = join(
    makeTempDir("gonogo-probe-"),
    `layouts-header-probe-${process.pid}.html`,
  );
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
    for (const scene of SCENES) {
      const context = await browser.newContext({
        viewport: { width: scene.pxW, height: PX_H },
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
          typeof (window as unknown as { __renderLayoutsHeader?: unknown })
            .__renderLayoutsHeader === "function",
        undefined,
        { timeout: 15_000 },
      );
      await page.evaluate(
        (s) =>
          (
            window as unknown as {
              __renderLayoutsHeader: (p: unknown) => Promise<void>;
            }
          ).__renderLayoutsHeader(s),
        { ...scene, pxH: PX_H },
      );
      const text = await page.evaluate(
        () => document.getElementById("root")?.textContent ?? "",
      );
      for (const field of ["UT", "CC", "Kerbal X", "Delay"]) {
        if (!text.includes(field) && scene.pxW >= 1000) {
          throw new Error(`${scene.name}: header never showed ${field}`);
        }
      }
      /*
       * Only the layout actions belong at the right: the first header field
       * sits at the left edge and ends before the actions begin.
       */
      const placed = await page.evaluate(() => {
        const banner = document
          .querySelector('[aria-label="Mission status"]')
          ?.getBoundingClientRect();
        const first = document
          .querySelector('[aria-label="Mission status"]')
          ?.firstElementChild?.getBoundingClientRect();
        const actions = document
          .querySelector('[aria-label="Layout history"]')
          ?.getBoundingClientRect();
        return {
          bannerLeft: banner?.left ?? 0,
          bannerRight: banner?.right ?? 0,
          firstLeft: first?.left ?? 0,
          actionsRight: actions?.right ?? 0,
        };
      });
      if (placed.firstLeft - placed.bannerLeft > 40) {
        throw new Error(`${scene.name}: header fields are not at the left`);
      }
      if (placed.bannerRight - placed.actionsRight > 40) {
        throw new Error(`${scene.name}: layout actions are not at the right`);
      }
      const out = join(OUT_DIR, `${scene.name}.png`);
      const root = await page.$("#root");
      if (!root) throw new Error("#root missing after render");
      await root.screenshot({ path: out });
      console.log(`  ✓ ${scene.name} → ${out}`);
      await context.close();
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
