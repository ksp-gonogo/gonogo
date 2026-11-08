import { type ActionInputPayload, useActionInput } from "@ksp-gonogo/core";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import { useRef } from "react";
import type {
  LaunchDirectorActionId,
  LaunchDirectorActions,
  Press,
} from "./actions";

/** The scene commands, and the registry a bound input presses them through. */
export function useLaunchCommands() {
  // LAUNCH is a delayed command to the pad; the other scene ops are KSC-desk actions.
  const launchCmd = useCommand("ksp.launch");
  const recoverCmd = useCommand("ksp.recover");
  const recoverVesselCmd = useCommand("ksp.recoverVessel");
  const revertLaunchCmd = useCommand("ksp.revertToLaunch");
  const revertEditorCmd = useCommand("ksp.revertToEditor");
  const toTrackingCmd = useCommand("ksp.toTrackingStation");
  const toSpaceCenterCmd = useCommand("ksp.toSpaceCenter");
  const switchCmd = useCommand("ksp.switchVessel");

  const boundPresses = useRef(new Map<LaunchDirectorActionId, Press>()).current;
  const pressBound =
    (id: LaunchDirectorActionId) => (payload: ActionInputPayload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      boundPresses.get(id)?.(true);
      return undefined;
    };
  useActionInput<LaunchDirectorActions>({
    launch: pressBound("launch"),
    recover: pressBound("recover"),
    "revert-to-launch": pressBound("revert-to-launch"),
    "revert-to-editor": pressBound("revert-to-editor"),
    "tracking-station": pressBound("tracking-station"),
    "space-center": pressBound("space-center"),
  });

  return {
    boundPresses,
    launchCmd,
    recoverCmd,
    recoverVesselCmd,
    revertLaunchCmd,
    revertEditorCmd,
    toTrackingCmd,
    toSpaceCenterCmd,
    switchCmd,
  };
}
