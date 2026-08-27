import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, firefox, type Locator, type Page, webkit } from "playwright";
import type {
  RenderProbeApi,
  ScenePayload,
  SceneReport,
  SceneStep,
  UplinkInventory,
} from "../render-probe";
import type { UplinkPackage } from "./context";
import { encodeGif } from "./gif";
import { buildProbePage } from "./page";
import { RENDER_PROBE_GLOBAL } from "./probe-global";
import { assertEveryWidgetCovered, buildScenes, type Scene } from "./scenes";

/**
 * The Playwright half: one browser, one page, every scene.
 *
 * Determinism carried over from the first-party harness, plus the three gaps its
 * own comment predicted. Pinned in one init script, before any module runs:
 * `Date.now`, `new Date()` with no arguments, `performance.now`, `Math.random`
 * and `crypto.randomUUID`. Doing it once in a published probe is cheaper than
 * each Uplink discovering the next one from a diff.
 */

export type Engine = "chromium" | "firefox" | "webkit";
const ENGINES = { chromium, firefox, webkit };

/** Arbitrary, stable: 2023-11-14T22:13:20Z. Only its fixedness matters. */
const FIXED_EPOCH_MS = 1_700_000_000_000;

async function pinTheClock(page: Page): Promise<void> {
  await page.addInitScript((fixed) => {
    const RealDate = Date;
    // A widget deriving layout from `new Date()` rather than `Date.now()` was
    // the gap the first-party harness's own comment named and left open. Only
    // the NO-ARGUMENT form is the nondeterministic one, so every other overload
    // is forwarded untouched.
    //
    // A function DECLARATION, not the arrow this used to be: an arrow has no
    // [[Construct]], so `new Date(x)` threw "Date is not a constructor" and took
    // the whole page down before a single module ran. Nothing in the page had
    // constructed a date until a first-party widget was mounted in it, so the
    // stand-in-host renders never reached the line. A declaration also keeps its
    // own name without the `__name` helper an anonymous function assigned to a
    // const picks up, which does not exist in the serialised page context.
    function PinnedDate(this: unknown, ...args: unknown[]) {
      if (!new.target) return RealDate();
      return Reflect.construct(
        RealDate,
        args.length === 0 ? [fixed] : args,
        new.target,
      );
    }
    PinnedDate.prototype = RealDate.prototype;
    PinnedDate.now = () => fixed;
    PinnedDate.parse = RealDate.parse;
    PinnedDate.UTC = RealDate.UTC;
    (globalThis as unknown as { Date: unknown }).Date = PinnedDate;
    performance.now = () => 0;
    let seed = 0x2545f491;
    Math.random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let uuidCounter = 0;
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: () => {
        uuidCounter++;
        const tail = uuidCounter.toString(16).padStart(12, "0");
        return `00000000-0000-4000-8000-${tail}`;
      },
    });
  }, FIXED_EPOCH_MS);
}

export interface RenderOptions {
  engine: Engine;
  outDir: string;
  /** Only scenes whose name matches. */
  scene?: string;
  /** Keep the numbered PNG frames of a motion scene beside its GIF. */
  frames: boolean;
  uplinkId?: string;
  /** Extra modules bundled into the page ON TOP of the package's own
   *  `gonogo.renderWith`, so a one-off run can name a host the package does not
   *  declare. See `ScenePayload.host`. */
  withModules?: readonly string[];
}

export interface RenderedAsset {
  scene: Scene;
  mode: string;
  /** Path relative to `outDir`. */
  file: string;
  kind: "still" | "motion";
}

export interface RenderResult {
  inventory: UplinkInventory;
  scenes: Scene[];
  assets: RenderedAsset[];
  /** `augment:<id>` / `contribution:<id>` with no scene. Named on the page. */
  unpreviewed: string[];
  fontMode: "locked" | "fallback";
  fontAdvice?: string;
}

type ProbeWindow = Record<typeof RENDER_PROBE_GLOBAL, RenderProbeApi>;

