import { useCommand } from "@ksp-gonogo/sitrep-client";
import type { TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { commandOutcomes } from "@ksp-gonogo/ui-kit";
import { SAS_MODES, type SasMode, sasModeOrdinal } from "./sasModes";

/** The SAS and RCS arm toggles and the SAS mode command, off the last confirmed control state. */
export function useSasControls(
  control: TopicPayload<"vessel.control"> | undefined,
) {
  const sasCmd = useCommand("vessel.control.setSas");
  const rcsCmd = useCommand("vessel.control.setRcs");
  const sasModeCmd = useCommand("vessel.control.setSasMode");

  // Uncoerced: inverting an unread arm would be a blind guess, and an unread arm is not a confirmed OFF.
  const sasRaw = control?.sas;
  const rcsRaw = control?.rcs;

  // Only turning SAS on is refused, so a SAS that is already on can still be switched off.
  const sasUnavailableReason =
    control?.sasAvailable === false && sasRaw !== true
      ? (control.sasUnavailableReason ?? "No SAS available")
      : null;

  const toggleSas = () => {
    if (typeof sasRaw !== "boolean" || sasUnavailableReason) return;
    void sasCmd.send({ enabled: !sasRaw }, { label: "Toggle SAS" });
  };
  const engageSas = () => {
    if (sasUnavailableReason) return;
    void sasCmd.send({ enabled: true }, { label: "SAS on" });
  };
  const toggleRcs = () => {
    if (typeof rcsRaw !== "boolean") return;
    void rcsCmd.send({ enabled: !rcsRaw }, { label: "Toggle RCS" });
  };
  const setSasMode = (mode: SasMode) => {
    void sasModeCmd.send(
      { mode: sasModeOrdinal(mode) },
      { label: `SAS mode: ${mode}` },
    );
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
    toggleSas,
    engageSas,
    toggleRcs,
    setSasMode,
    unconfirmedSasModes,
    dismissSasUnconfirmed: sasOutcomes.dismiss,
  };
}
