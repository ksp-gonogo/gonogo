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
 * The pair `"auto"` picks: the nearest as a fraction of each pair's own
 * separation, since in metres the widest pair would win almost everywhere.
 * With no craft, the craft's own body if it can be half of a pair, then the
 * catalogue's first pair.
 */
export function autoPair(
  facts: CelestialFacts | undefined,
  candidates: readonly LibrationPair[],
  ut: number,
  system: SystemInstant | null,
  vesselInertial: Vector3 | null,
  vesselBodyIndex: number | null | undefined,
): number | null {
  if (candidates.length === 0) return null;
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
