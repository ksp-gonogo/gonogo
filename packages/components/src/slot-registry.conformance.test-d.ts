// ---------------------------------------------------------------------------
// Drift guard: the `@ksp-gonogo/sitrep-sdk` slot-registry MIRROR
// (`mod/sitrep-sdk/src/api/slots.ts`) vs the real widget-owned context types
// declared in this package.
//
// Facade-sealing gap 1 fix (2026-07-19, docs/superpowers/plans/
// 2026-07-19-facade-sealing.md §2.3): the sdk leaf cannot import
// `@ksp-gonogo/components` (would form a turbo `^build` cycle — components
// already depends on the sdk), so every slot context type the sdk exposes
// via its own `SlotRegistry` merge is a hand-mirrored duplicate, not a live
// import. This file — living in components, which devDepends on the sdk AND
// owns every real type — is the one place both sides are visible, so it is
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
import type { ContractBadgeContext } from "./ContractManager";
import type { CrewBadgeContext } from "./CrewManifest";
import type { DeployedExperimentContext } from "./DeployedScience";
import type {
  DistanceToTargetBadgeContext,
  DistanceToTargetHudContext,
} from "./DistanceToTarget";
import type { GroundSurveyBadgesContext } from "./GroundSurvey";
import type { LandingStatusBadgesContext } from "./LandingStatus";
import type { LaunchDirectorSlotContext } from "./LaunchDirector";
import type {
  MapActionsContext,
  MapBadgesContext,
  MapBaseLayerContext,
  MapOverlayContext,
  MapSectionsContext,
} from "./MapView";
import type { OrbitBadgesContext, OrbitOverlayContext } from "./OrbitView";
import type { PowerSystemsSlotContext } from "./PowerSystems";
import type {
  ScienceOfficerInstrumentSlotContext,
  ScienceOfficerSlotContext,
} from "./ScienceOfficer";
import type { ShipMapBadgesContext, ShipMapOverlayContext } from "./ShipMap";
import type { StaffBadgeContext } from "./StaffRoster";
import type { SystemBadgesContext, SystemOverlayContext } from "./SystemView";
import type { TechNodeBadgeContext } from "./TechTree";

type Assignable<A, B> = A extends B ? true : false;
type Expect<T extends true> = T;

// --- Trivial (Record<string, never>) slots ----------------------------------
// No named context type on either side — just confirm the mirror resolved
// the merge at all (didn't fall back to the loose `Record<string, unknown>`).
type _SpaceCenterSections = Expect<
  Assignable<
    SdkSlotProps<"space-center-status.sections">,
    Record<string, never>
  >
>;
type _SpaceCenterBadges = Expect<
  Assignable<SdkSlotProps<"space-center-status.badges">, Record<string, never>>
>;
type _ManeuverSections = Expect<
  Assignable<SdkSlotProps<"maneuver-planner.sections">, Record<string, never>>
>;
type _ManeuverBadges = Expect<
  Assignable<SdkSlotProps<"maneuver-planner.badges">, Record<string, never>>
>;
type _TargetPickerSections = Expect<
  Assignable<SdkSlotProps<"target-picker.sections">, Record<string, never>>
>;
type _TargetPickerBadges = Expect<
  Assignable<SdkSlotProps<"target-picker.badges">, Record<string, never>>
>;
type _WarpActions = Expect<
  Assignable<SdkSlotProps<"warp-control.actions">, Record<string, never>>
>;
type _WarpBadges = Expect<
  Assignable<SdkSlotProps<"warp-control.badges">, Record<string, never>>
>;
type _CommSections = Expect<
  Assignable<SdkSlotProps<"comm-signal.sections">, Record<string, never>>
>;
type _CommBadges = Expect<
  Assignable<SdkSlotProps<"comm-signal.badges">, Record<string, never>>
>;
type _SystemActions = Expect<
  Assignable<SdkSlotProps<"system-view.actions">, Record<string, never>>
>;
type _NavballBadges = Expect<
  Assignable<SdkSlotProps<"navball.badges">, Record<string, never>>
>;
type _DeployedBadges = Expect<
  Assignable<SdkSlotProps<"deployed-science.badges">, Record<string, never>>
>;
type _ThermalBadges = Expect<
  Assignable<SdkSlotProps<"thermal-status.badges">, Record<string, never>>
>;
type _FuelSections = Expect<
  Assignable<SdkSlotProps<"fuel-status.sections">, Record<string, never>>
>;
type _FuelBadges = Expect<
  Assignable<SdkSlotProps<"fuel-status.badges">, Record<string, never>>
>;

// --- Named-context slots — checked both directions --------------------------

type _StaffBadges = Expect<
  Assignable<SdkSlotProps<"staff-roster.badges">, StaffBadgeContext>
