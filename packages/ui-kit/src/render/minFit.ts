/**
 * Does this widget FIT the tile it is being drawn in?
 *
 * Every widget declares a `minSize`, which is a promise: an operator who drags
 * the tile down to it gets a widget that still works. Nothing checked that
 * promise, and a sweep of 53 widgets found 12 whose own TITLE ellipsises at
 * their own minimum and two with content clipped behind an `overflow: hidden`
 * that has nothing to scroll, so it is not reachable by scrolling, by resizing
 * within the minimum, or by any other means.
 *
 * Measured through a real layout rather than in jsdom, because none of these
 * exist there: jsdom computes no boxes, so `scrollWidth` is zero everywhere and
 * every one of these checks passes on a widget that is unreadable in a browser.
 *
 * Deliberately narrow on two axes, so the answer is a defect and not a taste:
 *
 * - Text counts as cut off, and so does a box that DECLARES its own edges are
 *   content: see `FIT_BOX`. A box that declares nothing does not, because a
 *   decorative box drawn oversized inside a clipping parent (a gauge arc, a
 *   gradient bleed, a graph's plot area) is routinely and correctly clipped.
 *   Judging boxes by their looks cannot tell those apart from a pill whose
 *   rounded end is sliced off, so the pill says which it is.
 * - Only where the operator cannot get to it. Content below the fold of a
 *   vertical scroll area is content they reach without thinking, and a widget
 *   that puts its overflow behind a scroller at a small size is doing the right
 *   thing. A HORIZONTAL scroller is not the same affordance and does not count:
 *   see `readableBeyond`.
 */

/**
 * Every heading in the tile, which is what "the title" means here.
 *
 * A heading rather than a marker attribute on `PanelTitle`, and the reason is
 * not convenience. A widget reaches its title two ways, `<Panel panelTitle>` and
 * a `<PanelTitle>` child, and the two Uplink widgets worst at fitting their own
 * minimum both take the second, so the hook has to sit on the styled component
 * to see them. It cannot: a new attribute on `PanelTitle` rewrites the title
 * element of all 1033 committed DOM snapshots, in a repo where several branches
 * are editing those files at once.
 *
 * A heading answers the same question without touching the DOM, and answers a
 * slightly better one. What makes a title different from a vessel name is that
 * it is a fixed string the author chose, so it can always be made to fit, and
 * that is true of every heading a widget draws: a section heading cut to "Ang..."
 * is the same defect one level down.
 */
const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

/**
 * The custom property a primitive sets on itself to say its own EDGES are
 * content: a pill, a chip, a toolbar strip. Its value names the primitive, so a
 * finding can say which box was cut rather than only what it contained.
 *
 * A custom property rather than a `data-` attribute, for the same reason the
 * title check reads headings: an attribute on a kit primitive rewrites the
 * committed DOM snapshots of every widget that draws one. A computed style is
 * invisible to them.
 *
 * Custom properties inherit, so every descendant of a marked box reports the
 * same value and `boundedName` credits only the element whose value differs
 * from its parent's. That misses a marked box nested directly inside another
 * carrying the SAME name, which no primitive in the kit does, and it errs
 * towards saying nothing rather than saying it twice.
 */
const FIT_BOX = "--fit-box";

/** One thing an operator cannot read at this size. */
export interface MinFitFinding {
  kind:
    | "title-clipped"
    | "text-cut-off"
    | "escapes-tile"
    | "box-clipped"
    | "box-escapes-tile";
  /** How many pixels of it are unreachable. */
  px: number;
  /** The text that is cut off, the title's own words, or the name of the box
   *  and whatever it carries. */
  text: string;
  /** Which way it is cut: `x`, `y`, or both. */
  axis: string;
}

/** Sub-pixel layout noise, and the odd 1px border rounding. */
const TOLERANCE_PX = 2;

/** Enough of the text to recognise it; the whole string can be a paragraph. */
const TEXT_SAMPLE = 60;

function sample(el: Element): string {
  return (el.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TEXT_SAMPLE);
}

/**
 * Whether this element is the one CARRYING the text rather than an ancestor of
 * whatever does.
 *
 * A finding on every ancestor of a cut-off word would report the same defect a
 * dozen times over, once per wrapper, and the innermost box is the one whose
 * geometry actually failed. An element qualifies when it has a non-blank text
 * node of its own; `<button>Save</button>` does and its wrapping `<div>` does
 * not.
 */
function carriesText(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== 3) continue;
    if ((node.textContent ?? "").trim() !== "") return true;
  }
  return false;
}

function clips(style: CSSStyleDeclaration, axis: "x" | "y"): boolean {
  const value = axis === "x" ? style.overflowX : style.overflowY;
  return value !== "visible";
}

/**
 * Whether being able to scroll this box makes the text beyond its edge
 * REACHABLE, which is only ever true downwards.
 *
 * Vertical scrolling is the universal reading affordance: content below the fold
 * of a scroll area is content an operator reaches without thinking about it, and
 * a widget that puts its overflow behind a scroller at a small size is doing the
 * right thing. Horizontal scrolling is not the same thing and this deliberately
 * refuses to treat it as one. Text is read left to right, so a word cut off part
 * way through is unreadable whether or not the box can be dragged sideways, and
 * nobody drags a 112px tile sideways to finish a sentence.
 *
 * The difference is not academic. Migrating two Uplink widgets onto the panel's
 * scrolling body fixed 264px of unreachable rows and left "MODEL STALE" sliced
 * by the tile edge exactly as before, because the new scroller technically
 * scrolls both ways. Counting an x-scroller as an escape hid that, and six more
 * widgets whose empty-state SENTENCE is clipped mid-word.
 */
