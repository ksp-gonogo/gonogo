// `memoryStorage` moved to `@ksp-gonogo/sitrep-sdk/testing`: it imports nothing,
// so nothing kept it in an unpublished package, and an Uplink's own tests were
// reaching through `@ksp-gonogo/core/test` to get it.
//
// Re-exported so this subpath's importers keep their import site.
export { memoryStorage } from "@ksp-gonogo/sitrep-sdk/testing";
