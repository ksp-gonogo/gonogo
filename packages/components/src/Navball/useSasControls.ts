import { useCommand } from "@ksp-gonogo/sitrep-client";
import type { TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import {
  commandOutcomes,
  NULL_DISPLAY,
  type ReckoningMarking,
  type ToggleState,
  useCommandButton,
} from "@ksp-gonogo/ui-kit";
import { showsToggle } from "../shared/showsToggle";
import { SAS_MODES, type SasMode, sasModeOrdinal } from "./sasModes";

/**
 * The SAS, RCS and precision control toggles and the SAS mode command, off the
 * last confirmed control state. `controlHeld` says that state is the last one
 * received while its reading is withheld, which confirms nothing a toggle sent.
 */
export function useSasControls(
  control: TopicPayload<"vessel.control"> | undefined,
  controlHeld = false,
  /** The SAS mode's three-letter token the SAS toggle carries, or `""` when no mode is on the wire. */
  sasBadgeMode = "",
  /** The control reading's mark when the states shown are held rather than current. */
  readingMarking: ReckoningMarking | null = null,
  /** False while the vessel cannot be flown, which darkens every control. */
  controllable = true,
) {
  // Uncoerced: inverting an unread arm would be a blind guess, and an unread arm is not a confirmed OFF.
  const sasRaw = control?.sas;
  const rcsRaw = control?.rcs;
  const precisionRaw = control?.precisionControl;

  const confirmedBy = (shown: boolean | null | undefined) => (args: unknown) =>
    !controlHeld && showsToggle(args, shown);
  const sasCmd = useCommand("vessel.control.setSas", {
    confirmedBy: confirmedBy(sasRaw),
  });
  const rcsCmd = useCommand("vessel.control.setRcs", {
    confirmedBy: confirmedBy(rcsRaw),
  });
  const precisionCmd = useCommand("vessel.control.setPrecisionControl", {
    confirmedBy: confirmedBy(precisionRaw),
  });
  const sasModeCmd = useCommand("vessel.control.setSasMode");
  // A held state stays pressable; the tip says what the press does with it.
  const marking: ReckoningMarking | null =
    readingMarking === null
      ? null
      : {
          ...readingMarking,
          caption: `${readingMarking.caption}. The press sends the opposite of the state shown`,
        };

  // Only turning SAS on is refused, so a SAS that is already on can still be switched off.
  const sasUnavailableReason =
    control?.sasAvailable === false && sasRaw !== true
      ? (control.sasUnavailableReason ?? "No SAS available")
      : null;

  const notControllable = controllable ? null : NOT_CONTROLLABLE;
  const invert = (base: ToggleState) =>
    typeof base === "boolean" ? { enabled: !base } : undefined;
  const sasButton = useCommandButton({
    handle: sasCmd,
    commandLabel: "Toggle SAS",
    toggle: {
      state: sasRaw,
      name: "SAS",
      word: (shown) => armLabel("SAS", shown, sasBadgeMode),
      words: [
        armLabel("SAS", true, sasBadgeMode),
        armLabel("SAS", false),
        armLabel("SAS", null),
      ],
      sentWord: "SAS SENT",
      unavailable: sasUnavailableReason ?? notControllable,
      // Only turning SAS on is refused, so a SAS that is already on can still be switched off.
      args: (base) =>
        base !== true && sasUnavailableReason ? undefined : invert(base),
      marking,
    },
  });
  const rcsButton = useCommandButton({
    handle: rcsCmd,
    commandLabel: "Toggle RCS",
    toggle: {
      state: rcsRaw,
      name: "RCS",
      word: (shown) => armLabel("RCS", shown),
      words: [
        armLabel("RCS", true),
        armLabel("RCS", false),
        armLabel("RCS", null),
      ],
      sentWord: "RCS SENT",
      unavailable: notControllable,
      args: invert,
      marking,
    },
  });
  const precisionButton = useCommandButton({
    handle: precisionCmd,
    commandLabel: "Toggle precision control",
    toggle: {
      state: precisionRaw,
      name: "Precision",
      word: () => "PRECISION",
      words: ["PRECISION"],
      sentWord: "SENT",
      unavailable: notControllable,
      args: invert,
      marking,
    },
  });
  const toggleSas = () => sasButton.press(false);
  const engageSas = () => {
    if (sasButton.isBlocked) return;
    // SAS shown on, whether read or predicted, has nothing to engage.
    if (sasButton.toggleView?.shown === true) return;
    sasButton.sendAs({ enabled: true }, "SAS on");
  };
  const toggleRcs = () => rcsButton.press(false);
  const togglePrecision = () => precisionButton.press(false);
  const setSasMode = (mode: SasMode) => {
    const ordinal = sasModeOrdinal(mode);
    // A mode this screen already has on its way is not sent again, and one that was lost or refused can be.
    const onItsWay = sasModeCmd.inFlight.some(
      (row) =>
        typeof row.args === "object" &&
        row.args !== null &&
        "mode" in row.args &&
        row.args.mode === ordinal &&
        (row.predictedPhase === "in-transit" ||
          row.predictedPhase === "awaiting-reply" ||
          row.predictedPhase === "due"),
    );
    if (onItsWay) return;
    void sasModeCmd.send({ mode: ordinal }, { label: `SAS mode: ${mode}` });
  };

  /*
   * A mode command with no reply is echoed on the button that issued it,
   * matched back by the label `setSasMode` stamps; dismissing there or in the
   * Panel queue clears both.
   */
  const sasOutcomes = commandOutcomes(sasModeCmd);
  const unconfirmedSasModes = new Map<SasMode, string>();
  for (const f of sasOutcomes.unconfirmed) {
    const mode = SAS_MODES.find((m) => f.label === `SAS mode: ${m}`);
    if (mode) unconfirmedSasModes.set(mode, f.id);
  }

  return {
    sasRaw,
    sasUnavailableReason,
    rcsRaw,
    precisionRaw,
    toggleSas,
    engageSas,
    toggleRcs,
    togglePrecision,
    setSasMode,
    sasButton,
    rcsButton,
    precisionButton,
    sasCmd,
    rcsCmd,
    precisionCmd,
    unconfirmedSasModes,
    dismissSasUnconfirmed: sasOutcomes.dismiss,
  };
}

/** Why every control of the toggle row is dark while the vessel cannot be flown. */
const NOT_CONTROLLABLE = "The vessel is not controllable";

/**
 * One arm's toggle label: `SAS: PRO` / `RCS ON` when on, `SAS OFF` when
 * confirmed off, and the name plus `NULL_DISPLAY` when unread. Not the bare
 * name, which would collide with the mode grid's "SAS" stability-assist button.
 */
function armLabel(name: string, on: ToggleState, mode?: string): string {
  if (on !== true && on !== false) return `${name} ${NULL_DISPLAY}`;
  if (!on) return `${name} OFF`;
  return mode ? `${name}: ${mode}` : `${name} ON`;
}
