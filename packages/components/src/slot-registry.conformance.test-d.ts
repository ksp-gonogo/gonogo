// ---------------------------------------------------------------------------
// Drift guard: the `@ksp-gonogo/sitrep-sdk` slot-registry MIRROR
// (`mod/sitrep-sdk/src/api/slots.ts`) vs the real widget-owned context types
// declared in this package.
//
// Facade-sealing gap 1 fix (2026-07-19, docs/superpowers/plans/
// 2026-07-19-facade-sealing.md §2.3): the sdk leaf cannot import
// `@ksp-gonogo/components` (would form a turbo `^build` cycle, components
// already depends on the sdk), so every slot context type the sdk exposes
// via its own `SlotRegistry` merge is a hand-mirrored duplicate, not a live
// import. This file: living in components, which devDepends on the sdk AND
// owns every real type: is the one place both sides are visible, so it is
// where every mirror is kept honest: if a real slot context type drifts out
// of structural compatibility with the sdk's mirror, this fails this
// package's `tsc` typecheck (`tsconfig.test-d.json`, same convention as
// `Objectives/slot-contract.test-d.ts`).
//
// Checked bidirectionally (mirrors `packages/core/src/
// sdk-facade.conformance.test-d.ts`'s own pattern): an augment authored
// against the sdk's mirrored `SlotProps<S>` must satisfy the real widget's
// `registerAugment`/`<AugmentSlot>` call (mirror → real), and a real
// context value read back must satisfy the sdk-typed author view (real →
// mirror).
// ---------------------------------------------------------------------------

import type { SlotProps as SdkSlotProps } from "@ksp-gonogo/sitrep-sdk";
import type { ActionGroupSlotContext } from "./ActionGroup";
import type {
  CrewAvatarContext,
  CrewBadgeContext,
  CrewSurvivalSlotContext,
} from "./CrewStatus";
import type { DistanceToTargetHudContext } from "./DistanceToTarget";
import type {
  ExperimentsInstrumentSlotContext,
  ExperimentsSlotContext,
} from "./Experiments";
import type { LaunchDirectorSlotContext } from "./LaunchDirector";
import type {
  MapActionsContext,
  MapBaseLayerContext,
  MapOverlayContext,
  MapSectionsContext,
} from "./MapView";
import type { OrbitOverlayContext } from "./OrbitView";
import type { PowerSystemsSlotContext } from "./PowerSystems";
import type { ScienceDataAboardRowContext } from "./ScienceData";
import type { ShipMapOverlayContext } from "./ShipMap";
import type { SystemOverlayContext } from "./SystemView";

type Assignable<A, B> = A extends B ? true : false;
type Expect<T extends true> = T;

// --- Trivial (Record<string, never>) slots ----------------------------------
// No named context type on either side, just confirm the mirror resolved
// the merge at all (didn't fall back to the loose `Record<string, unknown>`).
type _SpaceCenterSections = Expect<
  Assignable<
    SdkSlotProps<"space-center-status.sections">,
    Record<string, never>
  >
>;
type _ManeuverSections = Expect<
  Assignable<SdkSlotProps<"maneuver-planner.sections">, Record<string, never>>
>;
type _TargetPickerSections = Expect<
  Assignable<SdkSlotProps<"target-picker.sections">, Record<string, never>>
>;
type _WarpActions = Expect<
  Assignable<SdkSlotProps<"warp-control.actions">, Record<string, never>>
>;
type _CommSections = Expect<
  Assignable<SdkSlotProps<"comm-signal.sections">, Record<string, never>>
>;
type _SystemActions = Expect<
  Assignable<SdkSlotProps<"system-view.actions">, Record<string, never>>
>;
type _FuelSections = Expect<
  Assignable<SdkSlotProps<"fuel-status.sections">, Record<string, never>>
>;

// --- Named-context slots: checked both directions --------------------------

type _D2tCamera = Expect<
  Assignable<
    SdkSlotProps<"distance-to-target.camera">,
    DistanceToTargetHudContext
  >
