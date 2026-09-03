// ---------------------------------------------------------------------------
// Drift guard: the `@ksp-gonogo/sitrep-sdk` `ContributionRegistry` MIRROR
// (`mod/sitrep-sdk/src/api/contribution-slots.ts`) vs core's real
// `ContributionRegistry` (`packages/core/src/contributions.ts`).
//
// Same reasoning as `slot-registry.conformance.test-d.ts`'s own header: the
// sdk leaf cannot import `@ksp-gonogo/components` or `@ksp-gonogo/core`
// (would form a turbo `^build` cycle, components and core both already
// depend on the sdk), so its `ContributionRegistry` is a hand-mirrored
// declaration-merge, kept honest here (this package devDepends on the sdk
// AND is where every first-party contribution slot will eventually be
// owned, same split as the augment-slot mirror).
//
// `ship-map.part-meters` and `ship-map.part-meta`, this repo's
// self-contribution flagship, are the first real slots to land here, so this
// file grows real per-key bidirectional checks (mirrors ↔ core's real
// registry, mirrors ↔ the real widget-owned entry types), exactly the same
// two-directions-per-slot pattern `slot-registry.conformance.test-d.ts`
// established for `SlotRegistry`.
// ---------------------------------------------------------------------------

import type {
  ContributionEntry as CoreContributionEntry,
  ContributionRegistry as CoreContributionRegistry,
} from "@ksp-gonogo/core";
import type {
  ContributionEntry as SdkContributionEntry,
  ContributionRegistry as SdkContributionRegistry,
} from "@ksp-gonogo/sitrep-sdk";
import type { CommSignalHopRateEntry } from "./CommSignal/commsRoute";
import type { Instrument } from "./Experiments/instrument";
import type { ShipMapPartMetaEntry, ShipMapPartMeterEntry } from "./ShipMap";
import type { SystemEntity } from "./SystemView";

type Assignable<A, B> = A extends B ? true : false;
type Expect<T extends true> = T;

// Every key the sdk mirrors must exist, with an assignable shape, on core's
// real registry.
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

// `comm-signal.hop-rates`, checked both directions.
//
// Importing `CommSignalHopRateEntry` from `./CommSignal/commsRoute` above also
// loads that module's `declare module "@ksp-gonogo/core"` merge, which is what
// puts the slot on core's real registry for the keys check (same reason the
// ship-map checks import `./ShipMap`).

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

// `experiments.instruments`, checked both directions.
//
// Importing `Instrument` from `./Experiments/instrument` above also loads that
// module's `declare module "@ksp-gonogo/core"` merge, the same way the
// hop-rates checks load CommSignal's.

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
  Assignable<SdkContributionEntry<"experiments.instruments">, Instrument>
>;
type _ExperimentsInstrumentsRealBack = Expect<
  Assignable<Instrument, SdkContributionEntry<"experiments.instruments">>
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
