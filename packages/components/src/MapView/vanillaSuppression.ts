// Pure decision for whether MapView's stock body texture should be
// suppressed (local_docs/spec-mapview-stackable-layers.md). Extracted so it
// is directly unit-testable without DOM/canvas — see this module's own test
// file for the regression this guards against.
//
// A `map-view.base` augment's mere REGISTRATION is not the same as its
// Domain being LIVE: the client bundle that registers an augment (e.g. an
// unconditional `import "@ksp-gonogo/<uplink>"` in the app's entry point)
// always registers it, whether or not the mod itself is running in KSP.
// Suppressing the vanilla base purely off registry presence means every
// user who doesn't have that Uplink's mod installed gets a black map with
// nothing to draw on it — the opposite of "don't like it, don't have the
// Uplink," which means the Domain must actually be live. Each candidate's
// `available` field carries that live signal, resolved by the caller via
// the SAME Domain-presence gate `AugmentSlot` uses to decide whether to
// render an augment's own component at all (see `useAugmentAvailable`,
// `@ksp-gonogo/core`'s `AugmentSlot.tsx`) — not read straight off the
// registry.

export interface VanillaSuppressionCandidate {
  /** From the augment's own `AugmentDefinition` — undefined/false = this augment never suppresses. */
  suppressesVanillaBase?: boolean;
  /** Whether this augment's Domain is CURRENTLY live — see this module's header comment. */
  available: boolean;
}

/**
 * True when any candidate both declares `suppressesVanillaBase` and is
 * currently `available`. A logical OR, order-independent (spec: "Multi-
 * Uplink conflict dissolves").
 */
export function shouldSuppressVanillaBase(
  candidates: readonly VanillaSuppressionCandidate[],
): boolean {
  return candidates.some(
    (c) => c.suppressesVanillaBase === true && c.available,
  );
}
