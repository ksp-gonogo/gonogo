#!/usr/bin/env tsx
/**
 * Render the Navball's RCS toggle and the Action Group's Light toggle through
 * one press over a 27.4 s one-way delay at each widget's default tile and its
 * smallest that still draws the toggle: idle, pending, held for a link, and
 * answered. Writes one PNG per frame, named by `--label`, plus a Markdown table
 * of the frames and the toggle's box in each. `--out <dir>` picks the folder.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import type { HeldStep, HeldWidget } from "./probe/held-toggles-entry";
import { tilePixels } from "./probe/payload";
import {
  installFixedClock,
  PROBE_PAGES,
  prepareProbePage,
  viewportFor,
} from "./widgetRenderHarness";

const HERE = dirname(fileURLToPath(import.meta.url));
function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}
const OUT_DIR = resolve(
  flag("--out") ?? resolve(HERE, "../../../.renders/heldmark"),
);
const LABEL = flag("--label") ?? "after";

const SIZES: ReadonlyArray<{
  widget: HeldWidget;
  name: string;
  w: number;
  h: number;
}> = [
  { widget: "navball", name: "navball-default-8x11", w: 8, h: 11 },
  { widget: "navball", name: "navball-smallest-5x8", w: 5, h: 8 },
  { widget: "action-group", name: "action-group-default-6x6", w: 6, h: 6 },
  { widget: "action-group", name: "action-group-min-5x4", w: 5, h: 4 },
];

const RUNS: ReadonlyArray<{ name: string; steps: readonly HeldStep[] }> = [
  { name: "pending", steps: ["pending", "answered"] },
  { name: "held", steps: ["held", "answered"] },
];

const CAPTION: Record<string, string> = {
  idle: "idle",
  pending: "pending under delay",
  held: "held in a blackout",
  answered: "result arrived",
};

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const html = await prepareProbePage({
    entry: join(HERE, "probe", "held-toggles-entry.tsx"),
    htmlTemplate: PROBE_PAGES.widget.htmlTemplate,
    scriptSrcPlaceholder: PROBE_PAGES.widget.scriptSrcPlaceholder,
    slug: "held-toggles",
  });
  const browser = await chromium.launch();
  const lines: string[] = [];
  try {
    for (const size of SIZES) {
      const px = tilePixels(size.w, size.h);
      const page = await browser.newPage({ viewport: viewportFor(px.pxW) });
      await installFixedClock(page);
      page.on("pageerror", (err) => console.error(`[page] ${err.message}`));
      await page.goto(pathToFileURL(html).toString());
      await page.waitForFunction(() => Boolean(window.__heldScene));
      for (const run of RUNS) {
        await page.evaluate((o) => window.__heldScene.mount(o), {
          widget: size.widget,
          w: size.w,
          h: size.h,
        });
        const row: {
          state: string;
          file: string;
          text: string;
          box: string;
        }[] = [];
        const shoot = async (state: string) => {
          const file = `${LABEL}--${size.name}--${run.name}--${row.length}-${state}.png`;
          await page.locator("#root").screenshot({ path: join(OUT_DIR, file) });
          let text = "(no toggle drawn)";
          let box = "";
          try {
            const b = await page.evaluate(() => window.__heldScene.button());
            text = b.text;
            box = `${Math.round(b.width)} x ${Math.round(b.height)}`;
          } catch {}
          row.push({ state, file, text, box });
        };
        await shoot("idle");
        for (const step of run.steps) {
          await page.evaluate((s) => window.__heldScene.step(s), step);
          await shoot(step);
        }
        lines.push(`### ${size.name}, ${run.name}`, "");
        lines.push(`| ${row.map((r) => CAPTION[r.state]).join(" | ")} |`);
        lines.push(`| ${row.map(() => "---").join(" | ")} |`);
        lines.push(
          `| ${row.map((r) => `![${r.state}](${r.file})`).join(" | ")} |`,
        );
        lines.push(
          `| ${row.map((r) => `"${r.text}" ${r.box}`).join(" | ")} |`,
          "",
        );
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  await writeFile(join(OUT_DIR, `INDEX-${LABEL}.md`), lines.join("\n"), "utf8");
  console.log(`held-toggles ${LABEL} → ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
