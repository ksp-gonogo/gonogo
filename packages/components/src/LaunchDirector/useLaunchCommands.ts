import { type ActionInputPayload, useActionInput } from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand } from "@ksp-gonogo/sitrep-client";
import { useRef } from "react";
import type {
  LaunchDirectorActionId,
  LaunchDirectorActions,
  Press,
} from "./actions";

/** The scene commands, and the registry a bound input presses them through. */
export function useLaunchCommands() {
  // LAUNCH is a delayed command to the pad; the other scene ops are KSC-desk actions at the meta-vantage.
  const launchCmd = useCommand("ksp.launch");
  const recoverCmd = useCommand("ksp.recover", { vantage: META_VANTAGE });
  const revertLaunchCmd = useCommand("ksp.revertToLaunch", {
    vantage: META_VANTAGE,
  });
  const revertEditorCmd = useCommand("ksp.revertToEditor", {
    vantage: META_VANTAGE,
  });
  const toTrackingCmd = useCommand("ksp.toTrackingStation", {
    vantage: META_VANTAGE,
  });
  const toSpaceCenterCmd = useCommand("ksp.toSpaceCenter", {
    vantage: META_VANTAGE,
  });
  const flyCmd = useCommand("ksp.flyVessel", { vantage: META_VANTAGE });
  const switchCmd = useCommand("ksp.switchVessel", { vantage: META_VANTAGE });

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
    revertToLaunch: pressBound("revertToLaunch"),
    revertToEditor: pressBound("revertToEditor"),
    trackingStation: pressBound("trackingStation"),
    spaceCenter: pressBound("spaceCenter"),
  });

  return {
    boundPresses,
    launchCmd,
    recoverCmd,
    revertLaunchCmd,
    revertEditorCmd,
    toTrackingCmd,
    toSpaceCenterCmd,
    flyCmd,
    switchCmd,
  };
}
