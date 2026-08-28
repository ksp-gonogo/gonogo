import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * Pick the longest form of a title that actually fits the box it is drawn in.
 *
 * ## The three things this replaces
 *
 * Every widget's title is a fixed string its author chose, so unlike a vessel
 * name it can always be made to fit. Nothing in the kit helped them do it, and
 * three widgets had each solved it their own way:
 *
 *  - `OrbitView` hand-rolled `cols < 4 ? "OVIEW" : "ORBIT VIEW"`, with a comment
 *    admitting what the threshold really is: "the header row gives the title a
 *    fixed reserved width and does not grow it into a chevron-collapsed aside's
 *    freed space, so a title that doesn't fit at this column count is squeezed
 *    far below what the row actually has room for". A grid-column count is a
 *    guess at a pixel width the widget cannot see
 *  - `PerfBudgets` picked "PERF BUDGETS" or "PERF" off a size branch it already
 *    had, so the title is right only where that branch happens to agree
 *  - `SpaceCenterStatus` is called "KSC" at every size, including a twelve-
 *    column tile with room for the whole name. The short form won permanently
 *
 * So the shape is: a list of forms, and a decision made by MEASUREMENT rather
 * than by a column count, so the widest form that fits is the one shown and the
 * short form is never a permanent loss.
 *
 * ## How the measurement works
 *
 * The title box fills the room available to it (`PanelHeader__Titles` grows),
 * so its `clientWidth` IS the room, and each candidate is measured on an
 * isolated clone of the live element. The clone keeps its styled-components
 * classes, so its font, letter-spacing and padding are the real ones rather
 * than an approximation, and it is appended and removed inside one synchronous
 * call so nothing ever observes it. Same technique as
 * `measureNaturalElementWidth` in `usePanelAsideSize`, for the same reason: a
 * live element squeezed by a flex chain reports the squeezed width, which is
 * exactly the case that has to be detected.
 *
 * In jsdom every box is zero, so the full title is what renders. That is the
 * existing behaviour of every widget test, deliberately: a hook that silently
 * shortened titles under test would make every `getByText` in the tree a coin
 * flip on layout nobody can see.
 */

/**
 * How much room to spare a longer form needs before it wins back.
 *
 * The whole hysteresis, and the same argument as `REEXPAND_MARGIN_PX` in
 * `usePanelAsideSize`: shortening reacts the instant the text stops fitting, so
 * a title is never left clipped, but lengthening waits for real room. Without
 * it a box sitting exactly on the boundary alternates forever, because showing
 * the longer form is what makes it not fit.
 */
const RELENGTHEN_MARGIN_PX = 12;

/**
 * One candidate's natural width, measured on an isolated clone of `el` with its
 * text replaced.
 *
 * Every candidate carries its own text, the full form included, and that is the
 * correctness of this hook rather than a detail. Measuring the first candidate
 * as "whatever the element currently renders" oscillates the instant it
 * shortens: the live element then reads back the SHORT text as the full form's
 * width, so the full form appears to fit, is restored, and does not fit.
 * Measured in Chromium, "RESOURCE OPS" alternated 131px and 90px forever in a
 * box with 110px of room.
 */
function measureCandidateWidth(el: HTMLElement | null, text: string): number {
  if (!el || typeof document === "undefined") return 0;
  const clone = el.cloneNode(true) as HTMLElement;
  clone.textContent = text;
  clone.style.position = "fixed";
  clone.style.visibility = "hidden";
  clone.style.pointerEvents = "none";
  clone.style.left = "-99999px";
  clone.style.top = "-99999px";
  // The live element fills its column and truncates; the clone has to report
  // what the text WANTS, so it is taken off both the width it inherits and the
  // ceiling that would clip it again.
  clone.style.width = "max-content";
  clone.style.maxWidth = "none";
  document.body.appendChild(clone);
  const width = clone.getBoundingClientRect().width;
  document.body.removeChild(clone);
  return width;
}

/**
 * Which candidate fits, as an index into a longest-first list. Pure, so the
 * hysteresis is testable with no DOM.
 *
 * Anything unmeasured (a zero available width, or a first candidate that
 * measured zero) holds index 0, the full form: that is jsdom, first paint
 * before layout, and a `ResizeObserver` that has not fired yet, and shortening
 * a title on the strength of a measurement that never happened is worse than
 * leaving it long.
 */
export function fittedTitleIndex(
  previous: number,
  available: number,
  widths: readonly number[],
): number {
  if (available <= 0 || widths.length === 0 || widths[0] <= 0) return 0;
  for (let i = 0; i < widths.length; i++) {
    // Growing back to a form longer than the current one has to clear the
    // margin; shrinking to this one, or staying put, does not.
    const room = i < previous ? available - RELENGTHEN_MARGIN_PX : available;
    if (widths[i] <= room) return i;
  }
  return widths.length - 1;
}

/**
 * The title form to render, given the full one and any shorter alternatives.
 *
 * `compact` is longest-first, so "ORBIT VIEW" then "OVIEW" then "OV" is a full
 * title of `ORBIT VIEW` with `compact={["OVIEW", "OV"]}`. The returned
 * `compacted` flag is what earns the full name an `aria-label` and a tooltip: a
 * screen reader hearing "KSC" has lost something a sighted operator only gave
 * up because the tile is small.
 */
export function useFittedTitle(
  titleRef: RefObject<HTMLElement | null>,
  full: string,
  compact: readonly string[],
): { index: number; compacted: boolean } {
  const [index, setIndex] = useState(0);
  const indexRef = useRef(index);
  indexRef.current = index;

  // `compact` is a fresh array on most renders, so its identity would defeat
  // the memo and rebuild the observer every time. Its CONTENTS are the input,
  // joined on a newline because a short title is still allowed spaces.
  const key = [full, ...compact].join("\n");

  const recompute = useCallback(() => {
    const el = titleRef.current;
    const forms = key.split("\n");
    if (!el || forms.length < 2) {
      if (indexRef.current !== 0) {
        indexRef.current = 0;
        setIndex(0);
      }
      return;
    }
    const widths = forms.map((text) => measureCandidateWidth(el, text));
    const next = fittedTitleIndex(indexRef.current, el.clientWidth, widths);
    if (next !== indexRef.current) {
      indexRef.current = next;
      setIndex(next);
    }
  }, [titleRef, key]);

  // `key` carries the title text, so a changed title recomputes through
  // `recompute`'s own identity even though it moves no box a ResizeObserver
  // would see.
  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(el);
    return () => ro.disconnect();
  }, [titleRef, recompute]);

  return { index, compacted: index > 0 };
}
