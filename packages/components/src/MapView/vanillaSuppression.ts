// Whether MapView's stock texture is suppressed. Registration is not a live Domain (a client bundle always registers its augments), so each candidate's `available` comes from the same presence gate `AugmentSlot` renders by.

export interface VanillaSuppressionCandidate {
  /** From the augment's own `AugmentDefinition`: undefined/false = this augment never suppresses. */
  suppressesVanillaBase?: boolean;
  /** Whether this augment's Domain is currently live. */
  available: boolean;
}

/** True when any candidate declares `suppressesVanillaBase` and is `available`: an order-independent OR. */
export function shouldSuppressVanillaBase(
  candidates: readonly VanillaSuppressionCandidate[],
): boolean {
  return candidates.some(
    (c) => c.suppressesVanillaBase === true && c.available,
  );
}
