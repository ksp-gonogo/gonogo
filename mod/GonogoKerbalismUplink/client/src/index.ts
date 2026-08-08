// @ksp-gonogo/gonogo-kerbalism-uplink: the KerbalismUplink client package entry.
//
// Registers the Kerbalism Domain's bare-primitive presence Topic. Bare
// side-effect import so bundlers never tree-shake the registration call.
//
// NOTE: SpaceWeather still lives in @ksp-gonogo/components; Ship Systems (the
// rebuilt Life Support) now lives HERE, registered through the Uplink client,
// since life support is a Kerbalism concept that never belonged in the base
// library. SpaceWeather's relocation is a follow-up.
import "./topics";
// The Uplink client identity, then the per-frame `summarise` Processor that
// stamps against it. Bare side-effect imports so the registrations survive
// tree-shaking when the app pulls the package entry in.
import "./uplink";
import "./processor";
// The Ship Systems widget (registerComponent) and its panel badge (a
// contribution off the same Processor). Side-effect imports so both register
// when the app pulls the package entry in.
import "./ShipSystems";
import "./ShipSystems/badge";
// CrewManifest's per-kerbal survival: a Processor (CrewSurvival/processor.ts),
// the `crew-manifest.survival` augment that renders it into the BASE widget's
// (packages/components/src/CrewManifest) own slot, and the panel badge off
// the same Processor. Per-kerbal survival is a Kerbalism concept and never
// belonged in the base widget itself, see that widget's own doc comment on
// the slot. Side-effect imports so all three register when the app pulls the
// package entry in.
import "./CrewSurvival";
import "./CrewSurvival/badge";
// The Space Weather panel badge: a contribution to the SpaceWeather widget's
// `space-weather.badges` slot off the `kerbalism.spaceweather` Topic. The
// widget stays in @ksp-gonogo/components for now (relocation is a later step);
// only the Kerbalism-derived badge lives here.
import "./SpaceWeather/badge";

// The CrewSurvival Processor handle + its result types, the single per-frame
// derivation the `crew-manifest.survival` augment and its badge both consume.
export {
  CREW_SURVIVAL,
  type CrewSurvival,
  type KerbalRuleState,
  type KerbalSurvival,
  type SurvivalTone,
} from "./CrewSurvival/processor";
export type {
  DiagnosisGroup,
  DiagnosisInput,
  GraphNode,
  Ledger,
  LedgerInput,
  LedgerTerm,
  ResourceFacts,
  ResourceGraph,
  ResourceRow,
  Summary,
  SummaryInput,
  WearRow,
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
  summarise,
  timeToEmptySeconds,
  wearRows,
} from "./ecosystem";
// The Ship Systems Processor handle + its result type, the single per-frame
// derivation the widget and its badge both consume.
export { SHIP_SYSTEMS, type ShipSystems } from "./processor";
