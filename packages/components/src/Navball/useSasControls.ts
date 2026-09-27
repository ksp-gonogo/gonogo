import { useCommand } from "@ksp-gonogo/sitrep-client";
import type { TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { commandFailures, usePanelDelay } from "@ksp-gonogo/ui-kit";
import { SAS_MODES, type SasMode, sasModeOrdinal } from "./sasModes";

/** The SAS and RCS arm toggles and the SAS mode command, off the last confirmed control state. */
export function useSasControls(
  control: TopicPayload<"vessel.control"> | undefined,
) {
  const sasCmd = useCommand("vessel.control.setSas");
  const rcsCmd = useCommand("vessel.control.setRcs");
  const sasModeCmd = useCommand("vessel.control.setSasMode");
  usePanelDelay(sasCmd);
  usePanelDelay(rcsCmd);
  usePanelDelay(sasModeCmd);

  // Uncoerced: inverting an unread arm would be a blind guess, and an unread arm is not a confirmed OFF.
  const sasRaw = control?.sas;
  const rcsRaw = control?.rcs;

  const toggleSas = () => {
    if (typeof sasRaw !== "boolean") return;
    void sasCmd.send({ enabled: !sasRaw }, { label: "Toggle SAS" });
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
   * A failed mode command is echoed on the button that issued it, matched back
   * by the label `setSasMode` stamps; dismissing there or in the Panel queue
   * clears both.
   */
  const sasFailures = commandFailures(sasModeCmd);
  const failedSasModes = new Map<SasMode, string>();
  for (const f of sasFailures.failed) {
    const mode = SAS_MODES.find((m) => f.label === `SAS mode: ${m}`);
    if (mode) failedSasModes.set(mode, f.id);
  }

  return {
    sasRaw,
    rcsRaw,
    toggleSas,
    toggleRcs,
    setSasMode,
    failedSasModes,
    dismissSasFailure: sasFailures.dismiss,
  };
}
