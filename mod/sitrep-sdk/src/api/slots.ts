// ---------------------------------------------------------------------------
// Slot-registry mirror: the `SlotRegistry` declaration-merge for every
// first-party (packages/components-owned) augment slot, carried by the sdk
// leaf itself.
//
// Why this lives HERE and not beside the widgets that own the slots: an earlier
// revision had each slot-owning
// widget carry a SECOND `declare module "@ksp-gonogo/sitrep-sdk"` block
// alongside its existing `declare module "@ksp-gonogo/core"` one (see e.g.
// MapView/index.tsx). That doesn't work: TypeScript only applies ambient
// module augmentation from files that are actually part of the compiled
// PROGRAM, and a facade-sealed client (which must not import
// `@ksp-gonogo/components`) never pulls those files in: so
// `SlotProps<"map-view.overlay">` etc. resolve to `never` for a sealed
// client, exactly the failure mode this seam exists to prevent.
//
// The fix is NOT `import type` from `@ksp-gonogo/components`, same leaf
// constraint documented at length in `./types.ts`'s header: sitrep-sdk is
// the dependency-graph LEAF (core, components, data, and sitrep-client all
// depend on the sdk already), so naming `@ksp-gonogo/components` here, even
// as a type-only import, would form a turbo `^build` cycle. Every slot
// context type below is therefore MIRRORED (duplicated), same as every
// other author-facing type in `./types.ts`: self-contained, kept honest by
// eyeball + the widget's own doc comments, not a live import.
//
// `index.ts` imports this module for its ambient side effect only (no named
// exports added to the barrel) so every consumer of the facade, sealed or
// not: gets the full merge automatically, without a per-file side-effect
// import.
//
// Scope: every slot OWNED by a `packages/components` widget. Slots owned by
// an UPLINK's own client package (SCANsat's `Scanning`, "scanning.sections"
// /".badges"; kerbcast's `CameraFeed`: "camera-feed.overlay"/".badges") are
// deliberately NOT mirrored here: mirroring them would require the sdk to
// import type shapes from an Uplink client package, which, since every
// Uplink client already depends on the sdk, would be the exact same cycle.
// Those slots stay owned/declared entirely inside the Uplink's own file
// (once sealed, its `declare module "@ksp-gonogo/sitrep-sdk"` block lives
// right there, which works fine: the owning file is always part of its OWN
// package's compiled program, so no cross-package reachability problem
// exists for a slot's OWNER, only for a FOREIGN filler, which is exactly
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

// "warp-control.stepper" carries no props today.

// --- Targeting (packages/components/src/Targeting) -----------

/**
 * Props passed to every `targeting.overlay` and `targeting.camera` augment.
 *
 * Both slots are drawn only in the docking HUD view, which the Targeting widget
 * switches to while docking alignment is reported and the target is close. The
 * overlay sits over the reticle box and the camera slot behind it, as the video
 * backdrop. Positions are measured in pixels from the centre of the HUD's
 * frame.
 *
 * @category Widget slots
 */
export interface TargetingHudContext {
  /** Alignment angle in degrees that reaches the edge of the reticle box. The reticle stops at the edge past it. Currently 8. */
  maxDeg: number;
  /**
   * The reticle's offset from the box centre, each axis from -1 to 1: the
   * alignment angle limited to `maxDeg` and divided by it. Positive `x` is
   * right and positive `y` is down, so a nose-up error reads as negative `y`.
   */
  reticleOffset: { x: number; y: number };
  /**
   * Pixels the reticle travels per unit of `reticleOffset`, the same on both
   * axes and measured from the centre of the HUD's frame. An overlay places a
   * marker at `calc(50% + offset.x·reticleTravelPx px)` across and
   * `calc(50% + offset.y·reticleTravelPx px)` down to sit in the same space,
   * so a degree is as far across as it is down.
   */
  reticleTravelPx: number;
  /**
   * For the `targeting.camera` slot: report the aspect (width over height) of
   * the picture the augment paints with `object-fit: cover`, or `null` once it
   * paints none. The reticle's degree scale then follows the camera's visible
   * field rather than the frame. An overlay has no picture and never calls it.
   */
  reportPictureAspect: (aspect: number | null) => void;
  /** True while the two ports are within docking-alignment tolerance. */
  aligned: boolean;
  /** Horizontal docking alignment angle in degrees, before any limit is applied. `undefined` while the angle is not reported. */
  ax: number | undefined;
  /** Vertical docking alignment angle in degrees, before any limit is applied. Positive is nose up. `undefined` while the angle is not reported. */
  ay: number | undefined;
  /** Distance to the target port in metres. `undefined` until the position is reported. */
  distance: number | undefined;
  /**
   * The camera the operator chose for the video backdrop in the widget's
   * settings, as a part flight id. `null` or `undefined` when none is chosen,
   * so the augment picks its own. The widget passes it through unread.
   */
  cameraFlightId: number | null | undefined;
}

