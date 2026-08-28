/**
 * Drift guard: the `@ksp-gonogo/sitrep-sdk` slot-registry MIRROR
 * (`mod/sitrep-sdk/src/api/slots.ts`) against the real widget-owned context
 * types declared in this package.
 *
 * The sdk leaf cannot import `@ksp-gonogo/components`, which would form a turbo
 * `^build` cycle since components already depends on the sdk, so every slot
 * context type the sdk exposes through its own `SlotRegistry` merge is a
 * hand-mirrored duplicate rather than a live import. This file lives in
 * components, which devDepends on the sdk and owns every real type, making it
 * the one place both sides are visible: when a real slot context type drifts out
 * of structural compatibility with the sdk's mirror, this fails the package's
 * `tsc` typecheck through `tsconfig.test-d.json`.
 *
 * Checked in both directions, the same way `packages/core`'s
 * `sdk-facade.conformance.test-d.ts` does it: an augment authored against the
 * sdk's mirrored `SlotProps<S>` must satisfy the real widget's
 * `registerAugment` and `<AugmentSlot>` call, and a real context value read back
 * must satisfy the sdk-typed author view.
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

type Assignable<A, B> = A extends B ? true : false;
type Expect<T extends true> = T;

// Trivial `Record<string, never>` slots: no named context type on either side, so all these confirm is that the mirror resolved the merge at all rather than falling back to the loose `Record<string, unknown>`.
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
// Universal segments `Panel` mounts. Their ids stay in both registries so a
// binder still types against the propless contract rather than the loose
// fallback; what the host widget knows and an augment wants reaches it through
// `WidgetScopeRegistry` instead, checked at the bottom of this file.
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

// crew-status.summary carries no widget-owned context type (whole-widget,
// empty-props contract), so there is nothing to mirror-check beyond the sdk's
// own `Record<string, never>`.
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

// "objectives.source" is deliberately NOT bidirectionally checked here.
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
// _DeployedSections/_DeployedSectionsBack (deployed-science.experiment vs
// DeployedExperimentContext) moved to
// mod/GonogoBreakingGroundUplink/client/src/slot-registry.conformance.test-d.ts:
// DeployedScience no longer lives in this package (Breaking Ground uplink
// extraction), so the real widget-owned type this file's header describes
// checking against is no longer visible from here.

// --- Widget SCOPES: the same mirror-vs-real drift guard, applied to what a
// widget publishes about its own current focus. A universal segment carries no
// props, so this is the seam a scope-key augment resolves through, and it drifts
// exactly the way the slot mirrors do.

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
