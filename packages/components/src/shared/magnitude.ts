// Re-export of the canonical implementation: this primitive is generic
// enough (no dependency on the built-in widget library) that it lives in
// `@ksp-gonogo/ui-kit`, the published package a third-party Uplink client can
// import too. Kept as a re-export here (rather than deleting it and updating
// every importer) so the many existing `../shared/magnitude` imports across
// this package's widgets don't need touching. See ui-kit's own doc comment
// on `magnitudeOr` for the full rationale.
export { magnitudeOf, magnitudeOr, type Quantityish } from "@ksp-gonogo/ui-kit";
