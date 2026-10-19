/**
 * Vessel-topology and per-part state shapes. Originally part of the legacy
 * flat-key API schema; now also the shapes `@ksp-gonogo/data`'s
 * `useTopology` / `vesselPartsAdapter.ts` derive from the mod's
 * `vessel.parts` stream Topic.
 */

/**
 * One part in the `v.topology` payload. Shape mirrors the source walker
 * exactly: no client-side renaming.
 * Live per-tick values (resources, temperatures) are not here; they live on
 * the separate `r.resourceFor[flightId]` / `therm.part[flightId]` keys so
 * the topology snapshot stays cacheable across staging-quiet stretches.
 */
export interface TopologyPart {
  flightId: number;
  persistentId: number;
  parentFlightId: number | null;
  /**
   * For parts carrying `CModuleFuelLine`, the flightId of the receiving
   * tank: the "to" end of the line. `parentFlightId` already points
   * at the source. `null` for any non-fuel-line part. Optional because
   * fixtures captured before the fork started emitting it stay readable.
   */
  fuelLineTarget?: number | null;
  name: string;
  title: string;
  manufacturer: string;
  /** `PartCategories` enum name as a display label (e.g. "Engine", "FuelTank").
   *  {@link categoryOrdinal} is what a consumer should branch on. */
  category: string;
  /**
   * `PartCategories` ordinal (`KspPartCategory`). Optional because a fixture
   * captured before the mod emitted it stays readable, and `null` when the part
   * carried no `partInfo`. Note `none` is `-1` and is a real category, not an
   * absence.
   */
  categoryOrdinal?: number | null;
  /** `Part.inverseStage`, or null when it could not be read. */
  inverseStage: number | null;
  crewCapacity: number;
  /** `Part.maxTemp` in kelvin, or null when it could not be read. */
  maxTemp: number | null;
  crashTolerance: number;
  /** `Part.mass`: dry mass only, not including resources. Null when it could not be read. */
  dryMass: number | null;
  /** Vessel-local root-relative position `[x, y, z]`. */
  orgPos: [number, number, number];
  /**
   * Part's local +up axis in vessel-local frame (`part.orgRot * Vector3.up`).
   * `[0, 1, 0]` for axially-mounted parts (the majority); `[±1, 0, 0]` or
   * `[0, 0, ±1]` for radially-mounted parts (docking ports, side nose cones,
   * radial decouplers); inverted parts (rare) carry a negative-Y component.
   * Optional because older fixtures carry none: consumers default to
   * `[0, 1, 0]`.
   */
  up?: [number, number, number];
  /**
   * Part's local +forward (+Z) axis in vessel-local frame
   * (`part.orgRot * Vector3.forward`). With {@link up} it fixes the part's
   * whole rotation, including the turn about its up axis that sets which way
   * a fin or a radial part faces. Optional because older fixtures carry none.
   */
  forward?: [number, number, number];
  /**
   * The part's mesh box in metres, in the part's own frame: the union of the
   * mesh bounds under the part's model, whatever its deploy state.
   *
   * `size` is the box's extent and `center` its centre's offset from
   * `orgPos`, both part-local, so a consumer turns `center` by the part's
   * rotation before adding it to `orgPos`. Missing `center` is treated as
   * `{x: 0, y: 0, z: 0}`.
   */
  bounds: {
    size: { x: number; y: number; z: number };
    center?: { x: number; y: number; z: number };
  };
  /** Raw `PartModule.moduleName` strings; no filtering. */
  modules: string[];
}

/**
 * `v.topology` response shape. `topologySeq` matches the lightweight
 * `v.topologySeq` key: consumers subscribe to the seq and refetch this key
 * only when it ticks rather than streaming the topology continuously.
 */
export interface VesselTopology {
  topologySeq: number;
  rootFlightId: number;
  parts: TopologyPart[];
}

