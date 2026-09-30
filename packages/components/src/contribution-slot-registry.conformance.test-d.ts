/*
 * Drift guard: the `@ksp-gonogo/sitrep-sdk` `ContributionRegistry` mirror (`mod/sitrep-sdk/src/api/contribution-slots.ts`) against core's real `ContributionRegistry`.
 * The sdk cannot import core or components without a build cycle, so its registry is a hand-mirrored declaration merge, checked here in both directions per slot against core's registry and the widget-owned entry types.
 */

import type {
  ContributionEntry as CoreContributionEntry,
  ContributionRegistry as CoreContributionRegistry,
} from "@ksp-gonogo/core";
import type {
  ContributionEntry as SdkContributionEntry,
  ContributionRegistry as SdkContributionRegistry,
} from "@ksp-gonogo/sitrep-sdk";
import type { CommSignalHopRateEntry } from "./CommSignal/commsRoute";
import type { ContributedInstrument } from "./Experiments/instrument";
import type { ShipMapPartMetaEntry, ShipMapPartMeterEntry } from "./ShipMap";
import type { SystemEntity } from "./SystemView";

type Assignable<Left, Right> = Left extends Right ? true : false;
type Expect<Condition extends true> = Condition;

// Every key the sdk mirrors must exist, with an assignable shape, on core's real registry.
type _SdkKeysAssignableToCore = Expect<
  Assignable<keyof SdkContributionRegistry, keyof CoreContributionRegistry>
>;

// ship-map.part-meters: checked both directions

type _ShipMapPartMeters = Expect<
  Assignable<
    SdkContributionEntry<"ship-map.part-meters">,
    CoreContributionEntry<"ship-map.part-meters">
  >
>;
type _ShipMapPartMetersBack = Expect<
  Assignable<
    CoreContributionEntry<"ship-map.part-meters">,
    SdkContributionEntry<"ship-map.part-meters">
  >
>;
type _ShipMapPartMetersReal = Expect<
  Assignable<
    SdkContributionEntry<"ship-map.part-meters">,
    ShipMapPartMeterEntry
  >
>;
type _ShipMapPartMetersRealBack = Expect<
  Assignable<
    ShipMapPartMeterEntry,
    SdkContributionEntry<"ship-map.part-meters">
  >
>;

// ship-map.part-meta: checked both directions

type _ShipMapPartMeta = Expect<
  Assignable<
    SdkContributionEntry<"ship-map.part-meta">,
    CoreContributionEntry<"ship-map.part-meta">
  >
>;
type _ShipMapPartMetaBack = Expect<
  Assignable<
    CoreContributionEntry<"ship-map.part-meta">,
    SdkContributionEntry<"ship-map.part-meta">
  >
>;
type _ShipMapPartMetaReal = Expect<
  Assignable<SdkContributionEntry<"ship-map.part-meta">, ShipMapPartMetaEntry>
>;
type _ShipMapPartMetaRealBack = Expect<
  Assignable<ShipMapPartMetaEntry, SdkContributionEntry<"ship-map.part-meta">>
>;

// system-view.entities: checked both directions

type _SystemViewEntities = Expect<
  Assignable<
    SdkContributionEntry<"system-view.entities">,
    CoreContributionEntry<"system-view.entities">
  >
>;
type _SystemViewEntitiesBack = Expect<
  Assignable<
    CoreContributionEntry<"system-view.entities">,
    SdkContributionEntry<"system-view.entities">
  >
>;
type _SystemViewEntitiesReal = Expect<
  Assignable<SdkContributionEntry<"system-view.entities">, SystemEntity>
>;
type _SystemViewEntitiesRealBack = Expect<
  Assignable<SystemEntity, SdkContributionEntry<"system-view.entities">>
>;

// `comm-signal.hop-rates`, checked both directions; importing from `./CommSignal/commsRoute` loads the merge that puts the slot on core's registry.

type _CommSignalHopRates = Expect<
  Assignable<
    SdkContributionEntry<"comm-signal.hop-rates">,
    CoreContributionEntry<"comm-signal.hop-rates">
  >
>;
type _CommSignalHopRatesBack = Expect<
  Assignable<
    CoreContributionEntry<"comm-signal.hop-rates">,
    SdkContributionEntry<"comm-signal.hop-rates">
  >
>;
type _CommSignalHopRatesReal = Expect<
  Assignable<
    SdkContributionEntry<"comm-signal.hop-rates">,
    CommSignalHopRateEntry
  >
>;
type _CommSignalHopRatesRealBack = Expect<
  Assignable<
    CommSignalHopRateEntry,
    SdkContributionEntry<"comm-signal.hop-rates">
  >
>;

// `experiments.instruments`, checked both directions; importing from `./Experiments/instrument` loads its merge.

type _ExperimentsInstruments = Expect<
  Assignable<
    SdkContributionEntry<"experiments.instruments">,
    CoreContributionEntry<"experiments.instruments">
  >
>;
type _ExperimentsInstrumentsBack = Expect<
  Assignable<
    CoreContributionEntry<"experiments.instruments">,
    SdkContributionEntry<"experiments.instruments">
  >
>;
type _ExperimentsInstrumentsReal = Expect<
  Assignable<
    SdkContributionEntry<"experiments.instruments">,
    ContributedInstrument
  >
>;
type _ExperimentsInstrumentsRealBack = Expect<
  Assignable<
    ContributedInstrument,
    SdkContributionEntry<"experiments.instruments">
  >
>;

// Keep every alias "used" under noUnusedLocals.
export type _ContributionRegistryConformance = [
  _SdkKeysAssignableToCore,
  _ShipMapPartMeters,
  _ShipMapPartMetersBack,
  _ShipMapPartMetersReal,
  _ShipMapPartMetersRealBack,
  _ShipMapPartMeta,
  _ShipMapPartMetaBack,
  _ShipMapPartMetaReal,
  _ShipMapPartMetaRealBack,
  _SystemViewEntities,
  _SystemViewEntitiesBack,
  _SystemViewEntitiesReal,
  _SystemViewEntitiesRealBack,
  _CommSignalHopRates,
  _CommSignalHopRatesBack,
  _CommSignalHopRatesReal,
  _CommSignalHopRatesRealBack,
  _ExperimentsInstruments,
  _ExperimentsInstrumentsBack,
  _ExperimentsInstrumentsReal,
  _ExperimentsInstrumentsRealBack,
];
