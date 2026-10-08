import { useMemo } from "react";
import { parentOf } from "./catalogue-elements";
import type { CelestialFacts } from "./celestial-facts";
import {
  bodyOrbitInput,
  type OrbitTrajectory,
  type OrbitTrajectoryInput,
} from "./orbit-trajectory";
import { useOrbitTrajectory } from "./use-orbit-trajectory";

/**
 * Whose path to ask for:
 *
 * - `body`: a catalogue body's orbit about its parent, with the horizon its own
 *   provider stated
 * - `orbit`: elements you already hold, whole `vessel.orbit`-shaped payload
 *   with its horizon, as {@link useOrbitTrajectory} takes them
 *
 * @category Frames of reference
 */
export type OrbitCurveSubject =
  | { kind: "body"; facts: CelestialFacts | undefined; index: number }
  | { kind: "orbit"; orbit: OrbitTrajectoryInput["orbit"] | undefined };

/**
 * How a subject's path may be drawn at the instant on screen: a conic, the arc
 * its provider vouched for, or a refusal with its reason, exactly as
 * {@link useOrbitTrajectory} answers for a craft, and held the same way for each
 * whole second of the view instant.
 *
 * `null` means the question could not be put: no clock, no catalogue yet, the
 * root star, or a body whose elements are not filled.
 *
 * @category Frames of reference
 */
export function useOrbitCurve(
  subject: OrbitCurveSubject,
  options?: Pick<OrbitTrajectoryInput, "samples" | "readFrame">,
): OrbitTrajectory | null {
  const facts = subject.kind === "body" ? subject.facts : undefined;
  const index = subject.kind === "body" ? subject.index : -1;
  const bodyOrbit = useMemo(() => {
    const body = facts?.bodies.find((b) => b.index === index);
    if (facts === undefined || body === undefined) return null;
    return bodyOrbitInput(body, parentOf(facts, body));
  }, [facts, index]);
  const orbit = subject.kind === "body" ? bodyOrbit : subject.orbit;
  return useOrbitTrajectory(orbit ?? undefined, options);
}