// --- CommSignal (packages/components/src/CommSignal) -----------------------

// "comm-signal.sections" / ".badges" carry no props today.

// --- ShipMap (packages/components/src/ShipMap) -----------------------------

/**
 * The deploy or activation state of one part module, as the ship map carries it
 * on {@link ShipMapPart.partState}.
 *
 * @category Widget slots
 */
export interface ShipMapPartStateModule {
  /** Which kind of module this is. */
  type:
    | "solarPanel"
    | "radiator"
    | "antenna"
    | "parachute"
    | "engine"
    | "drill"
    | "cargoBay"
    | "landingGear";
  /**
   * The module's state. Parts that deploy report `"extended"`, `"retracted"`,
   * `"deploying"` or `"retracting"`. Parachutes report `"stowed"`, `"armed"`,
   * `"extended"` or `"broken"`. Engines and drills report `"active"` or
   * `"inactive"`. `"unknown"` when KSP's own state does not map to one of these.
   */
  state: string;
  /** Solar panels only: true while the panel is turning to follow the sun. */
  tracking?: boolean;
  /** Engines only: present and true while the engine has flamed out. */
  flameout?: boolean;
}

/**
 * The shape the ship map draws a part as. Every part that is none of the named
 * kinds is `"other"`.
 *
 * @category Widget slots
 */
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

/**
 * One part of the active vessel as the ship map lays it out: the vessel's
 * structure plus whatever live readings have arrived for the part.
 *
 * The diagram is a side view. `lat` runs across the screen and `axial` runs up
 * it along the vessel's long axis, both in metres from the vessel's own origin.
 * The optional fields are live readings and are absent until they arrive.
 *
 * @category Widget slots
 */
export interface ShipMapPart {
  /** KSP's flight id for the part, unique within the vessel. */
  flightId: number;
  /** The flight id of the part this one is attached to. `null` for the root part. */
  parentFlightId: number | null;
  /** KSP's internal part name, such as `"liquidEngine"`. */
  name: string;
  /** The part's display title, such as `"LV-T45 \"Swivel\" Liquid Fuel Engine"`. */
  title: string;
  /** The shape the diagram draws this part as. */
  type: ShipMapPartType;
  /** Position across the diagram, in metres. */
  lat: number;
  /** Position along the vessel's long axis, in metres. Positive is up the screen. */
  axial: number;
  /** Position on the axis the side view flattens, in metres. Not drawn; parts are painted back to front by it. */
  depth: number;
  /** The part's rotation on screen, in radians counter-clockwise. 0 when KSP reports no orientation. */
  rotationRad: number;
  /** The part's bounding box size in metres, on the part's own three axes. */
  size: { x: number; y: number; z: number };
  /** Half the part's extent across the diagram, in metres. */
  latHalfExtent: number;
  /** Half the part's extent along the long axis, in metres. */
  axialHalfExtent: number;
  /** The part's dry mass in tonnes, without resources. */
  dryMass: number;
  /** The stage the part activates in, as KSP numbers stages (`Part.inverseStage`). */
  stage: number;
  /** The part's maximum internal temperature in kelvin, from its configuration. */
  maxTemp: number;
  /** Current internal temperature in kelvin. Absent until thermal readings arrive. */
  temperatureK?: number;
  /** Current maximum internal temperature in kelvin. Absent until thermal readings arrive. */
  maxTemperatureK?: number;
  /** Resources the part holds, one entry each: the resource name, then the amount held, then the capacity, in the resource's own units. */
  resources?: { n: string; a: number; c: number }[];
  /** Whether the part produces or consumes electric charge. `null` when it has no electric charge flow. */
  ecFlowSign?: "producer" | "consumer" | null;
  /** For a fuel line, the flight id of the part it feeds. */
  fuelLineTarget?: number | null;
  /**
   * The state of each module that deploys or activates. Empty when the part has
   * none. Absent before part states arrive, which means unknown rather than all
   * retracted.
   */
  partState?: ShipMapPartStateModule[];
}

