import { useEffect, useState } from "react";
import { getReplayController } from "./ReplayController";

/**
 * `true` while a replay is in progress (the dashboard's data sources have
 * been swapped for the replay backend), `false` otherwise. Widgets that
 * have interactive sides (KosTerminal's REPL, kOS executeScript dispatch
 * inside KosFiles / KosWidget / TargetPicker set-target) check this and
 * either short-circuit or render a "not available in replay" placeholder.
 *
 * Subscribes to the replay controller singleton, so a single hook call per
 * widget is fine.
 */
export function useReplayActive(): boolean {
  const controller = getReplayController();
  const [active, setActive] = useState(controller.getState().active);
  useEffect(
    () =>
      controller.subscribe((state) => {
        setActive(state.active);
      }),
    [controller],
  );
  return active;
}
