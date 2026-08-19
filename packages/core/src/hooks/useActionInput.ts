/**
 * `useActionInput` moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * A widget declares its actions in `registerComponent({ actions: [...] })` and
 * handles them with this hook in its own component body, so both halves belong to
 * an Uplink. Everything it named was already sdk-side: the handler registry, the
 * `ActionDefinition` / `ActionHandlers` types, `PerfBudget`, and the
 * dashboard-item context that moved with it.
 *
 * Re-exported so this package's importers keep their import site.
 */
export { useActionInput } from "@ksp-gonogo/sitrep-sdk/spine";
