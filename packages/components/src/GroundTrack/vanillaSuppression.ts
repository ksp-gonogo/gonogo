// Whether GroundTrack's stock texture is suppressed. Registration is not a live Domain (a client bundle always registers its augments), so each candidate's `available` comes from the same presence gate `AugmentSlot` renders by.

export interface VanillaSuppressionCandidate {
  /** From the augment's own `AugmentDefinition`: undefined/false = this augment never suppresses. */
  suppressesVanillaBase?: boolean;
  /** Whether this augment's Domain is currently live. */
  available: boolean;
  /**
   * Whether the augment has a layer on the map, or the operator switched its layer off.
   * A layer that is live but draws nothing (a locked scanner, data not yet arrived) leaves the stock map showing.
   */
  covering: boolean;
}

/** True when any candidate declares `suppressesVanillaBase`, is `available` and is `covering` the map: an order-independent or. */
export function shouldSuppressVanillaBase(
  candidates: readonly VanillaSuppressionCandidate[],
): boolean {
  return candidates.some(
    (c) => c.suppressesVanillaBase === true && c.available && c.covering,
  );
}