export async function renderUplink(
  pkg: UplinkPackage,
  opts: RenderOptions,
): Promise<RenderResult> {
  const page = await buildProbePage(pkg, [
    ...pkg.renderWith,
    ...(opts.withModules ?? []),
  ]);
  const browser = await ENGINES[opts.engine].launch();
  const pageErrors: string[] = [];
  const assets: RenderedAsset[] = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 900, height: 900 },
      deviceScaleFactor: 2,
      // Context level, so `prefers-reduced-motion`-guarded infinite pulses
      // collapse. `animations: "disabled"` at capture covers the rest.
      reducedMotion: "reduce",
    });
    const tab = await context.newPage();
    tab.on("pageerror", (err) => {
      console.error(`  [page error] ${err.message}`);
      pageErrors.push(err.message);
    });
    tab.on("console", (msg) => {
      if (msg.type() === "error") console.error(`  [console] ${msg.text()}`);
    });
    await pinTheClock(tab);
    await tab.goto(pathToFileURL(page.file).toString(), {
      waitUntil: "domcontentloaded",
    });
    await tab.waitForFunction(
      (key) =>
        typeof (globalThis as Record<string, unknown>)[key as string] ===
        "object",
      RENDER_PROBE_GLOBAL,
      { timeout: 20_000 },
    );

    const inventory = await tab.evaluate(
      ([key, uplinkId]) =>
        (globalThis as unknown as ProbeWindow)[
          key as typeof RENDER_PROBE_GLOBAL
        ].readInventory(uplinkId as string | undefined),
      [RENDER_PROBE_GLOBAL, opts.uplinkId] as const,
    );

    const all = buildScenes(pkg, inventory);
    const { unpreviewed } = assertEveryWidgetCovered(all, inventory);
    const scenes = opts.scene ? all.filter((s) => s.name === opts.scene) : all;
    if (scenes.length === 0) {
      throw new Error(
        `gonogo-uplink: no scene named "${opts.scene}". Known scenes: ` +
          `${all.map((s) => s.name).join(", ")}`,
      );
    }

    await mkdir(opts.outDir, { recursive: true });
    await cleanPngsAndGifs(opts.outDir);

    for (const scene of scenes) {
      await renderOneScene(tab, scene, opts, assets);
    }

    if (pageErrors.length > 0) {
      // A crashed widget still writes a PNG, and on a dark widget a blank frame
      // reads as font hinting. A render error must never be something a reviewer
      // catches by eye.
      const unique = [...new Set(pageErrors)];
      throw new Error(
        `${pageErrors.length} uncaught page error(s); no render from this run ` +
          `is trustworthy:\n  ${unique.join("\n  ")}`,
      );
    }
    return {
      inventory,
      scenes: all,
      assets,
      unpreviewed,
      fontMode: page.font.mode,
      fontAdvice: page.font.advice,
    };
  } finally {
    await browser.close();
  }
}

async function renderOneScene(
  tab: Page,
  scene: Scene,
  opts: RenderOptions,
  assets: RenderedAsset[],
): Promise<void> {
  console.log(`\n── ${scene.target.kind} ${scene.target.id} / ${scene.name}`);
  const first = scene.modes[0];

  // The starved run, once per scene rather than once per mode: the question is
  // about the FIXTURE, and a tile size cannot answer it.
  const starved = await mount(tab, payloadFor(scene, first, true));
  for (const [index, mode] of scene.modes.entries()) {
    const fed = await mount(tab, payloadFor(scene, mode, false));
    if (index === 0) assertFedRenderMeansSomething(scene, fed, starved);
    assertEveryEmitLanded(scene, fed);

    if (scene.steps && scene.steps.length > 0 && index === 0) {
      await captureMotion(tab, scene, mode, opts, assets);
      continue;
    }
    const file = `${scene.name}--${mode.name}.png`;
    await growToFullContent(tab);
    await assertEveryPaintVisible(tab, scene, mode.name);
    await shoot(tab, join(opts.outDir, file));
    assets.push({ scene, mode: mode.name, file, kind: "still" });
    // The visible text is printed because a picture is the one output a
    // terminal cannot show you, and this is the cheapest way for an author to
    // see that the render carries the words they expected.
    console.log(`   ${file}  ${fed.visibleText.slice(0, 110)}`);
  }
}

