import { InfoIcon, Stack } from "@ksp-gonogo/ui-kit";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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
      <button
        ref={triggerRef}
        type="button"
        style={INFO_TRIGGER_STYLE}
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
      </button>
      {open &&
        createPortal(
          <div
            ref={setHost}
            style={{
              ...POPOVER_HOST_STYLE,
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
            }}
          >
            {/* Escape is caught on the GROUP rather than the positioning
                wrapper around it: the wrapper draws nothing and holds no
                focusable area, so a key event can only arrive here by
                bubbling out of the group anyway. */}
            <Stack
              id={panelId}
              role="group"
              aria-label={label}
              style={POPOVER_PANEL_STYLE}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  dismiss();
                }
              }}
            >
              {hasContent ? (
                <>
                  {roleDescription && (
                    <p style={POPOVER_TEXT_STYLE}>{roleDescription}</p>
                  )}
                  {descriptionEffects && (
                    <p style={POPOVER_TEXT_STYLE}>{descriptionEffects}</p>
                  )}
                </>
              ) : (
                <p style={POPOVER_TEXT_STYLE}>No description available</p>
              )}
            </Stack>
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * An 18px round hit area for a 13px glyph: smaller than any kit control, and
 * deliberately so, because it sits inline in a crew row and must not push the
 * line height. The kit's IconButton is sized for a toolbar.
 */
const INFO_TRIGGER_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "18px",
  height: "18px",
  padding: 0,
  border: "none",
  borderRadius: "var(--radius-circle)",
  background: "transparent",
  color: "var(--color-text-faint)",
  cursor: "pointer",
} as const;

/* Fixed to the viewport, because the coordinates come from
   getBoundingClientRect. Carries the popover z rung itself: see the component
   doc comment for why it cannot live on the panel one level in. */
const POPOVER_HOST_STYLE = {
  position: "fixed",
  zIndex: "var(--z-dropdown)",
} as const;

/**
 * The floating surface. Not a `Box`: its border is fixed at the subtle rung and
 * its padding snaps to the space scale, where this needs the strong edge a
 * surface floating over arbitrary content has to have, and the surface inset.
 * The layout half is the kit's Stack, with the gap still named rather than
 * sized so the surface it floats over can retune it.
 */
const POPOVER_PANEL_STYLE = {
  gap: "var(--gap-related)",
  maxWidth: "320px",
  padding: "var(--inset-surface)",
  background: "var(--color-surface-raised)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-regular)",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-primary)",
} as const;

/** Stock trait text arrives with its own line breaks, so they are honoured. */
const POPOVER_TEXT_STYLE = { margin: 0, whiteSpace: "pre-line" } as const;
