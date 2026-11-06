import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

/** How far from the bottom, in pixels, still counts as being at it. */
const AT_BOTTOM_PX = 8;

/**
 * Keeps the bottom of a scrolling log in view as entries arrive, for as long
 * as the reader has not scrolled away from it. A reader who has scrolled up
 * keeps their place; scrolling back to the bottom resumes following.
 *
 * `count` is how many entries the log holds: a change in it is what triggers
 * the scroll, once the new entry has been laid out.
 */
export function useKeepNewestInView(
  scroller: RefObject<HTMLElement | null>,
  count: number,
): void {
  const following = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      following.current =
        el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [scroller]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the count is the trigger, the effect reads only the element
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [scroller, count]);
}
