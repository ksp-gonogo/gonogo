import type { ActionDefinition } from "@ksp-gonogo/core";
import { createContext, useContext, useEffect } from "react";

/**
 * One action per control that has exactly one target on screen. Each presses
 * the control itself, so a bound input arms then dispatches exactly as clicks
 * do, and does nothing while the control is dark or absent.
 */
export const launchDirectorActions = [
  {
    id: "launch",
    label: "Launch",
    accepts: ["button"],
    description:
      "First press arms, second press launches the craft selected on the open pad, with the crew selected for it.",
  },
  {
    id: "recover",
    label: "Recover",
    accepts: ["button"],
    description:
      "First press arms, second press recovers the vessel in flight, or the one standing on the open pad.",
  },
  {
    id: "revertToLaunch",
    label: "Revert to launch",
    accepts: ["button"],
    description:
      "In flight: first press arms, second press reverts the flight to its launch.",
  },
  {
    id: "revertToEditor",
    label: "Revert to VAB",
    accepts: ["button"],
    description:
      "First press arms, second press reverts the flight, or the vessel on the open pad, to the VAB.",
  },
  {
    id: "trackingStation",
    label: "Tracking Station",
    accepts: ["button"],
    description:
      "In flight: first press arms, second press saves the game and leaves for the Tracking Station.",
  },
] as const satisfies readonly ActionDefinition[];

export type LaunchDirectorActions = typeof launchDirectorActions;
export type LaunchDirectorActionId = LaunchDirectorActions[number]["id"];

export type Press = (armable: boolean) => void;

/** Each bound control's press, listed only while a click on it would do something. */
export const BoundPresses = createContext<Map<
  LaunchDirectorActionId,
  Press
> | null>(null);

export function useBindPress(
  action: LaunchDirectorActionId | undefined,
  press: Press,
  clickable: boolean,
): void {
  const registry = useContext(BoundPresses);
  useEffect(() => {
    if (!registry || !action || !clickable) return;
    registry.set(action, press);
    return () => {
      if (registry.get(action) === press) registry.delete(action);
    };
  }, [registry, action, press, clickable]);
}
