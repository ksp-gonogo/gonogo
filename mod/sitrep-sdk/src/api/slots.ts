// ---------------------------------------------------------------------------
// Slot-registry mirror — the `SlotRegistry` declaration-merge for every
// first-party (packages/components-owned) augment slot, carried by the sdk
// leaf itself.
//
// Why this lives HERE and not in `packages/components` (facade-sealing plan
// §2.3, corrected 2026-07-19): the plan originally had each slot-owning
// widget carry a SECOND `declare module "@ksp-gonogo/sitrep-sdk"` block
// alongside its existing `declare module "@ksp-gonogo/core"` one (see e.g.
// MapView/index.tsx). That doesn't work: TypeScript only applies ambient
// module augmentation from files that are actually part of the compiled
// PROGRAM, and a facade-sealed client (which must not import
// `@ksp-gonogo/components`) never pulls those files in — so
// `SlotProps<"map-view.overlay">` etc. silently fall back to the untyped
// `Record<string, unknown>` for a sealed client, exactly the failure mode
// this seam exists to prevent.
//
// The fix is NOT `import type` from `@ksp-gonogo/components` — same leaf
// constraint documented at length in `./types.ts`'s header: sitrep-sdk is
// the dependency-graph LEAF (core, components, data, and sitrep-client all
// depend on the sdk already), so naming `@ksp-gonogo/components` here, even
// as a type-only import, would form a turbo `^build` cycle. Every slot
// context type below is therefore MIRRORED (duplicated), same as every
// other author-facing type in `./types.ts` — self-contained, kept honest by
// eyeball + the widget's own doc comments, not a live import.
//
// `index.ts` imports this module for its ambient side effect only (no named
// exports added to the barrel) so every consumer of the facade — sealed or
// not — gets the full merge automatically, without a per-file side-effect
// import.
//
// Scope: every slot OWNED by a `packages/components` widget. Slots owned by
// an UPLINK's own client package (SCANsat's `Scanning` — "scanning.sections"
// /".badges"; kerbcast's `CameraFeed` — "camera-feed.overlay"/".badges") are
// deliberately NOT mirrored here: mirroring them would require the sdk to
// import type shapes from an Uplink client package, which — since every
// Uplink client already depends on the sdk — would be the exact same cycle.
// Those slots stay owned/declared entirely inside the Uplink's own file
// (once sealed, its `declare module "@ksp-gonogo/sitrep-sdk"` block lives
// right there, which works fine: the owning file is always part of its OWN
// package's compiled program, so no cross-package reachability problem
// exists for a slot's OWNER — only for a FOREIGN filler, which is exactly
// the packages/components case this file solves).
// ---------------------------------------------------------------------------

// --- SpaceCenterStatus (packages/components/src/SpaceCenterStatus) ---------

// "space-center-status.sections" / ".badges" carry no props today.

// --- ManeuverPlanner (packages/components/src/ManeuverPlanner) -------------

// "maneuver-planner.sections" / ".badges" carry no props today
// (ManeuverPlannerSectionsSlotProps / ManeuverPlannerBadgesSlotProps are
// both `Record<string, never>` aliases in the real widget).

// --- TargetPicker (packages/components/src/TargetPicker) -------------------

// "target-picker.sections" / ".badges" carry no props today.

// --- WarpControl (packages/components/src/WarpControl) ---------------------

// "warp-control.actions" / ".badges" carry no props today.

// --- StaffRoster (packages/components/src/StaffRoster) ---------------------

/** Mirrors `StaffBadgeContext` (StaffRoster/index.tsx). */
export interface StaffBadgeContext {
  /** The kerbal this badge row belongs to — its identity for the augment. */
  staffName: string;
  /** Position in the sorted roster; disambiguates duplicate names. */
  staffIndex: number;
}

// --- DistanceToTarget (packages/components/src/DistanceToTarget) -----------