/**
 * The area the vessel covers in the ship map's metre space, which the diagram
 * fits to its canvas.
 *
 * @category Widget slots
 */
export interface ShipMapBounds {
  /** Centre across the diagram, in metres, on the same axis as {@link ShipMapPart.lat}. */
  cx: number;
  /** Centre along the long axis, in metres, on the same axis as {@link ShipMapPart.axial}. */
  cy: number;
  /** Width across the diagram, in metres. */
  w: number;
  /** Height along the long axis, in metres. */
  h: number;
}

/**
 * Props passed to every `ship-map.overlay` augment: a layer over the ship
 * map's part diagram, with the parts and the projection the diagram fits them
 * with.
 *
 * Project a part at metre position `(lat, axial)` to overlay pixels with
 * `x = width / 2 + (lat - bounds.cx) * baseScale` and
 * `y = height / 2 - (axial - bounds.cy) * baseScale`. This is the diagram before
 * the operator zooms or pans it; the overlay does not follow the live zoom or
 * pan. The slot is not drawn until the vessel has parts.
 *
 * @category Widget slots
 */
export interface ShipMapOverlayContext {
  /** Every part of the active vessel, laid out in metres. */
  parts: readonly ShipMapPart[];
  /** Overlay width in pixels, the same as the diagram canvas. */
  width: number;
  /** Overlay height in pixels, the same as the diagram canvas. */
  height: number;
  /** The area the vessel covers, in metres. */
  bounds: ShipMapBounds;
  /** Pixels per metre at which the whole vessel fits the canvas. */
  baseScale: number;
  /** Margin in pixels the diagram leaves around the fitted vessel. */
  padding: number;
}

// --- CrewStatus (packages/components/src/CrewStatus) -------------------

/**
 * Props passed to every `crew-status.row-badges` augment, once for each kerbal
 * aboard the active vessel. The augment draws inline badges at the end of that
 * kerbal's row.
 *
 * @category Widget slots
 */
export interface CrewBadgeContext {
  /** The kerbal's name, as KSP's crew roster writes it. */
  crewName: string;
  /** The kerbal's position in the vessel's crew list, from 0. Tells two kerbals with the same name apart. */
  crewIndex: number;
}

/**
 * Props passed to every `crew-status.avatar` augment, once for each kerbal
 * aboard the active vessel. The augment fills a square cell at the start of
 * that kerbal's row. The cell is reserved only while an augment is bound, and
 * stays blank when the augment draws nothing.
 *
 * @category Widget slots
 */
export interface CrewAvatarContext {
  /** The kerbal's name, as KSP's crew roster writes it. */
  crewName: string;
  /** The kerbal's position in the vessel's crew list, from 0. Tells two kerbals with the same name apart. */
  crewIndex: number;
}

// --- AstronautComplex (packages/components/src/AstronautComplex) -----------

/**
 * Props passed to every `astronaut-complex.crew` and
 * `astronaut-complex.crew-badge` augment, once for each kerbal card in the
 * Astronaut Complex's Applicants and Active lists.
 *
 * `astronaut-complex.crew` draws under the kerbal's name, for detail your
 * Uplink holds about that kerbal, such as a date. `astronaut-complex.crew-badge`
 * draws in the card's top-right corner, for a short mark read with the name,
 * such as a state of your own that KSP's roster does not know.
 *
 * @category Widget slots
 */
export interface AstronautComplexCrewContext {
  /** The kerbal's name, as KSP's crew roster writes it. Join your own crew data on it. */
  kerbalName: string;
  /** The kerbal's standing, a `CrewStanding` value. `CrewStanding.Applicant` for an applicant. `null` when the roster did not report one. */
  standing: number | null;
  /** True for a candidate in the Applicants list, false for a kerbal already on the roster. */
  isApplicant: boolean;
}

// --- LaunchDirector (packages/components/src/LaunchDirector) ---------------

/**
 * Props passed to every `launch-director.preflight` augment: the launch the
 * operator is setting up in the Launch Director. The slot draws once, below
 * the list of pads.
 *
 * @category Widget slots
 */
