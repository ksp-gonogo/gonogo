#!/usr/bin/env tsx
/**
 * Render a Ground Track opened onto a flight the stream already holds, at its
 * default tile and its smallest map. Writes one PNG per size, named by
 * `--label`; `--out <dir>` picks the folder.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import type { LateScene } from "./probe/ground-track-late-entry";
import { tilePixels } from "./probe/payload";
import {
  installFixedClock,
  PROBE_PAGES,
  prepareProbePage,
  viewportFor,
} from "./widgetRenderHarness";

declare global {
  interface Window {
    __lateScene: LateScene;
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}
const OUT_DIR = resolve(
  flag("--out") ?? resolve(HERE, "../../../.renders/ground-track-trail"),
);
const LABEL = flag("--label") ?? "after";

const SIZES = [
  { name: "default-12x18", w: 12, h: 18 },
  { name: "wide-18x10", w: 18, h: 10 },
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const html = await prepareProbePage({
    entry: join(HERE, "probe", "ground-track-late-entry.tsx"),
    htmlTemplate: PROBE_PAGES.widget.htmlTemplate,
    scriptSrcPlaceholder: PROBE_PAGES.widget.scriptSrcPlaceholder,
    slug: "ground-track-late",
  });
  const browser = await chromium.launch();
  try {
    for (const size of SIZES) {
      const px = tilePixels(size.w, size.h);
      const page = await browser.newPage({ viewport: viewportFor(px.pxW) });
      await installFixedClock(page);
      page.on("pageerror", (err) => console.error(`[page] ${err.message}`));
      await page.goto(pathToFileURL(html).toString());
      await page.waitForFunction(() => Boolean(window.__lateScene));
      await page.evaluate((o) => window.__lateScene.mount(o), size);
      await page.evaluate(() => window.__lateScene.openMap());
      const file = join(OUT_DIR, `${LABEL}--${size.name}.png`);
      await page.locator("#root").screenshot({ path: file });
      console.log(file);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
