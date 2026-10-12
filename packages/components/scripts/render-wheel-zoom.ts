#!/usr/bin/env tsx
/**
 * Records real wheel input over a scrolling dashboard that holds a System View
 * and a Map View, for the revision in the working tree and, with `--before
 * <ref>`, for the widget library as it was at a git revision, from the same
 * scene and the same input. Output goes to `--out` (default
 * `.renders/wheel-zoom`): one mp4 per widget and revision, and `results.json`
 * with what each gesture did to the page and to the diagram.
 *
 * The wheel is sent through the browser's own input pipeline
 * (`Input.dispatchMouseEvent`, type `mouseWheel`), so the page scrolls for
 * real and a diagram that moves under a stationary pointer does so as it would
 * for an operator. Two input profiles: a mouse wheel (one 100 px notch at a
 * time) and a trackpad (a burst of small deltas that decays, then inertia).
 *
 * Requires ffmpeg on the path (webm to mp4).
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium, type Page } from "playwright";
import { prepareProbePage } from "./widgetRenderHarness";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = resolve(HERE, "..");
const REPO = resolve(PACKAGE, "../..");
const SCENE = join(HERE, "probe", "wheel-scene-entry.tsx");
const TEMPLATE = join(HERE, "probe", "wheel-scene.html");

const BEFORE_DIR = join(PACKAGE, ".wheel-before");
const VIEWPORT = { width: 1100, height: 700 };

interface Variant {
  name: string;
  /** Directory holding the widget library's `src`. */
  src: string;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function variants(): Promise<Variant[]> {
  const list: Variant[] = [{ name: "after", src: join(PACKAGE, "src") }];
  const before = argValue("--before");
  if (before !== undefined) {
    // Inside the package, so the revision resolves workspace packages from its node_modules.
    const dir = BEFORE_DIR;
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await execFileAsync(
      "sh",
      [
        "-c",
        `git -C ${REPO} archive ${before} packages/components/src | tar -x -C ${dir}`,
      ],
      { maxBuffer: 1 << 28 },
    );
    list.unshift({
      name: "before",
      src: join(dir, "packages", "components", "src"),
    });
  }
  return list;
}

async function pageFor(variant: Variant): Promise<string> {
  // Inside the package, so the bundler resolves workspace packages from its node_modules.
  const entry = join(PACKAGE, `.wheel-scene-${variant.name}-entry.tsx`);
  await writeFile(
    entry,
    `import ${JSON.stringify(join(variant.src, "index.ts"))};
import { AlarmsLauncherProvider } from ${JSON.stringify(join(variant.src, "shared/AlarmsLauncher"))};
import { installScene } from ${JSON.stringify(SCENE)};
installScene(AlarmsLauncherProvider as never);
`,
  );
  try {
    return await prepareProbePage({
      entry,
      htmlTemplate: TEMPLATE,
      scriptSrcPlaceholder:
        '<script type="module" src="./wheel-scene-entry.bundle.js"></script>',
      slug: `wheel-${variant.name}`,
    });
  } finally {
    await rm(entry, { force: true });
  }
}

/** One wheel event through the browser's input pipeline. */
async function wheel(
  page: Page,
  cdp: Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>>,
  x: number,
  y: number,
  deltaY: number,
  modifiers = 0,
) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x,
    y,
    deltaX: 0,
    deltaY,
    modifiers,
  });
  void page;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A mouse wheel: whole notches, `gap` ms apart. */
function mouseNotches(count: number, gap: number) {
  return Array.from({ length: count }, () => ({ delta: 100, gap }));
}

/** A trackpad flick: a burst that decays into inertia, events every 12 ms. */
function trackpadFlick(totalEvents: number) {
  return Array.from({ length: totalEvents }, (_, i) => ({
    delta: Math.max(1, Math.round(60 * 0.94 ** i)),
    gap: 12,
  }));
}

interface Gesture {
  label: string;
  /** Where the pointer starts: on the dashboard above or below the tile, or inside it. */
  at: "above" | "below" | "inside";
  /** Which way the wheel turns: 1 scrolls the page down, -1 up. */
  dir: 1 | -1;
  input: { delta: number; gap: number }[];
  ctrl?: boolean;
}

