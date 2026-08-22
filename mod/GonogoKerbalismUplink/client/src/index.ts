// @ksp-gonogo/gonogo-kerbalism-uplink: the KerbalismUplink client package entry.
//
// Registers the Kerbalism Domain's Topics: the bare-primitive presence gate plus
// the five structured Topics whose payload types this Uplink now owns outright
// (relocated out of Sitrep.Contract, see ./topics.ts). RE-EXPORTED rather than
// imported for side effect alone, and that is load-bearing in two ways: it keeps
// bundlers from tree-shaking the registration calls, AND it puts a real
// `export ... from "./topics"` into the built `dist/index.d.ts`, which is what
// carries topics.ts's `declare module "@ksp-gonogo/sitrep-sdk"` TopicPayloadMap
// augmentation across the package boundary. A bare `import "./topics"` is elided
// from the emitted declaration, so a consumer would silently see
// `useTelemetry("kerbalism.spaceweather")` resolve to `unknown` with nothing
// going red here (the same failure mode ui-kit's styledComponentsTheme.ts
// documents for its own augmentation).
//
// NOTE: SpaceWeather still lives in @ksp-gonogo/components; Ship Systems (the
// rebuilt Life Support) now lives HERE, registered through the Uplink client,
// since life support is a Kerbalism concept that never belonged in the base
// library. SpaceWeather's relocation is a follow-up.

