import { useTelemetry } from "@ksp-gonogo/core";
import { CELESTIAL_FACTS, useProcessor } from "@ksp-gonogo/sitrep-client";

/**
 * The name of the body at a stable index, off the catalogue's own index map.
 *
 * An index is how every Topic refers to a body: `vessel.identity` carries
 * `parentBodyIndex` and `vessel.orbit` carries `referenceBodyIndex`, and a name
 * is what a readout draws. `CelestialFacts.nameByIndex` is where that join
 * belongs, being a function of the same one Topic the catalogue is built from,
 * and it is one lookup rather than a body merge to reach a string.
 *
 * Both value-bearing arms are read because a catalogue is a FACT: it changes
 * when the game changes, nothing changes it down a link that is not
 * delivering, and a held one is still the catalogue. That is the same
 * reasoning {@link useCelestialBodies} states for the same read.
 *
 * The three-way absence, kept rather than collapsed:
 *
 * - `undefined` where it cannot be resolved YET: no index, the catalogue has
 *   not arrived, or it has arrived and does not carry this index
 * - `null` only when the catalogue itself is a confirmed tombstone
 *
 * A caller that draws an EMPTY caption for a confirmed absence and NO caption
 * for a read that has not arrived needs both, and `ManeuverPlanner` is such a
 * caller: it gates on `!== undefined`, so folding the two would delete its
 * reference-body caption instead of emptying it.
 *
 * The tombstone has to come from `system.bodies` ITSELF rather than from the
 * catalogue reading, because {@link CELESTIAL_FACTS} maps an absent dep onto an
 * EMPTY catalogue (`deriveCelestialFacts(undefined, viewUt)`) and so answers
 * `observed` either way. A processor states what it computed, not what its
 * inputs were, which erases exactly the distinction this join needs.
 *
 * ## Why this is app-side and not in the SDK
 *
 * It wraps a root-exported surface, so an Uplink could have it. It is here
 * anyway: the published type surface is largely ungated today, and adding one
 * more unlocked public API while that is being settled adds to the problem.
 * The one Uplink that needs this writes the unwrap out longhand, which is the
 * smaller cost. A SECOND Uplink needing it is the signal to promote this, by
 * which point it should land with a lock rather than without one.
 */
export function useBodyName(
  index: number | null | undefined,
): string | null | undefined {
  const reading = useProcessor(CELESTIAL_FACTS);
  const bodies = useTelemetry("system.bodies");
  if (index == null) return undefined;
  if (bodies.state === "absent") return null;
  if (reading === undefined) return undefined;
  if (reading.state !== "observed" && reading.state !== "stale") {
    return undefined;
  }
  return reading.value?.nameByIndex[index];
}

/**
 * The index of the body the active craft is around, held through a quiet link:
 * which body that is does not change because its telemetry stopped arriving,
 * and every figure the name labels is held on the same terms.
 */
export function useParentBodyIndex(): number | null | undefined {
  const identity = useTelemetry("vessel.identity");
  return identity.state === "observed" || identity.state === "stale"
    ? identity.value.parentBodyIndex
    : undefined;
}