/** Mirrors `DistanceToTargetHudContext` (DistanceToTarget/index.tsx). */
export interface DistanceToTargetHudContext {
  /** Half-range in degrees the reticle box maps to; the reticle clamps at the edge. */
  maxDeg: number;
  /**
   * Reticle-centre offset from HUD centre, each component in −1..1 (clamped
   * alignment angle ÷ `maxDeg`; `y` already flipped for screen coords so
   * positive is downward).
   */
  reticleOffset: { x: number; y: number };
  /**
   * Percent of the half-box the reticle travels per unit of `reticleOffset`
   * — an overlay places a marker at `50 + offset·reticleTravelPct` % to sit
   * in the same space.
   */
  reticleTravelPct: number;
  /** True while the two ports are within docking-alignment tolerance. */
  aligned: boolean;
  /** Raw docking alignment angles in degrees; undefined outside a docking scenario. */
  ax: number | undefined;
  ay: number | undefined;
  /** Range to the target in metres; undefined until the stream reports position. */
  distance: number | undefined;
  /**
   * Camera id the operator pinned for the backdrop, or unset to let the
   * augment choose. Opaque to this widget — the filling augment interprets it.
   */
  cameraFlightId: number | null | undefined;
}

/** Mirrors `DistanceToTargetBadgeContext` (DistanceToTarget/index.tsx). */
export interface DistanceToTargetBadgeContext {
  /** Current target name, or undefined when no target is set. */
  targetName: string | undefined;
  /** KSP target type (`Vessel`, `CelestialBody`, a docking-port type, ...). */
  targetType: string | undefined;
  /** Range to the target in metres; undefined until the stream reports position. */
  distance: number | undefined;
}

// --- CommSignal (packages/components/src/CommSignal) -----------------------

// "comm-signal.sections" / ".badges" carry no props today.

// --- ShipMap (packages/components/src/ShipMap) -----------------------------

/** Mirrors `PartStateModule` (`packages/core/src/schemas/vessel-parts.ts`) — the
 * only core-owned nested type `ShipMapPart` actually references. */
export interface ShipMapPartStateModule {
  type:
    | "solarPanel"
    | "radiator"
    | "antenna"
    | "parachute"
    | "engine"
    | "drill"
    | "cargoBay"
    | "landingGear";
  state: string;
  tracking?: boolean;
  flameout?: boolean;
}

/** Mirrors `PartType` (ShipMap/shipTopology.ts). */
export type ShipMapPartType =
  | "engine"
  | "booster"
  | "tank"
  | "decoupler"
  | "nose-cone"
  | "fin"
  | "rcs"
  | "capsule"
  | "solar"
  | "parachute"
  | "wheel"
  | "fuel-line"
  | "other";

/** Mirrors `ShipMapPart` (ShipMap/shipTopology.ts). */
export interface ShipMapPart {
  flightId: number;
  parentFlightId: number | null;
  name: string;
  title: string;
  type: ShipMapPartType;
  lat: number;
  axial: number;
  depth: number;
  rotationRad: number;
  size: { x: number; y: number; z: number };
  latHalfExtent: number;
  axialHalfExtent: number;
  dryMass: number;
  stage: number;
  maxTemp: number;
  temperatureK?: number;
  maxTemperatureK?: number;
  resources?: { n: string; a: number; c: number }[];
  ecFlowSign?: "producer" | "consumer" | null;
  fuelLineTarget?: number | null;
  partState?: ShipMapPartStateModule[];
}