export interface LaunchDirectorSlotContext {
  /** The current KSP scene, such as `"Flight"` or `"SpaceCenter"`. `undefined` until the scene is reported. */
  scene: string | undefined;
  /** True while the scene is `"Flight"`. */
  inFlight: boolean;
  /** The name of the saved craft the operator has picked. `null` when none is picked. */
  selectedShip: string | null;
  /** The internal name of the launch site the operator has open, such as `"LaunchPad"`. An empty string when no sites are reported. */
  selectedSite: string;
  /** The names of the kerbals the operator has picked to fly. */
  selectedCrew: string[];
  /** The career's funds. `undefined` when the save has no funds or they are not yet reported. */
  funds: number | undefined;
}

/**
 * Props passed to every `launch-director.pad` augment, once for each launch
 * site in the Launch Director's pad list. Use it to say something about one
 * pad from its own row, such as that a launch complex your Uplink tracks is
 * busy.
 *
 * @category Widget slots
 */
export interface LaunchDirectorPadContext {
  /** KSP's internal name for the site, such as `"LaunchPad"`. Stable; join your own pad data on it. */
  siteName: string;
  /** The site's display name, as the row shows it. */
  displayName: string;
  /** The editor that builds for this site: `"VAB"` for a launch pad, `"SPH"` for a runway. */
  editorFacility: string;
  /** Whether a vessel is standing on the site. `null` when the site does not report it. */
  occupied: boolean | null;
  /** The name of the vessel standing on the site. `null` when none is reported. */
  occupantName: string | null;
  /** True for the site the operator has open, so an augment can draw more for it. */
  expanded: boolean;
  /** The career's funds. `undefined` when the save has no funds or they are not yet reported. */
  funds: number | undefined;
}

// --- Objectives (packages/components/src/Objectives) -----------------------

/**
 * Where an objective stands. The Objectives widget draws each with its own
 * mark: `"pending"` is not yet met, `"active"` is under way, `"reached"` is met
 * and `"failed"` can no longer be met.
 *
 * @category Widget slots
 */
export type ObjectiveSlotState = "pending" | "active" | "reached" | "failed";

/**
 * One objective, as an `objectives.source` augment passes it to the
 * Objectives widget's `Section`.
 *
 * @category Widget slots
 */
export interface ObjectiveSlotItem {
  /** Unique across every source; the row's key. */
  id: string;
  /** What the objective asks for, drawn as the row's title. */
  title: string;
  /** Further detail, drawn under the title when present. */
  description?: string;
  /** Where the objective stands. */
  state: ObjectiveSlotState;
  /** The mission or contract the objective belongs to, drawn beside the title. */
  source: string;
  /** True for an objective that is not required. The widget marks it "(optional)". */
  optional?: boolean;
  /** The id of the contract this objective is part of, when it is one. The widget draws nothing from it; your own `renderAlarm` can read it. */
  contractId?: string;
}

/**
 * The props of the `Section` an `objectives.source` augment renders: one
 * source's objectives. The widget draws nothing for a section with no items.
 *
 * @category Widget slots
 */
export interface ObjectiveSlotSection {
  /** The source's objectives, in the order they are drawn. */
  items: ObjectiveSlotItem[];
  /** Draws a control at the end of an item's row, such as a button that sets an alarm for it. Return `null` for an item that has none. */
  renderAlarm?: (item: ObjectiveSlotItem) => import("react").ReactNode;
}

/**
 * Props passed to every `objectives.source` augment. The Objectives widget has
 * no objectives of its own: every source, the built-in contract parameters
 * included, is an augment that renders `<Section items={...} />` with its
 * objectives, and the widget draws them all the same way.
 *
 * @category Widget slots
 */
export interface ObjectiveSourceContext {
  /** The component to render your objectives through. */
  Section: import("react").ComponentType<ObjectiveSlotSection>;
}

// --- Strategies (packages/components/src/Strategies) -----------------------

/**
 * Props passed to every `strategies.screen-body` augment: the body of one
 * Administration Building screen, drawn below the strategy cards the screen
 * lists. Screens come from the `strategies.screens` contribution slot, and the
 * slot is drawn only on a screen that is open for use.
 *
 * @category Widget slots
 */
export interface StrategiesScreenBodyContext {
  /** The `id` of the screen being drawn, as its `strategies.screens` entry gave it. An augment bound to more than one screen branches on it. */
  screenId: string;
}

// --- ActionGroup (packages/components/src/ActionGroup) ---------------------

/**
 * The name of an action group: one of the eight stock names, or any other
 * string for a custom group.
 *
 * @category Widget slots
 */
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

