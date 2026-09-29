import { useTelemetry } from "@ksp-gonogo/core";
import { CELESTIAL_FACTS, useProcessor } from "@ksp-gonogo/sitrep-client";

/**
 * The name of the body at a stable index. A held catalogue is still the
 * catalogue, so a held one answers. `undefined` means not resolvable yet;
 * `null` means `system.bodies` itself is a confirmed tombstone, read from the
 * topic because the processor answers an absent input with an empty catalogue.
 */
export function useBodyName(
  index: number | null | undefined,
): string | null | undefined {
  const reading = useProcessor(CELESTIAL_FACTS);
  const bodies = useTelemetry("system.bodies");
  if (index == null) return undefined;
  if (bodies.state === "absent") return null;
  if (reading === undefined) return undefined;
  if (reading.state !== "observed" && reading.state !== "held") {
    return undefined;
  }
  return reading.value?.nameByIndex[index];
}

/** The active craft's parent body index, held through a quiet link like every figure it labels. */
export function useParentBodyIndex(): number | null | undefined {
  const identity = useTelemetry("vessel.identity");
  return identity.state === "observed" || identity.state === "held"
    ? identity.value.parentBodyIndex
    : undefined;
}
