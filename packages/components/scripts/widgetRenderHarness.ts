/**
 * Shared playwright + esbuild widget-screenshot harness. Every widget
 * driver delegates to `renderWidgets(configs)`; per-widget driver files
 * shrink to a config export. Adding a widget = new config, no new driver
 * script, no new package.json entry.
 *
 * The harness bundles `scripts/probe/probe-entry.tsx` ONCE per invocation
 * and reuses the same Chromium page across every widget when running
 * `--all`, so 10 widgets render in one launch instead of 10.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import { chromium, firefox, type Page, webkit } from "playwright";

const require = createRequire(import.meta.url);

type Engine = "chromium" | "firefox" | "webkit";
const ENGINES = { chromium, firefox, webkit };
// Every suffix `renderWidgets` can produce (chromium's default is empty).
// Used to scope stale-artifact cleanup to one engine's own files so a
// firefox/webkit render doesn't delete a sibling engine's PNGs that share
// the same output directory.
const ENGINE_SUFFIXES = [
  "",
  ...Object.keys(ENGINES).map((e) => `--${e}`),
] as const;

/** True if `name` was produced by a render using exactly `suffix` (not a
 *  different, more specific engine suffix that happens to end the same way
 *  once `.png` is appended). */
function artifactMatchesSuffix(name: string, suffix: string): boolean {
  if (!name.endsWith(`${suffix}.png`)) return false;
  if (suffix !== "") return true;
  return !ENGINE_SUFFIXES.some(
    (other) => other !== "" && name.endsWith(`${other}.png`),
  );
}

// Pin the page clock so time-based widgets render byte-deterministically.
// The graph derives its X-axis domain (and tick labels) from Date.now(), so
// without this two runs seconds apart differ, enough to trip the visual
// gate's tight threshold on every run. A fixed epoch makes every render of a
// given fixture reproducible across runs and machines. Chosen arbitrarily
// (2023-11-14T22:13:20Z); only its stability matters.
const FIXED_EPOCH_MS = 1_700_000_000_000;

/** Freeze `Date.now()` in the page before any script runs, so `Date.now()`-
 *  derived layout (the graph's time axis) renders reproducibly. Added via
 *  addInitScript so it lands before the probe module and the widgets it
 *  mounts read the clock. Note: only `Date.now()` is pinned, a future widget
 *  deriving layout from `new Date()` / `performance.now()` would reintroduce
 *  nondeterminism and need handling here. */
async function installFixedClock(page: Page): Promise<void> {
  await page.addInitScript((fixed) => {
    Date.now = () => fixed;
  }, FIXED_EPOCH_MS);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "probe-entry.tsx");
const PROBE_HTML_TEMPLATE = join(PROBE_DIR, "probe.html");
const SCREEN_ENTRY = join(PROBE_DIR, "screen-entry.tsx");
const SCREEN_HTML_TEMPLATE = join(PROBE_DIR, "screen-probe.html");
/**
 * The probe pages this harness builds, and the `window` global each one's
 * bundle installs at module load.
 *
 * Declared here, and consumed by both `renderWidgets`/`renderScreens` below
 * and by `probe-render-smoke.ts`, so the smoke check can never be exercising a
 * different entry, template or esbuild config from the one the real renders
 * use. A copy of the pairing in the smoke script would be free to drift green
 * while the harness broke, which is the failure mode it exists to close.
 */
export const PROBE_PAGES = {
  widget: {
    entry: PROBE_ENTRY,
    htmlTemplate: PROBE_HTML_TEMPLATE,
    scriptSrcPlaceholder:
      '<script type="module" src="./probe-entry.bundle.js"></script>',
    installs: "__renderProbe",
  },
  screen: {
    entry: SCREEN_ENTRY,
    htmlTemplate: SCREEN_HTML_TEMPLATE,
    scriptSrcPlaceholder:
      '<script type="module" src="./screen-entry.bundle.js"></script>',
    installs: "__renderScreen",
  },
} as const;

const COMPONENTS_SRC = resolve(HERE, "../src");
const LOCAL_DOCS = resolve(HERE, "../../../local_docs");
// The design tokens themselves. `packages/app/src/styles/global.css` only
// `@import`s `@ksp-gonogo/theme/tokens.css` (see that file's header comment),
// so reading it here would find no token declarations at all and every probe
// render would silently lose its colours. Read the theme package's *source*
// tokens.css directly:
// no bundler resolution needed, and no dependency on `pnpm --filter
// @ksp-gonogo/theme build` having run first (its `dist/tokens.css` is a
// gitignored build artifact; this script only ever reads plain text).
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");
const ARTIFACT_EXTS = new Set([".png"]);

// Dashboard grid constants: mirrors packages/app/src/components/Dashboard/
// layoutNormalization.ts (ROW_HEIGHT, margin) plus a colWidth approximating
// `lg` (cols=36) at a comfortable viewport.
const COL_WIDTH = 32;
const ROW_HEIGHT = 25;
const GRID_MARGIN = 8;

export interface SizeMode {
  /** Slug used in the output filename. */
  name: string;
  w: number;
  h: number;
  /** Per-mode config overlay merged onto the widget's defaultConfig. */
  config?: Record<string, unknown>;
  /**
   * Optional synthetic clicks dispatched after mount + emit + settle.
   * Captures interactive states (arm-then-confirm, dropdown open,
   * modal). Runs in order; selectors target the live DOM via
   * `document.querySelector`. Missing selectors throw so brittle
   * fixtures get caught instead of producing misleading screenshots.
   */
  clicks?: ReadonlyArray<{ selector: string; awaitMs?: number }>;
  /**
   * Scroll the panel's body (`[data-panel-body]`) down by this many px after
   * mount + settle, before the screenshot. Captures scroll-position-only UI
   * that the at-rest probe never sees, chiefly the Panel title ghost, which
   * only fades in once the real scrolling header is out of view. A big value
   * pins the scroller to the bottom, past any header height. No-op when the
   * body does not overflow (nothing to scroll), so it is safe on any widget.
   */
  scroll?: number;
  /**
   * Restrict the mode to a subset of fixtures. Useful for click-driven
   * modes that only make sense against specific scenarios (e.g. the
   * arm-recover click only applies to fixtures that actually have a
   * recoverable vessel). When omitted, the mode runs for every fixture.
   */
  forFixtures?: readonly string[];
}