/**
 * Props passed to every `action-group.subsystem` augment: the one action group
 * an Action Group widget controls, and its current state. The slot draws below
 * the group's toggle.
 *
 * @category Widget slots
 */
export interface ActionGroupSlotContext {
  /**
   * The group's name: one of the stock names such as `"SAS"` or `"Gear"`, or
   * for a custom group the name the mod reports for it, `"AG1"` to `"AG10"`
   * when it reports none. Two custom groups can share a name.
   */
  groupId: ActionGroupSlotId;
  /** The label the widget shows: the operator's own label when set, otherwise the group's name. */
  label: string;
  /**
   * The group's state: `true` or `false` for a group that toggles, a number for
   * a group that reports one, such as Stage. `null` when the state is reported
   * but cannot be read, `undefined` before it arrives.
   */
  value: unknown;
  /** The state as the widget writes it: `"ON"`, `"OFF"`, the number as text, or the null placeholder while `value` is `null` or `undefined`. */
  stateLabel: string;
}

// --- SystemView (packages/components/src/SystemView) -----------------------

/**
 * Props passed to every `system-view.overlay` augment: a layer over the System
 * View diagram, with the scale the diagram draws at.
 *
 * Draw in a `width` by `height` origin-centred viewBox: `d` metres from the
 * body the diagram is centred on is `d * plotScale` SVG units from `center`.
 * Both follow the diagram's pan and zoom, so an overlay drawn this way moves
 * with it. The layer passes pointer events through to the diagram, so an
 * element that needs clicks turns them back on itself.
 *
 * @category Widget slots
 */
export interface SystemOverlayContext {
  /** The name of the body the diagram is centred on. */
  parentName: string;
  /** Diagram width in pixels. The SVG runs from `-width / 2` to `width / 2`. */
  width: number;
  /** Diagram height in pixels. The SVG runs from `-height / 2` to `height / 2`. */
  height: number;
  /** SVG units per metre, at the diagram's current zoom. */
  plotScale: number;
  /** Where the centre body is drawn, in SVG units, after the diagram's pan: the origin until it is panned. */
  center: { x: number; y: number };
}

// "system-view.actions" carries no props today.

// --- MapView (packages/components/src/MapView) ------------------------------

/**
 * Props passed to every `map-view.overlay` augment: a layer over the Map View's
 * canvases, with the projection the map draws with.
 *
 * The map is an equirectangular world image, `worldW` by `worldH` pixels, seen
 * through a camera the operator can pan and zoom. The project function applies
 * the whole chain; the camera and world size are there for an augment building
 * its own transform. A world point `(wx, wy)` lands at
 * `x = (wx - camera.panX) * camera.zoom + width / 2` and
 * `y = (wy - camera.panY) * camera.zoom + height / 2`.
 *
 * @category Widget slots
 */
export interface MapOverlayContext {
  /** Overlay width in pixels, the same as the map area. */
  width: number;
  /** Overlay height in pixels, the same as the map area. */
  height: number;
  /** The live camera: `zoom` is screen pixels per world pixel, and `panX` and `panY` are the world point at the centre of the map area. */
  camera: { zoom: number; panX: number; panY: number };
  /** Width of the world image in world pixels, spanning 360 degrees of longitude. */
  worldW: number;
  /** Height of the world image in world pixels, spanning 180 degrees of latitude. */
  worldH: number;
  /** The body the map shows. It can differ from the active vessel's body when the operator picks another. `undefined` while none is known. */
  bodyName: string | undefined;
  /** The mapped body's radius in metres. `undefined` while it is not known. */
  bodyRadius: number | undefined;
  /** Returns the overlay pixel for a latitude and longitude in degrees, through the same projection the map is drawn with. */
  project: (lat: number, lon: number) => { x: number; y: number };
  /** The active vessel's latitude in degrees. `undefined` without a position, or when the map shows another body. */
  vesselLat: number | undefined;
  /** The active vessel's longitude in degrees. `undefined` without a position, or when the map shows another body. */
  vesselLon: number | undefined;
}

/** Mirrors `MapViewScope` (MapView/index.tsx): what the widget is currently
 *  looking at, read with `useWidgetScope("map-view")`. */
export interface MapViewScope {
  /** The mapped body (may diverge from the active vessel under a pin). */
  bodyName: string | undefined;
}

