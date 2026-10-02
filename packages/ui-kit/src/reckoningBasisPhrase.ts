import type { ReckoningBasis } from "@ksp-gonogo/sitrep-sdk";

const PHRASE: Record<ReckoningBasis, string> = {
  // A combination joins readings of one moment; it never advances a value through time.
  combination: "computed from several readings of the same moment",
  "kepler-propagation": "propagated forward on two-body motion",
  "linear-dead-reckoning": "carried forward at the last observed velocity",
  "powered-integration": "integrated forward through the burn",
  "rate-integration": "integrated forward at the last observed rate",
};

/**
 * How a value was reckoned, in words, for a chart's accessible name: dash and
 * mutedness are not channels a screen reader has.
 *
 * @category LineGraph
 */
export function reckoningBasisPhrase(basis: ReckoningBasis): string {
  return PHRASE[basis];
}