export interface WidgetRenderConfig {
  /** Registered widget id passed to the probe (matches `registerComponent({ id: ... })`). */
  widgetId: string;
  /** CLI lookup key for `render-widget <id>`; defaults to widgetId. Lets two
   * configs share one widgetId (e.g. a widget rendered against two fixture
   * sets) while staying individually addressable. */
  label?: string;
  /** Filename slug used for the tmpdir probe HTML; defaults to widgetId. */
  slug?: string;
  /** Fixtures directory path relative to `packages/components/src/`. */
  fixturesPath: string;
  /** Output directory path relative to `local_docs/`. */
  outPath: string;
  /** Grid-size variants to render every fixture at. */
  modes: SizeMode[];
  /** Force full-content capture for THIS config even when the caller (e.g. the
   * visual gate) renders fixed-tile by default, grows `#root` to the whole
   * widget so nothing is cropped below the fold. For composed instruments whose
   * content scrolls in a real cell (LandingStatus) but must be reviewed whole. */
  fullContent?: boolean;
  /**
   * Fail the render when any element matching `selector` is cut off by the
   * panel's own bottom edge.
   *
   * For a widget whose content is a COMPARISON, a row that renders below the
   * fold is not merely cropped: it is missing from the thing the widget exists
   * to show, while every DOM assertion still passes on it. jsdom computes no
   * boxes, so a unit test is structurally incapable of expressing this and
   * putting it there would be a second blind instrument.
   *
   * `mayScroll` names the modes where the property is deliberately given up: at
   * a tile too small to hold the content, scrolling IS the accepted
   * degradation. Everything not listed is checked, so a mode added later is
   * covered by default and an exemption has to be written down as one.
   */
  mustBeVisible?: { selector: string; mayScroll?: readonly string[] };
}

/** A viewport size the screen harness renders a screen at. Unlike a widget
 *  `SizeMode` (grid units → `#root` pixels), a screen breakpoint sizes the
 *  whole PAGE viewport so the screen's own `@media` rules engage. */
export interface ScreenBreakpoint {
  /** Slug used in the output filename. */
  name: string;
  /** Page viewport width in CSS px. */
  width: number;
  /** Page viewport height in CSS px. */
  height: number;
  /** Emulate a touch / coarse-pointer device so `@media (pointer: coarse)`
   *  matches. Defaults to true for sub-tablet widths. */
  touch?: boolean;
}

/** One visual state of a screen: selects the prop set passed to the screen
 *  view (idle / error / reconnecting). */
export interface ScreenState {
  /** Slug used in the output filename. */
  name: string;
  /** Prop set forwarded to the screen probe. Shape matches the screen view. */
  props: Record<string, unknown>;
}

export interface ScreenRenderConfig {
  /** Marks this as a screen entry (vs. a widget) for the unified registry. */
  isScreen: true;
  /** Screen id the screen-entry probe dispatches on. */
  screenId: string;
  /** Output directory path relative to `local_docs/`. */
  outPath: string;
  /** Viewport breakpoints to render every state at. */
  breakpoints: ScreenBreakpoint[];
  /** Visual states (prop sets) to render at every breakpoint. */
  states: ScreenState[];
}

interface ProbeSeriesSample {
  t: number;
  v: unknown;
}

interface ProbePayload {
  widgetId: string;
  fixture: Record<string, unknown>;
  w: number;
  h: number;
  pxW: number;
  pxH: number;
  config?: Record<string, unknown>;
  instanceId?: string;
  series?: Record<string, readonly ProbeSeriesSample[]>;
  clicks?: ReadonlyArray<{ selector: string; awaitMs?: number }>;
}

/** Render every (fixture × mode) for one widget, convenience wrapper for
 *  the common single-widget invocation. */
export async function renderWidget(config: WidgetRenderConfig): Promise<void> {
  await renderWidgets([config]);
}

/** Render every fixture/mode across multiple widgets in a single Chromium
 *  session. Bundle is built once, page is reused. */
