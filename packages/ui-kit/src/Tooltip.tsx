import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";

/** Where the tip sits, in viewport pixels. */
interface Placement {
  top: number;
  left: number;
}

/**
 * The pointer handlers and data attribute to spread onto the element the tip describes.
 *
 * @category Held figures
 */
export interface TooltipAnchorProps {
  onPointerEnter?: (event: { currentTarget: Element }) => void;
  onPointerLeave?: () => void;
  "data-tooltip"?: string;
}

/**
 * What {@link useTooltip} returns: props for the anchor, and the tip to render beside it.
 *
 * @category Held figures
 */
export interface Tooltip {
  anchor: TooltipAnchorProps;
  /** The tip itself, portalled to the document body; render it anywhere beside the anchor. */
  tip: ReactNode;
}

/**
 * The kit's hover tip: padded, rounded, drawn over everything, and placed
 * below its anchor inside the viewport, so a clipping or scrolling ancestor
 * never cuts it off.
 *
 * It says in words what the anchor already says to a screen reader, so it is
 * hidden from the accessibility tree. `null` or empty text gives an inert
 * anchor and no tip.
 *
 * @category Held figures
 */
export function useTooltip(text: string | null | undefined): Tooltip {
  const [at, setAt] = useState<Placement | null>(null);
  const shown = text != null && text !== "" ? text : null;
  const close = useCallback(() => setAt(null), []);

  // A tip placed once goes stale when the page under it moves.
  useEffect(() => {
    if (at === null) return;
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [at, close]);

  if (shown === null) return { anchor: {}, tip: null };

  return {
    anchor: {
      "data-tooltip": shown,
      onPointerEnter: (event) => {
        const box = event.currentTarget.getBoundingClientRect();
        setAt({ top: box.bottom, left: box.left });
      },
      onPointerLeave: close,
    },
    tip:
      at === null
        ? null
        : createPortal(
            <Tooltip__Body
              aria-hidden="true"
              data-tooltip-tip=""
              style={
                {
                  top: at.top,
                  left: at.left,
                  "--tip-left": `${at.left}px`,
                } as CSSProperties
              }
            >
              {shown}
            </Tooltip__Body>,
            document.body,
          ),
  };
}

const Tooltip__Body = styled.div`
  position: fixed;
  z-index: var(--z-toast);
  margin-top: var(--offset-popover);
  max-width: min(18rem, calc(100vw - 2 * var(--offset-popover)));
  /* Pulled back inside the viewport when the anchor sits near its right edge. */
  translate: min(0px, calc(100vw - 100% - var(--offset-popover) - var(--tip-left, 0px)));
  padding: var(--inset-tooltip);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-floating);
  box-shadow: var(--shadow-popover-drop) rgba(0, 0, 0, 0.35);
  color: var(--color-text-primary);
  font-size: var(--font-size-caption);
  line-height: var(--line-height-body);
  letter-spacing: 0.02em;
  white-space: normal;
  pointer-events: none;
`;
