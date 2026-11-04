import {
  CommandButton,
  type CommandButtonHandle,
  type CommandButtonState,
  Notice,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";

interface ControlTogglesProps {
  disabled: boolean;
  /** The SAS, RCS and precision controls and the commands they send, from `useSasControls`. */
  sas: { control: CommandButtonState; handle: CommandButtonHandle };
  rcs: { control: CommandButtonState; handle: CommandButtonHandle };
  /** Absent until a precision reading lands: an unpressed toggle means off, so there is none until then. */
  precision: {
    control: CommandButtonState;
    handle: CommandButtonHandle;
  } | null;
  /** Why SAS cannot be turned on, or null when it can; the toggle is held and says so. */
  sasUnavailableReason: string | null;
}

/**
 * SAS, RCS and precision control toggles, on every tile wide enough, not only
 * in control mode. The SAS toggle carries the active mode, since on a tile too
 * small for the mode grid it is the only place the mode appears.
 */
export function ControlToggles({
  disabled,
  sas,
  rcs,
  precision,
  sasUnavailableReason,
}: ControlTogglesProps) {
  return (
    <>
      {disabled && <Notice>Vessel not controllable: buttons disabled.</Notice>}
      <div style={TOGGLE_ROW}>
        <CommandButton
          size="sm"
          style={TOGGLE_CELL}
          handle={sas.handle}
          controller={sas.control}
          label="SAS"
        />
        <CommandButton
          size="sm"
          style={TOGGLE_CELL}
          handle={rcs.handle}
          controller={rcs.control}
          label="RCS"
        />
        {precision && (
          <CommandButton
            size="sm"
            style={TOGGLE_CELL}
            handle={precision.handle}
            controller={precision.control}
            label="Precision"
          />
        )}
      </div>
      {sasUnavailableReason && <Notice>{sasUnavailableReason}</Notice>}
    </>
  );
}

/** The SAS/RCS/precision row, packed by each control's own width rather than a uniform column minimum. */
const TOGGLE_ROW: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--gap-related)",
};

// Never shrinks: an inline-flex button's minimum is its widest word, so shrinking breaks or overflows the label before the row wraps.
const TOGGLE_CELL: CSSProperties = { flex: "1 0 auto" };
