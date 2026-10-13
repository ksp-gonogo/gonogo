import {
  type CSSProperties,
  cloneElement,
  type FocusEvent,
  forwardRef,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import styled, { createGlobalStyle } from "styled-components";

/** Where the tip sits, in viewport pixels: below its anchor, or above it where the anchor is low on the screen. */
interface Placement {
  top: number;
  left: number;
  above: boolean;
  anchorTop: number;
}

/** Anchors with less than this much viewport below them put their tip above. */
const ROOM_BELOW_PX = 120;

/** How long the pointer may spend crossing from an anchor to its tip before the tip closes. */
const CROSSING_MS = 120;

/** A name or description reduced to its words, so punctuation cannot make two phrasings of one thing differ. */
const words = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The handlers and data attribute to spread onto the element the tip describes.
 * Useful for opening a tip when the operator points at or focuses the element.
 * Returned as `anchor` by {@link useTooltip}.
 *
 * @category Floating
 */
export interface TooltipAnchorProps {
  /** Opens the tip against the element the pointer entered. */
  onPointerEnter?: (event: { currentTarget: Element }) => void;
  /** Closes the tip shortly after the pointer leaves, unless it moves onto the tip. */
  onPointerLeave?: () => void;
  /** Closes the tip on a press, so it never covers what is being pressed. */
  onPointerDown?: () => void;
  /** Ends the press, so the next keyboard focus can open the tip again. */
  onPointerUp?: () => void;
  /** Opens the tip on keyboard focus; the focus a press gives does not. */
  onFocus?: (event: FocusEvent<Element>) => void;
  /** Closes the tip when focus leaves, unless the pointer still holds it open. */
  onBlur?: () => void;
  /** The tip's text, on the element itself. Absent while there is no tip. */
  "data-tooltip"?: string;
}

/**
 * What {@link useTooltip} returns: props for the anchor, and the tip to render
 * beside it. Useful for explaining a control or figure to the operator in a tip
 * drawn where the caller chooses.
 *
 * @category Floating
 */
export interface UseTooltipResult {
  /** Props to spread on the element the tip belongs to. */
  anchor: TooltipAnchorProps;
  /** The tip itself, portalled to the document body; render it anywhere beside the anchor. */
  tip: ReactNode;
}

/**
 * The kit's tip for `text`: padded, rounded, drawn over everything, and
 * placed below its anchor inside the viewport, so a clipping or scrolling
 * ancestor never cuts it off. Useful for giving the operator the words behind
 * an icon or abbreviation when the tip needs its own placement. Used by the
 * communications addressee control. It opens while the pointer is over the anchor or
 * the anchor has keyboard focus, and closes on a press of the anchor, on Escape (from anywhere on the page), scroll or resize. The pointer can move onto the tip, which stays open while it is hovered and while its text is held or selected, so the operator can copy it.
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
  const [tipHovered, setTipHovered] = useState(false);
  // Set while the operator holds a press inside the tip or has text of it selected, so the tip stays to be read and copied.
  const [pinned, setPinned] = useState(false);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const holding = useRef(false);
  const pressed = useRef(false);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = text != null && text !== "" ? text : null;
  const open = at !== null && (hovered || focused || tipHovered || pinned);
  const cancelLeave = useCallback(() => {
    if (leaving.current !== null) clearTimeout(leaving.current);
    leaving.current = null;
  }, []);
  const close = useCallback(() => {
    cancelLeave();
    setAt(null);
    setHovered(false);
    setFocused(false);
    setTipHovered(false);
    setPinned(false);
    holding.current = false;
  }, [cancelLeave]);

  // Lets go once the press is over and no text of the tip is selected any more.
  useEffect(() => {
    if (!pinned) return;
    const settle = () => {
      const selection = document.getSelection();
      const inTip =
        selection !== null &&
        !selection.isCollapsed &&
        tipRef.current?.contains(selection.anchorNode) === true;
      if (!holding.current && !inTip) setPinned(false);
    };
    const release = () => {
      holding.current = false;
      settle();
    };
    document.addEventListener("pointerup", release);
    document.addEventListener("selectionchange", settle);
    return () => {
      document.removeEventListener("pointerup", release);
      document.removeEventListener("selectionchange", settle);
    };
  }, [pinned]);

  // The pointer gets a moment to cross onto the tip before the anchor's leave closes it.
  const leaveSoon = useCallback(() => {
    cancelLeave();
    leaving.current = setTimeout(() => {
      leaving.current = null;
      setHovered(false);
      setTipHovered(false);
    }, CROSSING_MS);
  }, [cancelLeave]);

  useEffect(() => cancelLeave, [cancelLeave]);

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

  /*
   * WCAG 1.4.13: Escape dismisses the tip wherever focus or the pointer is. It
   * listens in the capture phase on the document and stops the key there, so an
   * enclosing dialog's own Escape handler does not also close the dialog.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, close]);

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
        cancelLeave();
        place(event.currentTarget);
        setHovered(true);
      },
      onPointerLeave: leaveSoon,
      onPointerDown: () => {
        pressed.current = true;
        close();
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
        if (!hovered && !tipHovered) setAt(null);
      },
    },
    tip: open
      ? createPortal(
          <TipBody
            ref={tipRef}
            at={at}
            text={shown}
            onPress={() => {
              holding.current = true;
              setPinned(true);
            }}
            onPointerEnter={() => {
              cancelLeave();
              setTipHovered(true);
            }}
            onPointerLeave={leaveSoon}
          />,
          document.body,
        )
      : null,
  };
}

const TipBody = forwardRef<
  HTMLDivElement,
  {
    at: Placement;
    text: string;
    onPress: () => void;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
  }
>(function TipBody({ at, text, onPress, onPointerEnter, onPointerLeave }, ref) {
  const position: CSSProperties = at.above
    ? { bottom: window.innerHeight - at.anchorTop }
    : { top: at.top };
  return (
    <Tooltip__Body
      ref={ref}
      aria-hidden="true"
      data-tooltip-tip=""
      data-above={at.above ? "" : undefined}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      // The tip is a React child of its anchor, so a press in it would otherwise reach the anchor's own handlers and close the tip, or click whatever the anchor sits in.
      onPointerDown={(event) => {
        event.stopPropagation();
        onPress();
      }}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
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
});

/**
 * The props of {@link Tooltip}: the tip's text and the one element it
 * describes. Useful for explaining a control or figure to the operator without
 * taking room on the tile. Taken by {@link Tooltip}.
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
 * the element's description. Useful for explaining a control or figure to the
 * operator without taking room on the tile. Used by the settings and alarms
 * buttons. The text is also set as the child's
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
        "aria-description": named ? own["aria-description"] : text,
        tabIndex: focusable ? (own.tabIndex ?? 0) : own.tabIndex,
      })}
      {tip}
      {focusable && <TooltipFocusRing />}
    </>
  );
}

/** The kit focus ring for a non-control made focusable by {@link Tooltip}, in place of the browser default. */
const TooltipFocusRing = createGlobalStyle`
  [data-tooltip][tabindex]:not(button, a, input, select, textarea, summary):focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

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
  user-select: text;
  cursor: text;

  &[data-above] {
    margin-top: 0;
    margin-bottom: var(--offset-popover);
  }
`;
