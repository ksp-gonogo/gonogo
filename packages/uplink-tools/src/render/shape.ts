import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * What a rendered asset is, in a form two machines can compare.
 *
 * A docs page whose content is pictures had a gate that read the prose. `docs
 * --check` compared the README, the manifest and the asset filenames, and said
 * nothing about whether the images were rendered from today's code: Vehicle
 * Assembly's page showed a layout the code had stopped producing for five
 * commits, green throughout, and a re-render then changed thirty assets nobody
 * had touched.
 *
 * The obvious answer, comparing the pixels, cannot work. Rasterisation is
 * per-engine and per-OS, which is why the visual baselines are generated on
 * Linux and never accepted from a developer's machine. The obvious fallback,
 * requiring the assets to be newer than any commit touching the kit, is
 * OS-independent and useless: it fires on every kit change whether the picture
 * moved or not, so it is red forever and gets muted.
 *
 * ## The split this file is built on
 *
 * A shape carries the things the CSS cascade **computes** and excludes the things
 * a glyph rasteriser **measures**.
 *
 * Admissible, because a browser derives them from the stylesheet and the DOM:
 * element order, the attributes below, text content, and the computed properties
 * in `ADMISSIBLE_PROPERTIES`. `padding: 8px` computes to `8px` everywhere;
 * `flex-shrink: 0` computes to `0`; `font-family` computes to the specified
 * stack rather than the face that won, so it is a fact about the stylesheet.
 *
 * Inadmissible, because a browser derives them from glyph advances and hinting:
 * `getBoundingClientRect`, `offsetWidth`/`offsetHeight`, `scrollHeight`, any
 * length authored in `ch` or `em` (`min-width: 12ch` computed to `120.938px` in
 * chromium, `121px` in firefox and `117.1875px` in webkit), the px `line-height:
 * normal` resolves to, and the resolved track widths of a grid whose tracks are
 * content-sized.
 *
 * Measured against representative kit markup in all three engines on one
 * machine: every admissible field identical, every inadmissible one different.
 * Three layout engines and three font stacks is a harder test than one engine
 * across two operating systems, so agreement there is the evidence this rests
 * on. `scripts/uplink-shape-engines.mjs` is that measurement, kept runnable.
 *
 * Note `render-probe.tsx` already computes a `signature`, and this is a sibling
 * rather than a reuse: that one hashes `Math.round(box.width)` per element,
 * which is exactly the inadmissible half. It is right for its own job, comparing
 * a fed render against a starved one inside a single run, where both sides come
 * out of the same browser.
 *
 * ## The second consumer, which is the point
 *
 * A regeneration used to be committed back by a workflow that discarded every
 * modified asset, keeping only additions and deletions, so it had never once
 * healed a stale asset. The reasoning was sound and the rule was under-informed:
 * a motion scene's GIF re-encodes to different bytes from an unchanged tree, so
 * committing byte changes would push a churn commit on every run forever. It had
 * no way to tell that from a real one. The shape is that predicate. Shape
 * changed, it is stale; shape identical and bytes moved, it is not.
 */

/**
 * The computed style properties a picture's shape records: those whose value is
 * a fact about the stylesheet and not about the width of a glyph. Useful for
 * telling a restyled widget from an unchanged one without comparing pixels.
 * Read by the render driver when it captures a shape. Add a property only after
 * `uplink-shape-engines.mjs` agrees across all three engines.
 */
export const ADMISSIBLE_PROPERTIES = [
  "color",
  "background-color",
  "background-image",
  "display",
  "position",
  "visibility",
  "opacity",
  "overflow",
  "overflow-x",
  "overflow-y",
  "z-index",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-items",
  "justify-content",
  "gap",
  "row-gap",
  "column-gap",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-overflow",
  "text-decoration-line",
  "white-space",
  "box-shadow",
] as const;

/**
 * The attributes a picture's shape records, as a regular expression source so
 * it can be passed into the page. They are `style` and the SVG geometry
 * attributes, where a widget puts the numbers it means (a coverage bar's width,
 * a gauge needle's transform), `title`, which a kit primitive carries whenever
 * text can be truncated, and every `aria-` and `data-` attribute. Useful for
 * telling a widget whose layout changed from one that did not. Read by the
 * render driver when it captures a shape.
 */
