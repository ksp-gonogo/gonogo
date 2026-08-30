import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Locator, Page } from "playwright";
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

/**
 * playwright, imported when an engine is actually launched.
 *
 * It is an OPTIONAL peer of this package and this module's own header promises
 * that "a missing one fails with a named message rather than a resolution error".
 * That promise was false while the import sat at module scope: Node threw
 * ERR_MODULE_NOT_FOUND out of `dist/render.js` before a line of ours ran, which
 * is what an author copying the template met when they ran `npm run docs`, naming
 * a package they had never heard of and a file inside somebody else's dist.
 *
 * Only the VALUES move. `Page` and `Locator` stay type-only imports, which erase,
 * so the signatures throughout this file keep their real types.
 */
async function engine(name: Engine) {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch (err) {
    if (
      err instanceof Error &&
      /Cannot find (module|package)|ERR_MODULE_NOT_FOUND/.test(err.message)
    ) {
      throw new Error(
        "rendering needs playwright, which is not installed. It is your " +
          "dependency rather than ui-kit's, so an author who pins a version " +
          "gets the one they pinned:\n" +
          "  npm i -D playwright && npx playwright install chromium\n" +
          "Both halves are needed: the package drives a browser and the second " +
          "command downloads one.",
      );
    }
    throw err;
  }
  return playwright[name];
}

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
  const browser = await (await engine(opts.engine)).launch();
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
      if (isUnmountPlayAbort(err.message)) return;
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

/**
 * The one page error a render is allowed to survive.
 *
 * A `<video>` element unmounted while a `play()` promise is still pending
 * rejects, and every scene after the first unmounts one. It says nothing about
 * the render: the frame that was captured was captured before the unmount, and
 * the element being torn down is the harness moving on. Nothing else is
 * forgiven, because a page error is otherwise a widget that threw and a PNG
 * that looks like a widget that did not.
 *
 * Matched on both halves of the sentence rather than on "play", so a genuine
 * playback failure still fails the run.
 */
