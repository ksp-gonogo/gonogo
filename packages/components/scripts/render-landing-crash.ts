#!/usr/bin/env tsx
/**
 * Measures the touchdown plots of Landing Status on the frame before a crash
 * report arrives and on the frame after it, and across the last second of a
 * safe landing and of a splashdown, writing a picture of each ending. Exits 2
 * when any plot changes size across an ending.
 *
 * Run via `pnpm --filter @ksp-gonogo/components exec tsx scripts/render-landing-crash.ts --out <dir>`.
 */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { PROBE_PAGES, prepareProbePage } from "./widgetRenderHarness";

const outFlag = process.argv.indexOf("--out");
const out = resolve(
  outFlag !== -1 ? process.argv[outFlag + 1] : "renders/landing-crash",
);
const prefix = process.argv.includes("--prefix")
  ? process.argv[process.argv.indexOf("--prefix") + 1]
  : "";

const STORIES = [
  { name: "crash-landing", ending: "crash", w: 14, h: 24 },
  { name: "crash-landing-wide", ending: "crash", w: 16, h: 24 },
  { name: "safe-landing-wide", ending: "landed", w: 16, h: 24 },
  { name: "ocean-landing-wide", ending: "splashed", w: 16, h: 24 },
] as const;

const MEASURE = `(() => {
  const grid = document.querySelector("[data-grid-squares]");
  const slots = grid ? Array.from(grid.children) : [];
  const r = (e) => {
    const b = e.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  };
  const body = document.querySelector("[data-panel-body]");
  return {
    columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : null,
    plots: slots.map((s) => ({ title: (s.textContent || "").slice(0, 20), box: r(s), heading: r(s.querySelector("[data-plot-heading]")), square: r(s.querySelector("[data-plot-square]")) })),
    body: body ? r(body) : null,
    scrollTop: body ? body.scrollTop : null,
  };
})()`;

async function main() {
  await mkdir(out, { recursive: true });
  const html = await prepareProbePage({
    entry: resolve(import.meta.dirname, "probe/landing-crash-entry.tsx"),
    htmlTemplate: PROBE_PAGES.widget.htmlTemplate,
    scriptSrcPlaceholder: PROBE_PAGES.widget.scriptSrcPlaceholder,
    slug: "landing-crash",
  });
  const browser = await chromium.launch();
  const result: Record<string, unknown> = {};
  for (const s of STORIES) {
    const page = await browser.newPage({
      viewport: { width: 1800, height: 1500 },
    });
    page.on("pageerror", (e) => console.error("pageerror", e.message));
    await page.goto(`file://${html}`);
    await page.waitForFunction(() => "__landingCrash" in window);
    const total = (await page.evaluate(
      ([e, w, h]) => (window as any).__landingCrash.mount(e, w, h),
      [s.ending, s.w, s.h],
    )) as number;
    const trail: unknown[] = [];
    if (s.ending === "crash") {
      await page.evaluate(
        (n) => (window as any).__landingCrash.playTo(n),
        total,
      );
      trail.push(await page.evaluate(MEASURE));
      await page.screenshot({
        path: join(out, `${prefix}${s.name}--before.png`),
      });
      await page.evaluate(() => (window as any).__landingCrash.crash());
      trail.push(await page.evaluate(MEASURE));
      await page.screenshot({
        path: join(out, `${prefix}${s.name}--after.png`),
      });
    } else {
      // Every fifth frame of the last stretch: the touchdown and what follows it.
      for (let i = Math.max(1, total - 60); i < total; i += 5) {
        await page.evaluate((n) => (window as any).__landingCrash.playTo(n), i);
        trail.push(await page.evaluate(MEASURE));
      }
      await page.evaluate(
        (n) => (window as any).__landingCrash.playTo(n),
        total,
      );
      trail.push(await page.evaluate(MEASURE));
      await page.screenshot({ path: join(out, `${prefix}${s.name}--end.png`) });
    }
    result[s.name] = trail;
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(result, null, 1));
  const sides = (m: any) => m.plots.map((p: any) => p.square.w).join();
  const moved = Object.entries(result).filter(([, trail]) => {
    const t = trail as unknown[];
    return new Set(t.map(sides)).size > 1;
  });
  if (moved.length > 0) {
    console.error(`plots changed size in: ${moved.map(([n]) => n).join(", ")}`);
    process.exit(2);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
