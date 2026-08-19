// The `/media` subpath needs its OWN entry: the import map is keyed on exact
// specifiers, so `@ksp-gonogo/sitrep-sdk` alone does not resolve a subpath
// import for a runtime-loaded Uplink. This entry is also what carries the delay
// Worker into the build: Vite emits it as an asset from the `new URL(...)` site,
// which no `tsc`-built copy of the package can do for itself.
export * from "@ksp-gonogo/sitrep-sdk/media";
