#!/usr/bin/env tsx
/**
 * Records real wheel input over a scrolling dashboard that holds a System View
 * and a Map View, for the revision in the working tree and, with `--before
 * <ref>`, for the widget library as it was at a git revision, from the same
 * scene and the same input. Output goes to `--out` (default
 * `.renders/wheel-zoom`): one mp4 per widget and revision, and `results.json`
 * with what each gesture did to the page and to the diagram.
 *
 * The wheel is sent with Playwright's `mouse.wheel`, which goes through each
 * engine's own input pipeline, so the page scrolls for real and a diagram that
 * moves under a stationary pointer does so as it would for an operator.
 * `--engine chromium|firefox|webkit` picks the engine (default chromium). Two
 * input profiles: a mouse wheel (one 100 px notch at a time) and a trackpad (a
 * burst of small deltas that decays). Neither is a real trackpad: no engine
 * here sends the momentum phase, so a flick is a decaying run of pixel deltas.
 *
 * Each gesture is judged against who should own it: `page` (the page scrolls
 * in full and the diagram stays put), `diagram` (the diagram changes and the
 * page stays put) or `diagram then page` (the diagram runs out of zoom and
 * hands the rest of the turn to the page, or has none to give because it
 * starts at that limit), or `page then diagram` (the notches before the pointer
 * moves scroll the page, the ones after it zoom the diagram).
 *
 * `--widget system-view|map-view|ship-map` and `--gesture <text in the label>`
 * narrow the run, `--repeat <n>` repeats each gesture.
 *
 * Video is recorded for chromium only and needs ffmpeg on the path.
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium, firefox, type Page, webkit } from "playwright";
import { prepareProbePage } from "./widgetRenderHarness";

const ENGINES = { chromium, firefox, webkit } as const;
type EngineName = keyof typeof ENGINES;

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
import { ShipDiagram } from ${JSON.stringify(join(variant.src, "ShipMap/ShipDiagram"))};
import { AlarmsLauncherProvider } from ${JSON.stringify(join(variant.src, "shared/AlarmsLauncher"))};
import { installScene } from ${JSON.stringify(SCENE)};
installScene(AlarmsLauncherProvider as never, ShipDiagram as never);
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

type Expect = "page" | "diagram" | "diagram then page" | "page then diagram";

interface Gesture {
  label: string;
  /** Where the pointer starts: on the dashboard above or below the tile, or inside it. */
  at: "above" | "below" | "inside";
  /** Which way the wheel turns: 1 scrolls the page down, -1 up. */
  dir: 1 | -1;
  input: { delta: number; gap: number; nudge?: boolean; stall?: number }[];
  ctrl?: boolean;
  expect: Expect;
}

/** A notch gap past Firefox's wheel transaction timeout (1.5 s), after which it targets whatever is under the pointer again. */
const PAST_TRANSACTION = 1700;

const GESTURES: Gesture[] = [
  {
    label:
      "mouse wheel down, starts on the dashboard above and crosses the diagram",
    at: "above",
    dir: 1,
    input: mouseNotches(14, 45),
    expect: "page",
  },
  {
    label:
      "mouse wheel up, starts on the dashboard below and crosses the diagram",
    at: "below",
    dir: -1,
    input: mouseNotches(14, 45),
    expect: "page",
  },
  {
    label: "mouse wheel, slow notches up, starts below and crosses",
    at: "below",
    dir: -1,
    input: mouseNotches(8, 320),
    expect: "page",
  },
  {
    label:
      "trackpad flick up, starts on the dashboard below and crosses the diagram",
    at: "below",
    dir: -1,
    input: trackpadFlick(140),
    expect: "page",
  },
  {
    label:
      "trackpad flick down, starts on the dashboard above and crosses the diagram",
    at: "above",
    dir: 1,
    input: trackpadFlick(140),
    expect: "page",
  },
  {
    label: "mouse wheel up, starts inside the diagram",
    at: "inside",
    dir: -1,
    input: mouseNotches(6, 45),
    expect: "diagram",
  },
  {
    label: "trackpad flick up, starts inside the diagram",
    at: "inside",
    dir: -1,
    input: trackpadFlick(60),
    expect: "diagram",
  },
  {
    label: "Ctrl and wheel up inside the diagram",
    at: "inside",
    dir: -1,
    input: mouseNotches(4, 45),
    ctrl: true,
    expect: "diagram",
  },
  {
    label:
      "very slow notches (1.7 s apart) up, starts below and parks the diagram under the pointer",
    at: "below",
    dir: -1,
    input: mouseNotches(6, PAST_TRANSACTION),
    expect: "page",
  },
  {
    label: "very slow notches (1.7 s apart) down, starts inside the diagram",
    at: "inside",
    dir: -1,
    input: mouseNotches(4, PAST_TRANSACTION),
    expect: "diagram",
  },
  {
    label:
      "slow notches up, parks the diagram under the pointer, then the pointer moves 4 px and the wheel turns again",
    at: "below",
    dir: -1,
    input: [
      ...mouseNotches(4, PAST_TRANSACTION),
      { delta: 0, gap: 400, nudge: true },
      ...mouseNotches(2, PAST_TRANSACTION),
    ],
    expect: "page then diagram",
  },
  {
    label:
      "mouse wheel up, starts on the dashboard below, the page is busy for 350 ms mid-gesture",
    at: "below",
    dir: -1,
    input: [
      ...mouseNotches(3, 45),
      { delta: 100, gap: 45, stall: 350 },
      ...mouseNotches(10, 45),
    ],
    expect: "page",
  },
  {
    label:
      "mouse wheel in, 60 notches inside the diagram, past its zoom-in limit",
    at: "inside",
    dir: -1,
    input: mouseNotches(60, 30),
    expect: "diagram then page",
  },
  {
    label:
      "mouse wheel out, 60 notches inside the diagram, past its zoom-out limit",
    at: "inside",
    dir: 1,
    input: mouseNotches(60, 30),
    expect: "diagram then page",
  },
];