export const RECORDED_ATTRIBUTES =
  "^(style|title|role|type|disabled|hidden|open|checked|d|points|cx|cy|r|x|y|x1|y1|x2|y2|rx|ry|transform|viewBox|fill|stroke|stroke-width|stroke-dasharray|offset|stop-color)$|^(aria|data)-";

/**
 * The name of the shape record file, committed beside the pictures it
 * describes. Useful for finding the record the page check compares a fresh
 * render against. Used by the `docs` command and {@link readShapeRecord}.
 *
 * @category Shape records
 */
export const SHAPE_RECORD_FILE = "render-shape.json";

/**
 * One reading of the mounted widget: its shape text, element count and visible
 * text. A still folds one reading, a motion scene one per frame. Useful for
 * building the shape of a picture. Taken by {@link foldShape}.
 */
export interface ShapeCapture {
  text: string;
  elements: number;
  visibleText: string;
}

/**
 * What one picture's render reduces to: a hash of its shape, how many elements
 * it holds and a hash of its visible text. Useful for telling a content change
 * from a styling change without keeping the text. Returned by the shape folding
 * step, held in {@link ShapeRecord} and compared by {@link compareShapes}.
 *
 * @category Shape records
 */
export interface AssetShape {
  /** sha256 of the shape text, first 16 hex. */
  hash: string;
  /** Elements walked. Named so a mismatch can say the tree grew. */
  elements: number;
  /** sha256 of the visible text alone, first 8 hex. Splits a content change
   *  from a styling change without keeping the text itself. */
  text: string;
}

/**
 * The committed shape of every rendered picture, with the engine and format
 * version it was taken in. Useful for telling a page that no longer matches the
 * code without comparing pixels. Read by {@link readShapeRecord} and compared
 * against a fresh render by {@link compareShapes}.
 *
 * @category Shape records
 * @categoryDescription Shape records
 * The recorded shape of every rendered picture, which lets the page check tell
 * a page that no longer matches the code without comparing pixels.
 */
export interface ShapeRecord {
  /** Changes when the recorded properties change, so an old record is not compared against a new walk. */
  version: number;
  /** The engine the shapes were taken in. A record from another engine is not
   *  comparable and the check refuses rather than failing. */
  engine: string;
  /** The shape of each picture, by file. */
  assets: Record<string, AssetShape>;
}

/**
 * The version of the {@link ShapeRecord} format this package writes. Useful for
 * refusing to compare a record made by a different set of recorded properties.
 * Used by {@link compareShapes} and the `docs` command when it writes a record.
 *
 * @category Shape records
 */
export const SHAPE_RECORD_VERSION = 1;

/**
 * Reads the mounted widget in the page and returns its shape text, element
 * count and visible text. Useful for recording what a picture is made of. Used
 * by the render driver.
 *
 * It is passed to `tab.evaluate`, so it closes over nothing and takes the
 * property and attribute lists as arguments. `#root` itself is walked past and
 * not recorded, because its inline height is a measurement of the content.
 */
