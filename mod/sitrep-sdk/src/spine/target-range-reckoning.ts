import type { TargetListEntry } from "../__generated__/contract";
import { TargetKnowledge } from "../__generated__/contract";
import { value } from "../unit-system/value";
import type { CelestialFacts } from "./celestial-facts";
import type { CommsPeerOrbit } from "./comms-path-geometry";
import type { OrbitElements, Vec3Tuple } from "./kepler";
import {
  buildElements,
  isHyperbolic,
  magnitude,
  trySolve,
} from "./kepler-reckoning";
import { systemInstantAt } from "./reference-frame";

/**
 * The range from the active craft to a craft it only knows of, at an instant
 * after it last heard or sighted it.
 *
 * `target.available` gives such a craft no range, because a range is something
 * the active craft measures and it cannot measure this one. What it does hold
 * is the orbit that craft was on when it was last heard or seen, and its own
 * orbit, so where both are at a later instant follows from the two conics and
 * the bodies they are round. That is a model, and the reading says so.
 *
 * The other craft is assumed to have coasted since. Nothing on the wire can
 * say otherwise: a burn it made after the news left is exactly what the active
 * craft does not know yet.
 */
export interface KnownCraftOrbit {
  /** Position in `entries`, which is how the model's claim names the row. */
  readonly index: number;
  readonly bodyIndex: number;
  readonly elements: OrbitElements;
}

/**
 * Every entry whose place can be carried forward: known only by word or by
 * sight, with a closed orbit round a body the catalogue gives a gravitational
 * parameter for. An entry the craft sees as it is keeps its measured range.
 */
export function knownCraftOrbits(
  entries: readonly TargetListEntry[],
  facts: CelestialFacts,
): KnownCraftOrbit[] {
  const known: KnownCraftOrbit[] = [];
  entries.forEach((entry, index) => {
    if (entry?.source == null || entry.source === TargetKnowledge.InRange) {
      return;
    }
    const orbit = entry.orbit;
    const bodyIndex = entry.orbitBodyIndex;
    if (orbit == null || bodyIndex == null) return;
    const mu = facts.bodies.find((b) => b.index === bodyIndex)?.gravParameter;
    if (mu == null || !(mu > 0)) return;
    if (
      orbit.sma == null ||
      orbit.ecc == null ||
      orbit.inc == null ||
      orbit.meanAnomalyAtEpoch == null ||
      orbit.epoch == null
    ) {
      return;
    }
    const elements = buildElements({
      sma: orbit.sma,
      ecc: orbit.ecc,
      inc: orbit.inc,
      lan: orbit.lan,
      argPe: orbit.argPe,
      meanAnomalyAtEpoch: orbit.meanAnomalyAtEpoch,
      epoch: orbit.epoch,
      mu: value("m³/s²", mu),
    });
    const defined = [
      elements.sma,
      elements.ecc,
      elements.inc,
      elements.meanAnomalyAtEpoch,
      elements.epoch,
    ].every((n) => Number.isFinite(n));
    if (!defined || isHyperbolic(elements.ecc)) return;
    known.push({ index, bodyIndex, elements });
  });
  return known;
}

/** Metres between the active craft and one known craft at `at`, or NaN where either cannot be placed. */
export function knownCraftRangeAt(
  craft: CommsPeerOrbit,
  known: KnownCraftOrbit,
  facts: CelestialFacts,
  at: number,
): number {
  const system = systemInstantAt(facts, at);
  const here = placed(
    system.positionByIndex.get(craft.referenceBodyIndex),
    buildElements(craft),
    at,
  );
  const there = placed(
    system.positionByIndex.get(known.bodyIndex),
    known.elements,
    at,
  );
  if (here === null || there === null) return Number.NaN;
  return magnitude([
    here[0] - there[0],
    here[1] - there[1],
    here[2] - there[2],
  ]);
}

function placed(
  centre: Vec3Tuple | undefined,
  elements: OrbitElements,
  at: number,
): Vec3Tuple | null {
  if (centre === undefined) return null;
  const state = trySolve(elements, at);
  return state === null
    ? null
    : [
        centre[0] + state.position[0],
        centre[1] + state.position[1],
        centre[2] + state.position[2],
      ];
}
