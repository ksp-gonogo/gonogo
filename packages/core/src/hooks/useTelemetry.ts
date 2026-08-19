/**
 * `useTelemetry` moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * The canonical read hook of the Uplink architecture, so an Uplink widget calls it
 * on every render and its TEST has to be able to drive the real one. Everything it
 * named was already sdk-side or moved with it: the carried-topic policy, the topic
 * mapper, the reading union, the telemetry contexts, and the never-reckonable table
 * that moved in the same change.
 *
 * Re-exported so this package's importers keep their import site.
 */
export { useTelemetry } from "@ksp-gonogo/sitrep-sdk/spine";