/**
 * How much of the mapped body's surface is revealed, combined from every
 * registered coverage source, such as scanner coverage. A `map-view.base`
 * augment reads it to paint only what has been revealed.
 *
 * @category Widget slots
 */
export interface MapCoverageGate {
  /** One byte per cell, row by row, `width` by `height`: 0 is hidden and 255 fully revealed. `null` until coverage has been read. */
  data: Uint8Array | null;
  /** Goes up by one each time `data` changes. */
  version: number;
  /** Cells across `data`, spanning 360 degrees of longitude. */
  width: number;
  /** Cells down `data`, spanning 180 degrees of latitude. */
  height: number;
  /** True when a coverage source is registered and its coverage can be read. False means paint everything, not nothing. */
  hasAnySource: boolean;
}

/**
 * Props passed to every `map-view.base` augment: the base surface of the Map
 * View, under every other layer.
 *
 * Any number of augments can fill this slot at once. Each hands back a canvas
 * through `onLayer`, and the map stretches it over the whole world image, so
 * the canvas is an equirectangular picture of the whole body. Canvases are
 * drawn in order over the stock texture, and transparent pixels show what is
 * beneath. An augment that declares `suppressesVanillaBase` removes the stock
 * texture.
 *
 * @category Widget slots
 */
export interface MapBaseLayerContext {
  /** The body the map shows. It can differ from the active vessel's body when the operator picks another. `undefined` while none is known. */
  bodyId: string | undefined;
  /** Width of the map area in pixels. */
  width: number;
  /** Height of the map area in pixels. */
  height: number;
  /** Each augment's settings on this widget, keyed by augment id. Read your own with `augmentSettings[yourId]`; its `show` is `false` when the operator hid your layer. */
  augmentSettings: Record<string, Record<string, unknown>> | undefined;
  /** How much of the body is revealed. */
  coverageGate: MapCoverageGate;
  /**
   * Hands the map a new canvas, or `null` to withdraw yours. Pass your
   * augment's own id first, since several augments can each hold a canvas.
   * Call it again with a higher `version` whenever the canvas changes.
   */
  onLayer: (
    id: string,
    canvas: HTMLCanvasElement | null,
    version: number,
  ) => void;
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

// --- ScienceData (packages/components/src/ScienceData) ----------------------

/**
 * Props passed to every `science-data.aboard-row` augment, once for each
 * science subject on the Science Data widget's Aboard tab. The augment draws
 * under that subject's row, and reads its own data for it. A subject can have a
 * data file and a sample aboard at once.
 *
 * @category Widget slots
 */
export interface ScienceDataAboardRowContext {
  /** KSP's science subject id, such as `"crewReport@KerbinSrfLandedLaunchPad"`. Join your own science data on it. */
  subjectId: string;
}

// --- LandingStatus (packages/components/src/LandingStatus) ------------------
//
// `landing-status.envelope` is GONE, and it is worth saying why rather than
// leaving a hole. It was an overlay slot handing a guest a projection function,
// a coordinate space and the host's own descent integrator, and the host drew
// its curve, its wash and its marks through geometry that slot could not reach.
// The descent envelope is a whole contributed PLOT now, on the app-wide `plots`
// slot (see `./plots.ts`), and this widget's own is one of them: it arranges
// what it is handed and owns no projection a contributor cannot reach. What the
// guest lost was pixels; what it gained is that there is no host privilege left
// to out-draw it with.

// --- OrbitView (packages/components/src/OrbitView) --------------------------

/**
 * Props passed to every `orbit-view.overlay` augment: a layer over the Orbit
 * View diagram, with the active vessel's orbit.
 *
 * The diagram is centred on the body the vessel orbits. Distances are metres
 * from the body's centre. Before rotating by `argPe`, positive x runs along the
 * line of apsides towards periapsis and positive y is up. The slot is drawn only
 * while there is an orbit.
 *
 * @category Widget slots
 */
export interface OrbitOverlayContext {
  /** Semi-major axis in metres. */
  sma: number;
  /** Eccentricity. 1 or more on an escape trajectory. */
  ecc: number;
  /** Apoapsis distance from the body's centre, in metres. `undefined` on an escape trajectory, which has none. */
  apoapsis?: number;
  /** Periapsis distance from the body's centre, in metres. */
  periapsis: number;
  /** Argument of periapsis in degrees, which turns the orbit in its plane. 0 when not reported. */
  argPe: number;
  /** The vessel's true anomaly in degrees. 0 when not reported. */
  trueAnomaly: number;
  /** The body's radius in metres. Absent while it is not known. */
  bodyRadius?: number;
  /** Where the body is drawn. Always the origin. */
  center: { x: number; y: number };
  /** The distance from the centre to the edge of the visible diagram, in metres: the apoapsis, or a multiple of the periapsis on an escape trajectory. */
  scale: number;
}

// --- Navball (packages/components/src/Navball) ------------------------------

// "navball.badges" carries no props today.

// --- Experiments (packages/components/src/Experiments) ---------------

/**
 * One stock science instrument aboard the active vessel, as the Experiments
 * widget draws its row.
 *
 * @category Widget slots
 */
export interface ExperimentsInstrument {
  /** The part's flight id as a string. The Deploy and Transmit commands take it. */
  partId: string;
  /** The part's display title, such as `"2HOT Thermometer"`. */
  partTitle: string;
  /** KSP's experiment id, such as `"temperatureScan"`. The widget groups rows by it. */
  expId: string;
  /** True once the experiment has been run. */
  deployed: boolean;
  /** True while the instrument holds data that can be collected. */
  hasData: boolean;
  /** True when the experiment can be run again without being reset. */
  rerunnable: boolean;
  /** True when the instrument cannot run again until it is reset. */
  inoperable: boolean;
}

/**
 * Props passed to every `experiments.instrument` augment, once for each stock
 * instrument row in the Experiments widget. The augment draws directly after
 * the row inside a list, so render a list item. Instruments that come from the
 * `experiments.instruments` contribution slot get no augment.
 *
 * @category Widget slots
 */
export interface ExperimentsInstrumentSlotContext {
  /** The instrument whose row this follows. */
  instrument: ExperimentsInstrument;
}

// --- DeployedScience (mod/GonogoBreakingGroundUplink/client/src/DeployedScience) ---

/**
 * One Breaking Ground deployed experiment, as the Deployed Science widget draws
 * its card.
 *
 * Each science figure is `null` when the mod does not report it, rather than
 * 0, because 0 is a real reading: a newly placed experiment reports 0%. Branch
 * on the `null` rather than drawing it.
 *
 * @category Widget slots
 */
export interface DeployedScienceExperiment {
  /** The experiment's position in its base's list. Only for use as a key. */
  partId: number;
  /** KSP's experiment id, or a made-up id unique within the base when the mod reports none. */
  id: string;
  /** The part's name, or the experiment id when there is none. */
  name: string;
  /** The science the experiment is worth in total. `null` when not reported. */
  total: number | null;
  /** The most science the experiment can collect. `null` when not reported. */
  limit: number | null;
  /** How far collection has got, from 0 to 1. `null` when not reported. */
  progress: number | null;
  /** Science collected but not yet transmitted. `null` when either figure it comes from is not reported. */
  stored: number | null;
  /** Science already transmitted. `null` when either figure it comes from is not reported. */
  transmitted: number | null;
  /** True while collection is under 100%. `null` when progress is not reported. */
  collecting: boolean | null;
}

/**
 * Props passed to every `deployed-science.experiment` augment, once for each
 * experiment card in the Deployed Science widget.
 *
 * @category Widget slots
 */
export interface DeployedExperimentContext {
  /** The experiment this card shows. */
  experiment: DeployedScienceExperiment;
  /** The name of the body the experiment's base stands on. An empty string when not reported. */
  body: string;
}

// "deployed-science.badges" carries no props today.

// --- FuelStatus (packages/components/src/FuelStatus) -----------------------

// "fuel-status.sections" / ".badges" carry no props today.

// --- PowerSystems (packages/components/src/PowerSystems) -------------------

/** Mirrors `PowerSystemsScope` (PowerSystems/index.tsx): what the widget is
 *  currently looking at, read with `useWidgetScope("power-systems")`. */
export interface PowerSystemsScope {
  /**
   * The resource the widget is currently focused on (the picker/action-cycle
   * selection). Lets an augment scope its breakdown/badge to the same
   * resource the operator is viewing rather than assuming ElectricCharge.
   */
  resource: string;
}

// --- FleetRoster (packages/components/src/FleetRoster) ---------------------

/**
 * Props passed to every `fleet-roster.updates` augment, once for each craft in
 * the Fleet Roster. The augment draws a line under the craft's name, for
 * something such as a health or alarm note, and the line takes no room when it
 * draws nothing.
 *
 * @category Widget slots
 */
export interface FleetRosterUpdatesContext {
  /** The craft's vessel id, as `system.vessels` carries it. */
  vesselId: string;
  /** The craft's name. */
  vesselName: string;
  /** The name of the body the craft is at. An empty string when not known. */
  body: string;
  /** True when the roster is too narrow for a detail line, so the augment should draw a badge and nothing more. */
  compact: boolean;
}

// ---------------------------------------------------------------------------
// The merge itself: every first-party (packages/components-owned) slot id,
// enumerated by grepping every `declare module "@ksp-gonogo/core"` /
// `"@ksp-gonogo/sitrep-sdk"` SlotRegistry block across packages/components.
// ---------------------------------------------------------------------------

// Targets `./types` (relative), NOT the package specifier
// "@ksp-gonogo/sitrep-sdk": both resolve to the exact same file (this
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