export const readShapeText = (args: {
  properties: readonly string[];
  attributes: string;
}): ShapeCapture => {
  const host = document.getElementById("root");
  if (!host) throw new Error("render shape: no #root in the page");
  const attrRe = new RegExp(args.attributes);
  // Engines serialise a wide-gamut colour to different last digits: the same
  // theme token came out `color(srgb 0.636078 ...)` in chromium and
  // `color(srgb 0.636079 ...)` in firefox, and that one digit alone made every
  // asset's shape differ between the two. It is the same colour, and no change
  // anybody could see in a picture lives in the fourth decimal place, so the
  // text is normalised to three before it is hashed.
  const round = (text: string): string =>
    text.replace(/\d+\.\d{4,}/g, (n) => String(Math.round(+n * 1000) / 1000));
  /**
   * A React `useId` is a page-wide mount counter, and every scene renders in
   * one page, so the raw value depends on how many components mounted in the
   * scenes before this one. Each distinct id is renamed `:id<n>:` by first
   * appearance in this capture, which keeps a pair that references one id
   * linked. React 18 writes `:r<n>:` on the client and `:R<tree>H<n>:` when
   * hydrating, both in base 32.
   */
  const reactIds = new Map<string, string>();
  const canonicalIds = (text: string): string =>
    text.replace(/:(?:r[0-9a-v]+|R[0-9a-v]+(?:H[0-9a-v]+)?):/g, (id) => {
      const seen = reactIds.get(id);
      if (seen !== undefined) return seen;
      const named = `:id${reactIds.size}:`;
      reactIds.set(id, named);
      return named;
    });
  const lines: string[] = [];
  const texts: string[] = [];
  let elements = 0;

  const skip = new Set(["STYLE", "SCRIPT"]);
  const walk = (el: Element, path: string): void => {
    // xterm injects its own stylesheet into the widget, so a naive walk records a page of CSS selectors as text.
    if (
      skip.has(el.tagName) ||
      el.hasAttribute("data-unit-word") ||
      el.hasAttribute("data-unit-currency")
    ) {
      return;
    }
    elements++;
    const attrs = Array.from(el.attributes)
      .filter((a) => attrRe.test(a.name))
      .map((a) => `${a.name}=${a.value}`)
      .sort()
      .map(canonicalIds);
    const style = getComputedStyle(el);
    lines.push(
      round(
        `${path} ${el.tagName.toLowerCase()}` +
          (attrs.length > 0 ? ` [${attrs.join(";")}]` : "") +
          ` {${args.properties.map((p) => `${p}:${style.getPropertyValue(p)}`).join(";")}}`,
      ),
    );
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== 3) continue;
      const t = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t.length > 0) {
        lines.push(`${path} "${t}"`);
        texts.push(t);
      }
    }
    const kids = Array.from(el.children);
    for (let i = 0; i < kids.length; i++) {
      walk(kids[i] as Element, `${path}/${i}`);
    }
  };

  const roots = Array.from(host.children);
  for (let i = 0; i < roots.length; i++) {
    walk(roots[i] as Element, `${i}`);
  }
  return { text: lines.join("\n"), elements, visibleText: texts.join(" ") };
};

/**
 * Finishes every finite animation and transition in the page, and returns how
 * many it finished and a description of each animation that never ends. Useful
 * for reading a computed style that is the settled value the picture shows and
 * not a point on a transition. Used by the render driver before it captures a
 * shape.
 *
 * Finite animations are finished and not cancelled, to match the screenshot. An
 * animation with no end cannot be finished and is reported. It is passed to
 * `tab.evaluate`, so it closes over nothing.
 */
export const settleAnimations = (): { finished: number; endless: string[] } => {
  // `transitionProperty` is on CSSTransition, `animationName` on CSSAnimation
  // and `target` on KeyframeEffect, none of which the base types declare. Read
  // rather than asserted, because a stand-in in a test has neither prototype.
  const read = (host: object, key: string): unknown => Reflect.get(host, key);
  const word = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

  const describe = (animation: Animation): string => {
    const what =
      word(read(animation, "transitionProperty")) ??
      word(read(animation, "animationName")) ??
      "an animation";
    const effect = animation.effect;
    const target = effect === null ? undefined : read(effect, "target");
    const tag =
      typeof target === "object" && target !== null
        ? word(read(target, "tagName"))
        : undefined;
    return tag === undefined ? what : `${tag.toLowerCase()} ${what}`;
  };

  const endless: string[] = [];
  let finished = 0;
  for (const animation of document.getAnimations()) {
    const timing = animation.effect?.getComputedTiming();
    const ends =
      timing !== undefined &&
      timing.iterations !== Number.POSITIVE_INFINITY &&
      Number.isFinite(Number(timing.endTime ?? Number.POSITIVE_INFINITY));
    if (!ends) {
      endless.push(describe(animation));
      continue;
    }
    try {
      animation.finish();
      finished++;
    } catch {
      // An animation can refuse to finish (an unresolved effect end), and one that refuses is one still moving, so it belongs in the same bucket.
      endless.push(describe(animation));
    }
  }
  return { finished, endless };
};

const digest = (input: string, chars: number): string =>
  createHash("sha256").update(input).digest("hex").slice(0, chars);

/**
 * Folds one or more captures into the shape of a single picture. A still has
 * one capture; a motion scene has one per frame, so a step that stopped firing
 * changes its shape. Useful for recording what a picture is made of. Used by
 * the render driver.
 */
export function foldShape(captures: readonly ShapeCapture[]): AssetShape {
  return {
    hash: digest(captures.map((c) => c.text).join("\n--frame--\n"), 16),
    elements: captures[0]?.elements ?? 0,
    text: digest(captures.map((c) => c.visibleText).join(" | "), 8),
  };
}

