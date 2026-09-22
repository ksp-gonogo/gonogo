import { ArrowRightIcon, CloseIcon } from "@ksp-gonogo/ui";
import { Row, Stack } from "@ksp-gonogo/ui-kit";
import { PRESETS } from "./presets";
import type { ArmedTrigger } from "./triggerTypes";

interface ArmedTriggersListProps {
  triggers: readonly ArmedTrigger[];
  onCancel: (id: string) => void;
}

export function ArmedTriggersList({
  triggers,
  onCancel,
}: ArmedTriggersListProps) {
  if (triggers.length === 0) return null;
  return (
    <Stack as="ul" style={LIST_STYLE}>
      {triggers.map((t) => {
        const presetLabel =
          PRESETS.find((p) => p.id === t.inputs.preset)?.label ??
          t.inputs.preset;
        return (
          <Row key={t.id} role="status" style={ARMED_ROW_STYLE}>
            <div style={MAIN_STYLE}>
              <div style={PRIMARY_STYLE}>
                {t.dataKey} {t.op} {t.value}
              </div>
              <div style={META_STYLE}>
                <ArrowRightIcon size={11} /> {presetLabel}
              </div>
            </div>
            <button
              type="button"
              style={CANCEL_BUTTON_STYLE}
              onClick={() => onCancel(t.id)}
              aria-label="Cancel armed trigger"
            >
              <CloseIcon size={12} />
            </button>
          </Row>
        );
      })}
    </Stack>
  );
}

/** A list that is a Stack: the bullets and the browser's list insets go, the
 *  semantic `ul` stays. The gap is named rather than sized so a card around
 *  this list tightens it the way it tightens everything else. */
const LIST_STYLE = {
  gap: "var(--gap-related)",
  listStyle: "none",
  margin: 0,
  padding: 0,
} as const;

/**
 * An armed trigger is a warned card rather than a plain row, so the surface
 * rides on the kit's Row: Row brings the flex, the space-between and the gap,
 * and the padding here replaces its own because a card needs the surface inset
 * rather than a row's hairline.
 */
const ARMED_ROW_STYLE = {
  padding: "var(--inset-surface)",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-status-warning-bg)",
  borderRadius: "var(--radius-regular)",
} as const;

/* The seam between the two lines of one readout. A rung rather than a semantic
   name on purpose: 1px is the same 1px in every density tier, so a name for it
   would be a constant with two spellings. tokens.css says so. */
const MAIN_STYLE = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-hair)",
  minWidth: 0,
} as const;

const PRIMARY_STYLE = {
  fontSize: "var(--font-size-value)",
  color: "var(--color-status-warning-bg)",
  fontWeight: 600,
  letterSpacing: "0.02em",
} as const;

const META_STYLE = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-dim)",
  letterSpacing: "0.04em",
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--gap-related)",
} as const;

/** A 22px square for a 12px glyph, sized to the row rather than to a toolbar. */
const CANCEL_BUTTON_STYLE = {
  background: "transparent",
  border: "1px solid var(--color-status-alert-muted)",
  color: "var(--color-text-muted)",
  width: "22px",
  height: "22px",
  borderRadius: "var(--radius-regular)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
} as const;
