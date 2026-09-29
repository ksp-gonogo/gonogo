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
 *
 * @category HoverCard
 */
export interface HoverCardProps {
  /** The always-visible trigger content: a glyph, a tag, a short label. */
  trigger: ReactNode;
  /** Accessible name for the trigger, required since the trigger is usually a glyph. */
  ariaLabel: string;
  /** What the card says. Read-only facts: a hover card holds no controls. */
  children: ReactNode;
}

/** How long the card waits after the pointer leaves, so it can cross the gap onto the card. */
const CLOSE_DELAY_MS = 120;

/**
 * A card of facts about a trigger, shown while the trigger is hovered or
 * focused and gone when neither is, drawn over the page so no Panel clips it.
 * Escape dismisses it; the pointer can move onto the card without closing it.
 * The card is the trigger's description, so a screen reader hears it on focus.
 *
 * @category HoverCard
 */
export function HoverCard({ trigger, ariaLabel, children }: HoverCardProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hide]);

  const anchor = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    return rect ? { x: rect.left, y: rect.bottom } : null;
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
          <HoverCard__Card id={cardId} role="tooltip">
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
  cursor: help;

  ${focusRing}
`;

const HoverCard__Card = styled.div`
  padding: var(--inset-popover);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-regular);
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
`;