const GESTURES: Gesture[] = [
  {
    label:
      "mouse wheel down, starts on the dashboard above and crosses the diagram",
    at: "above",
    dir: 1,
    input: mouseNotches(14, 45),
  },
  {
    label:
      "mouse wheel up, starts on the dashboard below and crosses the diagram",
    at: "below",
    dir: -1,
    input: mouseNotches(14, 45),
  },
  {
    label: "mouse wheel, slow notches up, starts below and crosses",
    at: "below",
    dir: -1,
    input: mouseNotches(8, 320),
  },
  {
    label:
      "trackpad flick up, starts on the dashboard below and crosses the diagram",
    at: "below",
    dir: -1,
    input: trackpadFlick(140),
  },
  {
    label:
      "trackpad flick down, starts on the dashboard above and crosses the diagram",
    at: "above",
    dir: 1,
    input: trackpadFlick(140),
  },
  {
    label: "mouse wheel up, starts inside the diagram",
    at: "inside",
    dir: -1,
    input: mouseNotches(6, 45),
  },
  {
    label: "trackpad flick up, starts inside the diagram",
    at: "inside",
    dir: -1,
    input: trackpadFlick(60),
  },
  {
    label: "Ctrl and wheel up inside the diagram",
    at: "inside",
    dir: -1,
    input: mouseNotches(4, 45),
    ctrl: true,
  },
];

interface Measure {
  scrollY: number;
  /** System View: viewBox width (smaller is more zoomed). Map View: hash of the base canvas pixels. */
  view: string;
}

async function measure(page: Page, tile: string): Promise<Measure> {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    let view = "";
    if (id === "scene-system") {
      view = el?.querySelector("svg[viewBox]")?.getAttribute("viewBox") ?? "";
    } else {
      const canvas = el?.querySelector("canvas");
      const data = canvas?.toDataURL() ?? "";
      let h = 0;
      for (let i = 0; i < data.length; i += 7)
        h = (h * 31 + data.charCodeAt(i)) | 0;
      view = String(h);
    }
    return { scrollY: Math.round(window.scrollY), view };
  }, tile);
}