>;
type _D2tCameraBack = Expect<
  Assignable<
    DistanceToTargetHudContext,
    SdkSlotProps<"distance-to-target.camera">
  >
>;
type _D2tOverlay = Expect<
  Assignable<
    SdkSlotProps<"distance-to-target.overlay">,
    DistanceToTargetHudContext
  >
>;

type _ShipMapOverlay = Expect<
  Assignable<SdkSlotProps<"ship-map.overlay">, ShipMapOverlayContext>
>;
type _ShipMapOverlayBack = Expect<
  Assignable<ShipMapOverlayContext, SdkSlotProps<"ship-map.overlay">>
>;

type _CrewBadges = Expect<
  Assignable<SdkSlotProps<"crew-status.row-badges">, CrewBadgeContext>
>;
type _CrewBadgesBack = Expect<
  Assignable<CrewBadgeContext, SdkSlotProps<"crew-status.row-badges">>
>;

type _CrewAvatar = Expect<
  Assignable<SdkSlotProps<"crew-status.avatar">, CrewAvatarContext>
>;
type _CrewAvatarBack = Expect<
  Assignable<CrewAvatarContext, SdkSlotProps<"crew-status.avatar">>
>;

type _CrewSurvival = Expect<
  Assignable<SdkSlotProps<"crew-status.survival">, CrewSurvivalSlotContext>
>;
type _CrewSurvivalBack = Expect<
  Assignable<CrewSurvivalSlotContext, SdkSlotProps<"crew-status.survival">>
>;

// crew-status.summary carries no widget-owned context type (whole-widget,
// empty-props contract), so there is nothing to mirror-check beyond the sdk's
// own `Record<string, never>`.
type _CrewSummary = Expect<
  Assignable<SdkSlotProps<"crew-status.summary">, Record<string, never>>
>;

type _LaunchSections = Expect<
  Assignable<
    SdkSlotProps<"launch-director.sections">,
    LaunchDirectorSlotContext
  >
>;
type _LaunchBack = Expect<
  Assignable<
    LaunchDirectorSlotContext,
    SdkSlotProps<"launch-director.sections">
  >
>;

// "objectives.sections" is deliberately NOT bidirectionally checked here.
// Its props are a COMPONENT-VALUED contract (`{ Section: ComponentType<...>
// }`, Objectives/index.tsx's "typed-contract slot"), and comparing two
// `ComponentType<P>`s via a plain `extends` check runs into real React
// typings' union (function | class component) + `PropsWithChildren`
// variance machinery: noisy false negatives unrelated to whether the
// mirrored DATA shape (`ObjectiveSlotItem`/`ObjectiveSlotSection` in
// `mod/sitrep-sdk/src/api/slots.ts`) actually matches `ObjectiveItem`/
// `ObjectiveSection` here. `Objectives/slot-contract.test-d.ts` already
// proves the real (core-targeted) merge is a typed contract, not the loose
// fallback; the sdk mirror's field-for-field accuracy is eyeball-verified
// against this file at the point it was written, same as every other
// mirrored type in `mod/sitrep-sdk/src/api/types.ts` that predates this
// conformance file.

type _ActionGroupSections = Expect<
  Assignable<SdkSlotProps<"action-group.sections">, ActionGroupSlotContext>
>;
type _ActionGroupBack = Expect<
  Assignable<ActionGroupSlotContext, SdkSlotProps<"action-group.sections">>
>;

type _SystemOverlay = Expect<
  Assignable<SdkSlotProps<"system-view.overlay">, SystemOverlayContext>
>;
type _SystemOverlayBack = Expect<
  Assignable<SystemOverlayContext, SdkSlotProps<"system-view.overlay">>
>;
type _MapOverlay = Expect<
  Assignable<SdkSlotProps<"map-view.overlay">, MapOverlayContext>
>;
type _MapOverlayBack = Expect<
  Assignable<MapOverlayContext, SdkSlotProps<"map-view.overlay">>
