import { useTelemetry } from "@ksp-gonogo/core";
import { useViewUt } from "@ksp-gonogo/sitrep-client";
import {
  deriveReading,
  type Reading,
  unlessLocked,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * Time to the orbit's SOI transition: from the received edge as observed, and
 * from the instant the conic reckoned to where one reaches past it.
 * `transitionUt` is an absolute UT, so each arm subtracts its own instant.
 */
export function useEncounterIn(): Reading<Value<"s">> {
  const reading = useTelemetry("vessel.orbit");
  const receivedUt = useViewUt();
  return deriveReading(
    reading,
    (orbit) => {
      const encounter = unlessLocked(orbit.encounter ?? null);
      return encounter?.transitionUt.isFinite() === true &&
        receivedUt !== undefined
        ? encounter.transitionUt.minus(receivedUt)
        : undefined;
    },
    (orbit, atUt) => {
      const encounter = unlessLocked(orbit.encounter ?? null);
      return encounter?.transitionUt.isFinite() === true
        ? encounter.transitionUt.minus(atUt)
        : undefined;
    },
  );
}
