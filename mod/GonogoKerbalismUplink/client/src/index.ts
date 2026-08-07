// @ksp-gonogo/gonogo-kerbalism-uplink: the KerbalismUplink client package entry.
//
// Registers the Kerbalism Domain's bare-primitive presence Topic. Bare
// side-effect import so bundlers never tree-shake the registration call.
//
// NOTE: the SpaceWeather + LifeSupportSystems widgets currently live in
// @ksp-gonogo/components (they read the canonical kerbalism.* Topics via
// useTelemetry). Physically relocating them into this package is a follow-up,
// the visual/snapshot probe harness that renders them lives in components, so
// the move is a mechanical file relocation with no data-path change.
import "./topics";

export type {
  DiagnosisGroup,
  DiagnosisInput,
  GraphNode,
  Ledger,
  LedgerInput,
  LedgerTerm,
  ResourceFacts,
  ResourceGraph,
} from "./ecosystem";
// The derivation layer over the Kerbalism payloads: the resource graph, the
// per-source rate ledger, and the root-cause walk. Pure functions of the wire
// shapes, no React and no KSP, so a widget calls them and so does a test.
// Exported rather than kept private because the graph is the interesting part
// of this Domain and more than one surface wants it (the life-support ledger,
// the ecosystem view, and ShipMap's per-part resource meters).
export {
  buildGraph,
  buildLedger,
  closedLoops,
  diagnose,
  resourceFacts,
  stronglyConnected,
  timeToEmptySeconds,
} from "./ecosystem";
