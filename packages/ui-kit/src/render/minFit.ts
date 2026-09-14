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
 * Deliberately narrow on three axes, so the answer is a defect and not a taste:
 *
 * - Text counts as cut off, and so does a box that DECLARES its own edges are
 *   content: see `FIT_BOX`. A box that declares nothing does not, because a
 *   decorative box drawn oversized inside a clipping parent (a gauge arc, a
 *   gradient bleed, a graph's plot area) is routinely and correctly clipped.
 *   Judging boxes by their looks cannot tell those apart from a pill whose
 *   rounded end is sliced off, so the pill says which it is. A form control's
 *   value or placeholder counts as text too, though it is no text node: see
 *   `CONTROLS`.
 * - Only what the browser actually paints: see `painted`. A box kept laid out
 *   under `visibility: hidden` has edges to slice and an operator who will never
 *   see either them or what is inside them.
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
    | "box-escapes-tile"
    | "control-cut-off";
  /** How many pixels of it are unreachable. */
  px: number;
  /** The text that is cut off, the title's own words, the name of the box and
   *  whatever it carries, or a form control's accessible name and what it shows. */
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
 * Whether the browser paints this element at all.
 *
 * `display: none` leaves no box and `drawn` already discards it, but
 * `visibility: hidden` keeps the full layout: a box to measure, a box to slice,
 * and not one pixel of it reaching an operator. Saying such a box is cut off is
 * an answer to a question nobody asked.
 *
 * `Panel` is the case that forced this. Once the header's measured-fit collapse
 * fires, the FULL aside stays in the document under `visibility: hidden` so
 * `useHeaderAsideFit` can go on cloning it to measure, absolutely positioned off
 * a trigger only as wide as its own dots, and therefore free to overhang the
 * panel by more than it is wide. Audited, that reads as Science Data slicing its
 * own SYNCING badge at its declared minimum; what the operator sees there is the
 * dots-and-chevron summary the collapse put in its place precisely so the header
 * would fit. Judging the hidden copy would have every widget with a header aside
 * answering for chrome that already did the right thing.
 */
function painted(el: Element): boolean {
  return getComputedStyle(el).visibility === "visible";
}

/**
 * The form controls whose shown text is judged by `controlCut` rather than by the
 * text pass.
 *
 * A control carries its words in its value, which is not a text node, so the text
 * pass cannot see them at all: an altitude field showing only the "1" of "100"
 * reported nothing. The option elements of a closed select and the
 * default-value text node React writes into a textarea DO carry text nodes, and
 * are skipped by the text pass so each control is spoken about once.
 */
const CONTROLS = "input, select, textarea";

/** Input types that draw no text of their own, so have nothing to cut off. */
const TEXTLESS_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Input types that draw their `value` verbatim, so measuring the string measures
 * what is on screen. A date or a password draws something else, and for those
 * only the browser's own `scrollWidth` is trusted.
 */
const LITERAL_INPUTS = new Set([
  "email",
  "number",
  "search",
  "tel",
  "text",
  "url",
]);

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * How far in from its padding box's right edge a select's drop-down arrow
 * reaches. Chromium draws the arrow over the right end of the box whatever
 * padding the author gives it and lets the text run underneath, so text that
 * "fits" the content box can still end under the chevron. Measured at 13px
 * across font sizes and paddings, plus one so a glyph touching it counts.
 */
const SELECT_ARROW_PX = 14;

/**
 * What the control shows and which of its strings that is. The placeholder
 * counts: a hint cut to "Vess" is as unusable as a value cut to "1".
 */
function shownBy(
  control: Control,
): { text: string; from: "value" | "placeholder" } | undefined {
  if (control instanceof HTMLSelectElement) {
    const text = control.selectedOptions[0]?.text ?? "";
    return text.trim() === "" ? undefined : { text, from: "value" };
  }
  if (
    control instanceof HTMLInputElement &&
    TEXTLESS_INPUTS.has(control.type)
  ) {
    return undefined;
  }
  if (control.value !== "") return { text: control.value, from: "value" };
  if (control.placeholder.trim() !== "") {
    return { text: control.placeholder, from: "placeholder" };
  }
  return undefined;
}

/**
 * The width `text` draws at in this control's font.
 *
 * Needed because `scrollWidth` answers for the value and never for the
 * placeholder. Measured by a hidden span appended to the document and removed
 * straight after, so the page is left as it was found.
 */
function drawnWidth(control: Control, text: string): number {
  const style = getComputedStyle(control);
  const span = control.ownerDocument.createElement("span");
  const copy = span.style;
  copy.position = "absolute";
  copy.visibility = "hidden";
  copy.whiteSpace = "pre";
  copy.fontFamily = style.fontFamily;
  copy.fontSize = style.fontSize;
  copy.fontWeight = style.fontWeight;
  copy.fontStyle = style.fontStyle;
  copy.fontStretch = style.fontStretch;
  copy.fontVariant = style.fontVariant;
  copy.fontFeatureSettings = style.fontFeatureSettings;
  copy.letterSpacing = style.letterSpacing;
  copy.wordSpacing = style.wordSpacing;
  copy.textTransform = style.textTransform;
  span.textContent = text;
  control.ownerDocument.body.append(span);
  const width = span.getBoundingClientRect().width;
  span.remove();
  return width;
}

/**
 * How much of what a control shows an operator cannot see, per axis.
 *
 * Two causes, measured as one number because to the operator they are one
 * defect: text wider than the control's own content box (a field sized too
 * narrow for its value), and a content box that is itself cut by whatever clips
 * it (a field pushed past the panel edge). Horizontally the shortfall is the
 * text's width less the part of it left visible, placed where the control's
 * `text-align` puts it. Vertically it is how far the content box, which holds the
 * line of text, reaches past a clipper that cannot be scrolled.
 *
 * The text's width is the wider of the measured string and the browser's own
 * overflow, because each sees what the other cannot: `scrollWidth` ignores a
 * placeholder, and the string alone ignores a number field's spin buttons. A
 * textarea wraps, so its text fills its box and only overflows sideways when told
 * not to wrap; what wraps below its fold is reached by scrolling it.
 */
function controlCut(
  control: Control,
  tile: HTMLElement,
  shown: { text: string; from: "value" | "placeholder" },
): { cutX: number; cutY: number } {
  const style = getComputedStyle(control);
  const box = clientRect(control);
  const drawsArrow =
    control instanceof HTMLSelectElement && style.appearance !== "none";
  const content = {
    left: box.left + parseFloat(style.paddingLeft || "0"),
    right: Math.min(
      box.right - parseFloat(style.paddingRight || "0"),
      drawsArrow ? box.right - SELECT_ARROW_PX : Infinity,
    ),
    top: box.top + parseFloat(style.paddingTop || "0"),
    bottom: box.bottom - parseFloat(style.paddingBottom || "0"),
  };
  const room = content.right - content.left;
  const overflow = Math.max(0, control.scrollWidth - control.clientWidth);
  const measurable =
    control instanceof HTMLSelectElement ||
    shown.from === "placeholder" ||
    (control instanceof HTMLInputElement && LITERAL_INPUTS.has(control.type));
  const width =
    control instanceof HTMLTextAreaElement
      ? room + overflow
      : Math.max(
          measurable ? drawnWidth(control, shown.text) : room,
          overflow > 0 ? room + overflow : 0,
        );

  let left = content.left;
  if (width < room) {
    if (style.textAlign === "right" || style.textAlign === "end") {
      left = content.right - width;
    } else if (style.textAlign === "center") {
      left = content.left + (room - width) / 2;
    }
  }
  const x = limitFor(control, tile, "x");
  const seenLeft = Math.max(left, content.left, x?.left ?? -Infinity);
  const seenRight = Math.min(left + width, content.right, x?.right ?? Infinity);
  const cutX = width - Math.max(0, seenRight - seenLeft);

  const y = limitFor(control, tile, "y");
  const cutY = y
    ? Math.max(0, y.top - content.top, content.bottom - y.bottom)
    : 0;
  return { cutX, cutY };
}

/**
 * The rect that clips `el` on `axis`, or undefined when what lies beyond it is
 * reached by scrolling. See `clipperFor`.
 */
function limitFor(
  el: Element,
  tile: HTMLElement,
  axis: "x" | "y",
): ReturnType<typeof clientRect> | undefined {
  const { box, scrollable } = clipperFor(el, tile, axis);
  if (scrollable) return undefined;
  return box === tile ? tile.getBoundingClientRect() : clientRect(box);
}

/**
 * What a finding calls a control: its accessible name, resolved the way a
 * screen reader resolves the common cases, so the report names the field an
 * operator would.
 */
function controlName(control: Control): string {
  const flat = (text: string | null | undefined) =>
    (text ?? "").replace(/\s+/g, " ").trim();
  const label = flat(control.getAttribute("aria-label"));
  if (label !== "") return label;
  const by = control.getAttribute("aria-labelledby");
  if (by) {
    const named = flat(
      by
        .split(/\s+/)
        .map((id) => control.ownerDocument.getElementById(id)?.textContent)
        .join(" "),
    );
    if (named !== "") return named;
  }
  const labelled = flat(
    Array.from(control.labels ?? [])
      .map((l) => l.textContent)
      .join(" "),
  );
  if (labelled !== "") return labelled;
  const title = flat(control.getAttribute("title"));
  if (title !== "") return title;
  return `unnamed ${control.tagName.toLowerCase()}`;
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
    if (!painted(title)) continue;
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
    if (el.closest(CONTROLS)) continue;
    if (!drawn(el) || !painted(el)) continue;

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
    if (!drawn(el) || !painted(el)) continue;

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

  // A field is how an operator states a number, so a value they cannot read back
  // is an instruction they cannot check before sending it.
  for (const control of Array.from(tile.querySelectorAll<Control>(CONTROLS))) {
    if (!drawn(control) || !painted(control)) continue;
    const shown = shownBy(control);
    if (shown === undefined) continue;
    const { cutX, cutY } = controlCut(control, tile, shown);
    if (cutX <= TOLERANCE_PX && cutY <= TOLERANCE_PX) continue;
    const quoted = shown.text.replace(/\s+/g, " ").trim().slice(0, TEXT_SAMPLE);
    findings.push({
      kind: "control-cut-off",
      px: Math.round(Math.max(cutX, cutY)),
      text: `${controlName(control)} ${shown.from} '${quoted}'`,
      axis: axisOf(cutX, cutY),
    });
  }

  return findings.sort((a, b) => b.px - a.px);
}
