import { META_VANTAGE, useCommand } from "@ksp-gonogo/sitrep-client";
import { ButtonGroup, CommandButton } from "@ksp-gonogo/ui-kit";

/**
 * The game's own ways back from a crash: restart the flight from the launch pad or runway, or return to the vehicle assembly building. Each is gated on the game's revert availability, so a button the game would refuse is disabled with its reason. Used beneath the crash report while the game is still in the flight scene.
 */
export function CrashReverts() {
  const revertLaunchCmd = useCommand("ksp.revertToLaunch", {
    vantage: META_VANTAGE,
  });
  const revertEditorCmd = useCommand("ksp.revertToEditor", {
    vantage: META_VANTAGE,
  });
  return (
    <ButtonGroup>
      <CommandButton
        handle={revertLaunchCmd}
        commandLabel="Revert to launch"
        size="sm"
        label="Revert to launch"
        confirmLabel="Confirm revert to launch"
        confirmTone="nogo"
        pendingLabel="Reverting..."
      />
      <CommandButton
        handle={revertEditorCmd}
        args={{ editor: "vab" }}
        commandLabel="Revert to VAB"
        size="sm"
        label="Revert to VAB"
        confirmLabel="Confirm revert to VAB"
        confirmTone="nogo"
        pendingLabel="Reverting..."
      />
    </ButtonGroup>
  );
}
