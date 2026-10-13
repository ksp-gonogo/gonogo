import {
  Notice,
  NULL_DISPLAY,
  type ReckoningMarking,
  ToggleButton,
  Tooltip,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";

interface ControlTogglesProps {
  disabled: boolean;
  /** SAS as read, uncoerced: absent is a third state, not false. */
  sas: boolean | null | undefined;
  /** The active SAS mode's three-letter token, or `""` when no mode is on the wire. */
  sasBadgeMode: string;
  /** Why SAS cannot be turned on, or null when it can; the toggle is held and says so. */
  sasUnavailableReason: string | null;
  /** RCS as read, uncoerced. */
  rcs: boolean | null | undefined;
  /** Precision control as read, uncoerced; the chip is absent until a reading lands. */
  precision: boolean | null | undefined;
  /** The control reading's mark when the states shown are held rather than current, so a toggle is never drawn as a live setting it no longer is. */
  marking: ReckoningMarking | null;
  onToggleSas: () => void;
  onToggleRcs: () => void;
}

/**
 * SAS and RCS toggles plus a precision readout, on every tile wide enough, not
 * only in control mode. The SAS toggle carries the active mode, since on a tile
 * too small for the mode grid it is the only place the mode appears. Precision
 * has no set command, so it is a readout.
 */
/** Why every control of the toggle row is dark while the vessel cannot be flown. */
const NOT_CONTROLLABLE = "The vessel is not controllable";

export function ControlToggles({
  disabled,
  sas,
  sasBadgeMode,
  sasUnavailableReason,
  rcs,
  precision,
  marking,
  onToggleSas,
  onToggleRcs,
}: ControlTogglesProps) {
  // A held state stays pressable; the tip says what the press does with it.
  const heldState =
    marking === null
      ? null
      : {
          ...marking,
          caption: `${marking.caption}. The press sends the opposite of the state shown`,
        };
  return (
    <>
      {disabled && <Notice>Vessel not controllable: buttons disabled.</Notice>}
      <div style={TOGGLE_ROW}>
        <Tooltip text={sasUnavailableReason ?? undefined}>
          <ToggleButton
            type="button"
            size="sm"
            style={TOGGLE_CELL}
            pressed={sas === true}
            onClick={onToggleSas}
            disabled={disabled || sasUnavailableReason !== null}
            disabledReason={sasUnavailableReason ?? NOT_CONTROLLABLE}
            marked={heldState}
          >
            {armLabel("SAS", sas, sasBadgeMode)}
          </ToggleButton>
        </Tooltip>
        <ToggleButton
          type="button"
          size="sm"
          style={TOGGLE_CELL}
          pressed={rcs === true}
          onClick={onToggleRcs}
          disabled={disabled}
          disabledReason={NOT_CONTROLLABLE}
          marked={heldState}
        >
          {armLabel("RCS", rcs)}
        </ToggleButton>
        {/* A dim chip means off, so there is no chip until precision is read. */}
        {typeof precision === "boolean" && (
          <ToggleButton
            type="button"
            size="sm"
            style={TOGGLE_CELL}
            pressed={precision}
            disabled
            disabledReason="Precision mode is set in the game, not from here"
          >
            PRECISION
          </ToggleButton>
        )}
      </div>
      {sasUnavailableReason && <Notice>{sasUnavailableReason}</Notice>}
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

/** The SAS/RCS/precision row, packed by each control's own width rather than a uniform column minimum. */
const TOGGLE_ROW: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--gap-related)",
};

// Never shrinks: an inline-flex button's minimum is its widest word, so shrinking breaks or overflows the label before the row wraps.
const TOGGLE_CELL: CSSProperties = { flex: "1 0 auto" };