/** Mirrors `ShipBounds` (ShipMap/ShipDiagramSvg.tsx). */
export interface ShipMapBounds {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Mirrors `ShipMapOverlayContext` (ShipMap/index.tsx). */
export interface ShipMapOverlayContext {
  /** The projected parts (per-part `lat`/`axial`/`flightId`/geometry). */
  parts: readonly ShipMapPart[];
  /** Overlay layer width in px (matches the diagram canvas). */
  width: number;
  /** Overlay layer height in px (matches the diagram canvas). */
  height: number;
  /** Metre-space fit bounds of the projected vessel. */
  bounds: ShipMapBounds;
  /** Base (identity-camera) metres→px scale. */
  baseScale: number;
  /** Screen-space margin (px) reserved around the fit-scaled diagram. */
  padding: number;
}

/** Mirrors `ShipMapBadgesContext` (ShipMap/index.tsx). */
export interface ShipMapBadgesContext {
  /** Number of parts currently rendered. */
  partCount: number;
  /** Hottest part name (`therm.hottestPartName`), when known. */
  hottestPartName: string | null;
}

// --- ContractManager (packages/components/src/ContractManager) -------------

/** Mirrors `ContractBadgeContext` (ContractManager/index.tsx). */
export interface ContractBadgeContext {
  /** Contract id as a string (KSP long-safe). Identity for the augment. */
  contractId: string;
  /** Contract title, as shown in the card header. */
  title: string;
  /** Sponsoring agency — the natural key for contract-pack iconography. */
  agency: string;
  /** Which list the row sits in. */
  section: "active" | "offered";
}

// --- CrewManifest (packages/components/src/CrewManifest) -------------------

/** Mirrors `CrewBadgeContext` (CrewManifest/index.tsx). */
export interface CrewBadgeContext {
  /** The crew member this badge row belongs to — its identity for the augment. */
  crewName: string;
  /** Position in the roster; disambiguates duplicate names. */
  crewIndex: number;
}

// --- LaunchDirector (packages/components/src/LaunchDirector) ---------------

/** Mirrors `LaunchDirectorSlotContext` (LaunchDirector/index.tsx). */
export interface LaunchDirectorSlotContext {
  /** Current KSP scene ("Flight", "Editor", ...); undefined until telemetry arrives. */
  scene: string | undefined;
  /** True while a vessel is in flight (scene === "Flight"). */
  inFlight: boolean;
  /** The saved craft selected in the pre-launch picker, or null when none. */
  selectedShip: string | null;
  /** The chosen launch-site name (e.g. "LaunchPad"). */
  selectedSite: string;
  /** Crew names the operator has selected for the launch. */
  selectedCrew: string[];
  /** Career funds balance; undefined in sandbox/science or before telemetry. */
  funds: number | undefined;
}

// --- Objectives (packages/components/src/Objectives) -----------------------

/** Mirrors `ObjectiveState` (Objectives/index.tsx). */
export type ObjectiveSlotState = "pending" | "active" | "reached" | "failed";

/** Mirrors `ObjectiveItem` (Objectives/index.tsx). */
export interface ObjectiveSlotItem {
  id: string;
  title: string;
  description?: string;
  state: ObjectiveSlotState;
  /** Parent label — the mission or contract this objective belongs to. */
  source: string;
  optional?: boolean;
  /** Set for contract parameters — enables the "alarm on completion" toggle. */
  contractId?: string;
}

/** Mirrors `ObjectiveSection` (Objectives/index.tsx). */
export interface ObjectiveSlotSection {
  /** The source's objectives. */
  items: ObjectiveSlotItem[];
  /**
   * Optional per-item alarm affordance a source may offer. Returns a
   * control for an item, or `null` for items that cannot be alarmed.
   */
  renderAlarm?: (item: ObjectiveSlotItem) => unknown;
}

/** Mirrors `ObjectiveSourceContext` (Objectives/index.tsx). `ComponentType` is
 * the same react type used throughout this leaf's other slot/component types. */
export interface ObjectiveSourceContext {
  Section: import("react").ComponentType<ObjectiveSlotSection>;
}

// --- ActionGroup (packages/components/src/ActionGroup) ---------------------

/** Mirrors `ActionGroupId` (`packages/core/src/actionGroups.ts`) — the eight
 * known stock names, widened to admit an arbitrary custom (AGX) id. */
export type ActionGroupSlotId =
  | "SAS"
  | "RCS"
  | "Light"
  | "Gear"
  | "Brake"
  | "Abort"
  | "Precision Control"
  | "Stage"
  | (string & {});

/** Mirrors `ActionGroupSlotContext` (ActionGroup/index.tsx). */
export interface ActionGroupSlotContext {
  /** The KSP action group this instance controls (e.g. "AG1", "SAS", "Gear"). */
  groupId: ActionGroupSlotId;
  /** The display label — custom override or the official group name. */
  label: string;
  /** The group's current Value (boolean or numeric readout); `undefined` if unknown. */
  value: unknown;
  /** Rendered state readout — "ON" / "OFF" / a numeric string / "—". */
  stateLabel: string;
}

// --- SystemView (packages/components/src/SystemView) -----------------------

/** Mirrors `SystemOverlayContext` (SystemView/index.tsx). */
export interface SystemOverlayContext {
  /** Name of the parent body the diagram is centred on. */
  parentName: string;
  /** Diagram pixel width (origin-centred SVG frame). */
  width: number;
  /** Diagram pixel height. */
  height: number;
  /** Metres → SVG-user-unit plot scale at the diagram's auto-fit zoom. */
  plotScale: number;
  /** The parent body sits at the SVG origin. */
  center: { x: number; y: number };
}

/** Mirrors `SystemBadgesContext` (SystemView/index.tsx). */
export interface SystemBadgesContext {
  frameName: string | null;
}

// "system-view.actions" carries no props today.

// --- GroundSurvey (packages/components/src/GroundSurvey) -------------------

/** Mirrors `GroundSurveyBadgesContext` (GroundSurvey/index.tsx). */
export interface GroundSurveyBadgesContext {
  /** Body currently being surveyed (`v.body`), when known. */
  body: string | null;
  /** Survey phase driving the strip. */
  surveyState: "idle" | "active" | "frozen" | "above-ceiling";
}

// --- MapView (packages/components/src/MapView) ------------------------------

/** Mirrors `MapOverlayContext` (MapView/index.tsx). */
export interface MapOverlayContext {
  /** Pixel width of the overlay layer (== the map canvas container). */
  width: number;
  /** Pixel height of the overlay layer. */
  height: number;
  /** Live pan/zoom camera driving the equirectangular projection. */
  camera: { zoom: number; panX: number; panY: number };
  /** Equirectangular world-canvas width the camera maps from. */
  worldW: number;
  /** Equirectangular world-canvas height the camera maps from. */
  worldH: number;
  /** The mapped body (may diverge from the active vessel under a pin). */
  bodyName: string | undefined;
  /** Mapped body physical radius, metres, when known. */
  bodyRadius: number | undefined;
  /**
   * Project geographic lat/lon (degrees) to a pixel coordinate in the
   * overlay layer's own space.
   */
  project: (lat: number, lon: number) => { x: number; y: number };
  /** The active vessel's RAW (unadjusted) lat/lon; undefined with no fix. */
  vesselLat: number | undefined;
  vesselLon: number | undefined;
}

/** Mirrors `MapBadgesContext` (MapView/index.tsx). */
export interface MapBadgesContext {
  bodyName: string | undefined;
}

/** Mirrors `MapSectionsContext` (MapView/index.tsx). */
export interface MapSectionsContext {
  /** The mapped body (may diverge from the active vessel under a pin). */
  bodyName: string | undefined;
  /** Per-namespace augment settings, keyed by augment id. Always `undefined`
   *  until the settings read-back loop lands (see the real widget's doc). */
  augmentSettings: Record<string, Record<string, unknown>> | undefined;
}

/** Mirrors `CoverageGate` (MapView/useCoverageGate.ts). */
export interface MapCoverageGate {
  /** Composite reveal intensity, one byte per cell, row-major. */
  data: Uint8Array | null;
  version: number;
  width: number;
  height: number;
  /** True when at least one reveal source is registered AND a
   *  `FogMaskCacheProvider` is mounted to actually resolve its masks. */
  hasAnySource: boolean;
}

/** Mirrors `MapBaseLayerContext` (MapView/index.tsx). Stackable — any number
 *  of registered augments may fill this slot at once. */
export interface MapBaseLayerContext {
  /** The mapped body (may diverge from the active vessel under a pin). */
  bodyId: string | undefined;
  width: number;
  height: number;
  /** Per-namespace augment settings — same shape/caveat as `MapSectionsContext`. */
  augmentSettings: Record<string, Record<string, unknown>> | undefined;
  /** The paint-gate (T4) for this body. */
  coverageGate: MapCoverageGate;
  /** Called by the augment whenever it has a fresh canvas to contribute (or
   *  `null` to withdraw one) — MUST pass the augment's OWN id first, since
   *  more than one augment may hold a canvas at once. */
  onLayer: (
    id: string,
    canvas: HTMLCanvasElement | null,
    version: number,
  ) => void;
}

/** Mirrors `MapActionsContext` (MapView/index.tsx). */
export interface MapActionsContext {
  /** Per-namespace augment settings — same shape as `MapSectionsContext`'s own field. */
  augmentSettings: Record<string, Record<string, unknown>> | undefined;
  /** Persists ONE augment's `show` setting into this widget instance's own config. */
  setAugmentShow: (augmentId: string, show: boolean) => void;
}

// --- TechTree (packages/components/src/TechTree) ---------------------------

/** Mirrors `TechNodeState` (TechTree/index.tsx). */
export type TechNodeSlotState = "Available" | "Researchable" | "Unavailable";

/** Mirrors `TechPart` (TechTree/index.tsx). */
export interface TechSlotPart {
  name: string;
  title: string;
  manufacturer: string;
  category: string;
  entryCost: number;
  purchased: boolean;
}

/** Mirrors `TechNode` (TechTree/index.tsx). */
export interface TechSlotNode {
  id: string;
  title: string;
  description: string;
  scienceCost: number;
  state: TechNodeSlotState;
  parents: string[];
  parts: TechSlotPart[];
}

/** Mirrors `TechNodeBadgeContext` (TechTree/index.tsx). */
export interface TechNodeBadgeContext {
  /** The node this badge belongs to — its full identity for the augment. */
  node: TechSlotNode;
}

// --- LandingStatus (packages/components/src/LandingStatus) -----------------

/** Mirrors `LandingStatusBadgesContext` (LandingStatus/index.tsx). */
export interface LandingStatusBadgesContext {
  /** Body being landed on (`vessel.state.parentBodyName`), when known. */
  bodyName: string | null;
  /** Whether that body has an atmosphere (drives the vacuum/atmospheric split). */
  atmospheric: boolean;
}

// --- OrbitView (packages/components/src/OrbitView) --------------------------

/** Mirrors `OrbitOverlayContext` (OrbitView/index.tsx). */
export interface OrbitOverlayContext {
  /** Semi-major axis, distance units (metres from body centre). */
  sma: number;
  /** Eccentricity. */
  ecc: number;
  /** Apoapsis radius from body centre, same units. */
  apoapsis: number;
  /** Periapsis radius from body centre, same units. */
  periapsis: number;
  /** Argument of periapsis, degrees (rotates the ellipse in-plane). */
  argPe: number;
  /** Current vessel true anomaly, degrees. */
  trueAnomaly: number;
  /** Parent body physical radius, same units, when known. */
  bodyRadius?: number;
  /** The body's position in the diagram's SVG frame (its origin). */
  center: { x: number; y: number };
  /** Visible half-extent of the frame, distance units (apoapsis-driven). */
  scale: number;
}

/** Mirrors `OrbitBadgesContext` (OrbitView/index.tsx). */
export interface OrbitBadgesContext {
  bodyName: string | undefined;
}

// --- Navball (packages/components/src/Navball) ------------------------------

// "navball.badges" carries no props today.

// --- ScienceOfficer (packages/components/src/ScienceOfficer) ---------------

/** Mirrors `Instrument` (ScienceOfficer/index.tsx). */
export interface ScienceOfficerInstrument {
  partId: string;
  partTitle: string;
  expId: string;
  deployed: boolean;
  hasData: boolean;
  rerunnable: boolean;
  inoperable: boolean;
}

/** Mirrors `ScienceOfficerInstrumentSlotContext` (ScienceOfficer/index.tsx). */
export interface ScienceOfficerInstrumentSlotContext {
  /** The instrument the augmented row is rendering. */
  instrument: ScienceOfficerInstrument;
}

/** Mirrors `ScienceOfficerSlotContext` (ScienceOfficer/index.tsx). */
export interface ScienceOfficerSlotContext {
  /** Parsed instrument list, or `null` before telemetry arrives. */
  instruments: ScienceOfficerInstrument[] | null;
  /** Total stored science data across all instruments, in mits. */
  dataAmount: number;
}

// --- DeployedScience (packages/components/src/DeployedScience) -------------

/** Mirrors `DeployedExperiment` (DeployedScience/index.tsx). */
export interface DeployedScienceExperiment {
  partId: number;
  id: string;
  name: string;
  total: number;
  limit: number;
  progress: number;
  stored: number;
  transmitted: number;
  collecting: boolean;
}

/** Mirrors `DeployedExperimentContext` (DeployedScience/index.tsx). */
export interface DeployedExperimentContext {
  /** The deployed experiment this card renders — the augment's datum. */
  experiment: DeployedScienceExperiment;
  /** The body the parent base sits on, for context. */
  body: string;
}

// "deployed-science.badges" carries no props today.

// --- ThermalStatus (packages/components/src/ThermalStatus) -----------------

// "thermal-status.badges" carries no props today.

// --- FuelStatus (packages/components/src/FuelStatus) -----------------------

// "fuel-status.sections" / ".badges" carry no props today.

// --- PowerSystems (packages/components/src/PowerSystems) -------------------

/** Mirrors `PowerSystemsSlotContext` (PowerSystems/index.tsx). */
export interface PowerSystemsSlotContext {
  /**
   * The resource the widget is currently focused on (the picker/action-cycle
   * selection). Lets an augment scope its breakdown/badge to the same
   * resource the operator is viewing rather than assuming ElectricCharge.
   */
  resource: string;
}

// ---------------------------------------------------------------------------
// The merge itself — every first-party (packages/components-owned) slot id,
// enumerated by grepping every `declare module "@ksp-gonogo/core"` /
// `"@ksp-gonogo/sitrep-sdk"` SlotRegistry block across packages/components
// (2026-07-19).
// ---------------------------------------------------------------------------

// Targets `./types` (relative), NOT the package specifier
// "@ksp-gonogo/sitrep-sdk" — both resolve to the exact same file (this
// package's own `SlotRegistry` is declared in `./types.ts`, and TS module
// augmentation merges by resolved FILE IDENTITY, not by specifier string),
// but the relative form sidesteps a real self-referencing-package
// resolution flake: augmenting your own package by ITS OWN NAME from
// inside itself resolves inconsistently depending on which files happen to
// be program ROOTS (verified: succeeds under this package's own
// `tsconfig.json` full-`src` compile, fails under `tsconfig.test-d.json`'s
// narrower root set with "module cannot be found", even though `slots.ts`
// is transitively reachable in both). The relative specifier has no such
// ambiguity.
declare module "./types" {
  interface SlotRegistry {
    "space-center-status.sections": Record<string, never>;
    "space-center-status.badges": Record<string, never>;

