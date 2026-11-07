import { useCommand } from "@ksp-gonogo/sitrep-client";
import { Button, ButtonGroup } from "@ksp-gonogo/ui-kit";

/**
 * The game's own ways back from a crash: restart the flight from the launch pad or runway, or return to the vehicle assembly building. Each is gated on the game's revert availability, so a button the game would refuse is disabled with its reason. Used beneath the crash report while the game is still in the flight scene.
 */
export function CrashReverts() {
  const revertLaunchCmd = useCommand("ksp.revertToLaunch");
  const revertEditorCmd = useCommand("ksp.revertToEditor");
  return (
    <ButtonGroup>
      <Button
        command={revertLaunchCmd.with(undefined, { label: "Revert to launch" })}
        variant="ghost"
        size="sm"
        confirmLabel="Confirm revert to launch"
        confirmTone="nogo"
      >
        Revert to launch
      </Button>
      <Button
        command={revertEditorCmd.with(
          { editor: "vab" },
          { label: "Revert to VAB" },
        )}
        variant="ghost"
        size="sm"
        confirmLabel="Confirm revert to VAB"
        confirmTone="nogo"
      >
        Revert to VAB
      </Button>
    </ButtonGroup>
  );
}
