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
 *   see `readableBeyond`. The one exception is text a scroller's own overflow
 *   mask PAINTS OVER where it sits, which is unreadable without scrolling even
 *   though it is on screen: see `maskFindings`, which is narrow in its turn and
 *   speaks only where the mask is deeper than the scroll it advertises.
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

/**
 * The custom property a box sets on itself to say it PAINTS OVER the scrolling
 * content behind it, rather than merely sitting in front of it. See `fitMask`.
 *
 * Read the same way as `FIT_BOX`, and for the same reasons: custom properties
 * inherit, so only the element whose value differs from its parent's is the
 * mask itself.
 */
const FIT_MASK = "--fit-mask";

/** One thing an operator cannot read at this size. */
export interface MinFitFinding {
  kind:
    | "title-clipped"
    | "text-cut-off"
    | "escapes-tile"
    | "box-clipped"
    | "box-escapes-tile"
    | "control-cut-off"
    | "masked-by-glow";
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
 * How opaque the paint over a line of text has to be before the line counts as
 * unreadable.
 *
 * At half coverage the panel colour is mixed evenly with the glyph and the
 * faint body text the empty states use is gone; below it the text ghosts but
 * can still be made out. Half is also where the measurement is least sensitive
 * to the exact gradient, since coverage falls fastest through the middle of the
 * fade.
 */
const MASK_ALPHA = 0.5;

/** How finely the mask's coverage is sampled down its own height, in px. */
const MASK_STEP_PX = 0.5;

/** Splits a CSS list on its TOP-LEVEL commas, so a `rgb(1, 2, 3)` inside a
 *  gradient stays one token. */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let at = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(text.slice(at, i));
      at = i + 1;
    }
  }
  out.push(text.slice(at));
  return out.map((s) => s.trim()).filter((s) => s !== "");
}

/**
 * How opaque a computed colour is.
 *
 * Only the alpha matters here: a mask hides what is behind it by covering it,
 * whatever colour it covers it with. The forms are the ones a browser produces
 * in a computed `background-image`, which is a narrower set than CSS accepts.
 */
function alphaOf(colour: string): number {
  const text = colour.trim();
  if (text === "transparent") return 0;
  const slashed = /\/\s*([\d.]+%?)\s*\)/.exec(text);
  if (slashed) {
    const raw = slashed[1];
    return raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw);
  }
  const rgba = /^rgba?\(([^)]*)\)$/.exec(text);
  if (rgba) {
    const parts = splitTopLevel(rgba[1]);
    return parts.length >= 4 ? parseFloat(parts[3]) : 1;
  }
  return 1;
}

interface GradientStop {
  /** Distance along the gradient line from its start, in px. */
  at: number;
  alpha: number;
}

interface Gradient {
  /** Which edge of the box the gradient line STARTS at. */
  from: "top" | "bottom";
  stops: GradientStop[];
}

/**
 * One vertical gradient layer of a computed `background-image`, as stops of
 * alpha down the box.
 *
 * Returns undefined for anything this cannot read as a vertical fade: a
 * non-linear gradient, an angled one, an image. A mask made of those measures
 * as no mask at all, and the planted canary is what catches that rather than a
 * silent zero.
 */
function readGradient(layer: string, height: number): Gradient | undefined {
  const outer = /^linear-gradient\(([\s\S]*)\)$/.exec(layer.trim());
  if (!outer) return undefined;
  const parts = splitTopLevel(outer[1]);
  let from: "top" | "bottom" = "top";
  if (/^to\s/.test(parts[0]) || /^[-\d.]+(deg|rad|grad|turn)$/.test(parts[0])) {
    const direction = parts.shift() as string;
    if (
      /^to\s+top$/.test(direction) ||
      /^0(deg|rad|grad|turn)$/.test(direction)
    )
      from = "bottom";
    else if (!/^to\s+bottom$/.test(direction) && !/^180deg$/.test(direction))
      return undefined;
  }
  if (parts.length < 2) return undefined;

  const raw = parts.map((part) => {
    const position = /\s(-?[\d.]+)(%|px)$/.exec(part);
    const alpha = alphaOf(position ? part.slice(0, position.index) : part);
    if (!position) return { at: undefined, alpha };
    const value = parseFloat(position[1]);
    return { at: position[2] === "%" ? (value / 100) * height : value, alpha };
  });
  // CSS fills in an omitted position: the ends sit on the ends, and a run of
  // omitted stops spreads evenly between the known ones on either side.
  const at: number[] = raw.map((s) => s.at ?? Number.NaN);
  if (Number.isNaN(at[0])) at[0] = 0;
  if (Number.isNaN(at[at.length - 1])) at[at.length - 1] = height;
  for (let i = 1; i < at.length - 1; i++) {
    if (!Number.isNaN(at[i])) continue;
    let next = i;
    while (Number.isNaN(at[next])) next++;
    const step = (at[next] - at[i - 1]) / (next - i + 1);
    for (let j = i; j < next; j++) at[j] = at[i - 1] + step * (j - i + 1);
  }
  return { from, stops: raw.map((s, i) => ({ at: at[i], alpha: s.alpha })) };
}

