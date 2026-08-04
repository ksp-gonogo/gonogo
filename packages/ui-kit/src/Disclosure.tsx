import { type ReactNode, useId, useRef, useState } from "react";
import styled from "styled-components";

export interface DisclosureProps {
  /** The always-visible trigger content (text, a glyph, a badge). */
  label: ReactNode;
  /** The panel content, revealed when open. */
  children: ReactNode;
  /**
   * Accessible name for the trigger. Required when `label` is a non-text node
   * (an icon/glyph) so the button is not unlabelled to a screen reader.
   */
  ariaLabel?: string;
  className?: string;
}

/**
 * A minimal accessible disclosure: a real `<button aria-expanded>` that toggles a
 * panel, keyboard AND pointer reachable (click / Enter / Space to open, Escape to
 * close returning focus to the trigger), with a visible focus ring. The one
 * general-purpose focus/tap detail surface in the kit, deliberately NOT the
 * hover-only reveal `ControlDelayStream` uses (unreachable without a mouse). Use
 * it wherever a compact control needs to expand detail on demand.
 */
export function Disclosure({
  label,
  children,
  ariaLabel,
  className,
}: DisclosureProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <Disclosure__Root
      className={className}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <Disclosure__Trigger
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </Disclosure__Trigger>
      {open && (
        <Disclosure__Panel id={panelId} role="group">
          {children}
        </Disclosure__Panel>
      )}
    </Disclosure__Root>
  );
}

const Disclosure__Root = styled.div`
  position: relative;
  display: inline-flex;
`;

const Disclosure__Trigger = styled.button`
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-4);
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

const Disclosure__Panel = styled.div`
  position: absolute;
  top: 100%;
  right: 0;
  /* Local sibling ordering inside this component's own stacking context: lift the
     popped panel above following content (e.g. later rows). Not app-global chrome,
     so a named z rung would wrongly outrank the dashboard's. */
  z-index: 1;
  margin-top: var(--space-2);
  padding: var(--space-6) var(--space-8);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
`;
