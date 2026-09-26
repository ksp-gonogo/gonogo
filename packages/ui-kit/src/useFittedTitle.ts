import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * Room to spare a longer form needs before it wins back. Without it a box
 * sitting exactly on the boundary alternates forever, because showing the
 * longer form is what makes it not fit.
 */
const RELENGTHEN_MARGIN_PX = 12;

/**
 * One candidate's natural width, measured on an isolated clone of `el` with its
 * text replaced, so the font and spacing are the real ones and a flex-squeezed
 * live box cannot report its squeezed width.
 *
 * Every candidate carries its own text, the full form included: reading the
 * live element back after a shortening would measure the short text as the
 * full form's width and oscillate.
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
  // The live element truncates within its column; the clone must report the width the text wants.
  clone.style.width = "max-content";
  clone.style.maxWidth = "none";
  document.body.appendChild(clone);
  const width = clone.getBoundingClientRect().width;
  document.body.removeChild(clone);
  return width;
}

/**
 * Which candidate fits, as an index into a longest-first list.
 *
 * Anything unmeasured (a zero available width, or a first candidate that
 * measured zero) holds index 0, the full form: shortening a title on a
 * measurement that never happened is worse than leaving it long.
 */
export function fittedTitleIndex(
  previous: number,
  available: number,
  widths: readonly number[],
): number {
  if (available <= 0 || widths.length === 0 || widths[0] <= 0) return 0;
  for (let i = 0; i < widths.length; i++) {
    // Growing back to a form longer than the current one has to clear the margin; shrinking to this one, or staying put, does not.
    const room = i < previous ? available - RELENGTHEN_MARGIN_PX : available;
    if (widths[i] <= room) return i;
  }
  return widths.length - 1;
}

/**
 * The title form to render, given the full one and any shorter alternatives,
 * chosen by measuring the box rather than by a column count.
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

  // `compact` is a fresh array on most renders, so its contents are the key, joined on a newline because a short title may contain spaces.
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

  // A changed title moves no box a ResizeObserver would see, so it recomputes through `recompute`'s identity.
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