/** A gradient's alpha at `down` px from the TOP of its box. */
function alphaAt(gradient: Gradient, down: number, height: number): number {
  const along = gradient.from === "top" ? down : height - down;
  const { stops } = gradient;
  if (along <= stops[0].at) return stops[0].alpha;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (along > b.at) continue;
    if (b.at === a.at) return b.alpha;
    return a.alpha + ((along - a.at) / (b.at - a.at)) * (b.alpha - a.alpha);
  }
  return stops[stops.length - 1].alpha;
}

/**
 * The part of a mask element that actually hides what is behind it, in viewport
 * coordinates, or undefined when nothing it paints reaches `MASK_ALPHA`.
 *
 * Measured out of the element's own computed `background-image` rather than
 * from its height, which is the whole point: the panel's glow is a 44px box
 * whose opaque layer is solid for the first quarter of it and gone by half, so
 * its height is nearly three times what it covers. Reading the gradient means
 * the number cannot drift from the CSS, and a gradient this cannot parse
 * measures as no mask rather than as a wrong one.
 */
function maskedBand(el: Element): { top: number; bottom: number } | undefined {
  const style = getComputedStyle(el);
  if (parseFloat(style.opacity || "1") < 0.01) return undefined;
  const rect = el.getBoundingClientRect();
  if (rect.height < 1) return undefined;
  const layers = splitTopLevel(style.backgroundImage)
    .map((layer) => readGradient(layer, rect.height))
    .filter((g): g is Gradient => g !== undefined);
  if (layers.length === 0) return undefined;

  let top: number | undefined;
  let bottom: number | undefined;
  for (let down = 0; down <= rect.height; down += MASK_STEP_PX) {
    // Source-over: what each layer lets through, multiplied.
    let through = 1;
    for (const layer of layers) {
      through *= 1 - alphaAt(layer, down, rect.height);
    }
    if (1 - through < MASK_ALPHA) continue;
    if (top === undefined) top = rect.top + down;
    bottom = rect.top + down;
  }
  if (top === undefined || bottom === undefined) return undefined;
  return { top, bottom };
}

/**
 * Where this element's OWN words are actually INKED: top and bottom of the
 * glyphs, one band per line.
 *
 * Three boxes are in play and only the innermost is the answer. The element's
 * border box is where text may go, which on a readout row centring one line is
 * several times taller than where the text went. A range over its text nodes
 * narrows that to the line boxes, which is still the line's leading rather than
 * its glyphs: a 38px em-dash draws a two-pixel bar in the middle of a 50px line
 * box, and judging the line box reported that dash as fifteen pixels masked
 * while the render was pixel-identical with the mask turned off.
 *
 * So the line box is narrowed once more by the string's own ink extents, which
 * only a text measurement knows. The whole string's extents are applied to
 * every line of it, which can overstate a last line that happens to carry no
 * descender by a pixel or two, and is the only part of this that is an estimate.
 */
function inkBands(el: Element): { top: number; bottom: number }[] {
  const style = getComputedStyle(el);
  const out: { top: number; bottom: number }[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== 3) continue;
    const text = node.textContent ?? "";
    if (text.trim() === "") continue;
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(node);
    const metrics = measureInk(el.ownerDocument, style, text);
    for (const line of Array.from(range.getClientRects())) {
      if (!metrics) {
        out.push({ top: line.top, bottom: line.bottom });
        continue;
      }
      // Half-leading splits whatever the line box has spare around the font's
      // own box, which is what puts the baseline where the browser put it.
      const leading =
        (line.height - (metrics.fontAscent + metrics.fontDescent)) / 2;
      const baseline = line.top + leading + metrics.fontAscent;
      out.push({
        top: baseline - metrics.inkAscent,
        bottom: baseline + metrics.inkDescent,
      });
    }
  }
  return out;
}

interface InkMetrics {
  fontAscent: number;
  fontDescent: number;
  inkAscent: number;
  inkDescent: number;
}

/** One canvas for the whole audit; `measureText` needs a 2D context and
 *  nothing else, and making one per string is the slow way to the same number. */