>;
type _StaffBadgesBack = Expect<
  Assignable<StaffBadgeContext, SdkSlotProps<"staff-roster.badges">>
>;

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
type _D2tBadges = Expect<
  Assignable<
    SdkSlotProps<"distance-to-target.badges">,
    DistanceToTargetBadgeContext
  >
>;
type _D2tBadgesBack = Expect<
  Assignable<
    DistanceToTargetBadgeContext,
    SdkSlotProps<"distance-to-target.badges">
  >
>;

type _ShipMapOverlay = Expect<
  Assignable<SdkSlotProps<"ship-map.overlay">, ShipMapOverlayContext>
>;
type _ShipMapOverlayBack = Expect<
  Assignable<ShipMapOverlayContext, SdkSlotProps<"ship-map.overlay">>
>;
type _ShipMapBadges = Expect<
  Assignable<SdkSlotProps<"ship-map.badges">, ShipMapBadgesContext>
>;
type _ShipMapBadgesBack = Expect<
  Assignable<ShipMapBadgesContext, SdkSlotProps<"ship-map.badges">>
>;

type _ContractBadges = Expect<
  Assignable<SdkSlotProps<"contract-manager.badges">, ContractBadgeContext>
>;
type _ContractBadgesBack = Expect<
  Assignable<ContractBadgeContext, SdkSlotProps<"contract-manager.badges">>
>;

type _CrewBadges = Expect<
  Assignable<SdkSlotProps<"crew-manifest.badges">, CrewBadgeContext>
>;
type _CrewBadgesBack = Expect<
  Assignable<CrewBadgeContext, SdkSlotProps<"crew-manifest.badges">>
>;

type _LaunchBadges = Expect<
  Assignable<SdkSlotProps<"launch-director.badges">, LaunchDirectorSlotContext>
>;
type _LaunchSections = Expect<
  Assignable<
    SdkSlotProps<"launch-director.sections">,
    LaunchDirectorSlotContext
  >
>;
type _LaunchBack = Expect<
  Assignable<LaunchDirectorSlotContext, SdkSlotProps<"launch-director.badges">>
>;

// "objectives.sections" is deliberately NOT bidirectionally checked here.
// Its props are a COMPONENT-VALUED contract (`{ Section: ComponentType<...>
// }`, Objectives/index.tsx's "typed-contract slot"), and comparing two
// `ComponentType<P>`s via a plain `extends` check runs into real React
// typings' union (function | class component) + `PropsWithChildren`
// variance machinery — noisy false negatives unrelated to whether the
// mirrored DATA shape (`ObjectiveSlotItem`/`ObjectiveSlotSection` in
// `mod/sitrep-sdk/src/api/slots.ts`) actually matches `ObjectiveItem`/
// `ObjectiveSection` here. `Objectives/slot-contract.test-d.ts` already
// proves the real (core-targeted) merge is a typed contract, not the loose
// fallback; the sdk mirror's field-for-field accuracy is eyeball-verified
// against this file at the point it was written, same as every other
// mirrored type in `mod/sitrep-sdk/src/api/types.ts` that predates this
// conformance file.

type _ActionGroupBadges = Expect<
  Assignable<SdkSlotProps<"action-group.badges">, ActionGroupSlotContext>
>;
type _ActionGroupSections = Expect<
  Assignable<SdkSlotProps<"action-group.sections">, ActionGroupSlotContext>
>;
type _ActionGroupBack = Expect<
  Assignable<ActionGroupSlotContext, SdkSlotProps<"action-group.badges">>
>;

type _SystemOverlay = Expect<
  Assignable<SdkSlotProps<"system-view.overlay">, SystemOverlayContext>
>;
type _SystemOverlayBack = Expect<
  Assignable<SystemOverlayContext, SdkSlotProps<"system-view.overlay">>
>;
type _SystemBadges = Expect<
  Assignable<SdkSlotProps<"system-view.badges">, SystemBadgesContext>
>;
type _SystemBadgesBack = Expect<
  Assignable<SystemBadgesContext, SdkSlotProps<"system-view.badges">>
>;

type _GroundSurveyBadges = Expect<
  Assignable<SdkSlotProps<"ground-survey.badges">, GroundSurveyBadgesContext>
>;
type _GroundSurveyBadgesBack = Expect<
  Assignable<GroundSurveyBadgesContext, SdkSlotProps<"ground-survey.badges">>
>;

type _MapOverlay = Expect<
  Assignable<SdkSlotProps<"map-view.overlay">, MapOverlayContext>
>;
type _MapOverlayBack = Expect<
  Assignable<MapOverlayContext, SdkSlotProps<"map-view.overlay">>
>;
type _MapBadges = Expect<
  Assignable<SdkSlotProps<"map-view.badges">, MapBadgesContext>