export async function renderWidgets(
  configs: WidgetRenderConfig[],
  opts: {
    engine?: Engine;
    outSuffix?: string;
    outBase?: string;
    /**
     * Capture each widget's FULL rendered content rather than the fixed
     * grid-tile crop. The mount still uses the mode's `w`/`h` (so the widget
     * lays out at the real tile size and its responsive breakpoints engage),
     * but before the screenshot the harness grows `#root` to swallow any
     * content clipped by the Panel's `overflow:hidden` or trapped inside a
     * ScrollArea: so nothing below the fold is lost. The review path
     * (`render-widget`) turns this ON harness-wide so every widget renders
     * uncropped; the VISUAL GATE leaves it OFF so its per-tile baselines are
     * unaffected.
     */
    fullContent?: boolean;
  } = {},
): Promise<void> {
  if (configs.length === 0) {
    console.error("renderWidgets: no widget configs provided");
    process.exit(1);
  }

  const engine = opts.engine ?? "chromium";
  const outSuffix = opts.outSuffix ?? "";
  const outBase = opts.outBase ?? LOCAL_DOCS;
  const fullContent = opts.fullContent ?? false;

  const slug =
    configs.length === 1 ? (configs[0].slug ?? configs[0].widgetId) : "all";
  const probeHtmlOut = await prepareProbePage({
    ...PROBE_PAGES.widget,
    slug,
  });

  console.log(`Launching ${engine}…`);
  const browser = await ENGINES[engine].launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 800, height: 800 },
      deviceScaleFactor: 2,
      // Several widgets pulse with `animation: … infinite` guarded by
      // `@media (prefers-reduced-motion: no-preference)`. Emulate reduce so
      // those guards suppress the animation: otherwise a pulsing state is
      // captured at an arbitrary opacity phase and the visual gate flakes.
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const findings = noFindings();
    page.on("pageerror", (err) => {
      console.error("  [page error]", err.message);
      pageErrors.push(err.message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error("  [console error]", msg.text());
      }
    });

    await installFixedClock(page);
    await page.goto(pathToFileURL(probeHtmlOut).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __renderProbe?: unknown })
          .__renderProbe === "function",
      undefined,
      { timeout: 10_000 },
    );

    await proveOverlapDetectorWorks(page);

    for (const config of configs) {
      // A config can force full-content capture for itself (e.g. LandingStatus,
      // whose composed instrument scrolls in a real cell) even when the caller
      // renders fixed-tile by default (the visual gate).
      await renderOneWidget(
        page,
        config,
        outSuffix,
        outBase,
        config.fullContent ?? fullContent,
        findings,
      );
    }

    // Before the gates, because a gate's verdict only covers what rendered: a
    // clean overlap report over 16 of 42 widgets is not a clean tree.
    if (findings.mounts.length > 0) {
      throw new Error(
        `${findings.mounts.length} render(s) never happened, so nothing was ` +
          "gated or captured for them:\n  " +
          findings.mounts.join("\n  ") +
          "\n(A missing click selector is the usual cause: an interaction mode " +
          "whose control has been renamed, moved behind a condition the fixture " +
          "no longer meets, or dropped.)",
      );
    }

    if (findings.overlaps.length > 0) {
      const message =
        `${findings.overlaps.length} pair(s) of stacked siblings painting into the same ` +
        "pixels, so two sections of the widget are on top of each other:\n  " +
        findings.overlaps.join("\n  ");
      if (process.env.PROBE_ALLOW_OVERLAP === "1") {
        console.warn(`\n[warn] ${message}`);
      } else {
        throw new Error(
          `${message}\n(Set PROBE_ALLOW_OVERLAP=1 to render anyway. A stacked ` +
            "sibling overlap is usually a flex item with min-height:0 that was " +
            "shrunk below its content: it keeps painting at its natural size and " +
            "the content lands on whatever follows it.)",
        );
      }
    }

    if (findings.crushedGraphics.length > 0) {
      const message =
        `${findings.crushedGraphics.length} graphic(s) laid out at zero width or height, ` +
        "so they are in the DOM and paint nothing:\n  " +
        findings.crushedGraphics.join("\n  ");
      if (process.env.PROBE_ALLOW_CRUSHED_GRAPHICS === "1") {
        console.warn(`\n[warn] ${message}`);
      } else {
        throw new Error(
          `${message}\n(Set PROBE_ALLOW_CRUSHED_GRAPHICS=1 to render anyway. ` +
            "A crushed graphic is usually a flex row too narrow for an icon plus " +
            "its label: the icon's automatic minimum size is zero, so it is what " +
            "gives way.)",
        );
      }
    }

    // An uncaught exception during a render means the widget did not render.
    // Fail loudly rather than only logging: a crashed widget still writes a
    // PNG, just an empty one, and on a mostly-dark widget an empty frame
    // reads as a couple of percent of pixel drift. That is how a completely
    // blank kOS terminal once scored 1.90% and looked like a font-hinting
    // nudge. A render error must never be something you catch by eye.
    if (pageErrors.length > 0) {
      const unique = [...new Set(pageErrors)];
      throw new Error(
        `Widget render raised ${pageErrors.length} uncaught error(s); the renders are not trustworthy:\n  ${unique.join("\n  ")}`,
      );
    }
  } finally {
    await browser.close();
  }
}

/**
 * Render every (state × breakpoint) for one or more screen-level views in a
 * single Chromium session. The screen-entry bundle is built once and reused.
 *
 * The defining difference from `renderWidgets`: a screen owns the whole
 * viewport, so this resizes the PAGE viewport per breakpoint (and toggles
 * touch emulation) rather than sizing `#root`. That is what makes a screen's
 * `@media (max-width: …)` / `(pointer: coarse)` rules actually engage,
 * those match against the viewport + device, not an element's box. A fresh
 * browser CONTEXT is created per breakpoint because `hasTouch` is a
 * context-level option (it can't be flipped on a live page).
 */
export async function renderScreens(
  configs: ScreenRenderConfig[],
): Promise<void> {
  if (configs.length === 0) {
    console.error("renderScreens: no screen configs provided");
    process.exit(1);
  }

  const probeHtmlOut = await prepareProbePage({
    ...PROBE_PAGES.screen,
    slug: configs.length === 1 ? configs[0].screenId : "screens",
  });
  const probeUrl = pathToFileURL(probeHtmlOut).toString();

  console.log("Launching Chromium…");
  const browser = await chromium.launch();
  try {
    for (const config of configs) {
      await renderOneScreen(browser, probeUrl, config);
    }
  } finally {
    await browser.close();
  }
}

async function renderOneScreen(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  probeUrl: string,
  config: ScreenRenderConfig,
): Promise<void> {
  const outDir = resolve(LOCAL_DOCS, config.outPath);
  await mkdir(outDir, { recursive: true });
  await cleanArtifacts(outDir, ARTIFACT_EXTS);

  console.log(`\n── screen: ${config.screenId} ──`);
  let count = 0;
  for (const bp of config.breakpoints) {
    // hasTouch is a context-level option, a new context per breakpoint is
    // the only way to flip coarse-pointer emulation. deviceScaleFactor=2
    // mirrors the widget harness for crisp retina-density PNGs.
    const touch = bp.touch ?? bp.width <= 768;
    const context = await browser.newContext({
      viewport: { width: bp.width, height: bp.height },
      deviceScaleFactor: 2,
      hasTouch: touch,
      isMobile: touch,
      // Suppress prefers-reduced-motion-guarded pulses for deterministic shots.
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => {
      console.error("  [page error]", err.message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error("  [console error]", msg.text());
      }
    });

    await installFixedClock(page);
    await page.goto(probeUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __renderScreen?: unknown })
          .__renderScreen === "function",
      undefined,
      { timeout: 10_000 },
    );

    for (const state of config.states) {
      await page.evaluate(
        (p) =>
          (
            window as unknown as {
              __renderScreen: (payload: unknown) => Promise<void>;
            }
          ).__renderScreen(p),
        { screenId: config.screenId, props: state.props },
      );
      const outName = `${state.name}--${bp.name}.png`;
      // Full-page screenshot (not `#root`) so the captured frame is exactly
      // the breakpoint viewport: the whole point of a screen render.
      await page.screenshot({
        path: join(outDir, outName),
        animations: "disabled",
      });
      count++;
    }
    await context.close();
  }
  console.log(`Rendered ${count} screen shots → ${outDir}`);
}

/** Fraction the rendered aspect may drift from the authored one before it counts. */
const ASPECT_TOLERANCE = 0.02;