let inkCanvas: CanvasRenderingContext2D | null | undefined;

function measureInk(
  doc: Document,
  style: CSSStyleDeclaration,
  text: string,
): InkMetrics | undefined {
  if (inkCanvas === undefined) {
    inkCanvas = doc.createElement("canvas").getContext("2d");
  }
  if (!inkCanvas) return undefined;
  inkCanvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const m = inkCanvas.measureText(text);
  if (
    typeof m.fontBoundingBoxAscent !== "number" ||
    typeof m.actualBoundingBoxAscent !== "number"
  ) {
    return undefined;
  }
  return {
    fontAscent: m.fontBoundingBoxAscent,
    fontDescent: m.fontBoundingBoxDescent,
    inkAscent: m.actualBoundingBoxAscent,
    inkDescent: m.actualBoundingBoxDescent,
  };
}

/** The nearest vertical scroll container the mask is painted over. */
function scrollerUnder(mask: Element): HTMLElement | undefined {
  let at = mask.parentElement;
  while (at) {
    for (const el of Array.from(at.querySelectorAll<HTMLElement>("*"))) {
      const style = getComputedStyle(el);
      if (style.overflowY !== "auto" && style.overflowY !== "scroll") continue;
      if (el.scrollHeight - el.clientHeight <= TOLERANCE_PX) continue;
      return el;
    }
    at = at.parentElement;
  }
  return undefined;
}

/**
 * Text a scroll-overflow mask covers where it sits, at a size where the mask is
 * deeper than the scroll it is advertising.
 *
 * The mask is drawn at a fixed height whatever is behind it, and the trigger
 * that turns it on is binary: any overflow at all, by one pixel, paints the
 * whole thing. On a tall list that is the boundary cue it is meant to be, and a
 * row under it is a row the operator scrolls to without thinking. On a short
 * body it is a blindfold: a widget whose empty state sits five pixels past the
 * fold has the last line of that sentence covered where it stands, and the
 * operator has to scroll a body that barely scrolls to read a line that was
 * already on screen.
 *
 * So this reports only where the mask reaches DEEPER than the remaining scroll.
 * That is the difference between covering content because there is more below
 * and covering content because the mask is a fixed size: past that point the
 * cover cannot be explained by what is under it. Everything else a scroller
 * puts below its fold is reachable and deliberately says nothing, the same rule
 * `readableBeyond` applies to the text pass.
 */
function maskFindings(tile: HTMLElement): MinFitFinding[] {
  const findings: MinFitFinding[] = [];
  for (const mask of Array.from(tile.querySelectorAll("*"))) {
    const own = getComputedStyle(mask).getPropertyValue(FIT_MASK).trim();
    if (own === "") continue;
    const parent = mask.parentElement;
    const inherited = parent
      ? getComputedStyle(parent).getPropertyValue(FIT_MASK).trim()
      : "";
    if (own === inherited) continue;
    if (!painted(mask)) continue;
    const band = maskedBand(mask);
    if (!band) continue;
    const scroller = scrollerUnder(mask);
    if (!scroller) continue;

    const view = clientRect(scroller);
    // Which end of the scroller the mask sits at decides which way the scroll
    // that would clear it runs.
    const atBottom = view.bottom - band.bottom <= band.top - view.top;
    const depth = atBottom ? view.bottom - band.top : band.bottom - view.top;
    const remaining = atBottom
      ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
      : scroller.scrollTop;
    if (depth <= remaining + TOLERANCE_PX) continue;

    for (const el of Array.from(scroller.querySelectorAll("*"))) {
      if (!carriesText(el) || !drawn(el) || !painted(el)) continue;
      // Where the glyphs are inked rather than where the element is, because
      // what is at stake is whether the paint lands on the words.
      const covered = Math.max(
        0,
        ...inkBands(el).map(
          (line) =>
            // Only the part of it that is on screen: what a scroller puts below
            // its own fold is reachable by scrolling and says nothing here.
            Math.min(line.bottom, band.bottom, view.bottom) -
            Math.max(line.top, band.top, view.top),
        ),
      );
      if (covered <= TOLERANCE_PX) continue;
      findings.push({
        kind: "masked-by-glow",
        px: Math.round(covered),
        text: sample(el),
        axis: "y",
      });
    }
  }
  return findings;
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

  /* Being reachable by scrolling is not the same as being readable where it
     sits, and a fixed-height mask over a body that barely scrolls is the case
     where the two come apart. */
  findings.push(...maskFindings(tile));

  return findings.sort((a, b) => b.px - a.px);
}
