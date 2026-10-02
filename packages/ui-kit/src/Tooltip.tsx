import {
  type CSSProperties,
  cloneElement,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";

/** Where the tip sits, in viewport pixels: below its anchor, or above it where the anchor is low on the screen. */
interface Placement {
  top: number;
  left: number;
  above: boolean;
  anchorTop: number;
}

/** Anchors with less than this much viewport below them put their tip above. */
const ROOM_BELOW_PX = 120;

/** A name or description reduced to its words, so punctuation cannot make two phrasings of one thing differ. */
const words = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The handlers and data attribute to spread onto the element the tip describes.
 *
 * @category Floating
 */
export interface TooltipAnchorProps {
  onPointerEnter?: (event: { currentTarget: Element }) => void;
  onPointerLeave?: () => void;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
  onFocus?: (event: FocusEvent<Element>) => void;
  onBlur?: () => void;
  onKeyDown?: (event: KeyboardEvent<Element>) => void;
  "data-tooltip"?: string;
}

/**
 * What {@link useTooltip} returns: props for the anchor, and the tip to render beside it.
 *
 * @category Floating
 */
export interface UseTooltipResult {
  anchor: TooltipAnchorProps;
  /** The tip itself, portalled to the document body; render it anywhere beside the anchor. */
  tip: ReactNode;
}

/**
 * The kit's tip for `text`: padded, rounded, drawn over everything, and
 * placed below its anchor inside the viewport, so a clipping or scrolling
 * ancestor never cuts it off. It opens while the pointer is over the anchor or
 * the anchor has keyboard focus, and closes on Escape, scroll or resize.
 *
 * The tip is hidden from the accessibility tree, so the anchor must already
 * say the same thing to a screen reader (in its text, an `aria-label` or a
 * visually hidden span); {@link Tooltip} does this for any element. The
 * anchor must be focusable for the keyboard to open the tip. `null` or empty
 * text gives an inert anchor and no tip.
 *
 * @example
 * ```tsx
 * function Figure({ caption, children }: { caption: string | null; children: ReactNode }) {
 *   const { anchor, tip } = useTooltip(caption);
 *   return (
 *     <span {...anchor}>
 *       {children}
 *       {caption && <VisuallyHidden>, {caption}</VisuallyHidden>}
 *       {tip}
 *     </span>
 *   );
 * }
 * ```
 *
 * @category Floating
 */
export function useTooltip(text: string | null | undefined): UseTooltipResult {
  const [at, setAt] = useState<Placement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const pressed = useRef(false);
  const shown = text != null && text !== "" ? text : null;
  const open = at !== null && (hovered || focused);
  const close = useCallback(() => {
    setAt(null);
    setHovered(false);
    setFocused(false);
  }, []);

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

  const place = (element: Element) => {
    const box = element.getBoundingClientRect();
    setAt({
      top: box.bottom,
      left: box.left,
      above: window.innerHeight - box.bottom < ROOM_BELOW_PX,
      anchorTop: box.top,
    });
  };

  return {
    anchor: {
      "data-tooltip": shown,
      onPointerEnter: (event) => {
        place(event.currentTarget);
        setHovered(true);
      },
      onPointerLeave: () => {
        setHovered(false);
        if (!focused) setAt(null);
      },
      onPointerDown: () => {
        pressed.current = true;
      },
      onPointerUp: () => {
        pressed.current = false;
      },
      onFocus: (event) => {
        // A pointer press focuses its target too; only keyboard focus opens the tip on its own.
        if (pressed.current) return;
        place(event.currentTarget);
        setFocused(true);
      },
      onBlur: () => {
        setFocused(false);
        if (!hovered) setAt(null);
      },
      onKeyDown: (event) => {
        if (event.key === "Escape" && open) close();
      },
    },
    tip: open
      ? createPortal(<TipBody at={at} text={shown} />, document.body)
      : null,
  };
}

function TipBody({ at, text }: { at: Placement; text: string }) {
  const position: CSSProperties = at.above
    ? { bottom: window.innerHeight - at.anchorTop }
    : { top: at.top };
  return (
    <Tooltip__Body
      aria-hidden="true"
      data-tooltip-tip=""
      data-above={at.above ? "" : undefined}
      style={
        {
          ...position,
          left: at.left,
          "--tip-left": `${at.left}px`,
        } as CSSProperties
      }
    >
      {text}
    </Tooltip__Body>
  );
}

/**
 * The props of {@link Tooltip}.
 *
 * @category Floating
 */
export interface TooltipProps {
  /** What the tip says. `null` or empty leaves the child untouched. */
  text: string | null | undefined;
  /** The one element the tip describes. It must forward its props to a DOM element. */
  children: ReactElement<Record<string, unknown>>;
  /**
   * Makes the child a tab stop, so the keyboard can reach a tip on an element
   * that is not a control (a readout, a badge). Leave it off on a button,
   * link or input, which is focusable already.
   */
  focusable?: boolean;
  /**
   * Whether the text is also given to assistive technology as the child's
   * `aria-description`. Defaults to `true`. Set `false` where the child already
   * says the same words in its own text, as a tab does whose tip only shows a
   * label that truncates, or where the child is hidden from assistive
   * technology.
   */
  announce?: boolean;
}

/** The child's own handler, if it has one, then the tip's. */
function joined<Args extends unknown[]>(
  own: unknown,
  ours: ((...args: Args) => void) | undefined,
): (...args: Args) => void {
  return (...args) => {
    if (typeof own === "function") own(...args);
    ours?.(...args);
  };
}

/**
 * A tip for any element, in place of the browser's `title` attribute: themed,
 * opened by pointer or keyboard focus, dismissed by Escape, and announced as
 * the element's description. The text is also set as the child's
 * `aria-description`, so a screen reader hears it without the tip being open
 * and no hidden text is added to the page. Where the child already carries the
 * same words in its `aria-label`, nothing is added.
 *
 * It adds no wrapper: the handlers are merged onto the child itself.
 *
 * @example
 * ```tsx
 * <Tooltip text="Saves the game, then flies the vessel you pick">
 *   <Button onClick={open}>Fly vessel</Button>
 * </Tooltip>
 * ```
 *
 * @category Floating
 */
export function Tooltip({
  text,
  children,
  focusable = false,
  announce = true,
}: TooltipProps) {
  const { anchor, tip } = useTooltip(text);
  if (text == null || text === "") return children;

  const own = children.props;
  const label = own["aria-label"];
  const named =
    !announce ||
    (typeof label === "string" && words(label).includes(words(text)));

  return (
    <>
      {cloneElement(children, {
        "data-tooltip": text,
        onPointerEnter: joined(own.onPointerEnter, anchor.onPointerEnter),
        onPointerLeave: joined(own.onPointerLeave, anchor.onPointerLeave),
        onPointerDown: joined(own.onPointerDown, anchor.onPointerDown),
        onPointerUp: joined(own.onPointerUp, anchor.onPointerUp),
        onFocus: joined(own.onFocus, anchor.onFocus),
        onBlur: joined(own.onBlur, anchor.onBlur),
        onKeyDown: joined(own.onKeyDown, anchor.onKeyDown),
        "aria-description": named ? own["aria-description"] : text,
        tabIndex: focusable ? (own.tabIndex ?? 0) : own.tabIndex,
      })}
      {tip}
    </>
  );
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
  white-space: pre-line;
  pointer-events: none;

  &[data-above] {
    margin-top: 0;
    margin-bottom: var(--offset-popover);
  }
`;
