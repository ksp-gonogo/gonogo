/**
 * `useExecuteAction` moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * Still the legacy command bridge described on the implementation, and still on
 * death row: moving it does not bless it, it only puts it where the Uplink calling
 * it can also test it. It named the data-source registry, the command mapper and
 * the telemetry contexts, all already sdk-side.
 *
 * Re-exported so this package's importers keep their import site.
 */
export { useExecuteAction } from "@ksp-gonogo/sitrep-sdk/spine";
