import { InfoIcon } from "@ksp-gonogo/ui-kit";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { anchoredMenuPosition } from "../ShipMap/anchoredMenuPosition";

/**
 * A per-kerbal info toggle: a real `<button aria-expanded>` that reveals the
 * stock trait tooltip text (role description + current-rank effects) in a
 * portalled popover, keyboard-operable and Escape-dismissible.
 *
 * <p>Portalled to `document.body` rather than positioned in-flow: the crew
 * list scrolls inside a `ScrollArea` (`overflow: auto`), which clips a
 * same-stacking-context popover taller than the remaining tile space, the
 * same reasoning the Ship Map's part-action menu documents. The host div
 * carries `position: fixed` PLUS the popover z-index rung: a fixed element
 * is its own stacking context, so a rung declared one level in (on the panel
 * rather than the host) would be trapped there and painted under the
 * dashboard grid's own local z-index instead of clearing it.</p>
 */
export function KerbalInfoPopover({
  name,
  roleDescription,
  descriptionEffects,
}: Readonly<{
  name: string;
  roleDescription?: string;
  descriptionEffects?: string;
}>) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const dismiss = useCallback(() => {
    setOpen(false);
    setPos(null);
    triggerRef.current?.focus();
  }, []);

  // Re-place the portalled popover against the viewport once it can be
  // measured. A layout effect, not a passive one, so the corrected position
  // is the first one painted rather than a visible jump from 0,0. Re-runs on
  // resize and on scroll: the dashboard scrolls an inner container, not the
  // window, so the listener is capture-phase (those events don't bubble).
  useLayoutEffect(() => {
    if (!open || !host) return;
    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const anchorRect = trigger.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const next = anchoredMenuPosition(
        { x: anchorRect.left, y: anchorRect.bottom },
        { w: hostRect.width, h: hostRect.height },
        { w: window.innerWidth, h: window.innerHeight },
      );
      setPos((prev) =>
        prev && prev.left === next.left && prev.top === next.top ? prev : next,
      );
    };
    place();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(host);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, host]);

  // An outside pointer press dismisses, the same contract ActionMenu uses.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (host?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      dismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, host, dismiss]);

  const label = `Role info for ${name || "kerbal"}`;
  const hasContent = Boolean(roleDescription) || Boolean(descriptionEffects);

  return (
    <>
      <InfoTrigger
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        // The panel is portalled outside this button's DOM subtree, so
        // Escape pressed while focus sits on the trigger (where it stays
        // after the opening click, this isn't a focus-stealing dialog)
        // never reaches the portal's own handler below. Caught here too.
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            dismiss();
          }
        }}
      >
        <InfoIcon size={13} />
      </InfoTrigger>
      {open &&
        createPortal(
          <PopoverHost
            ref={setHost}
            style={{ left: pos?.left ?? 0, top: pos?.top ?? 0 }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                dismiss();
              }
            }}
          >
            <PopoverPanel id={panelId} role="group" aria-label={label}>
              {hasContent ? (
                <>
                  {roleDescription && (
                    <PopoverText>{roleDescription}</PopoverText>
                  )}
                  {descriptionEffects && (
                    <PopoverText>{descriptionEffects}</PopoverText>
                  )}
                </>
              ) : (
                <PopoverText>No description available</PopoverText>
              )}
            </PopoverPanel>
          </PopoverHost>,
          document.body,
        )}
    </>
  );
}

const InfoTrigger = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: var(--radius-circle, 50%);
  background: transparent;
  color: var(--color-text-faint);
  cursor: pointer;

  &:hover {
    color: var(--color-accent-fg);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

// Fixed to the viewport: coordinates come from getBoundingClientRect, which
// is viewport-relative. Carries the popover z-index rung itself, see the
// component doc comment for why it can't live on the panel one level in.
const PopoverHost = styled.div`
  position: fixed;
  z-index: var(--z-dropdown, 200);
`;

const PopoverPanel = styled.div`
  max-width: 320px;
  padding: var(--space-8) var(--space-10);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
`;

const PopoverText = styled.p`
  margin: 0;
  white-space: pre-line;
`;