/**
 * Every `<svg>` under `#root` whose rendered box has lost the aspect ratio its
 * own width/height attributes asked for, reported as
 * `<id> asked W×H (aspect A), got W×H (aspect B) inside <parent> "text"`.
 *
 * This is the failure a screenshot cannot describe and a jsdom snapshot cannot
 * see. An `<svg>` carries the UA's `overflow: hidden`, which by CSS makes its
 * automatic minimum size ZERO, so as a flex item it is the first thing a
 * too-narrow row gives up: it shrinks towards `width: 0` while the sibling text
 * keeps every pixel it asked for. The element stays in the DOM, `visibility:
 * visible`, opacity 1, and paints a sliver or nothing. Both instruments this
 * project approves work with call that a pass, one because it has no layout
 * engine, one because a missing glyph on a dark panel is a handful of pixels.
 *
 * ASPECT is the signal rather than absolute size, because a stylesheet is
 * entitled to override an icon's attributes (`width: 1em`) and does so in both
 * axes: the box changes, the ratio does not. Flex shrink acts on one axis only,
 * so distortion is specific to it. A graphic measuring 0×0 is genuinely hidden,
 * which is a legitimate render, not a defect.
 *
 * Only ABSOLUTE width/height attributes carry a claim about shape. A diagram
 * sized `width="100%" height="100%"` fills whatever box it is given and its
 * attributes say nothing about the ratio, so it is skipped: parsing those as
 * `100`×`100` reported every responsive diagram in the tree as distorted.
 */
async function findCrushedGraphics(page: Page): Promise<string[]> {
  return page.evaluate((tolerance) => {
    const host = document.getElementById("root");
    if (!host) return [] as string[];
    // A regex literal rather than a named arrow helper: tsx's keepNames wraps
    // a named function in a `__name(…)` call that exists only in module scope,
    // and this body is serialized into the page without it.
    const ABSOLUTE = /^\s*\d+(\.\d+)?(px)?\s*$/;
    const out: string[] = [];
    for (const el of Array.from(host.querySelectorAll("svg[width][height]"))) {
      const rawW = el.getAttribute("width") ?? "";
      const rawH = el.getAttribute("height") ?? "";
      const asked = {
        w: ABSOLUTE.test(rawW) ? Number.parseFloat(rawW) : Number.NaN,
        h: ABSOLUTE.test(rawH) ? Number.parseFloat(rawH) : Number.NaN,
      };
      if (!(asked.w > 0) || !(asked.h > 0)) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      const wanted = asked.w / asked.h;
      const got =
        box.height === 0 ? Number.POSITIVE_INFINITY : box.width / box.height;
      if (Math.abs(got - wanted) <= wanted * tolerance) continue;
      const id =
        el.getAttribute("data-marker") ??
        el.getAttribute("data-icon") ??
        el.getAttribute("aria-label") ??
        "svg";
      const parent = el.parentElement;
      const near = (parent?.textContent ?? "").trim().slice(0, 24);
      out.push(
        `${id} asked ${asked.w}×${asked.h} (aspect ${wanted.toFixed(2)}), ` +
          `got ${box.width.toFixed(2)}×${box.height.toFixed(2)} (aspect ${got.toFixed(2)}) ` +
          `inside <${parent?.tagName.toLowerCase() ?? "?"}> "${near}"`,
      );
    }
    return out;
  }, ASPECT_TOLERANCE);
}

/**
 * Pixels two stacked siblings may share before it counts as a collision, big
 * enough to absorb sub-pixel layout rounding and a 1px border sitting on a
 * neighbour's edge, small enough that a line of text landing on a button is
 * always over it.
 */
const OVERLAP_TOLERANCE_PX = 2;

/**
 * Every pair of stacked siblings under `#root` that paint into the same pixels,
 * reported as `<a> "text" ⨯ <b> "text" overlap WxH inside <container>`.
 *
 * Normal flow is a stack: a block container's children, and a column flex
 * container's items, occupy disjoint bands down the page. Two of them sharing
 * pixels means one has painted outside its own box, and the widget is showing
 * an operator two sections at once. That is not a thing a screenshot diff
 * notices on a dark panel, and a jsdom snapshot cannot see it at all, because
 * both sections are present and correct in the markup: only the boxes collide.
 *
 * A container is measured by its PAINTED extent, not its own border box, since
 * the whole failure mode is content escaping a box that was sized too small for
 * it. The walk unions in every descendant's rect and stops descending at any
 * element whose `overflow` clips (`hidden`/`clip`/`auto`/`scroll`), because a
 * clipping ancestor is exactly the promise that its content stays inside.
 *
 * Three kinds of overlap are DELIBERATE and are left out rather than allowed
 * back in one by one:
 *
 * - Out-of-flow children: anything `absolute`/`fixed`/`sticky`, or `relative`
 *   with a real offset, has been told to leave the stack. A badge hung over a
 *   corner and a marker over a dial are both this.
 * - Out-of-flow descendants, for the same reason: a marker drawn over its own
 *   dial must not make the dial overlap the section below it.
 * - Grid and row-flex containers, which are entitled to place two children in
 *   one cell or one column.
 *
 * SVG is skipped outright, container and child alike. Its children are placed
 * by coordinate and layered by document order, so overlap is the medium rather
 * than a defect: the navball's bezel sits over its own horizon ribbon and every
 * marker glyph stacks a dozen shapes. Chromium reports `display: block` for
 * those elements, which is what made them look like a stack.
 */
