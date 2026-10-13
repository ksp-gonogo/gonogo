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
 * How a value was reckoned (held, or carried forward by a model), in words.
 * Useful for naming a chart so a screen reader tells the operator how a line
 * was reckoned, since a dash style and a muted colour are not read out. Used
 * by {@link LineGraph} and the docking and rendezvous widgets.
 *
 * @category LineGraph
 */
export function reckoningBasisPhrase(basis: ReckoningBasis): string {
  return PHRASE[basis];
}
