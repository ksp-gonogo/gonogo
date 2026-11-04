#!/usr/bin/env tsx
/**
 * Render a main screen and a station of one command centre side by side, each
 * with the same commands in flight, for the Action Group and the Navball at
 * their default tiles: a press travelling, a press held at a relay, and a
 * throttle input the mod accepted with a warning. Writes one PNG per frame,
 * named by `--label`, plus a Markdown table. `--out <dir>` picks the folder.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { tilePixels } from "./probe/payload";
import type {
  SharedScreen,
  SharedStep,
  SharedWidget,
} from "./probe/shared-rail-entry";
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
  flag("--out") ?? resolve(HERE, "../../../.renders/sharedrail"),
);
const LABEL = flag("--label") ?? "after";

interface Run {
  name: string;
  widget: SharedWidget;
  w: number;
  h: number;
  caption: string;
  steps: ReadonlyArray<{
    step: SharedStep;
    from: SharedScreen;
    shoot?: string;
  }>;
}

const RUNS: readonly Run[] = [
  {
    name: "action-group-station-press",
    widget: "action-group",
    w: 6,
    h: 6,
    caption: "Action Group, Light pressed on the station, 27.4 s each way",
    steps: [
      {
        step: "press",
        from: "station",
        shoot: "pressed, mod not yet answered",
      },
      { step: "accept", from: "station" },
      { step: "travel", from: "station" },
      { step: "later", from: "station", shoot: "accepted, travelling" },
      { step: "grow", from: "main", shoot: "travelling, rails opened" },
    ],
  },
  {
    name: "action-group-station-held",
    widget: "action-group",
    w: 6,
    h: 6,
    caption: "Action Group, Light pressed on the station, held at a relay",
    steps: [
      { step: "press", from: "station" },
      { step: "accept", from: "station" },
      { step: "hold", from: "station" },
      { step: "later", from: "station", shoot: "held at a relay" },
      { step: "grow", from: "main", shoot: "held, rails opened" },
    ],
  },
  {
    name: "navball-main-press",
    widget: "navball",
    w: 8,
    h: 15,
    caption: "Navball, RCS pressed on the main screen, 27.4 s each way",
    steps: [
      { step: "press", from: "main", shoot: "pressed, mod not yet answered" },
      { step: "accept", from: "main" },
      { step: "travel", from: "main" },
      { step: "later", from: "main", shoot: "accepted, travelling" },
      { step: "grow", from: "main", shoot: "travelling, rails opened" },
    ],
  },
  {
    name: "navball-main-held",
    widget: "navball",
    w: 8,
    h: 15,
    caption: "Navball, RCS pressed on the main screen, held at a relay",
    steps: [
      { step: "press", from: "main" },
      { step: "accept", from: "main" },
      { step: "hold", from: "main" },
      { step: "later", from: "main", shoot: "held at a relay" },
    ],
  },
  {
    name: "navball-main-throttle",
    widget: "navball",
    w: 8,
    h: 15,
    caption:
      "Navball, throttle to full on the main screen, accepted with the continuous-input warning",
    steps: [
      { step: "throttle", from: "main" },
      {
        step: "warn",
        from: "main",
        shoot: "throttle travelling, rails collapsed",
      },
      { step: "grow", from: "main", shoot: "rails opened" },
    ],
  },
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const html = await prepareProbePage({
    entry: join(HERE, "probe", "shared-rail-entry.tsx"),
    htmlTemplate: PROBE_PAGES.widget.htmlTemplate,
    scriptSrcPlaceholder: PROBE_PAGES.widget.scriptSrcPlaceholder,
    slug: "shared-rail",
  });
  const browser = await chromium.launch();
  const lines: string[] = [`# Shared delay rail, ${LABEL}`, ""];
  try {
    for (const run of RUNS) {
      const px = tilePixels(run.w, run.h);
      const viewport = viewportFor(px.pxW);
      const page = await browser.newPage({
        viewport: { ...viewport, width: 2 * px.pxW + 48 },
      });
      await installFixedClock(page);
      page.on("pageerror", (err) => console.error(`[page] ${err.message}`));
      await page.goto(pathToFileURL(html).toString());
      await page.waitForFunction(() => Boolean(window.__sharedScene));
      await page.evaluate((o) => window.__sharedScene.mount(o), {
        widget: run.widget,
        w: run.w,
        h: run.h,
        pxW: px.pxW,
      });
      lines.push(
        `## ${run.caption}`,
        "",
        `Default tile ${run.w}x${run.h}.`,
        "",
      );
      let n = 0;
      for (const s of run.steps) {
        await page.evaluate(
          ({ step, from }) => window.__sharedScene.step(step, from),
          { step: s.step, from: s.from },
        );
        if (!s.shoot) continue;
        n += 1;
        const file = `${LABEL}--${run.name}--${n}.png`;
        await page.locator("#root").screenshot({ path: join(OUT_DIR, file) });
        const t = await page.evaluate(() => window.__sharedScene.toggles());
        lines.push(
          `### ${LABEL}: ${s.shoot}`,
          "",
          `![${run.caption}, ${s.shoot}](${file})`,
          "",
          `Toggle text: main "${t.main ?? "none drawn"}", station "${t.station ?? "none drawn"}"`,
          "",
        );
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  await writeFile(join(OUT_DIR, `INDEX-${LABEL}.md`), lines.join("\n"), "utf8");
  console.log(`shared-rail ${LABEL} → ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
