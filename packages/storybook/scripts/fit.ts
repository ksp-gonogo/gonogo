/**
 * Mounts the GO/NO-GO stories in a built Storybook, each at its own tile size
 * and at a ladder of smaller ones, and fails when the board is cut off: any
 * station, the countdown or the header drawn past an edge that clips it. A
 * board that scrolls is not cut off, so a clipped element inside a scrolling
 * region passes.
 *
 * It measures real layout in Chromium, which jsdom cannot. Before it trusts a
 * clean run it mounts a planted board that overflows its tile, and fails as
 * `BLIND` if that is reported clean.
 *
 * Run via `pnpm --filter @ksp-gonogo/storybook fit`. `--out <dir>` also writes
 * a PNG of every case, named `<prefix>-<story>-<w>x<h>.png` with `--prefix`.
 */
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { serve } from "./built";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = resolve(HERE, "../dist/static");

/** Main-screen stories, whose board lists stations; the station button has no board to cut. */
const MAIN_STORIES = [
  "widgets-gonogo--poll-in-progress",
  "widgets-gonogo--counting-down",
  "widgets-gonogo--aborted",
  "widgets-gonogo--mission-active",
  "widgets-gonogo--no-stations",
  "widgets-gonogo--eight-stations",
  "widgets-gonogo--many-stations",
];
const STATION_STORIES = [
  "widgets-gonogo--station-no-go",
  "widgets-gonogo--station-counting-down",
  "widgets-gonogo--station-abort",
];

/** Tile sizes in grid cells: the widget's minimum, its default, and the sizes between and past the stories' own. */
const SIZES: readonly [number, number][] = [
  [3, 3],
  [4, 3],
  [4, 4],
  [6, 3],
  [6, 4],
  [6, 6],
  [8, 4],
  [8, 8],
  [12, 4],
];

const PLANT = "smoke-plant--gonogo-overflow";

interface Cut {
  what: string;
  by: number;
}

/**
 * Elements of the mounted widget drawn past a clipping ancestor, one per
 * element. An ancestor that scrolls does not clip. Plain source in a function
 * body: it runs in the page, so it names no helper.
 */
async function cutOff(page: Page): Promise<Cut[]> {
  return page.evaluate(() => {
    const host = document.querySelector("[data-story-widget]");
    if (host === null) return [{ what: "no widget mounted", by: 0 }];
    const cuts: { what: string; by: number }[] = [];
    for (const el of host.querySelectorAll("*")) {
      if (el.getClientRects().length === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      for (let up = el.parentElement; up; up = up.parentElement) {
        const style = getComputedStyle(up);
        if (
          [style.overflowX, style.overflowY].some(
            (o) => o === "auto" || o === "scroll",
          )
        )
          break;
        const clips = [style.overflowX, style.overflowY].some(
          (o) => o === "hidden" || o === "clip",
        );
        if (!clips) continue;
        const box = up.getBoundingClientRect();
        const by = Math.max(
          rect.bottom - box.bottom,
          rect.right - box.right,
          box.top - rect.top,
          box.left - rect.left,
        );
        if (by > 1) {
          const text = (el.textContent ?? "").trim().slice(0, 24);
          cuts.push({ what: `${el.tagName.toLowerCase()} "${text}"`, by });
        }
        break;
      }
    }
    return cuts;
  });
}

async function mount(
  page: Page,
  base: string,
  id: string,
  size: readonly [number, number] | null,
): Promise<void> {
  const args = size ? `&args=w:${size[0]};h:${size[1]}` : "";
  await page.goto(`${base}/iframe.html?id=${id}&viewMode=story${args}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector('[data-scene="mounted"]', { timeout: 30_000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  await page.waitForTimeout(300);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const out = flag("--out");
  const prefix = flag("--prefix") ?? "fit";
  if (out) mkdirSync(out, { recursive: true });

  const { server, url } = await serve(STATIC);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const failures: string[] = [];
  try {
    await mount(page, url, PLANT, null);
    if ((await cutOff(page)).length === 0) {
      console.error("fit: BLIND: the planted overflowing board read as clean");
      process.exitCode = 1;
      return;
    }

    for (const id of [...MAIN_STORIES, ...STATION_STORIES]) {
      const sizes: (readonly [number, number] | null)[] = [null, ...SIZES];
      for (const size of sizes) {
        await mount(page, url, id, size);
        const label = size ? `${size[0]}x${size[1]}` : "own";
        const cuts = await cutOff(page);
        if (out) {
          await page.locator("[data-story-widget]").screenshot({
            path: join(
              out,
              `${prefix}-${id.replace("widgets-", "")}-${label}.png`,
            ),
          });
        }
        const mark = cuts.length === 0 ? "ok  " : "CUT ";
        console.log(`  ${mark} ${id} ${label}`);
        for (const cut of cuts) {
          failures.push(
            `${id} ${label}: ${cut.what} cut off by ${Math.round(cut.by)}px`,
          );
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length > 0) {
    console.error(`fit: ${failures.length} cut-off elements`);
    for (const f of failures) console.error(`  ${f}`);
    process.exitCode = 1;
  } else {
    console.log("fit: nothing cut off");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
