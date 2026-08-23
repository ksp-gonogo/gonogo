// The `/spine` subpath needs its OWN entry for the same reason `/media` does:
// the import map is keyed on exact specifiers, so `@ksp-gonogo/sitrep-sdk`
// alone resolves nothing for a subpath import and a runtime-loaded Uplink that
// names `/spine` fails to link at load.
//
// It resolves to the app's own spine modules rather than a second copy. That is
// what makes it safe to have both this chunk and `ext-sitrep-client` (which
// re-exports the spine) in the map: one Rollup build keeps each module in
// exactly one chunk, so a `TimelineStore` reached through either specifier is
// the same class, and a `useTelemetry` reads the store the app writes.
export * from "@ksp-gonogo/sitrep-sdk/spine";
