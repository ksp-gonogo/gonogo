#!/usr/bin/env tsx
/**
 * Render a zoomed-in Ground Track before and after a tag appears in its toolbar. Writes `<label>--zoomed.png` and
 * `<label>--zoomed-tagged.png` and prints the map frame height of each; `--out <dir>` picks the folder.
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

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const html = await prepareProbePage({
    entry: join(HERE, "probe", "ground-track-late-entry.tsx"),
    htmlTemplate: PROBE_PAGES.widget.htmlTemplate,
    scriptSrcPlaceholder: PROBE_PAGES.widget.scriptSrcPlaceholder,
    slug: "ground-track-zoom",
  });
  const browser = await chromium.launch();
  try {
    const px = tilePixels(12, 18);
    const page = await browser.newPage({ viewport: viewportFor(px.pxW) });
    await installFixedClock(page);
    page.on("pageerror", (err) => console.error(`[page] ${err.message}`));
    await page.goto(pathToFileURL(html).toString());
    await page.waitForFunction(() => Boolean(window.__lateScene));
    await page.evaluate(() => window.__lateScene.mount({ w: 12, h: 18 }));
    await page.evaluate(() => window.__lateScene.openMap());
    await page.evaluate(() => window.__lateScene.setSituation("ORBITING"));
    const map = page.getByRole("group", { name: "Map" });
    const box = await map.boundingBox();
    if (!box) throw new Error("map not found");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(400);
    const height = () =>
      map.evaluate((el) => el.getBoundingClientRect().height);
    const first = join(OUT_DIR, `${LABEL}--zoomed.png`);
    await page.locator("#root").screenshot({ path: first });
    console.log(first, "map height", await height());
    await page.evaluate(() => window.__lateScene.setSituation("SUB_ORBITAL"));
    await page.waitForTimeout(400);
    const second = join(OUT_DIR, `${LABEL}--zoomed-tagged.png`);
    await page.locator("#root").screenshot({ path: second });
    console.log(second, "map height", await height());
    await page.close();
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
