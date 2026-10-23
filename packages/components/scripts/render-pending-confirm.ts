#!/usr/bin/env tsx
/**
 * Render the Action Group's Light toggle through one press, frame by frame, at
 * its default tile and its smallest, at no signal delay and at 286 s: idle,
 * sent, accepted by the mod, travelling, answered, confirmed, unconfirmed and
 * refused. Writes one PNG per frame and an `INDEX.md` that lays each run's frames
 * side by side with the toggle's box in every one, so a frame that moves or
 * resizes the button reads at a glance. `--out <dir>` picks the folder.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { tilePixels } from "./probe/payload";
import type { PendingStep } from "./probe/pending-confirm-entry";
import {
  installFixedClock,
  PROBE_PAGES,
  prepareProbePage,
  viewportFor,
} from "./widgetRenderHarness";

const HERE = dirname(fileURLToPath(import.meta.url));
const outFlag = process.argv.indexOf("--out");
const OUT_DIR = resolve(
  outFlag === -1
    ? resolve(HERE, "../../../.renders/pendingconfirm")
    : process.argv[outFlag + 1],
);

const SIZES = [
  { name: "default-6x6", w: 6, h: 6 },
  { name: "min-5x4", w: 5, h: 4 },
] as const;

const RUNS: ReadonlyArray<{
  name: string;
  delay: number;
  refuse?: boolean;
  steps: readonly PendingStep[];
}> = [
  {
    name: "delay-286s",
    delay: 286,
    steps: ["sent", "accepted", "travelling", "answered", "confirmed"],
  },
  {
    name: "delay-286s-unconfirmed",
    delay: 286,
    steps: ["sent", "answered", "unconfirmed"],
  },
  { name: "no-delay", delay: 0, steps: ["sent", "answered", "confirmed"] },
  {
    name: "delay-286s-refused",
    delay: 286,
    refuse: true,
    steps: ["sent", "answered"],
  },
];

interface Frame {
  state: string;
  file: string;
  box: { x: number; y: number; width: number; height: number; text: string };
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const html = await prepareProbePage({
    entry: join(HERE, "probe", "pending-confirm-entry.tsx"),
    htmlTemplate: PROBE_PAGES.widget.htmlTemplate,
    scriptSrcPlaceholder: PROBE_PAGES.widget.scriptSrcPlaceholder,
    slug: "pending-confirm",
  });
  const browser = await chromium.launch();
  const lines: string[] = [
    "# Action Group toggle through one press",
    "",
    "The real Action Group widget (Light), mounted through the widget probe's own mount at its default tile and its smallest, its command played through the scene's stub transport. Each row is one press, frame by frame. Under each frame: the button's text, then its box (x, y, width x height) in px. A frame whose box differs from the run's first is marked **moved**.",
    "",
  ];
  let moved = 0;
  try {
    for (const size of SIZES) {
      const px = tilePixels(size.w, size.h);
      const page = await browser.newPage({ viewport: viewportFor(px.pxW) });
      await installFixedClock(page);
      page.on("pageerror", (err) => console.error(`[page] ${err.message}`));
      await page.goto(pathToFileURL(html).toString());
      await page.waitForFunction(() => Boolean(window.__pendingScene));
      for (const run of RUNS) {
        await page.evaluate((opts) => window.__pendingScene.mount(opts), {
          w: size.w,
          h: size.h,
          delay: run.delay,
          refuse: run.refuse,
        });
        const frames: Frame[] = [];
        const shoot = async (state: string) => {
          const file = `${size.name}--${run.name}--${frames.length}-${state}.png`;
          await page.locator("#root").screenshot({ path: join(OUT_DIR, file) });
          const box = await page.evaluate(() => window.__pendingScene.button());
          frames.push({ state, file, box });
        };
        await shoot("idle");
        for (const step of run.steps) {
          await page.evaluate((s) => window.__pendingScene.step(s), step);
          await shoot(run.refuse && step === "answered" ? "refused" : step);
        }
        const first = frames[0].box;
        lines.push(`## ${size.name}, ${run.name}`, "");
        lines.push(`| ${frames.map((f) => f.state).join(" | ")} |`);
        lines.push(`| ${frames.map(() => "---").join(" | ")} |`);
        lines.push(
          `| ${frames.map((f) => `![${f.state}](${f.file})`).join(" | ")} |`,
        );
        lines.push(
          `| ${frames
            .map((f) => {
              const same =
                f.box.x === first.x &&
                f.box.y === first.y &&
                f.box.width === first.width &&
                f.box.height === first.height;
              if (!same) moved++;
              const dims = `${Math.round(f.box.x)}, ${Math.round(f.box.y)}, ${Math.round(f.box.width)} x ${Math.round(f.box.height)}`;
              return `"${f.box.text}"<br>${dims}${same ? "" : " **moved**"}`;
            })
            .join(" | ")} |`,
        );
        lines.push("");
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  lines.splice(
    4,
    0,
    moved === 0
      ? "Every frame's button box matches its run's first frame."
      : `${moved} frame(s) moved or resized the button.`,
    "",
  );
  await writeFile(join(OUT_DIR, "INDEX.md"), lines.join("\n"), "utf8");
  console.log(`pending-confirm: ${moved} moved frame(s) → ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
