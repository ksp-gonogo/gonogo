/**
 * The contribution WRITE seam moved to `@ksp-gonogo/ui-kit`.
 *
 * The per-frame aggregation and `ContributionsProvider` write into the SAME
 * per-widget `ContributionsPanelStore` the read hooks subscribe to, and that store
 * is ui-kit's. It sat here while the pipeline needed sitrep-client values and a
 * core-side `PerfBudget`; every one of those is on the sdk now, and ui-kit imports
 * the sdk, so the two halves finally live together instead of writing to each other
 * across a package boundary.
 *
 * It went DOWN to ui-kit rather than to the sdk because an Uplink's test harness
 * needs `ContributionsProvider`, and the sdk cannot import ui-kit: handing the sdk
 * the store and the widget-meta hook so it could reassemble a ui-kit provider was
 * the wrong direction. The stack belongs where the providers are.
 *
 * Re-exported so this package's importers keep their import site.
 */
export {
  ContributionsProvider,
  useContributions,
  useContributionsBySlotId,
} from "@ksp-gonogo/ui-kit";
