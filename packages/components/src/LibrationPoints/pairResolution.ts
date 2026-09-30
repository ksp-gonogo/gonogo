import {
  type CelestialFacts,
  type LibrationAnswer,
  type LibrationOffset,
  type LibrationPair,
  lagrangePointsAt,
  librationOffsetOf,
  type OrbitElements,
  type SystemInstant,
  solve,
  type Vector3,
} from "@ksp-gonogo/sitrep-client";
import { type ControlFrame, ControlFrameKind } from "@ksp-gonogo/sitrep-sdk";

export interface Resolved {
  answer: LibrationAnswer;
  offset: LibrationOffset | null;
}

/**
 * The craft's root-centred inertial position, or null when it cannot be
 * placed: its elements solved about their body, plus that body's own position
 * from the same catalogue solve the frame is built on.
 */
export function vesselInertialAt(
  elements: OrbitElements | null,
  referenceBodyIndex: number | null | undefined,
  system: SystemInstant,
): Vector3 | null {
  if (elements === null || referenceBodyIndex == null) return null;
  if (!(elements.ecc >= 0 && elements.ecc < 1)) return null;
  const parent = system.positionByIndex.get(referenceBodyIndex);
  if (parent === undefined) return null;
  const state = solve(elements, system.ut);
  return [
    parent[0] + state.position[0],
    parent[1] + state.position[1],
    parent[2] + state.position[2],
  ];
}

export function resolveFor(
  facts: CelestialFacts | undefined,
  secondaryIndex: number | null,
  ut: number,
  system: SystemInstant | null,
  vesselInertial: Vector3 | null,
): Resolved {
  const answer = lagrangePointsAt(
    facts,
    secondaryIndex,
    ut,
    system ?? undefined,
  );
  return { answer, offset: librationOffsetOf(answer, vesselInertial) };
}

/**
 * The pair a rotating Control Frame turns with, as the secondary's index, or
 * null when the frame names no pair or names one the catalogue has no
 * libration points for. Both heads must match a candidate: a frame turning
 * two bodies that are not parent and child has no five points to follow. The
 * target frame arrives with no kind, so the kind check already excludes it.
 */
export function controlFramePair(
  frame: ControlFrame | null | undefined,
  candidates: readonly LibrationPair[],
): number | null {
  if (frame == null) return null;
  if (
    frame.kind !== ControlFrameKind.BarycentricRotating &&
    frame.kind !== ControlFrameKind.RotatingPulsating
  ) {
    return null;
  }
  const pair = candidates.find(
    (p) =>
      p.secondaryName === frame.secondaryBody &&
      p.primaryName === frame.primaryBody,
  );
  return pair?.secondaryIndex ?? null;
}

/**
 * The pair `"auto"` picks. The live Control Frame's pair first, when it turns
 * with one of the candidates, since the operator has already chosen that view
 * in game. Otherwise the nearest as a fraction of each pair's own separation,
 * since in metres the widest pair would win almost everywhere. With no craft,
 * the craft's own body if it can be half of a pair, then the catalogue's
 * first pair.
 */
export function autoPair(
  facts: CelestialFacts | undefined,
  candidates: readonly LibrationPair[],
  ut: number,
  system: SystemInstant | null,
  vesselInertial: Vector3 | null,
  vesselBodyIndex: number | null | undefined,
  controlFrame?: ControlFrame | null,
): number | null {
  if (candidates.length === 0) return null;
  const followed = controlFramePair(controlFrame, candidates);
  if (followed !== null) return followed;
  if (vesselInertial !== null && system !== null) {
    let best: { index: number; units: number } | null = null;
    for (const pair of candidates) {
      const { offset } = resolveFor(
        facts,
        pair.secondaryIndex,
        ut,
        system,
        vesselInertial,
      );
      if (offset === null) continue;
      if (best === null || offset.distanceUnits < best.units) {
        best = { index: pair.secondaryIndex, units: offset.distanceUnits };
      }
    }
    if (best !== null) return best.index;
  }
  const own = candidates.find((p) => p.secondaryIndex === vesselBodyIndex);
  return own?.secondaryIndex ?? candidates[0].secondaryIndex;
}