async function caption(page: Page, text: string) {
  await page.evaluate((t) => {
    let el = document.getElementById("scene-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "scene-caption";
      el.style.cssText =
        "position:fixed;top:8px;left:8px;z-index:99999;padding:6px 10px;background:#000c;color:#fff;font:14px monospace;border:1px solid #888;max-width:520px";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

async function cursor(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.evaluate(
    ([cx, cy]) => {
      let el = document.getElementById("scene-cursor");
      if (!el) {
        el = document.createElement("div");
        el.id = "scene-cursor";
        el.style.cssText =
          "position:fixed;z-index:99999;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#ff3030;border:2px solid #fff;pointer-events:none";
        document.body.appendChild(el);
      }
      el.style.left = `${cx}px`;
      el.style.top = `${cy}px`;
    },
    [x, y],
  );
}

async function run(
  variant: Variant,
  html: string,
  out: string,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  const browser = await chromium.launch();
  try {
    for (const tile of ["scene-system", "scene-map"]) {
      const widget = tile === "scene-system" ? "system-view" : "map-view";
      const videoDir = join(out, `_video-${variant.name}-${widget}`);
      await mkdir(videoDir, { recursive: true });
      const context = await browser.newContext({
        viewport: VIEWPORT,
        recordVideo: { dir: videoDir, size: VIEWPORT },
      });
      const page = await context.newPage();
      page.on("pageerror", (e) => console.error("  [page error]", e.message));
      const cdp = await context.newCDPSession(page);
      await page.goto(pathToFileURL(html).toString(), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(
        () => typeof window.__mountScene === "function",
        undefined,
        { timeout: 10_000 },
      );
      await page.evaluate(() => window.__mountScene());
      await page.waitForSelector(
        tile === "scene-system"
          ? "#scene-system svg[viewBox]"
          : "#scene-map canvas",
        { timeout: 10_000 },
      );
      // What the page sees of each wheel event over the tile once the diagram has had its turn.
      await page.evaluate((id) => {
        const w = window as unknown as {
          __wheelLog: { over: number; swallowed: number };
        };
        w.__wheelLog = { over: 0, swallowed: 0 };
        window.addEventListener("wheel", (e) => {
          const el = document.getElementById(id);
          if (el?.contains(e.target as Node)) {
            w.__wheelLog.over++;
            if (e.defaultPrevented) w.__wheelLog.swallowed++;
          }
        });
      }, tile);
      await sleep(800);
      // The tile at rest, for comparing one revision with another pixel for pixel.
      await mkdir(join(out, "rest"), { recursive: true });
      await page.locator(`#${tile}`).screenshot({
        path: join(out, "rest", `${widget}-${variant.name}.png`),
      });

      for (const g of GESTURES) {
        // A fresh scene, so the gesture starts from the whole picture, then the page is placed where the gesture starts.
        await page.evaluate(() => window.__mountScene());
        await page.waitForSelector(
          tile === "scene-system"
            ? "#scene-system svg[viewBox]"
            : "#scene-map canvas",
        );
        const box = await page.evaluate((id) => {
          const r = document.getElementById(id)?.getBoundingClientRect();
          return r
            ? {
                top: r.top + window.scrollY,
                h: r.height,
                left: r.left,
                w: r.width,
              }
            : null;
        }, tile);
        if (!box) throw new Error(`no ${tile}`);
        const x = Math.round(box.left + box.w / 2);
        const scrollTo =
          g.at === "above"
            ? Math.max(0, box.top - 520)
            : g.at === "below"
              ? box.top + box.h - 260
              : Math.max(0, box.top - 140);
        await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
        await sleep(900);
        const y = g.at === "above" ? 120 : Math.round(140 + box.h / 2);
        await cursor(page, x, y);
        await caption(page, `${widget}: ${g.label}`);
        await sleep(600);
        const before = await measure(page, tile);
        await page.evaluate(() => {
          (
            window as unknown as {
              __wheelLog: { over: number; swallowed: number };
            }
          ).__wheelLog = { over: 0, swallowed: 0 };
        });
        const underPointer = await page.evaluate(
          ([px, py, id]) =>
            document
              .getElementById(id as string)
              ?.contains(
                document.elementFromPoint(px as number, py as number),
              ) ?? false,
          [x, y, tile],
        );
        if (underPointer !== (g.at === "inside")) {
          throw new Error(
            `gesture "${g.label}" starts with the pointer in the wrong place`,
          );
        }
        if (g.ctrl) await page.keyboard.down("Control");
        for (const step of g.input) {
          await wheel(page, cdp, x, y, step.delta * g.dir, g.ctrl ? 2 : 0);
          await sleep(step.gap);
        }
        if (g.ctrl) await page.keyboard.up("Control");
        await sleep(1200);
        const after = await measure(page, tile);
        const log = await page.evaluate(
          () =>
            (
              window as unknown as {
                __wheelLog: { over: number; swallowed: number };
              }
            ).__wheelLog,
        );
        results.push({
          variant: variant.name,
          widget,
          gesture: g.label,
          pageScrolled: after.scrollY - before.scrollY,
          diagramChanged: after.view !== before.view,
          wheelEventsOverDiagram: log.over,
          wheelEventsTheDiagramTook: log.swallowed,
        });
        console.log(
          `  ${variant.name} ${widget}: ${g.label}: page ${after.scrollY - before.scrollY}px, diagram ${after.view !== before.view ? "moved" : "unchanged"}, took ${log.swallowed} of ${log.over} wheel events over it`,
        );
      }
      await context.close();
      const [webm] = (await readdir(videoDir)).filter((f) =>
        f.endsWith(".webm"),
      );
      const mp4 = join(out, `${widget}-${variant.name}.mp4`);
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        join(videoDir, webm),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        mp4,
      ]);
      await rm(videoDir, { recursive: true, force: true });
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function main() {
  const out = resolve(
    argValue("--out") ?? join(PACKAGE, "../..", ".renders/wheel-zoom"),
  );
  await mkdir(out, { recursive: true });
  const all: Record<string, unknown>[] = [];
  for (const variant of await variants()) {
    console.log(`\n── ${variant.name} ──`);
    const html = await pageFor(variant);
    all.push(...(await run(variant, html, out)));
  }
  await writeFile(
    join(out, "results.json"),
    `${JSON.stringify(all, null, 2)}\n`,
  );
  await rm(BEFORE_DIR, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
