/**
 * The never-reckonable table moved to `@ksp-gonogo/sitrep-sdk`
 * (`src/spine/never-reckonable.ts`).
 *
 * `UnmodelledReading` is the return type of `useTelemetry` for a topic nothing can
 * model, so an Uplink widget already received one and could not name it. The file
 * imported `Reading` and nothing else, and `Reading` was already sdk-side.
 *
 * Re-exported so this package's importers keep their import site.
 */
export * from "@ksp-gonogo/sitrep-sdk/spine";