/**
 * Live per-part resource state. Keyed by resource name (LiquidFuel,
 * Oxidizer, ElectricCharge, ...); empty object when the part has no
 * resources / contributes no flow / the flightId isn't found. Sourced from
 * the mod's `vessel.parts` stream Topic (`@ksp-gonogo/data`'s
 * `usePartsLive`/`derivePartResources`): originally the legacy fork's
 * `r.resourceFor[flightId]` key, whose row shape this interface still
 * mirrors field-for-field.
 *
 * `amount` / `maxAmount` cover storage. `flow` and `nominalFlow` are
 * present when the part's modules contribute production / consumption
 * (solar panels, RTGs, generators, ISRU, drills, engines):
 *
 * - `flow`: signed units/sec: positive = producing, negative =
 *   consuming. Summed across every contributing module on the part.
 * - `nominalFlow`: same sign, 100%-efficiency cap (sun-aligned solar,
 *   full-rate generator). Omitted when no module supports a nominal
 *   (e.g. engines), when no module contributes, or when nominal equals
 *   flow.
 *
 * Rows are emitted for resources the part contributes flow to even when
 * storage is zero, an RTG part reports `{ ElectricCharge: { amount: 0,
 * maxAmount: 0, flow: 0.7, nominalFlow: 0.75 } }`.
 */
export interface PartResources {
  [resourceName: string]: {
    /** Null when it could not be read. */
    amount: number | null;
    /** Null when it could not be read. */
    maxAmount: number | null;
    flow?: number;
    nominalFlow?: number;
    /** True when a running process on the part moves this resource with no readable rate; absent otherwise. */
    unratedProcess?: true;
  };
}

/**
 * Live per-part thermal state from `therm.part[flightId]`. `null` upstream
 * when the flightId isn't found: consumers should treat the missing case
 * as "thermal data not available" rather than zero-Kelvin.
 */
export interface PartThermal {
  temperature: number;
  /** Null when the part's limit could not be read. */
  maxTemperature: number | null;
  temperatureK: number;
  /** Null when the part's limit could not be read. */
  maxTemperatureK: number | null;
}

/**
 * Behavioural state for one PartModule on a part, the fork emits one
 * entry per supported module under `v.partState[flightId].modules`.
 *
 * `type` discriminates the module; `state` is the standardised deploy /
 * activation vocabulary (see fork's PartStateDataLinkHandler):
 *
 * - `extended` / `retracted` / `deploying` / `retracting`, for parts
 *   that animate (solar panels, radiators, antennas, cargo bays, gear).
 * - `stowed` / `armed` / `extended` / `broken`, parachute lifecycle.
 *   `armed` means the chute is armed and waiting for atmospheric trigger.
 * - `active` / `inactive`: engines (EngineIgnited toggle), drills.
 * - `unknown`: fallback when the underlying KSP enum doesn't map.
 *
 * Module-specific extras:
 * - solarPanel: `tracking` (bool): sun-tracking gimbal active.
 * - engine: `flameout` (bool, only when true): fuel-starved.
 */
export interface PartStateModule {
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

/**
 * Per-part module behavioural state. Originally the legacy fork's
 * `v.partState[flightId]` response, where `seq` was a per-vessel counter
 * bumped on staging, vessel modifications, part death / undock / couple,
 * PAW dismiss, and as a 10s backstop for events without a GameEvent hook,
 * consumers dedup on `seq` rather than deep-comparing the modules array.
 *
 * Now sourced from the mod's `vessel.parts` stream Topic
 * (`@ksp-gonogo/data`'s `usePartsLive`/`derivePartState`), whose payload
 * re-emits atomically on any change, there's no separate per-part dedup
 * counter on the wire any more, so `seq` is synthesized from the module
 * count (see `derivePartState`'s doc comment). No current consumer reads
 * `.seq` directly.
 */
export interface PartState {
  seq: number;
  modules: PartStateModule[];
}