function payloadFor(
  scene: Scene,
  mode: { name: string; w: number; h: number; pxW: number; pxH: number },
  starve: boolean,
): ScenePayload {
  return {
    target: scene.target,
    fixture: scene.name,
    pinnedUt: scene.pinnedUt,
    carriedChannels: scene.carriedChannels,
    emits: scene.emits,
    config: scene.config,
    slotProps: scene.slotProps,
    host: scene.host,
    dataSources: scene.dataSources,
    w: mode.w,
    h: mode.h,
    pxW: mode.pxW,
    pxH: mode.pxH,
    starve,
    steps: scene.steps,
  };
}

async function mount(tab: Page, payload: ScenePayload): Promise<SceneReport> {
  const report = await tab.evaluate(
    ([key, scene]) =>
      (globalThis as unknown as ProbeWindow)[
        key as typeof RENDER_PROBE_GLOBAL
      ].renderScene(scene as ScenePayload),
    [RENDER_PROBE_GLOBAL, payload] as const,
  );
  return report;
}

/**
 * Every string `_scene.paints` names is on screen and READABLE.
 *
 * Measured through the real layout, which is the whole point: a jsdom suite
 * computes none, so text squeezed to zero width by a neighbour that wrapped
 * satisfies every `toBeInTheDocument` while being unreadable in a browser.
 *
 * Two ways a label loses. Zero width is the one that motivated the check: a
 * launch complex's own name rendered at nothing beside a detail sentence that
 * took the whole row. CLIPPING is the other, and it is the one a bounding box
 * alone cannot see, because `text-overflow: ellipsis` leaves a box of perfectly
 * respectable size showing "V…". Both are the same failure to a reader, so both
 * fail here.
 *
 * Collected across the whole list before throwing, so an author fixing a scene
 * sees all of it rather than one label per run. Grown to full content first, so
 * a label below the tile's fold is a visible label and not a failure.
 */
async function assertEveryPaintVisible(
  tab: Page,
  scene: Scene,
  mode: string,
): Promise<void> {
  const failures: string[] = [];
  for (const text of scene.paints) {
    const matches = tab.locator("#root").getByText(text, { exact: false });
    const count = await matches.count().catch(() => 0);
    if (count === 0) {
      failures.push(`"${text}" is not on the page at all`);
      continue;
    }
    // ANY readable instance passes, rather than the first. A hosted scene mounts
    // every augment registered on the host's slot, so a common label like
    // "Funds" legitimately appears several times, and asking only the first
    // whether it survived is asking about an arbitrary one of them.
    const verdicts: string[] = [];
    for (let i = 0; i < count; i++) {
      const verdict = await readable(matches.nth(i));
      if (verdict === null) {
        verdicts.length = 0;
        break;
      }
      verdicts.push(verdict);
    }
    if (verdicts.length > 0) {
      failures.push(
        `"${text}" appears ${count === 1 ? "once" : `${count} times`} and is ` +
          `readable nowhere: ${[...new Set(verdicts)].join("; ")}`,
      );
    }
  }
  if (failures.length === 0) return;
  throw new Error(
    `${scene.name} (${scene.target.kind} ${scene.target.id}) at ${mode}: ` +
      `${failures.length} of ${scene.paints.length} "_scene.paints" ` +
      `entries did not survive the layout:\n  ${failures.join("\n  ")}\n` +
      "Either the render is wrong, or this shape genuinely cannot carry the " +
      'text, in which case narrow the scene with "_scene": { "modes": [...] }.',
  );
}

/** `null` when this element carries the text readably, otherwise why it does not. */
async function readable(at: Locator): Promise<string | null> {
  const box = await at.boundingBox().catch(() => null);
  if (box === null) return "not laid out at all";
  if (box.width <= 0 || box.height <= 0) {
    return `painted at ${box.width}x${box.height}`;
  }
  // Its own overflow, not an ancestor's: `text-overflow: ellipsis` needs the
  // clip on the element carrying the text, so this is where the idiom lives. An
  // element overflowing VISIBLY is still readable and is not a failure.
  return at
    .evaluate((el) => {
      if (getComputedStyle(el).overflowX === "visible") return null;
      const over = el.scrollWidth - el.clientWidth;
      return over > 1
        ? `clipped, ${over}px of it outside the ${el.clientWidth}px it is given`
        : null;
    })
    .catch(() => null);
}

