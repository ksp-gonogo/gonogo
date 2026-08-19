// ---------------------------------------------------------------------------
// `@ksp-gonogo/sitrep-sdk/registry`: the ORCHESTRATION half of the component
// registry.
//
// The registry itself lives in this package (`../api/registry.ts`), because every
// Uplink writes to it and an Uplink's tests reset and read it. Its author-facing
// half is on the root barrel. This subpath carries the rest: the reads a
// DASHBOARD does when it decides which widgets to render, which an Uplink author
// has no business calling.
//
// Deliberately NOT re-exported from the root barrel, for the reason `/spine` gives
// about `TimelineStore`: widget-level replacement, conflict resolution and theme
// enumeration are app orchestration rules, and publishing them on the author
// surface would freeze them as third-party API, where every future change to how
// the dashboard picks widgets becomes someone else's breaking change.
//
// It is a subpath rather than staying in `@ksp-gonogo/core` because the STATE
// cannot be in two places: one Map, one home, and this is where the Map is now.
// The app reaches these through `@ksp-gonogo/core`'s re-export, unchanged.
// ---------------------------------------------------------------------------

export {
  type AnyDef,
  type AnySource,
  getComponents,
  getReplacementConflicts,
  getResolvedComponents,
  getTheme,
  getThemes,
  onDataSourcesChange,
  type ReplacementConflict,
} from "../api/registry";
