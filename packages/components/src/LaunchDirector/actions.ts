import type { ActionDefinition } from "@ksp-gonogo/core";
import { createContext, useCallback, useContext, useRef } from "react";

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
  {
    id: "spaceCenter",
    label: "Space Center",
    accepts: ["button"],
    description:
      "In flight or the Tracking Station: first press arms, second press saves the game and leaves for the Space Center.",
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

/**
 * A `CommandButton`'s `onPressReady` for a control a bound input may press:
 * lists the press under `action` while a click on the control would do
 * something and withdraws it otherwise.
 */
export function useBoundPress(action: LaunchDirectorActionId | undefined) {
  const registry = useContext(BoundPresses);
  const listed = useRef<Press | null>(null);
  return useCallback(
    (press: Press | null) => {
      if (!registry || !action) return;
      if (press) {
        registry.set(action, press);
        listed.current = press;
        return;
      }
      if (listed.current && registry.get(action) === listed.current) {
        registry.delete(action);
      }
      listed.current = null;
    },
    [registry, action],
  );
}
