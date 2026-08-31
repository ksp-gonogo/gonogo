import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * What a rendered asset IS, in a form two machines can compare.
 *
 * A docs page whose content is pictures had a gate that read the prose. `docs
 * --check` compared the README, the manifest and the asset FILENAMES, and said
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
 * `flex-shrink: 0` computes to `0`; `font-family` computes to the SPECIFIED
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
 * `uplink-docs.yml` regenerates every page and commits the result back, and its
 * commit-back discarded every MODIFIED asset, keeping only additions and
 * deletions. So the self-heal had never once healed a stale asset. The reasoning
 * was sound and the rule was under-informed: a motion scene's GIF re-encodes to
 * different bytes from an unchanged tree, so committing byte changes would push
 * a churn commit on every run forever. It had no way to tell that from a real
 * one. The shape is that predicate. Shape changed, commit it; shape identical
 * and bytes moved, discard it as before.
 */

/**
 * Computed properties whose value is a fact about the stylesheet.
 *
 * Add to this list freely and only after `uplink-shape-engines.mjs` agrees
 * across all three engines. Anything whose value can be traced back to the width
 * of a glyph belongs in the doc comment above as an exclusion, not here.
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
 * Attributes worth recording, as a regex source so it survives the trip into the
 * page.
 *
 * `style` and the SVG geometry attributes are here because that is where a
 * widget puts the numbers it means: a coverage bar's length is
 * `style="width: 42%"` and a gauge needle is a `d` or a `transform`, and both are
 * silent in `textContent`. They are AUTHORED numbers, which is what makes them
 * admissible where a measured box is not.
 *
 * `title` is here because a kit primitive reaches for it whenever text can be
 * truncated, so it appears and disappears with a layout decision: `RowName` and
 * `Panel`'s compacted title both carry the full string in one when the visible
 * text is an ellipsis. A change that alters what fits therefore shows up in this
 * attribute before it shows up anywhere else that is admissible.
 */
export const RECORDED_ATTRIBUTES =
  "^(style|title|role|type|disabled|hidden|open|checked|aria-|data-|d|points|cx|cy|r|x|y|x1|y1|x2|y2|rx|ry|transform|viewBox|fill|stroke|stroke-width|stroke-dasharray|offset|stop-color)$";

/** Committed beside the assets it describes. */
export const SHAPE_RECORD_FILE = "render-shape.json";

/** One reading of the mounted widget. A still folds one, a film folds one per
 *  frame. */
export interface ShapeCapture {
  text: string;
  elements: number;
  visibleText: string;
}

/** What one asset's render reduces to. */
export interface AssetShape {
  /** sha256 of the shape text, first 16 hex. */
  hash: string;
  /** Elements walked. Named so a mismatch can say the tree grew. */
  elements: number;
  /** sha256 of the visible text alone, first 8 hex. Splits a content change
   *  from a styling change without keeping the text itself. */
  text: string;
}

export interface ShapeRecord {
  /** Bumped when the admissible set changes, so an old record is not compared
   *  against a new walk and reported as staleness that is really a schema
   *  change. */
  version: number;
  /** The engine the shapes were taken in. A record from another engine is not
   *  comparable and the check refuses rather than failing. */
  engine: string;
  assets: Record<string, AssetShape>;
}

export const SHAPE_RECORD_VERSION = 1;

/**
 * Read the mounted widget, in the page.
 *
 * Passed to `tab.evaluate` and so must close over nothing: the whitelists arrive
 * as arguments. It returns the shape TEXT rather than a hash, because hashing in
 * the page would mean a mismatch could only ever say "different", and the caller
 * derives the counts a message can act on.
 *
 * `#root` itself is walked past rather than included. `growToFullContent` writes
 * a measured `height` into its inline style before the shot, so recording the
 * host's own attributes would carry a content measurement into the one place
 * that must not have one.
 */
export const readShapeText = (args: {
  properties: readonly string[];
  attributes: string;
}): ShapeCapture => {
  const host = document.getElementById("root");
  if (!host) throw new Error("render shape: no #root in the page");
  const attrRe = new RegExp(args.attributes);
  const lines: string[] = [];
  const texts: string[] = [];
  let elements = 0;

  const skip = new Set(["STYLE", "SCRIPT"]);
  const walk = (el: Element, path: string): void => {
    // xterm injects its own stylesheet into the widget, so a naive walk records
    // a page of CSS selectors as text.
    if (skip.has(el.tagName) || el.hasAttribute("data-unit-word")) return;
    elements++;
    const attrs = Array.from(el.attributes)
      .filter((a) => attrRe.test(a.name))
      .map((a) => `${a.name}=${a.value}`)
      .sort();
    const style = getComputedStyle(el);
    lines.push(
      `${path} ${el.tagName.toLowerCase()}` +
        (attrs.length > 0 ? ` [${attrs.join(";")}]` : "") +
        ` {${args.properties.map((p) => `${p}:${style.getPropertyValue(p)}`).join(";")}}`,
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

const digest = (input: string, chars: number): string =>
  createHash("sha256").update(input).digest("hex").slice(0, chars);

/** Fold one or more captures into the shape of a single asset. A still has one
 *  capture; a motion scene has one per frame, and the film's shape is the
 *  sequence, so a step that stopped firing changes it. */
export function foldShape(captures: readonly ShapeCapture[]): AssetShape {
  return {
    hash: digest(captures.map((c) => c.text).join("\n--frame--\n"), 16),
    elements: captures[0]?.elements ?? 0,
    text: digest(captures.map((c) => c.visibleText).join(" | "), 8),
  };
}

export function readShapeRecord(assetDir: string): ShapeRecord | undefined {
  const file = join(assetDir, SHAPE_RECORD_FILE);
  if (!existsSync(file)) return undefined;
  const parsed = JSON.parse(readFileSync(file, "utf8")) as ShapeRecord;
  if (
    typeof parsed?.version !== "number" ||
    typeof parsed?.assets !== "object"
  ) {
    throw new Error(`${file} is not a shape record`);
  }
  return parsed;
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

export interface ShapeVerdict {
  /** Assets whose render no longer matches what was committed. */
  stale: { file: string; was: AssetShape; now: AssetShape }[];
  /** Assets with no recorded shape, so nothing can be said about them. */
  unrecorded: string[];
  /** Set when the record cannot be compared at all, with the reason. */
  incomparable?: string;
}

/**
 * Compare today's render against the committed record.
 *
 * An asset with no record is `unrecorded`, never `stale`. The difference matters:
 * the mechanism lands across ten Uplinks that were never recorded, and calling
 * all of them stale on day one would be a wall of red with one command behind it
 * and no way to tell a NEW break from the seeding backlog. The unrecorded count
 * is held by a shrink-only ratchet instead, and heals as each Uplink is next
 * regenerated.
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
        "Regenerate with `pnpm uplink-docs`.",
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

/** Why one asset is stale, in the terms a person can act on. */
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