const HTML_NS = "http://www.w3.org/1999/xhtml";
async function findOverlappingSections(page: Page): Promise<string[]> {
  return page.evaluate(
    ([tolerance, htmlNs]) => {
      const host = document.getElementById("root");
      if (!host) return [] as string[];
      const out: string[] = [];
      const containers: Element[] = [
        host,
        ...Array.from(host.querySelectorAll("*")),
      ];

      for (const container of containers) {
        if (container.namespaceURI !== htmlNs) continue;
        const cs = getComputedStyle(container);
        const stacks =
          cs.display === "block" ||
          cs.display === "flow-root" ||
          cs.display === "list-item" ||
          ((cs.display === "flex" || cs.display === "inline-flex") &&
            cs.flexDirection.startsWith("column"));
        if (!stacks) continue;

        type Box = { x0: number; y0: number; x1: number; y1: number };
        const kids: (Box & { el: Element; boxes: Box[] })[] = [];
        for (const child of Array.from(container.children)) {
          if (child.namespaceURI !== htmlNs) continue;
          const s = getComputedStyle(child);
          if (s.display === "none" || s.visibility === "hidden") continue;
          if (s.float !== "none") continue;
          if (s.position !== "static" && s.position !== "relative") continue;
          if (
            s.position === "relative" &&
            [s.top, s.right, s.bottom, s.left].some(
              (v) => v !== "auto" && v !== "0px",
            )
          ) {
            continue;
          }

          // Painted extent: this element unioned with every in-flow descendant
          // that is not sealed behind a clipping ancestor. An explicit stack
          // rather than recursion, and no named helpers: tsx's keepNames wraps a
          // named function in a `__name(…)` call that exists only in module
          // scope, and this body is serialized into the page without it.
          let x0 = Number.POSITIVE_INFINITY;
          let y0 = Number.POSITIVE_INFINITY;
          let x1 = Number.NEGATIVE_INFINITY;
          let y1 = Number.NEGATIVE_INFINITY;
          const stack: Element[] = [child];
          while (stack.length > 0) {
            const node = stack.pop();
            if (!node) continue;
            const ns = getComputedStyle(node);
            if (ns.display === "none" || ns.visibility === "hidden") continue;
            if (ns.opacity === "0") continue;
            if (
              node !== child &&
              (ns.position === "absolute" ||
                ns.position === "fixed" ||
                ns.position === "sticky")
            ) {
              continue;
            }
            const b = node.getBoundingClientRect();
            if (b.width > 0 && b.height > 0) {
              if (b.left < x0) x0 = b.left;
              if (b.top < y0) y0 = b.top;
              if (b.right > x1) x1 = b.right;
              if (b.bottom > y1) y1 = b.bottom;
            }
            if (
              /hidden|clip|auto|scroll/.test(`${ns.overflowX} ${ns.overflowY}`)
            ) {
              continue;
            }
            for (const grandchild of Array.from(node.children)) {
              stack.push(grandchild);
            }
          }
          if (x1 <= x0 || y1 <= y0) continue;
          // An inline box that has WRAPPED occupies one fragment per line, and
          // `getBoundingClientRect` returns their union: a rectangle covering
          // every line it touches, full container width, describing no area it
          // actually paints. Two such phrases sitting side by side on one line
          // then read as a collision. Where the child is fragmented, compare its
          // fragments instead of that union. Everything else (the overwhelming
          // majority) keeps the one box and the cheap single comparison.
          const fragments = child.getClientRects();
          const boxes =
            fragments.length > 1
              ? Array.from(fragments).map((r) => ({
                  x0: r.left,
                  y0: r.top,
                  x1: r.right,
                  y1: r.bottom,
                }))
              : [{ x0, y0, x1, y1 }];
          kids.push({ el: child, x0, y0, x1, y1, boxes });
        }

        for (let i = 0; i < kids.length; i++) {
          for (let j = i + 1; j < kids.length; j++) {
            const a = kids[i];
            const b = kids[j];
            // Cheap union pre-filter: unions can only over-report, so a miss
            // here is a real miss and the per-fragment pass below never runs.
            if (
              Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) <= tolerance ||
              Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) <= tolerance
            ) {
              continue;
            }
            let ox = 0;
            let oy = 0;
            for (const ab of a.boxes) {
              for (const bb of b.boxes) {
                const fx = Math.min(ab.x1, bb.x1) - Math.max(ab.x0, bb.x0);
                const fy = Math.min(ab.y1, bb.y1) - Math.max(ab.y0, bb.y0);
                if (fx <= tolerance || fy <= tolerance) continue;
                if (fx * fy > ox * oy) {
                  ox = fx;
                  oy = fy;
                }
              }
            }
            if (ox === 0) continue;
            const label = [a, b].map((k) => {
              const tag = k.el.tagName.toLowerCase();
              const text = (k.el.textContent ?? "").replace(/\s+/g, " ").trim();
              // The id when there is one: a pair of unlabelled wrapper divs, or
              // two SVG groups, reports as `<div> "" x <div> ""` and names
              // nothing an author could go and look at.
              const id = k.el.id ? `#${k.el.id}` : "";
              return `<${tag}${id}> "${text.slice(0, 32)}"`;
            });
            out.push(
              `${label[0]} ⨯ ${label[1]} overlap ` +
                `${ox.toFixed(1)}×${oy.toFixed(1)}px inside ` +
                `<${container.tagName.toLowerCase()}>`,
            );
          }
        }
      }
      return out;
    },
    [OVERLAP_TOLERANCE_PX, HTML_NS] as const,
  );
}

/**
 * Plants known layouts in the probe page and checks the overlap detector's
 * verdict on each one, before a single widget is rendered.
 *
 * A detector that cannot see its own failure reports zero and zero reads as a
 * pass, which is the shape of every instrument this project has been burned by.
 * So the run refuses to start unless the detector both FIRES on a deliberately
 * broken stack and STAYS QUIET on each kind of overlap that is somebody's
 * design: an absolutely-positioned badge hung over the section below it, a
 * relatively-offset element shifted onto its neighbour, a grid stacking two
 * children in one cell, and layered SVG shapes.
 *
 * Every case sits in its own absolutely-positioned wrapper. Out-of-flow siblings
 * are never compared to each other, so the case that is SUPPOSED to overflow
 * cannot leak a finding onto the case below it, while the children inside each
 * wrapper are still scanned normally.
 */
