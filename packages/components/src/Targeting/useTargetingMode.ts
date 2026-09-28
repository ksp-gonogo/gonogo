import type { ReadingState } from "@ksp-gonogo/sitrep-client";
import { useEffect, useState } from "react";
import {
  APPROACH_ENTER_M,
  APPROACH_EXIT_M,
  HUD_ENTER_M,
  HUD_EXIT_M,
  type ViewMode,
} from "./config";

/** Sticky, with a smaller window to enter than to exit. */
function nextMode(
  mode: ViewMode,
  dockingAvailable: boolean,
  tarDistance: number,
): ViewMode {
  if (mode === "tracking") {
    if (dockingAvailable && tarDistance <= HUD_ENTER_M) return "docking-hud";
    if (tarDistance < APPROACH_ENTER_M) return "approach";
    return mode;
  }
  if (mode === "approach") {
    if (dockingAvailable && tarDistance <= HUD_ENTER_M) return "docking-hud";
    if (tarDistance > APPROACH_EXIT_M) return "tracking";
    return mode;
  }
  // docking-hud: left the docking scenario or backed out of HUD range.
  if (!dockingAvailable || tarDistance > HUD_EXIT_M) return "approach";
  return mode;
}

/**
 * The tracking / approach / docking-hud state machine. The specialised views
 * assert something about NOW, so anything held falls back to tracking,
 * which can state its age.
 */
export function useTargetingMode(params: {
  autoSwitch: boolean;
  dockable: boolean;
  dockingAvailable: boolean;
  tarDistance: number | undefined;
  targetState: ReadingState;
}): ViewMode {
  const { autoSwitch, dockable, dockingAvailable, tarDistance, targetState } =
    params;
  const [mode, setMode] = useState<ViewMode>("tracking");

  useEffect(() => {
    if (
      !autoSwitch ||
      !dockable ||
      tarDistance === undefined ||
      targetState !== "observed"
    ) {
      if (mode !== "tracking") setMode("tracking");
      return;
    }
    const next = nextMode(mode, dockingAvailable, tarDistance);
    if (next !== mode) setMode(next);
  }, [autoSwitch, dockable, dockingAvailable, tarDistance, mode, targetState]);

  return mode;
}
