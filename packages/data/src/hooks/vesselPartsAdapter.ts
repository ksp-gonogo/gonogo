import {
  kelvinToCelsius,
  type PartResources,
  type PartState,
  type PartStateModule,
  type PartThermal,
  type TopologyPart,
  type VesselTopology,
} from "@ksp-gonogo/core";
import type {
  PartModuleState,
  VesselPart,
  VesselParts,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * Reshapes the mod's `vessel.parts` Topic (the structural part-tree stream,
 * `VesselStructure.cs`'s doc comment calls it a SIBLING channel) into the
 * legacy `VesselTopology` shape `ShipMap`/`PowerSystems`'s diagram code
 * already consumes, so `useTopology` can un-gap `v.topology`/`v.topologySeq`
 * without touching either widget's rendering logic.
 *
 * Every field the diagrams actually read maps straight across
 * (name/title/category/modules/dryMass/inverseStage/maxTemp/orgPos/up/
 * bounds/fuelLineTarget/parentFlightId: see `shipTopology.ts`'s
 * `buildShipMapPart`/`classifyPart`). `persistentId`/`manufacturer`/
 * `crewCapacity`/`crashTolerance` have no `VesselPart` equivalent and no
 * diagram code reads them (confirmed by grep across `ShipMap`/
 * `PowerSystems`), so they're defaulted rather than plumbed through a new
 * mod field nobody would consume.
 *
 * **This is where the unit system stops.** `VesselTopology` is the input to
 * SVG geometry: `orgPos`/`bounds` are fed to transform maths, projected, and
 * written into `viewBox` and `d` attributes, none of which can take anything
 * but a raw number. Carrying `Value` past this boundary would only mean
 * unwrapping it a few frames deeper instead, once per part per render, for no
 * reader that benefits. So every magnitude is taken here, at one boundary,
 * and the diagram keeps the plain-number shape it was written against.
 */
export function deriveTopologyFromVesselParts(
  wire: VesselParts,
): VesselTopology {
  const parts: TopologyPart[] = wire.parts.map(deriveTopologyPart);
  const root = wire.parts.find((p) => p.parentId == null);
  return {
    // `vessel.parts` is not seq-gated: the whole payload re-emits on change,
    // so there is no separate lightweight counter to mirror here. The part
    // count is a cheap, honest stand-in for a consumer that wants only "did
    // the structure change". None reads it directly, `useTopology`'s consumers
    // key off the returned object's own identity via `useMemo`.
    topologySeq: wire.parts.length,
    rootFlightId: root ? Number(root.id) : 0,
    parts,
  };
}

function deriveTopologyPart(p: VesselPart): TopologyPart {
  return {
    flightId: Number(p.id),
    persistentId: Number(p.id),
    parentFlightId: p.parentId != null ? Number(p.parentId) : null,
    fuelLineTarget:
      p.fuelLineTargetId != null ? Number(p.fuelLineTargetId) : null,
    name: p.name,
    title: p.title,
    manufacturer: "",
    category: p.category,
    categoryOrdinal: p.categoryOrdinal ?? null,
    inverseStage: p.inverseStage,
    crewCapacity: 0,
    maxTemp: p.maxTemp.magnitude,
    crashTolerance: 0,
    dryMass: p.dryMass.magnitude,
    orgPos: [
      p.position.x.magnitude,
      p.position.y.magnitude,
      p.position.z.magnitude,
    ],
    up: p.up
      ? [p.up.x.magnitude, p.up.y.magnitude, p.up.z.magnitude]
      : undefined,
    bounds: {
      size: {
        x: p.bounds.size.x.magnitude,
        y: p.bounds.size.y.magnitude,
        z: p.bounds.size.z.magnitude,
      },
      center: p.bounds.center
        ? {
            x: p.bounds.center.x.magnitude,
            y: p.bounds.center.y.magnitude,
            z: p.bounds.center.z.magnitude,
          }
        : undefined,
    },
    modules: p.modules,
  };
}

// The Kelvin -> Celsius offset comes from core's `kelvinToCelsius`. It is not
// done through the unit system because Celsius is an OFFSET unit and the
// registry only knows ratios: `value("K", 300)` in "degC" would be a scaling,
// and there is no scale factor that turns 300 K into 26.85 C.
//
// The constant lives in ONE place, deliberately. Two packages each exporting an
// `ABSOLUTE_ZERO_C` with opposite signs (273.15 to subtract, -273.15 to add) are
// each correct only beside their own operator, and reading one while applying
// the other silently lands you 546.3 K out.

/**
 * Per-part internal temperature off the SAME `vessel.parts` payload
 * `deriveTopologyFromVesselParts` reads, carrying both units, and with no wire
 * round-trip of its own. `null` when the
 * part hasn't been simulated yet this session (`currentTemp` unset,
 * KSP's `-1` "not yet simulated" sentinel already resolved to `null` on the
 * mod side): same "thermal data not available" contract `PartThermal`'s
 * doc comment already promises callers.
 */
export function derivePartThermal(p: VesselPart): PartThermal | null {
  if (p.currentTemp == null) return null;
  return {
    temperature: kelvinToCelsius(p.currentTemp.magnitude),
    maxTemperature: kelvinToCelsius(p.maxTemp.magnitude),
    temperatureK: p.currentTemp.magnitude,
    maxTemperatureK: p.maxTemp.magnitude,
  };
}

/** Builds the flightId-keyed thermal lookup `usePartsLive` merges into its
 *  per-part live slices. Empty map when `wire` hasn't arrived yet. */
export function buildThermalByFlightId(
  wire: VesselParts | undefined,
): Map<number, PartThermal | null> {
  const out = new Map<number, PartThermal | null>();
  if (!wire) return out;
  for (const p of wire.parts) {
    out.set(Number(p.id), derivePartThermal(p));
  }
  return out;
}

/**
 * Reshapes one `VesselPart.resources` row map into the SDK's `PartResources`
 * shape: a field-for-field pass-through (see the mod's `PartResourceFlow`
 * doc comment: the wire row already carries `amount`/`maxAmount`/
 * `flow`/`nominalFlow`), dropping `flow`/`nominalFlow` keys entirely rather
 * than carrying explicit `undefined` so callers relying on `"flow" in row`
 * see the same "field absent" shape the legacy `r.resourceFor[fid]` payload
 * had.
 */
export function derivePartResources(p: VesselPart): PartResources {
  const out: PartResources = {};
  for (const [name, row] of Object.entries(p.resources)) {
    out[name] = {
      amount: row.amount.magnitude,
      maxAmount: row.maxAmount.magnitude,
      ...(row.flow != null ? { flow: row.flow.magnitude } : {}),
      ...(row.nominalFlow != null
        ? { nominalFlow: row.nominalFlow.magnitude }
        : {}),
    };
  }
  return out;
}

/** Builds the flightId-keyed resources lookup `usePartsLive` merges into its
 *  per-part live slices: the `vessel.parts` replacement for the legacy
 *  `r.resourceFor[fid]` subscription. Empty map when `wire` hasn't arrived
 *  yet. */
export function buildResourcesByFlightId(
  wire: VesselParts | undefined,
): Map<number, PartResources> {
  const out = new Map<number, PartResources>();
  if (!wire) return out;
  for (const p of wire.parts) {
    out.set(Number(p.id), derivePartResources(p));
  }
  return out;
}

function deriveModuleState(m: PartModuleState): PartStateModule {
  return {
    // The mod's `type`/`state` are plain strings (no shared enum between
    // Sitrep.Contract and @ksp-gonogo/core); PartStateModule's own doc
    // comment is the source of truth for the vocabulary both sides agree
    // on, so this is a trusted pass-through rather than a validated parse.
    type: m.type as PartStateModule["type"],
    state: m.state,
    ...(m.tracking != null ? { tracking: m.tracking } : {}),
    ...(m.flameout != null ? { flameout: m.flameout } : {}),
  };
}

/**
 * Reshapes one `VesselPart.moduleStates` list into the SDK's `PartState`
 * shape (`{ seq, modules }`): the `vessel.parts` replacement for the
 * legacy `v.partState[fid]` subscription. `seq` has no wire equivalent any
 * more: the whole `vessel.parts` payload re-emits atomically on change (see
 * `VesselParts`' doc comment), so there's no separate per-part dedup
 * counter left to carry forward. No `usePartsLive` consumer reads `.seq`
 * (confirmed by grep across ShipMap/PowerSystems), so this synthesizes a
 * value from the module count: stable across identical payloads, changes
 * whenever the module set does, satisfying the field's original
 * "consumers dedup on seq" contract without a real wire counter.
 */
export function derivePartState(p: VesselPart): PartState {
  return {
    seq: p.moduleStates.length,
    modules: p.moduleStates.map(deriveModuleState),
  };
}

/** Builds the flightId-keyed module-state lookup `usePartsLive` merges into
 *  its per-part live slices. Empty map when `wire` hasn't arrived yet. */
export function buildPartStateByFlightId(
  wire: VesselParts | undefined,
): Map<number, PartState> {
  const out = new Map<number, PartState>();
  if (!wire) return out;
  for (const p of wire.parts) {
    out.set(Number(p.id), derivePartState(p));
  }
  return out;
}
