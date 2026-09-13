import { useViewClockOptional } from "@ksp-gonogo/sitrep-client";
import { useCelestialBodies } from "./useCelestialBodies";

/**
 * Body rotation angle for the OrbitDiagram pole marker, derived CLIENT-SIDE
 * from the body's `rotationPeriod` + the SDK view-UT rather than read per frame
 * off the wire.
 *
 * `angleDeg = (360 · viewUt / rotationPeriod) mod 360`, the rate is exact
 * (one turn per `rotationPeriod` seconds; a NEGATIVE period spins the marker
 * the other way, matching retrograde rotation), and the PHASE is deliberately
 * dropped. The wire DOES carry one now, `BodyEntry.initialRotation`, and the
 * SDK's `bodyRotationAngleDegAt` is the absolute angle built from the pair; it
 * is what a surface position needs and not what this marker is. The only
 * consumer here is the OrbitDiagram's spinning limb, a rotation *indicator*
 * drawn relative to the body rather than the sky, so an absolute phase would
 * move the marker without making it mean more.
 *
 * `rotates` is derived from `rotationPeriod` too: a body rotates iff its period
 * is finite and non-zero.
 *
 * Reads the SDK view-UT NON-reactively (`ViewClock.confirmedEdgeUt()` at
 * render), not via a per-frame `onFrame` subscription, so the marker advances
 * on the widget's own telemetry-driven re-renders and adds no subscription that
 * could fire state updates outside React's `act`.
 *
 * Returns `null` for either field while the body index hasn't resolved yet
 * (the bodies fan-out hasn't reached the row whose name matches `bodyName`),
 * and `angleDeg` is additionally `null` when the body doesn't rotate or the
 * view clock isn't available yet (no `TelemetryProvider` / no confirmed
 * sample: `confirmedEdgeUt()` is `-Infinity`).
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
