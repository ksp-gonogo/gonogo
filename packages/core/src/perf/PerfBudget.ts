/**
 * `PerfBudget` moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * Every new data source is required to register one, and the eight Uplink test
 * setups all call `PerfBudget.installTestGate()`, so it has to be reachable from
 * a published package or that requirement only applies to code inside this repo.
 * It named nothing above the sdk leaf but `@ksp-gonogo/logger`, which the sdk
 * already shims through the host.
 *
 * Its registry moved to a `globalThis` slot in the same change: a module-static
 * `Set` was safe while this file was the only home, and would have been the
 * silent second-copy-of-a-registry failure once the class could be bundled.
 *
 * Re-exported so this package's ~67 users keep their import site.
 */
export { PerfBudget, type PerfBudgetOptions } from "@ksp-gonogo/sitrep-sdk";