function isUnmountPlayAbort(message: string): boolean {
  return (
    message.includes("play() request was interrupted") &&
    message.includes("new load request")
  );
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
    await reportFit(tab, scene, mode.name);
    await performActs(tab, scene);
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

/**
 * Say, under each render, what the operator cannot read at that size.
 *
 * Printed rather than thrown, and that is the only thing about it worth
 * arguing over. It is an author's own render run, not a gate: failing it would
 * stop the pictures being produced, which is the one thing the author came here
 * for, and a check that blocks the tool it rides in is a check people stop
 * running. The repo's own gate over every widget at once fails; this tells the
 * author, at the moment they are looking at the widget, which of their own
 * sizes is unreadable.
 *
 * Taken BEFORE `growToFullContent`, which lifts the vertical crop so the
 * picture shows the whole widget: an audit after that has measured a tile
 * nobody runs.
 */
async function reportFit(tab: Page, scene: Scene, mode: string): Promise<void> {
  const findings = await tab.evaluate(
    (key) =>
      (globalThis as unknown as ProbeWindow)[
        key as typeof RENDER_PROBE_GLOBAL
      ].auditMinFit(),
    RENDER_PROBE_GLOBAL,
  );
  if (findings.length === 0) return;
  console.log(
    `   ! ${scene.name} @ ${mode}: ${findings.length} thing(s) an operator ` +
      `cannot read at this size`,
  );
  for (const f of findings.slice(0, 4)) {
    console.log(`     ${f.kind} ${f.px}px [${f.axis}]  "${f.text}"`);
  }
  if (findings.length > 4) {
    console.log(`     … and ${findings.length - 4} more`);
  }
  console.log(
    "     A heading that will not fit wants <Panel compactTitle>; content " +
      "that overflows wants a scroller. If neither is honest, raise the " +
      "widget's minSize.",
  );
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

/**
 * `_scene.before`, through real input events.
 *
 * A press goes through the accessible NAME rather than a selector, because that
 * is the handle an operator has and a class name is not: a control renamed out
 * from under a scene should fail here rather than quietly photograph the state
 * before the press.
 */
async function performActs(tab: Page, scene: Scene): Promise<void> {
  for (const act of scene.before) {
    if (act.press !== undefined) {
      const control = await pressable(tab, act.press);
      if (control === null) {
        throw new Error(
          `${scene.name}: "_scene.before" presses "${act.press}", which is ` +
            "not a button or a tab on screen at that point. Presses run in " +
            "order, so a control that only appears after an earlier press has " +
            "to come after it.",
        );
      }
      await control.click();
    } else if (act.hover !== undefined) {
      const target = tab.locator(act.hover).first();
      await target.scrollIntoViewIfNeeded().catch(() => {});
      const box = await target.boundingBox().catch(() => null);
      if (box === null) {
        throw new Error(
          `${scene.name}: "_scene.before" hovers "${act.hover}", which matched ` +
            "nothing that is laid out.",
        );
      }
      // A plain pointer move, not `locator.hover()`. That one refuses when
      // something is painted over the target, which is the normal case for a
      // hover-gated overlay: the chrome sits on top of the video it is gating.
      // What a hover-gate reads is where the pointer IS, so that is what this
      // sets.
      await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await restPointer(tab);
    }
    await settle(tab);
  }
}

/**
 * The control an accessible name reaches, or null when nothing does.
 *
 * <p>A tab is tried after a button because a tab IS a press an operator makes
 * and `role="tab"` is not `role="button"`. Without it every augment hosted
 * inside a tabbed widget was unreachable: the host renders its first tab, the
 * scene can never open the one the augment is in, and the only fixture that
 * could be written was one photographing a panel the augment is not on. Three
 * of the app's own hosts tab their content.</p>
 */
async function pressable(tab: Page, name: string): Promise<Locator | null> {
  for (const role of ["button", "tab"] as const) {
    const found = tab.getByRole(role, { name }).first();
    if ((await found.count()) > 0) return found;
  }
  return null;
}

/**
 * Put the pointer somewhere the widget is not.
 *
 * Past the tile's own bottom-right corner rather than at negative coordinates:
 * the browser clamps those back into the viewport, whose origin is INSIDE the
 * tile, so a hover-gated control asked to rest was hovered instead and both
 * halves of a resting/hovered pair came out identical.
 */
async function restPointer(tab: Page): Promise<void> {
  const viewport = tab.viewportSize() ?? { width: 900, height: 900 };
  const rect = await tab.evaluate(() => {
    const el = document.getElementById("root");
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return { right: box.right, bottom: box.bottom };
  });
  await tab.mouse.move(
    Math.min(viewport.width - 1, (rect?.right ?? 0) + 20),
    Math.min(viewport.height - 1, (rect?.bottom ?? 0) + 20),
  );
}

/** Two frames, which is what a React state change plus its layout costs. */
async function settle(tab: Page): Promise<void> {
  await tab.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
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
  await fitViewportToRoot(tab);
  const root = await tab.$("#root");
  if (!root) throw new Error("render: #root vanished after mount");
  return root.screenshot({ path, animations: "disabled" });
}

/**
 * Make the viewport tall enough to hold the whole widget in one go.
 *
 * An element screenshot taller than the viewport is captured by SCROLLING and
 * stitching, and scrolling the page also scrolls anything under it that still
 * has an overflow of its own. A `Panel` whose body did not quite grow to fit
 * therefore scrolled between two captures and the stitched image showed the
 * same rows twice, which reads as a widget that renders its contents twice.
 * Fitting the viewport first means nothing ever scrolls.
 */
async function fitViewportToRoot(tab: Page): Promise<void> {
  const height = await tab.evaluate(
    () => document.getElementById("root")?.getBoundingClientRect().height ?? 0,
  );
  const wanted = Math.ceil(height) + VIEWPORT_MARGIN_PX;
  const current = tab.viewportSize();
  if (!current || wanted <= current.height) return;
  await tab.setViewportSize({ width: current.width, height: wanted });
  await settle(tab);
}

/** Room for the tile's own outer inset, so nothing sits on the viewport edge. */
const VIEWPORT_MARGIN_PX = 64;

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
  await performActs(tab, scene);
  // Before the first frame, and once: a step that drives a control has to be
  // able to REACH it, and `page.mouse` works in viewport coordinates. A control
  // below the fold of a scrolling tile is at a y nothing is under, so the press
  // landed on the page and the film came out thirty-four identical frames.
  // Doing it here rather than per frame also keeps the framing fixed, which a
  // scroll between two frames would not.
  await growToFullContent(tab);
  await fitViewportToRoot(tab);
  // The state before the first step is a frame in its own right: the reader has
  // to see what changed FROM.
  frames.push(await shootFrame(tab, opts, framesDir, frames.length));
  let holding = false;
  for (const step of scene.steps ?? []) {
    const count = Math.max(1, step.frames ?? 1);
    const delta = (step.advanceUt ?? 0) / count;
    const wait = (step.waitMs ?? 0) / count;
    for (let i = 0; i < count; i++) {
      // The emit, the click and the pointer belong to the step's FIRST frame
      // only; repeating them would re-emit once per frame and mean something
      // else. `waitMs` is the exception, being an amount rather than an event.
      if (i === 0 && step.hold) {
        await holdPointer(tab, scene, step.hold);
        holding = true;
      }
      if (i === 0 && step.release) {
        await tab.mouse.up();
        holding = false;
      }
      const perFrame: SceneStep =
        i === 0 ? { ...step, frames: 1 } : { frames: 1 };
      await tab.evaluate(
        ([key, s, d]) =>
          (globalThis as unknown as ProbeWindow)[
            key as typeof RENDER_PROBE_GLOBAL
          ].stepScene(s as SceneStep, d as number),
        [RENDER_PROBE_GLOBAL, perFrame, delta] as const,
      );
      if (wait > 0) await tab.waitForTimeout(wait);
      frames.push(await shootFrame(tab, opts, framesDir, frames.length));
    }
  }
  // A pointer left down outlives the scene and lands on whatever mounts next.
  if (holding) await tab.mouse.up();
  assertMotionMoved(scene, frames);
  const gif = encodeGif(frames, scene.motion);
  const file = `${scene.name}--${mode.name}.gif`;
  await writeFile(join(opts.outDir, file), gif);
  assets.push({ scene, mode: mode.name, file, kind: "motion" });
  console.log(`   ${file} (${frames.length} frames @ ${scene.motion.fps}fps)`);
}

/**
 * A motion scene whose frames are all the same byte-for-byte is a film of
 * nothing.
 *
 * The still path has the fed-versus-starved comparison and a motion scene had
 * no equivalent, so a GIF announcing thirty-four frames was indistinguishable
 * from one where every step missed. That is not hypothetical: it is how a
 * `hold` step reaching a control the page had scrolled past was found, having
 * produced a perfectly well-formed film of a widget sitting still.
 */
function assertMotionMoved(scene: Scene, frames: readonly Buffer[]): void {
  const first = frames[0];
  if (!first || frames.every((frame) => frame.equals(first))) {
    throw new Error(
      `${scene.name} (${scene.target.kind} ${scene.target.id}): all ` +
        `${frames.length} frames of this motion scene are IDENTICAL, so the ` +
        "film shows nothing happening. Either the steps did not reach what " +
        "they name, or this scene has no motion in it and wants to be a still.",
    );
  }
}

/** Presses the pointer on a named control and drags it, without letting go. */
async function holdPointer(
  tab: Page,
  scene: Scene,
  hold: NonNullable<SceneStep["hold"]>,
): Promise<void> {
  const control = tab
    .getByRole((hold.role ?? "slider") as Parameters<Page["getByRole"]>[0], {
      name: hold.name,
    })
    .first();
  await control.scrollIntoViewIfNeeded().catch(() => {});
  const box = await control.boundingBox().catch(() => null);
  if (box === null) {
    throw new Error(
      `${scene.name}: a "hold" step names "${hold.name}", which is not laid ` +
        "out. A control that is not on screen cannot be dragged, and the frames " +
        "after this step would be a film of nothing happening.",
    );
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await tab.mouse.move(x, y);
  await tab.mouse.down();
  // Stepped rather than jumped: a drag handler reading movement per event sees
  // one enormous delta from a teleport and nothing resembling a drag.
  await tab.mouse.move(x + (hold.dx ?? 0), y + (hold.dy ?? 0), { steps: 8 });
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
