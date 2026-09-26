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
 * A per-kerbal toggle revealing the stock trait text in a popover, portalled to
 * the body because the crew list's scroll area would clip it.
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

  /* A layout effect so the first painted position is the corrected one. Scroll
     is captured because the dashboard scrolls an inner container, whose scroll
     events do not bubble. */
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
        // Focus stays on the trigger, and Escape here never reaches the portalled panel's handler.
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

/** Smaller than any kit control, so it sits inline in a crew row without pushing the line height. */
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

// A fixed element is its own stacking context, so the z rung must sit here and not on the panel inside it.
const POPOVER_HOST_STYLE = {
  position: "fixed",
  zIndex: "var(--z-dropdown)",
} as const;

// Not a Box: a surface floating over arbitrary content needs the strong border and the surface inset.
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