// This Uplink's own wire payload types, now that it declares them rather than
// core. A consumer that reads a kerbalism.* Topic names its shape from HERE, the
// same way it used to name it from @ksp-gonogo/sitrep-sdk.
export type {
  KerbalismCrewEntry,
  KerbalismCrewRule,
  KerbalismFeatures,
  KerbalismGreenhouseEntry,
  KerbalismHabitat,
  KerbalismLifeSupport,
  KerbalismProcessDef,
  KerbalismProcessEntry,
  KerbalismProfile,
  KerbalismResource,
  KerbalismResourceDef,
  KerbalismRuleDef,
  KerbalismSpaceWeather,
  KerbalismStarInfo,
  KerbalismStormEntry,
} from "./__generated__/contract";
// This Uplink's namespaces of the two elected `isru.*` payloads' extension bags, same
// boundary and same load-bearing re-export again. Kerbalism WINS the ISRU election too,
// but here it fills every shared field: these readers add the blocking reason, the EC
// draw, the asteroid depletion state and the process throttle, none of which stock has
// a concept of (see ./isru.ts, and note that its converter list includes life-support
// processes because Kerbalism does not separate the two).
export {
  ISRU_CONVERTERS_TOPIC,
  ISRU_DRILLS_TOPIC,
  KERBALISM_ISRU_PROVIDER_ID,
  type KerbalismIsruConverterExtension,
  type KerbalismIsruDrillExtension,
  readKerbalismIsruConverterExt,
  readKerbalismIsruDrillExt,
} from "./isru";
// This Uplink's namespace of the CORE `reliability.summary` payload's provider
// extension bag: the typed shape plus its reader. Not a Topic of this Domain, a
// sub-tree of an elected capability's shared payload that core keeps opaque on
// purpose (see ./reliability.ts). RE-EXPORTED, like ./topics above, so the module
// loads (which is what registers the bag's runtime shape routing) and so the type
// reaches `dist/index.d.ts` rather than being elided.
export {
  KERBALISM_RELIABILITY_PROVIDER_ID,
  type KerbalismReliabilityExt,
  RELIABILITY_SUMMARY_TOPIC,
  readKerbalismReliabilityExt,
} from "./reliability";
// This Uplink's namespaces of the four elected `science.*` payloads' extension bags,
// same boundary and same load-bearing re-export as ./reliability above. Kerbalism
// WINS the science election, so on a Kerbalism install these readers are how a widget
// gets at what the shared fields cannot carry (see ./science.ts, and note which core
// fields Kerbalism deliberately leaves null).
export {
  KERBALISM_SCIENCE_PROVIDER_ID,
  KERBALISM_SCIENCE_VALUE_MODEL,
  type KerbalismScienceBreakdownExt,
  type KerbalismScienceExperimentExt,
  type KerbalismScienceInstrumentExt,
  type KerbalismScienceLabExt,
  readKerbalismScienceBreakdownExt,
  readKerbalismScienceExperimentExt,
  readKerbalismScienceInstrumentExt,
  readKerbalismScienceLabExt,
  SCIENCE_EXPERIMENT_BREAKDOWN_TOPIC,
  SCIENCE_EXPERIMENTS_TOPIC,
  SCIENCE_INSTRUMENTS_TOPIC,
  SCIENCE_LAB_TOPIC,
} from "./science";
export {
  KERBALISM_AVAILABLE_TOPIC,
  KERBALISM_CREW_TOPIC,
  KERBALISM_FEATURES_TOPIC,
  KERBALISM_LIFESUPPORT_TOPIC,
  KERBALISM_PROFILE_TOPIC,
  KERBALISM_SPACEWEATHER_TOPIC,
} from "./topics";
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
// CrewStatus's per-kerbal survival: a Processor (CrewSurvival/processor.ts),
// the `crew-status.meters` contribution that carries it into the BASE widget's
// (packages/components/src/CrewStatus) own slot, and the panel badge off
// the same Processor. Per-kerbal survival is a Kerbalism concept and never
// belonged in the base widget itself, see that widget's own doc comment on
// the slot. Side-effect imports so all three register when the app pulls the
// package entry in.
import "./CrewSurvival";
import "./CrewSurvival/badge";
// The whole-widget `crew-status.summary` slot: a vessel radiation-environment
// reading off `kerbalism.spaceweather`, distinct from the per-kerbal survival
// above (a storm affects the whole crew together, not one kerbal at a time).
import "./CrewSurvival/summary";
// The Space Weather panel badge: a contribution to the SpaceWeather widget's
// `space-weather.badges` slot off the `kerbalism.spaceweather` Topic. The
// widget stays in @ksp-gonogo/components for now (relocation is a later step);
// only the Kerbalism-derived badge lives here.
import "./SpaceWeather/badge";
// The CME / solar-activity overlay: a contribution to SystemView's
// `system-view.entities` slot off the same `kerbalism.spaceweather` Topic,
// one faint blob per active storm. SystemView itself stays in
// @ksp-gonogo/components and has no idea Kerbalism exists.
import "./SystemViewCme/contribution";
// ShipMap's self-contribution (spec §13.4): supply-tank part-meters and
// fitted-process part-meta, on the SAME two slots the built-in `core`
// contribution feeds (`packages/components/src/ShipMap/
// partMetersContribution.ts`). ShipMap itself stays in @ksp-gonogo/components;
// only these two Kerbalism-derived contributions live here.
import "./ShipMap/partMeta";
import "./ShipMap/partMeters";
// ResourceOps' filter slot: Kerbalism's per-process axis over its own
// converter list, contributed because Kerbalism is the only party that knows
// which process each row is (see ./ResourceOps/processFilters.ts for what it
// deliberately does NOT contribute).
import "./ResourceOps/processFilters";
// ScienceData's per-subject `science-data.aboard-row` slot: the File
// Manager controls (send/delete/analyze/dump/move-to-lab) over the drive
// picture only Kerbalism has. ScienceData itself stays in
// @ksp-gonogo/components; only this augment lives here.
import "./ScienceFileManager";

// The CrewSurvival Processor handle + its result types, the single per-frame
// derivation the survival meters, the per-row badge and the panel badge all consume.
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
// The consumable projection channel, re-exported rather than imported for side
// effect alone for the same reason `./topics` is: a bare side-effect import is
// elided from the emitted declaration and bundlers tree-shake the registration
// with it. Registering here is what puts `kerbalism.resourceProjection` on any
// store a TelemetryProvider builds.
export {
  deriveResourceProjectionReckoning,
  deriveResourceProjections,
  KERBALISM_RESOURCE_PROJECTION_TOPIC,
  type KerbalismResourceProjection,
  type KerbalismResourceProjections,
  kerbalismResourceProjectionChannel,
} from "./resourceProjection";