>;
type _MapSections = Expect<
  Assignable<SdkSlotProps<"map-view.sections">, MapSectionsContext>
>;
type _MapSectionsBack = Expect<
  Assignable<MapSectionsContext, SdkSlotProps<"map-view.sections">>
>;
type _MapBase = Expect<
  Assignable<SdkSlotProps<"map-view.base">, MapBaseLayerContext>
>;
type _MapBaseBack = Expect<
  Assignable<MapBaseLayerContext, SdkSlotProps<"map-view.base">>
>;
type _MapActions = Expect<
  Assignable<SdkSlotProps<"map-view.actions">, MapActionsContext>
>;
type _MapActionsBack = Expect<
  Assignable<MapActionsContext, SdkSlotProps<"map-view.actions">>
>;

type _OrbitOverlay = Expect<
  Assignable<SdkSlotProps<"orbit-view.overlay">, OrbitOverlayContext>
>;
type _OrbitOverlayBack = Expect<
  Assignable<OrbitOverlayContext, SdkSlotProps<"orbit-view.overlay">>
>;

type _ExperimentsSections = Expect<
  Assignable<
    SdkSlotProps<"experiments.instrument">,
    ExperimentsInstrumentSlotContext
  >
>;
type _ExperimentsSectionsBack = Expect<
  Assignable<
    ExperimentsInstrumentSlotContext,
    SdkSlotProps<"experiments.instrument">
  >
>;
type _ExperimentsBadges = Expect<
  Assignable<SdkSlotProps<"experiments.actions">, ExperimentsSlotContext>
>;
type _ExperimentsBadgesBack = Expect<
  Assignable<ExperimentsSlotContext, SdkSlotProps<"experiments.actions">>
>;

// _DeployedSections/_DeployedSectionsBack (deployed-science.sections vs
// DeployedExperimentContext) moved to
// mod/GonogoBreakingGroundUplink/client/src/slot-registry.conformance.test-d.ts:
// DeployedScience no longer lives in this package (Breaking Ground uplink
// extraction), so the real widget-owned type this file's header describes
// checking against is no longer visible from here.

type _PowerSections = Expect<
  Assignable<SdkSlotProps<"power-systems.sections">, PowerSystemsSlotContext>
>;
type _PowerSectionsBack = Expect<
  Assignable<PowerSystemsSlotContext, SdkSlotProps<"power-systems.sections">>
>;

type _ScienceDataAboardRow = Expect<
  Assignable<
    SdkSlotProps<"science-data.aboard-row">,
    ScienceDataAboardRowContext
  >
>;
type _ScienceDataAboardRowBack = Expect<
  Assignable<
    ScienceDataAboardRowContext,
    SdkSlotProps<"science-data.aboard-row">
  >
>;

// Keep every alias "used" under noUnusedLocals.
export type _SlotRegistryConformance = [
  _SpaceCenterSections,
  _ManeuverSections,
  _TargetPickerSections,
  _WarpActions,
  _CommSections,
  _SystemActions,
  _FuelSections,
  _D2tCamera,
  _D2tCameraBack,
  _D2tOverlay,
  _ShipMapOverlay,
  _ShipMapOverlayBack,
  _CrewBadges,
  _CrewBadgesBack,
  _CrewSurvival,
  _CrewSurvivalBack,
  _LaunchSections,
  _LaunchBack,
  _ActionGroupSections,
  _ActionGroupBack,
  _SystemOverlay,
  _SystemOverlayBack,
  _MapOverlay,
  _MapOverlayBack,
  _MapSections,
  _MapSectionsBack,
  _MapBase,
  _MapBaseBack,
  _OrbitOverlay,
  _OrbitOverlayBack,
  _ExperimentsSections,
  _ExperimentsSectionsBack,
  _ExperimentsBadges,
  _ExperimentsBadgesBack,
  _PowerSections,
  _PowerSectionsBack,
  _ScienceDataAboardRow,
  _ScienceDataAboardRowBack,
];