    "maneuver-planner.sections": Record<string, never>;

    "target-picker.sections": Record<string, never>;

    "warp-control.stepper": Record<string, never>;

    "targeting.camera": TargetingHudContext;
    "targeting.overlay": TargetingHudContext;

    "comm-signal.sections": Record<string, never>;

    "ship-map.overlay": ShipMapOverlayContext;

    /**
     * Inline badges at the end of each crew row, keyed by `crewName`. Distinct
     * from the widget's `crew-status.badges` header segment.
     */
    "crew-status.row-badges": CrewBadgeContext;
    /**
     * A leading avatar cell on each crew row. The cell is reserved only while
     * an augment is bound, and stays blank for a kerbal the augment has nothing
     * for.
     */
    "crew-status.avatar": CrewAvatarContext;
    /**
     * One whole-widget section above the roster, for crew-wide status. Passes no
     * props.
     */
    "crew-status.summary": Record<string, never>;

    "astronaut-complex.crew": AstronautComplexCrewContext;
    "astronaut-complex.crew-badge": AstronautComplexCrewContext;
    // A whole tab, which passes nothing.
    "astronaut-complex.training": Record<string, never>;

    "launch-director.preflight": LaunchDirectorSlotContext;
    "launch-director.pad": LaunchDirectorPadContext;

