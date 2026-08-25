/**
 * The magnitude unwrap, re-exported from where it now lives.
 *
 * It was implemented here until 2026-08-25 and moved down into
 * `@ksp-gonogo/sitrep-sdk` beside `Value`, the type it unwraps. The reason is
 * the dependency direction: ui-kit depends on the sdk, so while the canonical
 * pair lived here nothing in the sdk could reach it without a cycle, and two
 * spine files carried their own copies that disagreed about what absence means.
 * That file's own doc comment carries the full reasoning.
 *
 * This re-export is what made the move cost nothing at the call sites: ui-kit
 * is the published package a third-party Uplink already imports, so
 * `magnitudeOf` stays reachable from exactly where every caller expects it.
 */
export {
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "@ksp-gonogo/sitrep-sdk";
