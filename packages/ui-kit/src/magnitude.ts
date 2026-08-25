/**
 * The magnitude unwrap, re-exported.
 *
 * It is implemented in `@ksp-gonogo/sitrep-sdk` beside `Value`, the type it
 * unwraps, and belongs there because of the dependency direction: ui-kit
 * depends on the sdk, so a canonical pair defined HERE is unreachable from the
 * sdk without a cycle, and spine files end up carrying their own copies that
 * disagree about what absence means. That file's own doc comment carries the
 * full reasoning.
 *
 * The re-export exists because ui-kit is the published package a third-party
 * Uplink already imports, so `magnitudeOf` stays reachable from exactly where
 * every caller expects it.
 */
export {
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "@ksp-gonogo/sitrep-sdk";
