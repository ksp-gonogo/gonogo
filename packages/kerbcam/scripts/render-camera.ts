#!/usr/bin/env tsx
/**
 * Render the CameraFeed widget through a real Chromium page with a mocked
 * kerbcam sidecar + a canvas.captureStream() video — the camera-widget
 * equivalent of the components `render-widget` harness. CameraFeed can't
 * go through that harness (it needs a live MediaStream and the kerbcam
 * session context), so this is its dedicated renderer.
 *
 * Run: `pnpm --filter @gonogo/kerbcam render-camera`
 * Output: local_docs/renders/camera-feed/<scene>.png
 *
 * Each scene varies the camera's capability flags (pan / pitch / zoom) so a
 * regression in the control layout is visible. Controls are hover-gated, so
 * the runner hovers the <video> before each screenshot.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "probe-entry.tsx");
const PROBE_HTML = join(PROBE_DIR, "probe.html");
const GLOBAL_CSS = resolve(HERE, "../../app/src/styles/global.css");
const OUT_DIR = resolve(HERE, "../../../local_docs/renders/camera-feed");

const CAM_BASE = {
  lifecycle: "active",
  partName: "mumech.MuMechModuleHullCamera",
  partTitle: "Hullcam Mk1",
  cameraName: "Starboard Cam",
  vesselName: "Kerbal X",
  layers: ["NEAR", "SCALED"],
  operatorLayers: ["NEAR", "SCALED"],
  renderWidth: 384,
  renderHeight: 384,
  operatorWidth: 384,
  operatorHeight: 384,
  supportsZoom: false,
  fov: 45,
  fovMin: 10,
  fovMax: 90,
  supportsPan: false,
  panYaw: 0,
  panPitch: 0,
  panYawMin: 0,
  panYawMax: 0,
  panPitchMin: 0,
  panPitchMax: 0,
  encoderBitrateBps: 1_500_000,
  targetBitrateBps: 0,
  degradeLevel: 0,
};

interface Scene {
  name: string;
  camera: Record<string, unknown> & { flightId: number };
  config: Record<string, unknown>;
  pxW: number;
  pxH: number;
}

const SCENES: Scene[] = [
  {
    name: "pan-pitch-zoom",
    camera: {
      ...CAM_BASE,
      flightId: 42,
      supportsPan: true,
      supportsZoom: true,
      panYawMin: -90,
      panYawMax: 90,
      panPitchMin: -45,
      panPitchMax: 45,
      panYaw: 18,
      panPitch: -10,
    },
    config: { flightId: 42 },
    pxW: 360,
    pxH: 452,
  },
  {
    name: "yaw-only",
    camera: {
      ...CAM_BASE,
      flightId: 42,
      supportsPan: true,
      supportsZoom: true,
      panYawMin: -120,
      panYawMax: 120,
      panPitchMin: 0,
      panPitchMax: 0,
    },
    config: { flightId: 42 },
    pxW: 360,
    pxH: 452,
  },
];

function extractRootBlock(css: string): string {
  const match = css.match(/:root\s*\{[\s\S]*?\}/);
  if (!match) throw new Error("global.css: no :root block found");
  return match[0];
}

async function prepareProbePage(): Promise<string> {
  console.log("Bundling probe-entry with esbuild…");
  const result = await build({
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
  const bundleJs = result.outputFiles[0].text;
  const html = await readFile(PROBE_HTML, "utf8");
  const themeCss = extractRootBlock(await readFile(GLOBAL_CSS, "utf8"));
  const escaped = bundleJs.replace(/<\/script/gi, "<\\/script");
  const out = html
    .replace(
      '<style id="probe-theme">/* injected by render-camera from packages/app/src/styles/global.css */</style>',
      () => `<style id="probe-theme">${themeCss}</style>`,
    )
    .replace(
      '<script type="module" src="./probe-entry.bundle.js"></script>',
      () => `<script type="module">${escaped}</script>`,
    );
  const file = join(tmpdir(), `kerbcam-cam-probe-${process.pid}.html`);
  await writeFile(file, out, "utf8");
  return file;
}

async function cleanPngs(dir: string): Promise<void> {
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
  await cleanPngs(OUT_DIR);

  console.log("Launching Chromium…");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 640, height: 640 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.error("  [page error]", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("  [console]", msg.text());
    });

    await page.goto(pathToFileURL(probeHtml).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __renderCamera?: unknown })
          .__renderCamera === "function",
      undefined,
      { timeout: 10_000 },
    );

    for (const scene of SCENES) {
      await page.evaluate(
        (s) =>
          (
            window as unknown as {
              __renderCamera: (p: unknown) => Promise<void>;
            }
          ).__renderCamera(s),
        scene,
      );
      // Reveal the hover-gated controls, then let the opacity transition land.
      await page.hover("video").catch(() => {});
      await page.waitForTimeout(250);
      const root = await page.$("#root");
      if (!root) throw new Error("#root missing after render");
      const out = join(OUT_DIR, `${scene.name}.png`);
      await root.screenshot({ path: out });
      console.log(`  ✓ ${scene.name} → ${out}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
