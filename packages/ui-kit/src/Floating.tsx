import {
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import {
  type AnchoredPosition,
  type AnchorPoint,
  anchoredPosition,
} from "./anchoredPosition";

/**
 * The props of {@link Floating}.
 *
 * @category Floating
 */
export interface FloatingProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The viewport point the layer attaches to, or a function returning it. A
   * function is re-read whenever the layer re-places (on resize and on any
   * scroll), so a layer anchored to an element follows it.
   */
  anchor: AnchorPoint | (() => AnchorPoint | null);
  children?: ReactNode;
}

/**
 * A layer drawn over the whole page rather than inside its widget: a hover
 * card, a tooltip, an anchored menu. It is portalled to the document body, so
 * no panel or scroll box clips it, and placed against the viewport by
 * {@link anchoredPosition}. It is measured before paint (and stays hidden
 * until then), and re-placed on every render, on resize and on any scroll.
 * The layer has no surface of its own: style what you put inside it. Any
 * other `div` attribute passes through to the layer.
 *
 * React events still bubble through the component tree, not the DOM, so a
 * pointer handler on an ancestor sees events from inside the layer.
 *
 * @example
 * ```tsx
 * function PartMenu({ details }: { details: ReactNode }) {
 *   const [anchor, setAnchor] = useState<AnchorPoint | null>(null);
 *   return (
 *     <>
 *       <Button onClick={(e) => setAnchor({ x: e.clientX, y: e.clientY })}>
 *         Details
 *       </Button>
 *       {anchor && (
 *         <Floating anchor={anchor} onMouseLeave={() => setAnchor(null)}>
 *           <Box surface="raised" pad="popover" radius="floating" bordered>
 *             {details}
 *           </Box>
 *         </Floating>
 *       )}
 *     </>
 *   );
 * }
 * ```
 *
 * @category Floating
 */
export function Floating({ anchor, style, children, ...rest }: FloatingProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<AnchoredPosition | null>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  const place = useCallback(() => {
    if (!host) return;
    const current = anchorRef.current;
    const at = typeof current === "function" ? current() : current;
    if (!at) return;
    const box = host.getBoundingClientRect();
    const next = anchoredPosition(
      at,
      { w: box.width, h: box.height },
      { w: window.innerWidth, h: window.innerHeight },
    );
    setPos((prev) =>
      prev && prev.left === next.left && prev.top === next.top ? prev : next,
    );
  }, [host]);

  // Every render re-places, since the anchor may have moved with it; an unchanged position is not a state change.
  useLayoutEffect(() => {
    place();
  });

  useLayoutEffect(() => {
    if (!host) return;
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(host);
    window.addEventListener("resize", place);
    // Captured: the dashboard scrolls inner containers, whose scroll events do not bubble.
    window.addEventListener("scroll", place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [host, place]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <Floating__Root
      ref={setHost}
      // Hidden until measured, so the unplaced first frame never shows.
      style={{
        ...style,
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos === null ? "hidden" : style?.visibility,
      }}
      {...rest}
    >
      {children}
    </Floating__Root>,
    document.body,
  );
}

const Floating__Root = styled.div`
  position: fixed;
  z-index: var(--z-dropdown);
`;