    "maneuver-planner.sections": Record<string, never>;
    "maneuver-planner.badges": Record<string, never>;

    "target-picker.sections": Record<string, never>;
    "target-picker.badges": Record<string, never>;

    "warp-control.actions": Record<string, never>;
    "warp-control.badges": Record<string, never>;

    "staff-roster.badges": StaffBadgeContext;

    "distance-to-target.camera": DistanceToTargetHudContext;
    "distance-to-target.overlay": DistanceToTargetHudContext;
    "distance-to-target.badges": DistanceToTargetBadgeContext;

    "comm-signal.sections": Record<string, never>;
    "comm-signal.badges": Record<string, never>;

    "ship-map.overlay": ShipMapOverlayContext;
    "ship-map.badges": ShipMapBadgesContext;

    "contract-manager.badges": ContractBadgeContext;

    "crew-manifest.badges": CrewBadgeContext;

    "launch-director.badges": LaunchDirectorSlotContext;
    "launch-director.sections": LaunchDirectorSlotContext;

    "objectives.sections": ObjectiveSourceContext;

    "action-group.badges": ActionGroupSlotContext;
    "action-group.sections": ActionGroupSlotContext;

    "system-view.actions": Record<string, never>;
    "system-view.overlay": SystemOverlayContext;
    "system-view.badges": SystemBadgesContext;

    "ground-survey.badges": GroundSurveyBadgesContext;

    "map-view.overlay": MapOverlayContext;
    "map-view.badges": MapBadgesContext;
    "map-view.sections": MapSectionsContext;
    "map-view.base": MapBaseLayerContext;
    "map-view.actions": MapActionsContext;

    "tech-tree.badges": TechNodeBadgeContext;

    "landing-status.badges": LandingStatusBadgesContext;

    "orbit-view.overlay": OrbitOverlayContext;
    "orbit-view.badges": OrbitBadgesContext;

    "navball.badges": Record<string, never>;

    "science-officer.sections": ScienceOfficerInstrumentSlotContext;
    "science-officer.badges": ScienceOfficerSlotContext;

    "deployed-science.sections": DeployedExperimentContext;
    "deployed-science.badges": Record<string, never>;

    "thermal-status.badges": Record<string, never>;

    "fuel-status.sections": Record<string, never>;
    "fuel-status.badges": Record<string, never>;

    "power-systems.sections": PowerSystemsSlotContext;
    "power-systems.badges": PowerSystemsSlotContext;
  }
}
