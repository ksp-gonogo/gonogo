import { useTelemetry } from "@ksp-gonogo/core";
import { useMemo } from "react";
import { bodyNamed, type StreamBodies, type StreamBody } from "./streamBody";

/**
 * The streamed body for a name resolved off the same `system.bodies` roster,
 * which a caller must declare. Memoised because callers sample curves off it.
 */
export function useStreamBody(
  name: string | null | undefined,
  fallbackName?: string | null,
): StreamBody | undefined {
  const reading = useTelemetry("system.bodies");
  // A body roster does not decay, so a held one still answers.
  const bodies =
    reading.state === "observed" || reading.state === "held"
      ? (reading.value as StreamBodies | undefined)
      : undefined;
  return useMemo(
    () => bodyNamed(bodies, name) ?? bodyNamed(bodies, fallbackName),
    [bodies, name, fallbackName],
  );
}