function readableBeyond(style: CSSStyleDeclaration, axis: "x" | "y"): boolean {
  if (axis === "x") return false;
  return style.overflowY === "auto" || style.overflowY === "scroll";
}

/**
 * The box that decides whether this element is visible: the nearest ancestor
 * that clips on `axis`, or the tile when nothing between them does.
 *
 * Measured against the ancestor's CLIENT box (padding box minus scrollbars)
 * rather than its border box, because that is the region it actually paints
 * children into.
 */
function clipperFor(
  el: Element,
  tile: HTMLElement,
  axis: "x" | "y",
): { box: Element; scrollable: boolean } {
  let at = el.parentElement;
  while (at && at !== tile) {
    const style = getComputedStyle(at);
    if (clips(style, axis)) {
      return { box: at, scrollable: readableBeyond(style, axis) };
    }
    at = at.parentElement;
  }
  return { box: tile, scrollable: false };
}

/** The rect of an element's client box, in viewport coordinates. */
function clientRect(el: Element): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const box = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const left = box.left + parseFloat(style.borderLeftWidth || "0");
  const top = box.top + parseFloat(style.borderTopWidth || "0");
  return {
    left,
    top,
    right: left + (el as HTMLElement).clientWidth,
    bottom: top + (el as HTMLElement).clientHeight,
  };
}

/** Which primitive this element is, when it says its edges are content. */
function boundedName(el: Element): string | undefined {
  const own = getComputedStyle(el).getPropertyValue(FIT_BOX).trim();
  if (own === "") return undefined;
  const parent = el.parentElement;
  const inherited = parent
    ? getComputedStyle(parent).getPropertyValue(FIT_BOX).trim()
    : "";
  return own === inherited ? undefined : own;
}

/** How far this element reaches past whatever clips it, per axis. */
function cutBy(
  el: Element,
  tile: HTMLElement,
): { cutX: number; cutY: number; escaping: boolean } {
  const box = el.getBoundingClientRect();
  let cutX = 0;
  let cutY = 0;
  let escaping = false;
  for (const axis of ["x", "y"] as const) {
    const { box: clipper, scrollable } = clipperFor(el, tile, axis);
    if (scrollable) continue;
    const limit =
      clipper === tile ? tile.getBoundingClientRect() : clientRect(clipper);
    const over =
      axis === "x"
        ? Math.max(limit.left - box.left, box.right - limit.right)
        : Math.max(limit.top - box.top, box.bottom - limit.bottom);
    if (over <= TOLERANCE_PX) continue;
    if (clipper === tile) escaping = true;
    if (axis === "x") cutX = over;
    else cutY = over;
  }
  return { cutX, cutY, escaping };
}

function axisOf(cutX: number, cutY: number): string {
  return `${cutX > TOLERANCE_PX ? "x" : ""}${cutY > TOLERANCE_PX ? "y" : ""}`;
}

/** Big enough to be drawn at all. A collapsed box has no edges to slice. */
function drawn(el: Element): boolean {
  const box = el.getBoundingClientRect();
  return box.width >= 0.5 && box.height >= 0.5;
}

/**
 * Every way this tile's content is unreachable at the size it is mounted at.
 *
 * `tile` is the mount box, sized to the widget's declared `minSize`. Nothing
 * here mutates the page, so a caller may audit and then go on to screenshot the
 * same render.
 */
export function auditMinFit(tile: HTMLElement): MinFitFinding[] {
  const findings: MinFitFinding[] = [];
  /** Boxes already named by the text pass, so a pill whose LABEL is sliced is
   *  one finding rather than two saying the same thing. */
  const spoken = new Set<Element>();

  // A heading is chrome rather than data: it is a fixed string the widget author
  // chose, so unlike a vessel name it can always be made to fit, and an
  // ellipsised one is the widget failing to name itself.
  for (const title of Array.from(tile.querySelectorAll(HEADINGS))) {
    const over = title.scrollWidth - (title as HTMLElement).clientWidth;
    if (over <= TOLERANCE_PX) continue;
    findings.push({
      kind: "title-clipped",
      px: Math.round(over),
      text: sample(title),
      axis: "x",
    });
  }

  for (const el of Array.from(tile.querySelectorAll("*"))) {
    if (!carriesText(el)) continue;
    // A title's ellipsis is already reported above, with the reason it is a
    // harsher rule than the one every other string gets.
    if (el.closest(HEADINGS)) continue;
    if (!drawn(el)) continue;

    const { cutX, cutY, escaping } = cutBy(el, tile);
    if (cutX <= TOLERANCE_PX && cutY <= TOLERANCE_PX) continue;
    spoken.add(el);
    findings.push({
      kind: escaping ? "escapes-tile" : "text-cut-off",
      px: Math.round(Math.max(cutX, cutY)),
      text: sample(el),
      axis: axisOf(cutX, cutY),
    });
  }

  // A box whose edges are content is cut off the moment those edges are, even
  // when everything written inside it still fits: a three-column tile held a
  // status pill's two words and 15px less than the pill drawn around them, so
  // the panel edge sliced its rounded ends at the minimum the widget promised.
  for (const el of Array.from(tile.querySelectorAll("*"))) {
    if (spoken.has(el)) continue;
    const name = boundedName(el);
    if (name === undefined) continue;
    if (!drawn(el)) continue;

    const { cutX, cutY, escaping } = cutBy(el, tile);
    if (cutX <= TOLERANCE_PX && cutY <= TOLERANCE_PX) continue;
    const carried = sample(el);
    findings.push({
      kind: escaping ? "box-escapes-tile" : "box-clipped",
      px: Math.round(Math.max(cutX, cutY)),
      text: carried === "" ? name : `${name} ${carried}`,
      axis: axisOf(cutX, cutY),
    });
  }

  return findings.sort((a, b) => b.px - a.px);
}
