import type { ReckoningMarking } from "@ksp-gonogo/ui-kit";

/**
 * The one mark a figure takes when it rests on several readings: a held basis
 * outranks a modelled one, since the number then rests on an observation the link
 * has stopped confirming, and the first of equal kind speaks. Null only where
 * every basis is current.
 */
export function mergeMarkings(
  ...markings: ReadonlyArray<ReckoningMarking | null>
): ReckoningMarking | null {
  return (
    markings.find((m) => m?.kind === "held") ??
    markings.find((m) => m !== null) ??
    null
  );
}