async function proveOverlapDetectorWorks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = document.getElementById("root");
    if (!host) throw new Error("Probe: #root missing before the overlap check");
    const box = document.createElement("div");
    box.id = "overlap-detector-selfcheck";
    // Every planted element carries an id, and the id is what the detector's
    // report names. Text alone was not enough: SVG groups have none, so the
    // `quiet-svg` arm silently matched nothing and passed while the detector was
    // reporting 402 SVG overlaps across navball's renders alone.
    //
    // The layered-SVG case sits in a FLEX container, matching every real one: a
    // flex item is blockified, so an svg's default inline display becomes block
    // and the element looks like a stack. In a plain block parent it stays
    // inline, is skipped for THAT reason, and the namespace guard goes untested.
    box.innerHTML = `
      <div style="position:absolute;top:0;left:0;width:200px">
        <div id="fires-overflow" style="height:20px"><div style="height:60px">block</div></div>
        <div id="fires-victim" style="height:40px">below</div>
      </div>
      <div style="position:absolute;top:200px;left:0;width:200px">
        <div id="quiet-badge-host" style="height:20px;position:relative">
          <div style="position:absolute;top:0;height:60px">badge</div>
        </div>
        <div id="quiet-badge-neighbour" style="height:40px">below</div>
      </div>
      <div style="position:absolute;top:400px;left:0;width:200px">
        <div id="quiet-offset" style="height:20px;position:relative;top:40px">shifted</div>
        <div id="quiet-offset-neighbour" style="height:40px">below</div>
      </div>
      <div style="position:absolute;top:600px;left:0;width:200px;display:grid">
        <div id="quiet-grid-a" style="grid-area:1/1;height:40px">a</div>
        <div id="quiet-grid-b" style="grid-area:1/1;height:40px">b</div>
      </div>
      <div style="position:absolute;top:800px;left:0;display:flex">
        <svg width="40" height="40" viewBox="0 0 40 40" aria-label="layered">
          <g id="quiet-svg-under"><rect width="40" height="40" fill="#111"></rect></g>
          <g id="quiet-svg-over"><circle cx="20" cy="20" r="18" fill="#222"></circle></g>
        </svg>
      </div>`;
    host.appendChild(box);
  });
  const found = await findOverlappingSections(page);
  await page.evaluate(() =>
    document.getElementById("overlap-detector-selfcheck")?.remove(),
  );

  const fired = found.some(
    (f) => f.includes("fires-overflow") && f.includes("fires-victim"),
  );
  const misfired = found.filter((f) => f.includes("quiet-"));
  if (!fired) {
    throw new Error(
      "The stacked-overlap detector is BLIND: a deliberately broken stack " +
        "(a 60px block inside a 20px box, painting onto the section below it) " +
        "was not reported, so a clean run proves nothing about the widgets.\n" +
        `What it did report: ${found.length === 0 ? "nothing" : found.join("; ")}`,
    );
  }
  if (misfired.length > 0) {
    throw new Error(
      "The stacked-overlap detector reported overlap that is somebody's " +
        "design, so its verdict on a widget cannot be trusted either:\n  " +
        misfired.join("\n  "),
    );
  }
}

/**
 * Everything a run collects across every widget and reports once at the end.
 *
 * Collected rather than thrown on the spot, and `mounts` is why that matters
 * beyond tidiness: one stale interaction selector used to abort the whole
 * session, so `astronaut-complex` failing its Fire click meant 17 of 45 widget
 * configs rendered and the other 28 were never gated or compared to a baseline. In the `visual` job, which is red on purpose, that is invisible. A
 * run now surveys the WHOLE set and fails at the end holding all of it.
 */
interface RenderFindings {
  /** Graphics laid out at zero width or height (the paint gate). */
  crushedGraphics: string[];
  /** Stacked siblings painting into the same pixels. */
  overlaps: string[];
  /** Renders that never happened: a throw out of `__renderProbe`. */
  mounts: string[];
}

function noFindings(): RenderFindings {
  return { crushedGraphics: [], overlaps: [], mounts: [] };
}

