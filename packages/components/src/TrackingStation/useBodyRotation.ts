import { useViewClockOptional } from "@ksp-gonogo/sitrep-client";
import { useCelestialBodies } from "./useCelestialBodies";

/**
 * Body rotation angle for the OrbitDiagram pole marker, `(360 * viewUt / rotationPeriod) mod 360`, derived from the period and the view UT.
 *
 * The phase is dropped on purpose: the marker is a rotation indicator drawn relative to the body, so `initialRotation` would move it without adding meaning. A negative period spins it the other way (retrograde), and `rotates` is true iff the period is finite and non-zero.
 *
 * Not a reckoner: the angle is exact arithmetic on a catalogue constant and the view UT, so there is no observed value to hold, fade or give a band to, and its status could never differ from measured. It sits on no channel, and `registerReckoner` takes a `TopicId`.
 *
 * The view UT is read non-reactively at render, so the marker advances on the widget's own re-renders and adds no subscription. Both fields are `null` until the body resolves; `angleDeg` is also `null` for a non-rotating body or before the view clock has a confirmed sample.
 */
export function useBodyRotation(bodyName: string | null | undefined): {
  angleDeg: number | null;
  rotates: boolean | null;
} {
  const bodies = useCelestialBodies();
  const clock = useViewClockOptional();
  const body = bodyName
    ? (bodies.find((b) => b.name === bodyName) ?? null)
    : null;

  if (body === null) return { angleDeg: null, rotates: null };

  const period = body.rotationPeriod;
  const rotates = period != null && Number.isFinite(period) && period !== 0;

  let angleDeg: number | null = null;
  const viewUt = clock?.confirmedEdgeUt();
  if (rotates && viewUt != null && Number.isFinite(viewUt)) {
    const raw = ((360 * viewUt) / (period as number)) % 360;
    angleDeg = raw < 0 ? raw + 360 : raw;
  }

  return { angleDeg, rotates };
}
