import { Floating, InfoIcon, Stack } from "@ksp-gonogo/ui-kit";
import { useCallback, useEffect, useId, useRef, useState } from "react";

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const dismiss = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const anchor = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    return rect ? { x: rect.left, y: rect.bottom } : null;
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      const panel = document.getElementById(panelId);
      if (panel?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      dismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, panelId, dismiss]);

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
      {open && (
        <Floating anchor={anchor}>
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
        </Floating>
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