    "objectives.source": ObjectiveSourceContext;

    "action-group.subsystem": ActionGroupSlotContext;

    "system-view.actions": Record<string, never>;
    "system-view.overlay": SystemOverlayContext;

    "map-view.overlay": MapOverlayContext;
    "map-view.base": MapBaseLayerContext;
    // Mounted by `Panel`'s universal segments, not by the widget. Declared so a
    // binder types against the propless contract, not the loose fallback.
    "map-view.sections": Record<string, never>;
    "map-view.actions": Record<string, never>;

    // Same universal segment, and the reason it is worth naming a second one:
    // the tech tree looked like a widget that needed a slot ADDED to it (it
    // declares no `augmentSlots` of its own), which is a first-party edit an
    // Uplink author cannot make. It does not, because `Panel` mounts
    // `${componentId}.sections` for every widget. Declared here so a binder
    // gets the propless contract rather than the loose fallback.
    "tech-tree.sections": Record<string, never>;

    "science-data.aboard-row": ScienceDataAboardRowContext;

    "orbit-view.overlay": OrbitOverlayContext;

    // Mounted by `Panel`'s universal segments, not by the widget.
    "landing-status.sections": Record<string, never>;
    "landing-status.actions": Record<string, never>;

    "experiments.instrument": ExperimentsInstrumentSlotContext;
    // Mounted by `Panel`'s universal `actions` segment, not by the widget.
    "experiments.actions": Record<string, never>;

    "deployed-science.experiment": DeployedExperimentContext;

    "fuel-status.sections": Record<string, never>;

    // Mounted by `Panel`'s universal `sections` segment; the resource in focus reaches an augment through `WidgetScopeRegistry` below instead.
    "power-systems.sections": Record<string, never>;

    "fleet-roster.updates": FleetRosterUpdatesContext;

    "strategies.screen-body": StrategiesScreenBodyContext;
  }

  // What each widget publishes about its own current focus, for an augment to
  // read with `useWidgetScope`. Mirrored here for the same reachability reason
  // the slot props above are: a widget in `packages/components` declaring its
  // scope is invisible to a sealed client that cannot see that package.
  interface WidgetScopeRegistry {
    "map-view": MapViewScope;
    "power-systems": PowerSystemsScope;
  }
}
