import { NULL_DISPLAY, ToggleButton } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";

interface ControlTogglesProps {
  disabled: boolean;
  /** SAS as read, uncoerced: absent is a third state, not false. */
  sas: boolean | null | undefined;
  /** The active SAS mode's three-letter token, or `""` when no mode is on the wire. */
  sasBadgeMode: string;
  /** RCS as read, uncoerced. */
  rcs: boolean | null | undefined;
  /** Precision control as read, uncoerced; the chip is absent until a reading lands. */
  precision: boolean | null | undefined;
  onToggleSas: () => void;
  onToggleRcs: () => void;
}

/**
 * SAS and RCS toggles plus a precision readout, on every tile wide enough, not
 * only in control mode. The SAS toggle carries the active mode, since on a tile
 * too small for the mode grid it is the only place the mode appears. Precision
 * has no set command, so it is a readout.
 */
export function ControlToggles({
  disabled,
  sas,
  sasBadgeMode,
  rcs,
  precision,
  onToggleSas,
  onToggleRcs,
}: ControlTogglesProps) {
  return (
    <>
      {disabled && (
        <div style={BANNER} role="status" aria-live="polite">
          Vessel not controllable: buttons disabled.
        </div>
      )}
      <div style={TOGGLE_ROW}>
        <ToggleButton
          type="button"
          size="sm"
          style={TOGGLE_CELL}
          active={sas === true}
          onClick={onToggleSas}
          disabled={disabled}
        >
          {armLabel("SAS", sas, sasBadgeMode)}
        </ToggleButton>
        <ToggleButton
          type="button"
          size="sm"
          style={TOGGLE_CELL}
          active={rcs === true}
          onClick={onToggleRcs}
          disabled={disabled}
        >
          {armLabel("RCS", rcs)}
        </ToggleButton>
        {/* A dim chip means off, so there is no chip until precision is read. */}
        {typeof precision === "boolean" && (
          <ToggleButton
            type="button"
            size="sm"
            style={TOGGLE_CELL}
            active={precision}
            disabled
          >
            PRECISION
          </ToggleButton>
        )}
      </div>
    </>
  );
}

/**
 * One arm's toggle label: `SAS: PRO` / `RCS ON` when on, `SAS OFF` when
 * confirmed off, and the name plus `NULL_DISPLAY` when unread. Not the bare
 * name, which would collide with the mode grid's "SAS" stability-assist button.
 */
function armLabel(
  name: string,
  on: boolean | null | undefined,
  mode?: string,
): string {
  if (on !== true && on !== false) return `${name} ${NULL_DISPLAY}`;
  if (!on) return `${name} OFF`;
  return mode ? `${name}: ${mode}` : `${name} ON`;
}

const BANNER: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-warn-text)",
  padding: "var(--inset-surface)",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-warn-mark)",
  borderRadius: "var(--radius-regular)",
};

/** The SAS/RCS/precision row, packed by each control's own width rather than a uniform column minimum. */
const TOGGLE_ROW: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--gap-related)",
};

// Never shrinks: an inline-flex button's minimum is its widest word, so shrinking breaks or overflows the label before the row wraps.
const TOGGLE_CELL: CSSProperties = { flex: "1 0 auto" };