/**
 * The shape record in `assetDir`, or `undefined` when there is none. Useful for
 * finding out how the committed pictures looked when they were generated. Used
 * by the `docs` command's check.
 *
 * @category Shape records
 */
export function readShapeRecord(assetDir: string): ShapeRecord | undefined {
  const file = join(assetDir, SHAPE_RECORD_FILE);
  if (!existsSync(file)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof Reflect.get(parsed, "version") !== "number" ||
    typeof Reflect.get(parsed, "assets") !== "object"
  ) {
    throw new Error(`${file} is not a shape record`);
  }
  return parsed as ShapeRecord;
}

export async function writeShapeRecord(
  assetDir: string,
  record: ShapeRecord,
): Promise<void> {
  // Keys sorted so a regeneration that changes nothing produces no diff.
  const assets: Record<string, AssetShape> = {};
  for (const name of Object.keys(record.assets).sort()) {
    assets[name] = record.assets[name] as AssetShape;
  }
  await writeFile(
    join(assetDir, SHAPE_RECORD_FILE),
    `${JSON.stringify({ ...record, assets }, null, 2)}\n`,
    "utf8",
  );
}

/**
 * What {@link compareShapes} found: the pictures that changed, the ones with no
 * recorded shape and, when the record cannot be compared at all, the reason.
 * Useful for telling the author which committed pictures are stale. Returned by
 * `compareShapes` and read by the `docs` command's check.
 *
 * @category Shape records
 */
export interface ShapeVerdict {
  /** Assets whose render no longer matches what was committed. */
  stale: { file: string; was: AssetShape; now: AssetShape }[];
  /** Assets with no recorded shape, so nothing can be said about them. */
  unrecorded: string[];
  /** Set when the record cannot be compared at all, with the reason. */
  incomparable?: string;
}

/**
 * Compares today's render against the committed shape record. A picture with no
 * recorded shape is listed as `unrecorded`, never as `stale`. Useful for
 * telling the author which pictures no longer match the code. Used by the
 * `docs` command's check.
 *
 * @category Shape records
 */
export function compareShapes(
  record: ShapeRecord | undefined,
  rendered: ReadonlyMap<string, AssetShape>,
  engine: string,
): ShapeVerdict {
  if (!record) {
    return { stale: [], unrecorded: [...rendered.keys()].sort() };
  }
  if (record.version !== SHAPE_RECORD_VERSION) {
    return {
      stale: [],
      unrecorded: [],
      incomparable:
        `the record is version ${record.version} and this build writes ` +
        `${SHAPE_RECORD_VERSION}, so the two walks are not the same walk. ` +
        "Regenerate with `uplink-tools docs`, on Linux.",
    };
  }
  if (record.engine !== engine) {
    return {
      stale: [],
      unrecorded: [],
      incomparable:
        `the record was taken in ${record.engine} and this run used ${engine}. ` +
        "Shapes agree across engines by design, but a mismatch here means one " +
        "of the two is not the engine the page's images were rendered in, so " +
        "the comparison is not the one anybody wants.",
    };
  }
  const stale: ShapeVerdict["stale"] = [];
  const unrecorded: string[] = [];
  for (const file of [...rendered.keys()].sort()) {
    const was = record.assets[file];
    const now = rendered.get(file) as AssetShape;
    if (!was) {
      unrecorded.push(file);
      continue;
    }
    if (was.hash !== now.hash) stale.push({ file, was, now });
  }
  return { stale, unrecorded };
}

/**
 * Why one picture's render no longer matches its recorded shape: the element
 * count that changed, the visible text that changed, or styling alone. Useful
 * for telling the author what to look at in a stale picture. Used by the `docs`
 * command's check for each entry of a {@link ShapeVerdict}.
 *
 * @category Shape records
 */
export function describeStale(entry: {
  file: string;
  was: AssetShape;
  now: AssetShape;
}): string {
  const { file, was, now } = entry;
  const why: string[] = [];
  if (was.elements !== now.elements) {
    why.push(`${was.elements} elements became ${now.elements}`);
  }
  if (was.text !== now.text) why.push("the visible text changed");
  if (why.length === 0) why.push("styling changed, the tree and text did not");
  return (
    `${file}: the committed picture is not what this code renders ` +
    `(${why.join("; ")}; shape ${was.hash} became ${now.hash})`
  );
}
