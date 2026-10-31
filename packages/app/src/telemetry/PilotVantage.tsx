import { useTelemetryClientOptional } from "@ksp-gonogo/sitrep-client";
import { useEffect } from "react";

/**
 * Asks the mod to keep a pilot's telemetry session at the active craft.
 *
 * Renders nothing: it is a binding, not a control. The request is sent once.
 * From then on the mod moves the session itself when the game changes craft
 * (a switch, an EVA, a docking or an undock), so a pilot reads and flies the
 * active craft with no signal delay, crewed or not, and the page never names a
 * craft. With no active craft the session reads from the home command centre.
 */
export function PilotVantage() {
  const client = useTelemetryClientOptional();

  useEffect(() => {
    client?.followActiveCraft();
  }, [client]);

  return null;
}
