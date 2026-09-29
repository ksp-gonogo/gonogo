import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

export interface InlineOverflow {
  /** Content is scrolled past on the start edge. */
  left: boolean;
  /** Content remains beyond the end edge. */
  right: boolean;
}

const NONE: InlineOverflow = { left: false, right: false };

/**
 * Which inline edges of a horizontal scroller have content beyond them, kept
 * current across scrolling and across the scroller or its children resizing.
 */
export function useInlineOverflow(el: HTMLElement | null): InlineOverflow {
  const [overflow, setOverflow] = useState(NONE);
  // React's same-value bailout is not guaranteed with other work queued, so an unchanged measurement is filtered here.
  const last = useRef(NONE);

  useEffect(() => {
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      if (last.current.left === left && last.current.right === right) return;
      last.current = { left, right };
      setOverflow(last.current);
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    const mo = new MutationObserver(() => {
      for (const child of Array.from(el.children)) ro?.observe(child);
      update();
    });
    mo.observe(el, { childList: true });
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
      mo.disconnect();
    };
  }, [el]);

  return overflow;
}

/**
 * The glow over a horizontal scroller's edge that says more content lies that
 * way. At least the panel gutter wide, so a strip reaching the panel's edge
 * fades out across the gutter instead of stopping hard at the padding. Render
 * it after the scroller: it paints over it by document order.
 */
export const InlineOverflowGlow = styled.div<{
  $position: "left" | "right";
  $visible: boolean;
}>`
  position: absolute;
  top: 0;
  bottom: 0;
  ${({ $position }) => ($position === "left" ? "left: 0;" : "right: 0;")}
  width: max(28px, var(--bleed-inline));
  pointer-events: none;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transition: opacity var(--duration-base) var(--ease-standard);
  background: linear-gradient(
    to ${({ $position }) => ($position === "left" ? "right" : "left")},
    rgba(255, 255, 255, 0.12),
    rgba(255, 255, 255, 0) 100%
  );

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;
