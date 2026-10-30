#!/usr/bin/env tsx
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
/**
 * Render the GO/NO-GO poll in the screen header (`MissionBanner` with the
 * poll's centre and controls) through a real Chromium page: the main screen's
 * station boxes, its countdown and its poll settings, and a station's vote,
 * its input binding and its abort, at phone and desktop width.
 *
 * Run: `pnpm --filter @ksp-gonogo/app render-gonogo-header`
 * Output: .renders/gonogoheader/ (GONOGO_HEADER_RENDER_OUT overrides)
 */
import { makeTempDir } from "../../../scripts/temp-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "gonogo-header-probe-entry.tsx");
const PROBE_HTML = join(PROBE_DIR, "gonogo-header-probe.html");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

const OUT_DIR =
  process.env.GONOGO_HEADER_RENDER_OUT ??
  resolve(HERE, "../../../.renders/gonogoheader");

type Vote = "go" | "no-go" | null;

interface Scene {
  name: string;
  screen: "main" | "station";
  stations?: [string, Vote][];
  approval?: "approved" | "pending" | "refused";
  countdownSeconds?: number;
  launched?: boolean;
  reopened?: boolean;
  /** What the operator does before the shot. */
  action?: "vote" | "hover" | "settings" | "input";
  /** Room below the header for a popover or a dialog. */
  tall?: boolean;
}

const MIXED: [string, Vote][] = [
  ["Flight Director", "go"],
  ["Guidance", "go"],
  ["Propulsion", "no-go"],
  ["Capcom", null],
];

const BASE_SCENES: Scene[] = [
  { name: "main-mixed", screen: "main", stations: MIXED },
  {
    name: "main-countdown",
    screen: "main",
    stations: [
      ["Flight Director", "go"],
      ["Guidance", "go"],
    ],
  },
  {
    name: "main-settings",
    screen: "main",
    stations: MIXED,
    action: "settings",
    tall: true,
  },
  { name: "station-nogo", screen: "station" },
  { name: "station-go", screen: "station", action: "vote" },
  { name: "station-not-in-poll", screen: "station", approval: "refused" },
  { name: "station-hover", screen: "station", action: "hover", tall: true },
  { name: "station-countdown", screen: "station", countdownSeconds: 7.3 },
  { name: "station-input", screen: "station", action: "input", tall: true },
  { name: "station-abort", screen: "station", launched: true },
  {
    name: "station-abort-reopened",
    screen: "station",
    launched: true,
    reopened: true,
  },
];

const WIDTHS: [string, number][] = [
  ["phone", 390],
  ["wide", 1600],
];

const SCENES = BASE_SCENES.flatMap((s) =>
  WIDTHS.map(([suffix, pxW]) => ({ ...s, name: `${s.name}-${suffix}`, pxW })),
);

function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error("tokens.css: no :root block found");
  }
  return css;
}

async function prepareProbePage(): Promise<string> {
  console.log("Bundling GO/NO-GO header probe with esbuild...");
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
      '<script type="module" src="./gonogo-header-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escaped}</script>`,
    );
  const file = join(
    makeTempDir("gonogo-probe-"),
    `gonogo-header-probe-${process.pid}.html`,
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

const ACTIONS: Record<
  NonNullable<Scene["action"]>,
  (page: Page) => Promise<void>
> = {
  vote: (page) => page.getByRole("button", { name: "NO-GO" }).click(),
  hover: (page) => page.getByRole("button", { name: "NO-GO" }).hover(),
  settings: (page) => page.getByRole("button", { name: /On go:/ }).click(),
  input: (page) => page.getByRole("button", { name: "Vote input" }).click(),
};

async function act(page: Page, then: Scene["action"]): Promise<void> {
  if (then) await ACTIONS[then](page);
  await page.waitForTimeout(250);
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
      const height = scene.tall ? 640 : 200;
      const context = await browser.newContext({
        viewport: { width: scene.pxW, height },
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
          typeof (window as unknown as { __renderGonogoHeader?: unknown })
            .__renderGonogoHeader === "function",
        undefined,
        { timeout: 15_000 },
      );
      await page.evaluate(
        (s) =>
          (
            window as unknown as {
              __renderGonogoHeader: (p: unknown) => Promise<void>;
            }
          ).__renderGonogoHeader(s),
        scene,
      );
      await act(page, scene.action);
      const out = join(OUT_DIR, `${scene.name}.png`);
      if (scene.tall) {
        await page.screenshot({ path: out });
      } else {
        const root = await page.$("#root");
        if (!root) throw new Error("#root missing after render");
        await root.screenshot({ path: out });
      }
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