async function renderOneWidget(
  page: Page,
  config: WidgetRenderConfig,
  outSuffix = "",
  outBase: string = LOCAL_DOCS,
  fullContent = false,
  findings: RenderFindings = noFindings(),
): Promise<void> {
  const fixturesDir = resolve(COMPONENTS_SRC, config.fixturesPath);
  const outDir = resolve(outBase, config.outPath);

  await mkdir(outDir, { recursive: true });
  await cleanArtifacts(outDir, ARTIFACT_EXTS, (name) =>
    artifactMatchesSuffix(name, outSuffix),
  );

  const fixtureFiles = (await readdir(fixturesDir)).filter((e) =>
    e.endsWith(".json"),
  );
  if (fixtureFiles.length === 0) {
    console.error(`[${config.widgetId}] No fixtures found in ${fixturesDir}`);
    return;
  }

  const fixtures: { name: string; data: Record<string, unknown> }[] = [];
  for (const file of fixtureFiles) {
    const raw = await readFile(join(fixturesDir, file), "utf8");
    fixtures.push({
      name: file.replace(/\.json$/, ""),
      data: JSON.parse(raw) as Record<string, unknown>,
    });
  }

  console.log(`\n── ${config.widgetId} ──`);
  let count = 0;
  for (const fixture of fixtures) {
    // Fixtures may include an `_series` block keyed by data-source key,
    // each entry an array of {t, v} samples. The harness lifts that out
    // of the fixture and into the probe payload so useDataSeries-backed
    // sparklines / live trace dots render with seeded history.
    const seriesData = (
      fixture.data as { _series?: Record<string, readonly ProbeSeriesSample[]> }
    )._series;
    for (const mode of config.modes) {
      if (mode.forFixtures && !mode.forFixtures.includes(fixture.name)) {
        continue;
      }
      const pxW = mode.w * COL_WIDTH + (mode.w - 1) * GRID_MARGIN;
      const pxH = mode.h * ROW_HEIGHT + (mode.h - 1) * GRID_MARGIN;
      const payload: ProbePayload = {
        widgetId: config.widgetId,
        fixture: fixture.data,
        w: mode.w,
        h: mode.h,
        pxW,
        pxH,
        config: mode.config,
        series: seriesData,
        clicks: mode.clicks,
      };
      try {
        await page.evaluate(
          (p) =>
            (
              window as unknown as {
                __renderProbe: (payload: ProbePayload) => Promise<void>;
              }
            ).__renderProbe(p),
          payload as unknown as Record<string, unknown>,
        );
      } catch (err) {
        // Record and move to the next mode. A mount that threw produced no
        // widget, so every step below it (the gates, the screenshot) would be
        // measuring the previous render's DOM and reporting it under this
        // mode's name.
        findings.mounts.push(
          `${config.widgetId} @ ${mode.name} (${fixture.name}): ` +
            (err instanceof Error ? err.message.split("\n")[0] : String(err)),
        );
        continue;
      }
      // Full-content capture (review path): grow `#root` until nothing is
      // clipped, so the PNG shows the WHOLE widget, not a tile-height crop.
      // Content can hide in two places, behind the Panel's `overflow:hidden`,
      // or inside a ScrollArea's `overflow:auto`: so we measure both (the
      // Panel is `#root`'s first child; ScrollArea inners carry a stable
      // `data-scroll-area-inner` attribute) and grow to swallow the larger
      // overflow, iterating to a fixpoint since growing the box can reveal a
      // little more. The mount already laid out at the real tile WIDTH, so
      // responsive breakpoints stay honest: only the vertical crop is lifted.
      // OFF for the visual gate, so its per-tile baselines are unaffected.
      if (fullContent) {
        // NB: no named `const fn = () => …` helpers inside this evaluate,
        // tsx's keepNames wraps them with a `__name(…)` helper that is only
        // defined in the module scope, not the serialized page context, so a
        // named arrow here throws "__name is not defined". Keep it inline.
        await page.evaluate(() => {
          const el = document.getElementById("root");
          if (!el) return;
          el.style.overflow = "visible";
          for (let i = 0; i < 8; i++) {
            const nodes = [
              el,
              el.firstElementChild,
              ...document.querySelectorAll("[data-scroll-area-inner]"),
            ];
            let need = 0;
            for (const n of nodes) {
              if (n) need = Math.max(need, n.scrollHeight - n.clientHeight);
            }
            if (need <= 1) break;
            el.style.height = `${el.clientHeight + need}px`;
            // Force a synchronous reflow so the next iteration sees new sizes.
            void el.offsetHeight;
          }
        });
        // Let ResizeObserver-driven bits (ScrollArea glow, Gauge/Tape sizing)
        // settle at the final height before the shot.
        await page.evaluate(
          () =>
            new Promise<void>((res) => {
              requestAnimationFrame(() => requestAnimationFrame(() => res()));
            }),
        );
        await page.waitForTimeout(150);
      }
      // Scroll the body past its header so the title ghost fades in. Applied
      // after any fullContent grow (where it becomes a no-op, nothing
      // overflows) and before the shot. Dispatches a scroll event so the
      // ghost's scroll observer fires, then settles a frame. reducedMotion is
      // emulated at the context, so the ghost's JS-gated fade collapses to an
      // instant show and the capture is deterministic.
      if (mode.scroll !== undefined) {
        await page.evaluate((top) => {
          const el = document.querySelector(
            "[data-panel-body]",
          ) as HTMLElement | null;
          if (!el) return;
          el.scrollTop = top;
          el.dispatchEvent(new Event("scroll"));
        }, mode.scroll);
        await page.evaluate(
          () =>
            new Promise<void>((res) => {
              requestAnimationFrame(() => requestAnimationFrame(() => res()));
            }),
        );
      }
      if (
        config.mustBeVisible &&
        !fullContent &&
        !(config.mustBeVisible.mayScroll ?? []).includes(mode.name)
      ) {
        // Measured in the page, after layout, because that is the only place
        // this property exists at all.
        const clipped = await page.evaluate((selector) => {
          const host = document.getElementById("root");
          if (!host) return [] as string[];
          const limit = host.getBoundingClientRect().bottom;
          const out: string[] = [];
          for (const el of Array.from(document.querySelectorAll(selector))) {
            const box = el.getBoundingClientRect();
            // A hidden element has no box and is not a clipping failure; a
            // visible one must END above the panel's own bottom edge.
            if (box.height === 0) continue;
            if (box.bottom > limit + 0.5) {
              out.push((el.textContent ?? "").trim().slice(0, 60));
            }
          }
          return out;
        }, config.mustBeVisible.selector);
        if (clipped.length > 0) {
          throw new Error(
            `${config.widgetId} @ ${mode.name} (${fixture.name}): ` +
              `${clipped.length} element(s) matching "${config.mustBeVisible.selector}" ` +
              "are cut off by the panel edge, so they render but cannot be read:\n  " +
              clipped.join("\n  ") +
              "\n(This widget declares mustBeVisible because a DOM assertion " +
              "cannot see the fold. If this mode is genuinely too small to hold " +
              "the content, add it to mustBeVisible.mayScroll.)",
          );
        }
      }
      for (const crushed of await findCrushedGraphics(page)) {
        findings.crushedGraphics.push(
          `${config.widgetId} @ ${mode.name} (${fixture.name}): ${crushed}`,
        );
      }
      for (const overlap of await findOverlappingSections(page)) {
        findings.overlaps.push(
          `${config.widgetId} @ ${mode.name} (${fixture.name}): ${overlap}`,
        );
      }
      const root = await page.$("#root");
      if (!root) throw new Error("Probe: #root missing after render");
      const outName = `${fixture.name}--${mode.name}${outSuffix}.png`;
      const outPath = join(outDir, outName);
      /*
       * `PROBE_DUMP_DOM=<css selector>` writes each match's outerHTML, and the
       * computed value of every property named in `PROBE_DUMP_STYLE`, beside
       * the PNG.
       *
       * A screenshot cannot tell DOM that is absent from DOM that is painted
       * invisibly, and those two have unrelated causes. The dump is the
       * instrument that separates them.
       */
      const dumpSelector = process.env.PROBE_DUMP_DOM;
      if (dumpSelector) {
        const dumped = await page.evaluate(
          ([selector, styleProps]) => {
            const props = styleProps ? styleProps.split(",") : [];
            return Array.from(document.querySelectorAll(selector)).map((el) => {
              const computed = getComputedStyle(el);
              const box = el.getBoundingClientRect();
              return {
                html: el.outerHTML,
                box: `${box.width}x${box.height} @ ${box.left},${box.top} scroll=${el.scrollWidth}x${el.scrollHeight} client=${el.clientWidth}x${el.clientHeight}`,
                style: props
                  .map(
                    (p) => `${p.trim()}=${computed.getPropertyValue(p.trim())}`,
                  )
                  .join(" "),
              };
            });
          },
          [dumpSelector, process.env.PROBE_DUMP_STYLE ?? ""] as const,
        );
        const dumpPath = outPath.replace(/\.png$/, ".dom.txt");
        await writeFile(
          dumpPath,
          `selector: ${dumpSelector}\nmatches: ${dumped.length}\n\n` +
            dumped
              .map(
                (d, i) =>
                  `── match ${i} ──\nbox: ${d.box}\nstyle: ${d.style}\n${d.html}\n`,
              )
              .join("\n"),
          "utf8",
        );
        console.log(`  dom dump → ${dumpPath} (${dumped.length} matches)`);
      }
      // animations:"disabled" cancels any still-running CSS animation to its
      // initial state and fast-forwards finite transitions, so the capture is
      // deterministic even for anything not covered by reducedMotion.
      await root.screenshot({ path: outPath, animations: "disabled" });
      count++;
    }
  }
  console.log(`Rendered ${count} widget shots → ${outDir}`);
}