async function shoot(tab: Page, path: string): Promise<Buffer> {
  const root = await tab.$("#root");
  if (!root) throw new Error("render: #root vanished after mount");
  return root.screenshot({ path, animations: "disabled" });
}

/**
 * Grow `#root` until nothing is clipped, so the image shows the WHOLE widget.
 *
 * The mount already laid out at the real tile WIDTH, so responsive breakpoints
 * stay honest; only the vertical crop is lifted. Content hides in two places, a
 * `Panel`'s `overflow: hidden` and a scroll area's `overflow: auto`, so both are
 * measured and the box grows to swallow the larger, iterating because growing it
 * can reveal a little more.
 *
 * On by default here, unlike the first-party visual gate: a per-tile baseline
 * wants the crop, and a reader of a docs page wants the widget.
 */
async function growToFullContent(tab: Page): Promise<void> {
  // No named arrow functions inside `evaluate`: tsx's `keepNames` wraps one in a
  // `__name(...)` helper that exists in the module scope and not the serialised
  // page context, so a named arrow here throws "__name is not defined".
  await tab.evaluate(() => {
    const el = document.getElementById("root");
    if (!el) return;
    el.style.overflow = "visible";
    for (let i = 0; i < 8; i++) {
      let need = 0;
      // Every clipping box under the root, found rather than listed. The list
      // this replaces named `#root`, its first child and `ScrollArea`'s marker,
      // and a `Panel`'s BODY is the scroller in this kit and carries no marker
      // at all: a widget mounted in its real host had its last rows cropped,
      // and the crop was invisible because the picture still looked like a
      // widget. A hand-kept list of the ways content hides is exactly the shape
      // that goes stale silently.
      const boxes: Element[] = [el, ...el.querySelectorAll("*")];
      for (const node of boxes) {
        const over = node.scrollHeight - node.clientHeight;
        if (over <= need) continue;
        if (node !== el && getComputedStyle(node).overflowY === "visible") {
          continue;
        }
        need = over;
      }
      if (need <= 1) break;
      el.style.height = `${el.clientHeight + need}px`;
      void el.offsetHeight;
    }
  });
  // ResizeObserver-driven bits (gauges, tapes, scroll glow) settle at the final
  // height before the shot.
  await tab.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * The check the operator asked for, and it is exact rather than textual.
 *
 * An empty widget renders the same whether it works or not, so a render of an
 * unfed scene is a picture that looks like a working widget with no data. Two
 * widgets in this repo once carried 96 committed baselines between them that were
 * renders of nothing, and a textual detector found one and missed the other,
 * because one empty state is a sentence and the other is punctuation.
 *
 * So the comparison is between the SAME scene fed and starved. If they match, the
 * render does not depend on the fixture, whatever the scenario is called. The only
 * escape is `_scene.expectsEmpty`, which takes a written reason, and which still
 * has to render something.
 */
function assertFedRenderMeansSomething(
  scene: Scene,
  fed: SceneReport,
  starved: SceneReport,
): void {
  if (fed.boxCount === 0) {
    throw new Error(
      `${scene.name} (${scene.target.kind} ${scene.target.id}): the render is ` +
        "BLANK, not one painted element. Nothing mounted, or the mount threw " +
        "before painting.",
    );
  }
  if (scene.expectsEmpty) {
    if (fed.visibleText.length === 0) {
      throw new Error(
        `${scene.name}: "_scene.expectsEmpty" says this scene is an empty ` +
          `state ("${scene.expectsEmpty}"), but the render carries no visible ` +
          "text at all. An empty state a reader can see is a render; a blank " +
          "frame is not, and expectsEmpty is not a way to wave one through.",
      );
    }
    return;
  }
  if (fed.signature === starved.signature) {
    throw new Error(
      `${scene.name} (${scene.target.kind} ${scene.target.id}): this scene ` +
        "renders IDENTICALLY with its fixture suppressed, so the picture " +
        "contains none of the data the fixture feeds.\n" +
        `  what a reader sees: ${JSON.stringify(fed.visibleText.slice(0, 160))}\n` +
        `  topics the fixture emits: ${scene.emits.map((e) => e.topic).join(", ") || "(none)"}\n` +
        `  legacy keys: ${Object.values(scene.dataSources).flatMap(Object.keys).join(", ") || "(none)"}\n` +
        "Either the fixture feeds something this target does not read, or the " +
        "scene genuinely is an empty state, in which case say so with " +
        '"_scene": { "expectsEmpty": "<why>" }.',
    );
  }
}

/**
 * A `StubTransport` is subscription-gated exactly as production is, so an emit
 * to a topic nothing subscribed to is dropped in silence and the render is of no
 * data. This turns that whole class of bug into a named error.
 */
function assertEveryEmitLanded(scene: Scene, report: SceneReport): void {
  if (report.unsubscribedTopics.length === 0) return;
  throw new Error(
    `${scene.name} (${scene.target.kind} ${scene.target.id}): nothing in the ` +
      "mounted tree subscribed to " +
      `${report.unsubscribedTopics.length} emitted topic(s), so they were ` +
      "dropped:\n  " +
      `${report.unsubscribedTopics.join("\n  ")}\n` +
      `Derived carried channels (from the registration): ${scene.carriedChannels.join(", ") || "(none)"}\n` +
      (report.uncarriedTopics.length > 0
        ? `Not in that set at all: ${report.uncarriedTopics.join(", ")}. ` +
          "Add the topic to the target's `channels` / `optionalChannels` / " +
          "`dataRequirements`, or drop it from the fixture.\n"
        : "Carried, so the allowlist is right and nothing read it: either the " +
          "target does not consume the topic, or whatever gates the read never " +
          "opened.\n"),
  );
}

/**
 * A motion scene, frame by frame off the PINNED clock.
 *
 * That is the whole difference between this and a screen recording: the clock is
 * an input, so the same fixture produces the same frames on any machine. A still
 * already answers "what does this look like"; motion earns its place only where
 * the thing the widget exists to show IS a change.
 */
async function captureMotion(
  tab: Page,
  scene: Scene,
  mode: { name: string; w: number; h: number; pxW: number; pxH: number },
  opts: RenderOptions,
  assets: RenderedAsset[],
): Promise<void> {
  const frames: Buffer[] = [];
  const framesDir = join(opts.outDir, `${scene.name}.frames`);
  if (opts.frames) await mkdir(framesDir, { recursive: true });
  // The state before the first step is a frame in its own right: the reader has
  // to see what changed FROM.
  frames.push(await shootFrame(tab, opts, framesDir, frames.length));
  for (const step of scene.steps ?? []) {
    const count = Math.max(1, step.frames ?? 1);
    const delta = (step.advanceUt ?? 0) / count;
    for (let i = 0; i < count; i++) {
      // The emit and the click belong to the step's FIRST frame only; repeating
      // them would re-emit once per frame and mean something else.
      const perFrame: SceneStep =
        i === 0 ? { ...step, frames: 1 } : { frames: 1 };
      await tab.evaluate(
        ([key, s, d]) =>
          (globalThis as unknown as ProbeWindow)[
            key as typeof RENDER_PROBE_GLOBAL
          ].stepScene(s as SceneStep, d as number),
        [RENDER_PROBE_GLOBAL, perFrame, delta] as const,
      );
      frames.push(await shootFrame(tab, opts, framesDir, frames.length));
    }
  }
  const gif = encodeGif(frames, scene.motion);
  const file = `${scene.name}--${mode.name}.gif`;
  await writeFile(join(opts.outDir, file), gif);
  assets.push({ scene, mode: mode.name, file, kind: "motion" });
  console.log(`   ${file} (${frames.length} frames @ ${scene.motion.fps}fps)`);
}

async function shootFrame(
  tab: Page,
  opts: RenderOptions,
  framesDir: string,
  index: number,
): Promise<Buffer> {
  const path = opts.frames
    ? join(framesDir, `${String(index).padStart(3, "0")}.png`)
    : undefined;
  const root = await tab.$("#root");
  if (!root) throw new Error("render: #root vanished mid-motion");
  return root.screenshot({ path, animations: "disabled" });
}

/** Wipe this tool's own artifacts so a removed scene leaves no orphan. Only the
 *  two extensions it writes, so a sibling directory is never destroyed. */
async function cleanPngsAndGifs(dir: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.endsWith(".png") || entry.endsWith(".gif")) {
      await rm(join(dir, entry));
    }
  }
}