interface Measure {
  scrollY: number;
  /** System View: its viewBox. Ship Map: the transform of its drawing. Map View: hash of the base canvas pixels. */
  view: string;
}

async function measure(page: Page, tile: string): Promise<Measure> {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    const scrollY = Math.round(window.scrollY);
    if (id === "scene-system") {
      const viewBox = el
        ?.querySelector("svg[viewBox]")
        ?.getAttribute("viewBox");
      return { scrollY, view: viewBox ?? "" };
    }
    if (id === "scene-ship") {
      const drawing = el?.querySelector("svg g[transform]");
      return { scrollY, view: drawing?.getAttribute("transform") ?? "" };
    }
    const data = el?.querySelector("canvas")?.toDataURL() ?? "";
    let h = 0;
    for (let i = 0; i < data.length; i += 7)
      h = (h * 31 + data.charCodeAt(i)) | 0;
    return { scrollY, view: String(h) };
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

/** Brings the pointer to a point the way a hand does, as a run of moves rather than one jump. */
async function cursor(page: Page, x: number, y: number) {
  await page.mouse.move(x - 40, y);
  await page.mouse.move(x, y, { steps: 6 });
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

const TILES = [
  {
    id: "scene-system",
    widget: "system-view",
    ready: "#scene-system svg[viewBox]",
  },
  { id: "scene-map", widget: "map-view", ready: "#scene-map canvas" },
  {
    id: "scene-ship",
    widget: "ship-map",
    ready: "#scene-ship svg g[transform]",
  },
];

async function run(
  variant: Variant,
  html: string,
  out: string,
  engine: EngineName,
  only: string | undefined,
  gestureFilter: string | undefined,
  repeat: number,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  const video = engine === "chromium";
  const browser = await ENGINES[engine].launch();
  try {
    for (const { id: tile, widget, ready } of TILES) {
      if (only !== undefined && widget !== only) continue;
      const videoDir = join(out, `_video-${engine}-${variant.name}-${widget}`);
      if (video) await mkdir(videoDir, { recursive: true });
      const context = await browser.newContext({
        viewport: VIEWPORT,
        ...(video ? { recordVideo: { dir: videoDir, size: VIEWPORT } } : {}),
      });
      const page = await context.newPage();
      page.on("pageerror", (e) => console.error("  [page error]", e.message));
      await page.goto(pathToFileURL(html).toString(), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(
        () => typeof window.__mountScene === "function",
        undefined,
        { timeout: 10_000 },
      );
      await page.evaluate(() => window.__mountScene());
      await page.waitForSelector(ready, { timeout: 10_000 });
      // What the page sees of each wheel event over the tile once the diagram has had its turn.
      await page.evaluate((id) => {
        const w = window as unknown as {
          __wheelLog: { over: number; swallowed: number; total: number };
        };
        w.__wheelLog = { over: 0, swallowed: 0, total: 0 };
        const trace: string[] = [];
        (window as unknown as { __trace: string[] }).__trace = trace;
        window.addEventListener(
          "wheel",
          (e) =>
            trace.push(
              `${Math.round(performance.now())} wheel ${e.clientX},${e.clientY} on ${document.getElementById(id)?.contains(e.target as Node) ? "diagram" : "page"}`,
            ),
          { capture: true, passive: true },
        );
        window.addEventListener(
          "pointermove",
          (e) =>
            trace.push(
              `${Math.round(performance.now())} pointermove ${e.clientX},${e.clientY} on ${document.getElementById(id)?.contains(e.target as Node) ? "diagram" : "page"}`,
            ),
          { capture: true, passive: true },
        );
        window.addEventListener(
          "scroll",
          () =>
            trace.push(
              `${Math.round(performance.now())} scroll ${Math.round(window.scrollY)}`,
            ),
          { capture: true, passive: true },
        );
        window.addEventListener("wheel", (e) => {
          trace.push(`   prevented=${e.defaultPrevented}`);
          w.__wheelLog.total++;
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

      const plan = Array.from({ length: repeat }).flatMap(() =>
        GESTURES.filter(
          (candidate) =>
            gestureFilter === undefined ||
            candidate.label.includes(gestureFilter),
        ),
      );
      for (const g of plan) {
        // A fresh scene, so the gesture starts from the whole picture, then the page is placed where the gesture starts.
        await page.evaluate(() => {
          (window as unknown as { __trace: string[] }).__trace.length = 0;
          return window.__mountScene();
        });
        await page.waitForSelector(ready);
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
              __wheelLog: { over: number; swallowed: number; total: number };
            }
          ).__wheelLog = { over: 0, swallowed: 0, total: 0 };
        });
        const range = await page.evaluate(
          () =>
            document.documentElement.scrollHeight -
            document.documentElement.clientHeight,
        );
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
        await page.evaluate(
          ([id, px, py]) => {
            const trace = (window as unknown as { __trace: string[] }).__trace;
            const r = document
              .getElementById(id as string)
              ?.getBoundingClientRect();
            trace.push(
              `start under pointer: ${document.elementFromPoint(px as number, py as number)?.tagName ?? "none"} scrollY=${Math.round(window.scrollY)} tile ${Math.round(r?.top ?? 0)}..${Math.round(r?.bottom ?? 0)} pointer ${px},${py}`,
            );
          },
          [tile, x, y],
        );
        let nudged = 0;
        let blocked: Promise<void> = Promise.resolve();
        for (const step of g.input) {
          if (step.stall !== undefined) {
            const ms = step.stall;
            blocked = page.evaluate((busy) => {
              const from = performance.now();
              while (performance.now() - from < busy);
            }, ms);
          }
          if (step.nudge) {
            nudged += 4;
            await page.mouse.move(x + nudged, y);
          } else {
            await page.mouse.wheel(0, step.delta * g.dir);
          }
          await sleep(step.gap);
        }
        await blocked;
        if (g.ctrl) await page.keyboard.up("Control");
        await sleep(1200);
        const after = await measure(page, tile);
        const log = await page.evaluate(
          () =>
            (
              window as unknown as {
                __wheelLog: { over: number; swallowed: number; total: number };
              }
            ).__wheelLog,
        );
        const sent = g.input
          .filter((step) => !step.nudge)
          .reduce((sum, step) => sum + step.delta, 0);
        const room = g.dir === 1 ? range - before.scrollY : before.scrollY;
        const expectedPage = Math.min(sent, room);
        const scrolled = (after.scrollY - before.scrollY) * g.dir;
        const diagramChanged = after.view !== before.view;
        const pageInFull = scrolled >= expectedPage * 0.9;
        const pageStill = scrolled === 0;
        const beforeNudge = g.input
          .slice(
            0,
            g.input.findIndex((step) => step.nudge),
          )
          .reduce((sum, step) => sum + step.delta, 0);
        const verdict =
          g.expect === "page"
            ? pageInFull && !diagramChanged
            : g.expect === "diagram"
              ? diagramChanged && pageStill
              : g.expect === "page then diagram"
                ? scrolled >= Math.min(beforeNudge, room) * 0.9 &&
                  diagramChanged
                : scrolled > 0;
        results.push({
          engine,
          variant: variant.name,
          widget,
          gesture: g.label,
          expect: g.expect,
          pageScrolled: after.scrollY - before.scrollY,
          pageScrollExpected: expectedPage * g.dir,
          pageScrolledInFull: pageInFull,
          diagramChanged,
          wheelEventsSent: g.input.filter((step) => !step.nudge).length,
          wheelEventsSeen: log.total,
          wheelEventsOverDiagram: log.over,
          wheelEventsTheDiagramTook: log.swallowed,
          ok: verdict,
        });
        if (!verdict) {
          const trace = await page.evaluate(
            () => (window as unknown as { __trace: string[] }).__trace,
          );
          console.log(`  trace:\n    ${trace.join("\n    ")}`);
        }
        console.log(
          `  ${engine} ${variant.name} ${widget}: ${verdict ? "ok  " : "FAIL"} ${g.label}: page ${after.scrollY - before.scrollY}px of ${expectedPage * g.dir}, diagram ${diagramChanged ? "moved" : "unchanged"}, ${log.total} wheel events seen of ${g.input.filter((st) => !st.nudge).length} sent, diagram took ${log.swallowed} of ${log.over} over it`,
        );
      }
      await context.close();
      if (!video) continue;
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
  const engine = (argValue("--engine") ?? "chromium") as EngineName;
  if (!(engine in ENGINES)) throw new Error(`unknown engine "${engine}"`);
  const only = argValue("--widget");
  for (const variant of await variants()) {
    console.log(`\n── ${engine} ${variant.name} ──`);
    const html = await pageFor(variant);
    all.push(
      ...(await run(
        variant,
        html,
        out,
        engine,
        only,
        argValue("--gesture"),
        Number(argValue("--repeat") ?? 1),
      )),
    );
  }
  await writeFile(
    join(out, `results-${engine}.json`),
    `${JSON.stringify(all, null, 2)}\n`,
  );
  await rm(BEFORE_DIR, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
