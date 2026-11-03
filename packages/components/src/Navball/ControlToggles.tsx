import {
  Notice,
  NULL_DISPLAY,
  type ReckoningMarking,
  ReservedText,
  ToggleButton,
  Tooltip,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import {
  ALL_CONFIRMATION_WORDS,
  confirmationSentenceOf,
  confirmationWordOf,
  heldCommandMarking,
  shownToggleState,
  type ToggleConfirmation,
} from "../shared/toggleConfirmation";

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
  /** Precision control as read, uncoerced; the toggle is absent until a reading lands. */
  precision: boolean | null | undefined;
  /** Where each toggle's latest press stands, or null when none is outstanding. */
  confirmations: {
    sas: ToggleConfirmation | null;
    rcs: ToggleConfirmation | null;
    precision: ToggleConfirmation | null;
  };
  /** The control reading's mark when the states shown are held rather than current, so a toggle is never drawn as a live setting it no longer is. */
  marking: ReckoningMarking | null;
  onToggleSas: () => void;
  onToggleRcs: () => void;
  onTogglePrecision: () => void;
}

/**
 * SAS, RCS and precision control toggles, on every tile wide enough, not only
 * in control mode. The SAS toggle carries the active mode, since on a tile too
 * small for the mode grid it is the only place the mode appears.
 */
/** Why every control of the toggle row is dark while the vessel cannot be flown. */
const NOT_CONTROLLABLE = "The vessel is not controllable";

export function ControlToggles({
  disabled,
  sas: sasReading,
  sasBadgeMode,
  sasUnavailableReason,
  rcs: rcsReading,
  precision: precisionReading,
  confirmations,
  marking,
  onToggleSas,
  onToggleRcs,
  onTogglePrecision,
}: ControlTogglesProps) {
  const sas = shownToggleState(sasReading, confirmations.sas);
  const rcs = shownToggleState(rcsReading, confirmations.rcs);
  const precision = shownToggleState(precisionReading, confirmations.precision);
  // A held state stays pressable; the tip says what the press does with it.
  const heldState =
    marking === null
      ? null
      : {
          ...marking,
          caption: `${marking.caption}. The press sends the opposite of the state shown`,
        };
  const marksFor = (label: string, confirmation: ToggleConfirmation | null) =>
    heldCommandMarking(label, confirmation, heldState);
  // A held command's sentence rides the held mark's tip, so the tooltip beside it stays free.
  const tipFor = (label: string, confirmation: ToggleConfirmation | null) =>
    confirmation === "held" || confirmation === "modelled"
      ? undefined
      : (confirmationSentenceOf(label, confirmation) ?? undefined);
  return (
    <>
      {disabled && <Notice>Vessel not controllable: buttons disabled.</Notice>}
      <div style={TOGGLE_ROW}>
        <Tooltip
          text={sasUnavailableReason ?? tipFor("SAS", confirmations.sas)}
        >
          <ToggleButton
            type="button"
            size="sm"
            style={TOGGLE_CELL}
            pressed={sas === true}
            onClick={onToggleSas}
            disabled={disabled || sasUnavailableReason !== null}
            disabledReason={sasUnavailableReason ?? NOT_CONTROLLABLE}
            marked={marksFor("SAS", confirmations.sas)}
          >
            <ArmLabel
              name="SAS"
              on={sas}
              mode={sasBadgeMode}
              confirmation={confirmations.sas}
            />
          </ToggleButton>
        </Tooltip>
        <Tooltip text={tipFor("RCS", confirmations.rcs)}>
          <ToggleButton
            type="button"
            size="sm"
            style={TOGGLE_CELL}
            pressed={rcs === true}
            onClick={onToggleRcs}
            disabled={disabled}
            disabledReason={NOT_CONTROLLABLE}
            marked={marksFor("RCS", confirmations.rcs)}
          >
            <ArmLabel name="RCS" on={rcs} confirmation={confirmations.rcs} />
          </ToggleButton>
        </Tooltip>
        {/* An unpressed toggle means off, so there is none until precision is read. */}
        {typeof precision === "boolean" && (
          <Tooltip text={tipFor("Precision", confirmations.precision)}>
            <ToggleButton
              type="button"
              size="sm"
              style={TOGGLE_CELL}
              pressed={precision}
              onClick={onTogglePrecision}
              disabled={disabled}
              disabledReason={NOT_CONTROLLABLE}
              marked={marksFor("Precision", confirmations.precision)}
            >
              <ReservedText
                shown={
                  confirmationWordOf(confirmations.precision) ?? "PRECISION"
                }
                reserve={["PRECISION", ...ALL_CONFIRMATION_WORDS]}
              />
            </ToggleButton>
          </Tooltip>
        )}
      </div>
      {sasUnavailableReason && <Notice>{sasUnavailableReason}</Notice>}
    </>
  );
}

/**
 * An arm's label, sized to the widest thing it can say so a press does not
 * change its width: the state, or `SENT` in its place until the mod answers
 * the press.
 */
function ArmLabel({
  name,
  on,
  mode,
  confirmation,
}: {
  name: string;
  on: boolean | null | undefined;
  mode?: string;
  confirmation: ToggleConfirmation | null;
}) {
  const shown =
    confirmationWordOf(confirmation) === null
      ? armLabel(name, on, mode)
      : `${name} ${confirmationWordOf(confirmation)}`;
  const reserve = [
    armLabel(name, on, mode),
    armLabel(name, false),
    ...ALL_CONFIRMATION_WORDS.map((word) => `${name} ${word}`),
  ];
  return <ReservedText shown={shown} reserve={reserve} />;
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
