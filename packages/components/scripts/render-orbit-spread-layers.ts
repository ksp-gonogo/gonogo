#!/usr/bin/env tsx
/**
 * Renders the real System View (Tracking Station) and Ground Track widgets
 * through one probe page, each scene carried forward from its last observation
 * by the orbit reckoner, so the band each layer draws is the one the orbit
 * diagram draws.
 *
 * Run: `pnpm --filter @ksp-gonogo/components exec tsx scripts/render-orbit-spread-layers.ts --out <dir> --prefix <before|after>`
 * Output: `<dir>/<prefix>-<layer>-<scene id>.png`.
 *
 * Not registered in `widgets.ts`: that file is the visual gate's input, and a
 * scene added to it with no committed baseline fails the gate as missing.
 */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { LAYER_SCENES } from "./orbitSpreadScenarios";
import { PROBE_PAGES, prepareProbePage } from "./widgetRenderHarness";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const LAYERS = [
  { layer: "system-view", w: 14, h: 16 },
  { layer: "map", w: 14, h: 12 },
] as const;

async function main() {
  const out = resolve(arg("out", "renders/orbit-spread-layers"));
  const prefix = arg("prefix", "after");
  await mkdir(out, { recursive: true });
  const html = await prepareProbePage({
    entry: resolve(import.meta.dirname, "probe/orbit-spread-layers-entry.tsx"),
    htmlTemplate: PROBE_PAGES.widget.htmlTemplate,
    scriptSrcPlaceholder: PROBE_PAGES.widget.scriptSrcPlaceholder,
    slug: "orbit-spread-layers",
  });
  const browser = await chromium.launch();
  let failures = 0;
  try {
    for (const { layer, w, h } of LAYERS) {
      for (const scene of LAYER_SCENES) {
        const page = await browser.newPage({
          viewport: { width: 1400, height: 1200 },
          deviceScaleFactor: 2,
        });
        page.on("pageerror", (e) => {
          failures++;
          console.error("pageerror", e.message);
        });
        await page.goto(`file://${html}`);
        await page.waitForFunction(() => "__orbitSpreadLayers" in window);
        await page.evaluate(
          ([l, s, ww, hh]) =>
            (window as any).__orbitSpreadLayers.mount(l, s, ww, hh),
          [layer, scene.id, w, h],
        );
        await page.waitForTimeout(300);
        const path = join(out, `${prefix}-${layer}-${scene.id}.png`);
        await page.screenshot({ path });
        console.log(`  ✓ ${layer} ${scene.id} → ${path}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (failures > 0) throw new Error(`${failures} page error(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
