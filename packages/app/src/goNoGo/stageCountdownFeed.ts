import { useTelemetry } from "@ksp-gonogo/core";
import { Situation } from "@ksp-gonogo/sitrep-sdk";
import { stageCountdownStore } from "@ksp-gonogo/sitrep-sdk/spine";
import { useEffect, useRef } from "react";
import type { CountdownEvent } from "./GoNoGoHostService";

/**
 * Writes a screen's poll countdown into the store `useGoNoGoCountdown` and
 * `useLiftoffCountdown` read. A countdown lifts off when it fires Stage and
 * the active craft is on the launch pad as it starts; the mission clock starting
 * marks the liftoff, and the craft going back to the pad forgets the countdown.
 */
export function useStageCountdownFeed({
  subscribe,
  stagesAtGo,
  launched,
}: Readonly<{
  /** Calls the listener as a countdown starts or finishes, or `null` while the screen has no poll to follow. */
  subscribe: ((listener: (event: CountdownEvent) => void) => () => void) | null;
  /** Whether the poll fires Stage at T-0. */
  stagesAtGo: boolean;
  /** Whether the mission clock has started. */
  launched: boolean;
}>): void {
  const flight = useTelemetry("flight.current");
  const onPad =
    (flight.state === "observed" || flight.state === "held") &&
    flight.value.phase === Situation.PreLaunch;
  const now = useRef({ onPad, stagesAtGo });
  now.current = { onPad, stagesAtGo };

  useEffect(() => {
    if (!subscribe) return;
    return subscribe((event) => {
      if (event.type === "end") {
        stageCountdownStore.end(event.how);
        return;
      }
      const seconds = event.lengthMs / 1000;
      stageCountdownStore.start({
        remainingSeconds: seconds,
        lengthSeconds: seconds,
        liftsOff: now.current.stagesAtGo && now.current.onPad,
      });
    });
  }, [subscribe]);

  const wasLaunched = useRef(false);
  useEffect(() => {
    if (launched) stageCountdownStore.setLiftedOff(true);
    if (!launched && wasLaunched.current) stageCountdownStore.clear();
    wasLaunched.current = launched;
  }, [launched]);

  useEffect(() => () => stageCountdownStore.clear(), []);
}
