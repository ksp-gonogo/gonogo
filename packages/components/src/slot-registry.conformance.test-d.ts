/**
 * Drift guard: the `@ksp-gonogo/sitrep-sdk` slot-registry mirror (`mod/sitrep-sdk/src/api/slots.ts`) against the real widget-owned context types in this package.
 *
 * The sdk cannot import components without a build cycle, so its slot context types are hand-mirrored; this package sees both sides, so drift fails its `tsc` typecheck. Checked both ways: an augment typed against the sdk's `SlotProps<S>` satisfies the real `registerAugment`, and a real context value satisfies the sdk-typed view.
 */

import type {
  SlotProps as SdkSlotProps,
  WidgetScope as SdkWidgetScope,
} from "@ksp-gonogo/sitrep-sdk";
import type { ActionGroupSlotContext } from "./ActionGroup";
import type { CrewAvatarContext, CrewBadgeContext } from "./CrewStatus";
import type { ExperimentsInstrumentSlotContext } from "./Experiments";
import type {
  LaunchDirectorPadContext,
  LaunchDirectorSlotContext,
} from "./LaunchDirector";
import type {
  MapBaseLayerContext,
  MapOverlayContext,
  MapViewScope,
} from "./MapView";
import type { OrbitOverlayContext } from "./OrbitView";
import type { PowerSystemsScope } from "./PowerSystems";
import type { ScienceDataAboardRowContext } from "./ScienceData";
import type { ShipMapOverlayContext } from "./ShipMap";
import type { SystemOverlayContext } from "./SystemView";
import type { TargetingHudContext } from "./Targeting";

type Assignable<Left, Right> = Left extends Right ? true : false;
type Expect<Condition extends true> = Condition;

// Trivial `Record<string, never>` slots, so this only confirms the mirror resolved the merge rather than the loose fallback.
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
  Assignable<SdkSlotProps<"warp-control.stepper">, Record<string, never>>
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
// Universal segments `Panel` mounts, kept in both registries so a binder types against the propless contract; host knowledge reaches augments through `WidgetScopeRegistry`, checked at the bottom.
type _MapSections = Expect<
  Assignable<SdkSlotProps<"map-view.sections">, Record<string, never>>
>;
type _MapActions = Expect<
  Assignable<SdkSlotProps<"map-view.actions">, Record<string, never>>
>;
type _PowerSections = Expect<
  Assignable<SdkSlotProps<"power-systems.sections">, Record<string, never>>
>;
type _ExperimentsActions = Expect<
  Assignable<SdkSlotProps<"experiments.actions">, Record<string, never>>
>;

// Named-context slots, checked in both directions.

type _TargetingCamera = Expect<
  Assignable<SdkSlotProps<"targeting.camera">, TargetingHudContext>
>;
type _TargetingCameraBack = Expect<
  Assignable<TargetingHudContext, SdkSlotProps<"targeting.camera">>
>;
type _TargetingOverlay = Expect<
  Assignable<SdkSlotProps<"targeting.overlay">, TargetingHudContext>
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

// crew-status.summary has no widget-owned context type, so there is nothing beyond the sdk's `Record<string, never>` to check.
type _CrewSummary = Expect<
  Assignable<SdkSlotProps<"crew-status.summary">, Record<string, never>>
>;

type _LaunchSections = Expect<
  Assignable<
    SdkSlotProps<"launch-director.preflight">,
    LaunchDirectorSlotContext
  >
>;
type _LaunchBack = Expect<
  Assignable<
    LaunchDirectorSlotContext,
    SdkSlotProps<"launch-director.preflight">
  >
>;

type _LaunchPad = Expect<
  Assignable<SdkSlotProps<"launch-director.pad">, LaunchDirectorPadContext>
>;
type _LaunchPadBack = Expect<
  Assignable<LaunchDirectorPadContext, SdkSlotProps<"launch-director.pad">>
>;

/*
 * "objectives.source" is not bidirectionally checked: its props are component-valued, and `extends` between two `ComponentType<P>`s gives false negatives from React's typings.
 * `Objectives/slot-contract.test-d.ts` proves the core-targeted merge is a typed contract instead.
 */

type _ActionGroupSections = Expect<
  Assignable<SdkSlotProps<"action-group.subsystem">, ActionGroupSlotContext>
>;
type _ActionGroupBack = Expect<
  Assignable<ActionGroupSlotContext, SdkSlotProps<"action-group.subsystem">>
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
type _MapBase = Expect<
  Assignable<SdkSlotProps<"map-view.base">, MapBaseLayerContext>
>;
type _MapBaseBack = Expect<
  Assignable<MapBaseLayerContext, SdkSlotProps<"map-view.base">>
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

// Widget scopes: the same drift guard, applied to what a widget publishes about its own current focus, the seam a scope-key augment resolves through.
type _MapViewScope = Expect<
  Assignable<SdkWidgetScope<"map-view">, MapViewScope>
>;
type _MapViewScopeBack = Expect<
  Assignable<MapViewScope, SdkWidgetScope<"map-view">>
>;
type _PowerScope = Expect<
  Assignable<SdkWidgetScope<"power-systems">, PowerSystemsScope>
>;
type _PowerScopeBack = Expect<
  Assignable<PowerSystemsScope, SdkWidgetScope<"power-systems">>
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
  _MapSections,
  _MapActions,
  _PowerSections,
  _ExperimentsActions,
  _TargetingCamera,
  _TargetingCameraBack,
  _TargetingOverlay,
  _ShipMapOverlay,
  _ShipMapOverlayBack,
  _CrewBadges,
  _CrewBadgesBack,
  _LaunchSections,
  _LaunchBack,
  _ActionGroupSections,
  _ActionGroupBack,
  _SystemOverlay,
  _SystemOverlayBack,
  _MapOverlay,
  _MapOverlayBack,
  _MapBase,
  _MapBaseBack,
  _OrbitOverlay,
  _OrbitOverlayBack,
  _ExperimentsSections,
  _ExperimentsSectionsBack,
  _ScienceDataAboardRow,
  _ScienceDataAboardRowBack,
  _MapViewScope,
  _MapViewScopeBack,
  _PowerScope,
  _PowerScopeBack,
];