>;
type _MapBadgesBack = Expect<
  Assignable<MapBadgesContext, SdkSlotProps<"map-view.badges">>
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

type _TechBadges = Expect<
  Assignable<SdkSlotProps<"tech-tree.badges">, TechNodeBadgeContext>
>;
type _TechBadgesBack = Expect<
  Assignable<TechNodeBadgeContext, SdkSlotProps<"tech-tree.badges">>
>;

type _LandingBadges = Expect<
  Assignable<SdkSlotProps<"landing-status.badges">, LandingStatusBadgesContext>
>;
type _LandingBadgesBack = Expect<
  Assignable<LandingStatusBadgesContext, SdkSlotProps<"landing-status.badges">>
>;

type _OrbitOverlay = Expect<
  Assignable<SdkSlotProps<"orbit-view.overlay">, OrbitOverlayContext>
>;
type _OrbitOverlayBack = Expect<
  Assignable<OrbitOverlayContext, SdkSlotProps<"orbit-view.overlay">>
>;
type _OrbitBadges = Expect<
  Assignable<SdkSlotProps<"orbit-view.badges">, OrbitBadgesContext>
>;
type _OrbitBadgesBack = Expect<
  Assignable<OrbitBadgesContext, SdkSlotProps<"orbit-view.badges">>
>;

type _ScienceOfficerSections = Expect<
  Assignable<
    SdkSlotProps<"science-officer.sections">,
    ScienceOfficerInstrumentSlotContext
  >
>;
type _ScienceOfficerSectionsBack = Expect<
  Assignable<
    ScienceOfficerInstrumentSlotContext,
    SdkSlotProps<"science-officer.sections">
  >
>;
type _ScienceOfficerBadges = Expect<
  Assignable<SdkSlotProps<"science-officer.badges">, ScienceOfficerSlotContext>
>;
type _ScienceOfficerBadgesBack = Expect<
  Assignable<ScienceOfficerSlotContext, SdkSlotProps<"science-officer.badges">>
>;

type _DeployedSections = Expect<
  Assignable<
    SdkSlotProps<"deployed-science.sections">,
    DeployedExperimentContext
  >
>;
type _DeployedSectionsBack = Expect<
  Assignable<
    DeployedExperimentContext,
    SdkSlotProps<"deployed-science.sections">
  >
>;

type _PowerSections = Expect<
  Assignable<SdkSlotProps<"power-systems.sections">, PowerSystemsSlotContext>
>;
type _PowerSectionsBack = Expect<
  Assignable<PowerSystemsSlotContext, SdkSlotProps<"power-systems.sections">>
>;
type _PowerBadges = Expect<
  Assignable<SdkSlotProps<"power-systems.badges">, PowerSystemsSlotContext>
>;

// Keep every alias "used" under noUnusedLocals.
export type _SlotRegistryConformance = [
  _SpaceCenterSections,
  _SpaceCenterBadges,
  _ManeuverSections,
  _ManeuverBadges,
  _TargetPickerSections,
  _TargetPickerBadges,
  _WarpActions,
  _WarpBadges,
  _CommSections,
  _CommBadges,
  _SystemActions,
  _NavballBadges,
  _DeployedBadges,
  _ThermalBadges,
  _FuelSections,
  _FuelBadges,
  _StaffBadges,
  _StaffBadgesBack,
  _D2tCamera,
  _D2tCameraBack,
  _D2tOverlay,
  _D2tBadges,
  _D2tBadgesBack,
  _ShipMapOverlay,
  _ShipMapOverlayBack,
  _ShipMapBadges,
  _ShipMapBadgesBack,
  _ContractBadges,
  _ContractBadgesBack,
  _CrewBadges,
  _CrewBadgesBack,
  _LaunchBadges,
  _LaunchSections,
  _LaunchBack,
  _ActionGroupBadges,
  _ActionGroupSections,
  _ActionGroupBack,
  _SystemOverlay,
  _SystemOverlayBack,
  _SystemBadges,
  _SystemBadgesBack,
  _GroundSurveyBadges,
  _GroundSurveyBadgesBack,
  _MapOverlay,
  _MapOverlayBack,
  _MapBadges,
  _MapBadgesBack,
  _MapSections,
  _MapSectionsBack,
  _MapBase,
  _MapBaseBack,
  _TechBadges,
  _TechBadgesBack,
  _LandingBadges,
  _LandingBadgesBack,
  _OrbitOverlay,
  _OrbitOverlayBack,
  _OrbitBadges,
  _OrbitBadgesBack,
  _ScienceOfficerSections,
  _ScienceOfficerSectionsBack,
  _ScienceOfficerBadges,
  _ScienceOfficerBadgesBack,
  _DeployedSections,
  _DeployedSectionsBack,
  _PowerSections,
  _PowerSectionsBack,
  _PowerBadges,
];
