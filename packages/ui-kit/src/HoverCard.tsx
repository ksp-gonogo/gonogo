import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import { Floating } from "./Floating";
import { focusRing } from "./focusRing";

/**
 * The props of {@link HoverCard}.
 * Useful for giving the operator detail on an item without leaving the list.
 * Used by {@link HoverCard}.
 *
 * @category Floating
 */
export interface HoverCardProps {
  /** The always-visible trigger content: a glyph, a tag, a short label. */
  trigger: ReactNode;
  /** Accessible name for the trigger, required since the trigger is usually a glyph. */
  "aria-label": string;
  /** What the card says. Read-only facts: a hover card holds no controls. */
  children: ReactNode;
}

/** Floating's distance from its anchor to the layer's near edge. */
const ANCHOR_GAP = 12;
/** Floating's minimum distance from the viewport edge. */
const VIEWPORT_EDGE = 8;

/** How long the card waits after the pointer leaves, so it can cross the gap onto the card. */
const CLOSE_DELAY_MS = 120;

/**
 * A card of facts about a trigger, shown while the trigger is hovered or
 * focused and gone when neither is, drawn over the page in a {@link Floating}
 * so no panel clips it. The card sits above the trigger so the rows beneath it
 * stay in view and reachable; it drops below the trigger only where there is
 * no room above. Useful for giving the operator detail on an item
 * without leaving the list. Used by the vessel catalog's signal cell and the
 * commcast message rows. The trigger renders as an unstyled `button`. Escape
 * dismisses the card; the pointer can move onto the card without closing it.
 * The card is the trigger's description, so a screen reader hears it on focus.
 *
 * @example
 * ```tsx
 * <HoverCard trigger={<InfoIcon />} aria-label="Signal path">
 *   <Text>Relayed through {relayName}</Text>
 * </HoverCard>
 * ```
 *
 * @category Floating
 */
export function HoverCard({
  trigger,
  "aria-label": ariaLabel,
  children,
}: HoverCardProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardId = useId();

  const cancelClose = useCallback(() => {
    if (closeTimer.current === null) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const show = () => {
    cancelClose();
    setOpen(true);
  };
  const hideSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  const hide = useCallback(() => {
    cancelClose();
    setOpen(false);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  useEffect(() => {
    if (!open) return;
    // Capture phase and stopped there, so an enclosing dialog does not also close on the same Escape.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      hide();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, hide]);

  const anchor = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    /*
     * Floating places its layer ANCHOR_GAP below the anchor, so anchoring a
     * card's own height plus two gaps above the trigger leaves one gap between
     * its bottom edge and the trigger. With no room above, the card falls back
     * to hanging below the trigger.
     */
    const cardHeight = cardRef.current?.offsetHeight ?? 0;
    const above = rect.top - cardHeight - 2 * ANCHOR_GAP;
    return {
      x: rect.left,
      y: above + ANCHOR_GAP >= VIEWPORT_EDGE ? above : rect.bottom,
    };
  };

  return (
    <>
      <HoverCard__Trigger
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-describedby={open ? cardId : undefined}
        onPointerEnter={show}
        onPointerLeave={hideSoon}
        onFocus={show}
        onBlur={hide}
      >
        {trigger}
      </HoverCard__Trigger>
      {open && (
        <Floating
          anchor={anchor}
          onPointerEnter={cancelClose}
          onPointerLeave={hideSoon}
        >
          <HoverCard__Card ref={cardRef} id={cardId} role="tooltip">
            {children}
          </HoverCard__Card>
        </Floating>
      )}
    </>
  );
}

const HoverCard__Trigger = styled.button`
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  cursor: default;

  ${focusRing}
`;

const HoverCard__Card = styled.div`
  padding: var(--inset-popover);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-regular);
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
`;