export interface PreparePageOpts {
  /** esbuild entry point (probe-entry.tsx or screen-entry.tsx). */
  entry: string;
  /** HTML template path with the `probe-theme` style + script placeholder. */
  htmlTemplate: string;
  /** The exact `<script …></script>` string in the template to replace with
   *  the inlined bundle. */
  scriptSrcPlaceholder: string;
  /** Filename slug for the tmpdir HTML. */
  slug: string;
}

/**
 * A widget's own bare `import "some.css"` (e.g. `@xterm/xterm/css/xterm.css`
 * in the kOS terminal) needs to actually land in the page as a `<style>` tag,
 * `loader: "text"` alone just turns the file into an inert string module
 * that nothing reads, which esbuild's tree-shaking then elides outright
 * whenever the imported package declares `sideEffects: false` (as
 * `@xterm/xterm` does), producing an "ignored bare import" warning and a
 * fully unstyled render. This plugin rewrites every `.css` import into a JS
 * module whose OWN top-level code appends a `<style>` tag with the file's
 * contents, and marks the resolved import `sideEffects: true` so esbuild
 * never drops it regardless of the source package's own declaration.
 */
const cssSideEffectPlugin: Plugin = {
  name: "css-side-effect",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\.css$/ }, (args) => {
      // Resolve via NODE's own resolver (the same `require.resolve` approach
      // `jetbrainsMonoFontFace` below uses for its woff2 files) rather than
      // `pluginBuild.resolve()`. The latter re-enters esbuild's onResolve
      // pipeline: including THIS callback, which matches the same `.css`
      // filter: and esbuild does not dedupe that self-recursion; it hung /
      // crashed the esbuild service (goroutine explosion) the first time
      // this plugin ran against a real `.css` import.
      const resolvedPath = require.resolve(args.path, {
        paths: [args.resolveDir],
      });
      return { path: resolvedPath, sideEffects: true };
    });
    pluginBuild.onLoad({ filter: /\.css$/ }, async (args) => {
      const css = await readFile(args.path, "utf8");
      return {
        loader: "js",
        contents: `const __style = document.createElement("style");
__style.textContent = ${JSON.stringify(css)};
document.head.appendChild(__style);`,
      };
    });
  },
};

/** Build a probe bundle, inline it + the theme CSS into the HTML template,
 *  write to tmpdir. Shared by the widget and screen render paths, they
 *  differ only in entry point + HTML template. Returns the generated HTML
 *  path. */
export async function prepareProbePage(opts: PreparePageOpts): Promise<string> {
  console.log(`Bundling ${opts.entry} with esbuild…`);
  const bundleResult = await build({
    entryPoints: [opts.entry],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    sourcemap: "inline",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [cssSideEffectPlugin],
  });
  const bundleJs = bundleResult.outputFiles[0].text;

  const htmlTemplate = await readFile(opts.htmlTemplate, "utf8");
  const themeCss = themeTokens(await readFile(THEME_TOKENS_CSS, "utf8"));
  const fontFace = await jetbrainsMonoFontFace();

  // Inline-script payload may contain `</script>` (rare but possible in
  // bundled React code embedded as strings); escape so the host page
  // doesn't terminate the script tag early. Use a function-form `.replace`
  // so the replacement string is treated literally, String.replace's
  // string form interprets `$&`, `$1`, etc. as backreferences, which would
  // corrupt the bundle (React's sanitisation helpers use `$&` extensively).
  const escapedBundle = bundleJs.replace(/<\/script/gi, "<\\/script");
  const htmlWithBundle = htmlTemplate
    .replace(
      /<style id="probe-theme">[\s\S]*?<\/style>/,
      () => `<style id="probe-theme">${fontFace}${themeCss}</style>`,
    )
    .replace(
      opts.scriptSrcPlaceholder,
      () => `<script type="module">${escapedBundle}</script>`,
    );

  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-probe-${opts.slug}-${process.pid}.html`,
  );
  await writeFile(probeHtmlOut, htmlWithBundle, "utf8");
  return probeHtmlOut;
}

/** Inline JetBrains Mono as a data-URI @font-face so file:// renders use the
 *  locked font deterministically, matching the app's self-hosted face. */
async function jetbrainsMonoFontFace(): Promise<string> {
  // @fontsource ships the woff2 under files/. Resolve via the package.
  const regular = require.resolve(
    "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
  );
  const bold = require.resolve(
    "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2",
  );
  const b64 = async (p: string) => (await readFile(p)).toString("base64");
  return `
    @font-face{font-family:"JetBrains Mono";font-weight:400;font-style:normal;
      src:url(data:font/woff2;base64,${await b64(regular)}) format("woff2");}
    @font-face{font-family:"JetBrains Mono";font-weight:700;font-style:normal;
      src:url(data:font/woff2;base64,${await b64(bold)}) format("woff2");}
  `;
}

/**
 * tokens.css verbatim, checked to actually declare tokens.
 *
 * The whole file rather than its first `:root` block, because the file's
 * `@media (pointer: coarse)` overrides live outside that block and
 * `renderScreens` emulates touch per breakpoint precisely so coarse-pointer
 * rules engage: injecting one block silently rendered every touch breakpoint at
 * desktop font sizes, which is the one thing the emulation exists to exercise.
 */
function themeTokens(css: string): string {
  if (!/--[a-z0-9-]+\s*:/.test(css)) {
    throw new Error("tokens.css: no custom properties found");
  }
  return css;
}

/** Wipe stale artifacts from the output dir before regenerating. Only
 *  touches top-level files whose extension is in the allowlist so a stray
 *  sibling directory is never recursively destroyed. */
async function cleanArtifacts(
  dir: string,
  allow: ReadonlySet<string>,
  matches: (name: string) => boolean = () => true,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const dot = entry.name.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = entry.name.slice(dot).toLowerCase();
    if (!allow.has(ext)) continue;
    if (!matches(entry.name)) continue;
    await rm(join(dir, entry.name));
    removed++;
  }
  if (removed > 0) {
    console.log(`Cleaned ${removed} stale artifact(s) from ${dir}`);
  }
}
