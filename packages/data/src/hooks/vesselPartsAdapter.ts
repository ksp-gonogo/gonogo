import type {
  PartResources,
  PartState,
  PartStateModule,
  PartThermal,
  TopologyPart,
  VesselTopology,
} from "@ksp-gonogo/core";
import type {
  PartModuleState,
  VesselPart,
  VesselParts,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * Reshapes the mod's `vessel.parts` Topic (the structural part-tree stream —
 * `VesselStructure.cs`'s doc comment calls it a SIBLING channel) into the
 * legacy `VesselTopology` shape `ShipMap`/`PowerSystems`'s diagram code
 * already consumes, so `useTopology` can un-gap `v.topology`/`v.topologySeq`
 * without touching either widget's rendering logic.
 *
 * Every field the diagrams actually read maps straight across
 * (name/title/category/modules/dryMass/inverseStage/maxTemp/orgPos/up/
 * bounds/fuelLineTarget/parentFlightId — see `shipTopology.ts`'s
 * `buildShipMapPart`/`classifyPart`). `persistentId`/`manufacturer`/
 * `crewCapacity`/`crashTolerance` have no `VesselPart` equivalent and no
 * diagram code reads them (confirmed by grep across `ShipMap`/
 * `PowerSystems`), so they're defaulted rather than plumbed through a new
 * mod field nobody would consume.
 */
export function deriveTopologyFromVesselParts(
  wire: VesselParts,
): VesselTopology {
  const parts: TopologyPart[] = wire.parts.map(deriveTopologyPart);
  const root = wire.parts.find((p) => p.parentId == null);
  return {
    // `vessel.parts` isn't seq-gated the way the old fork's
    // `v.topologySeq`/`v.topology` pair was — the whole payload re-emits on
    // change, so there's no separate lightweight counter to mirror. The
    // part count is a cheap, honest stand-in for widgets that only used
    // `topologySeq` to detect "did the structure change" (none currently
    // read it directly — `useTopology`'s consumers key off the returned
    // object's own identity via `useMemo`).
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
    inverseStage: p.inverseStage,
    crewCapacity: 0,
    maxTemp: p.maxTemp,
    crashTolerance: 0,
    dryMass: p.dryMass,
    orgPos: [p.position.x, p.position.y, p.position.z],
    up: p.up ? [p.up.x, p.up.y, p.up.z] : undefined,
    bounds: {
      size: { x: p.bounds.size.x, y: p.bounds.size.y, z: p.bounds.size.z },
      center: p.bounds.center
        ? {
            x: p.bounds.center.x,
            y: p.bounds.center.y,
            z: p.bounds.center.z,
          }
        : undefined,
    },
    modules: p.modules,
  };
}

/**
 * Per-part internal temperature off the SAME `vessel.parts` payload
 * `deriveTopologyFromVesselParts` reads — the old `therm.part[flightId]`
 * live key's dual-unit shape, minus the wire round-trip. `null` when the
 * part hasn't been simulated yet this session (`currentTemp` unset,
 * KSP's `-1` "not yet simulated" sentinel already resolved to `null` on the
 * mod side) — same "thermal data not available" contract `PartThermal`'s
 * doc comment already promises callers.
 */
export function derivePartThermal(p: VesselPart): PartThermal | null {
  if (p.currentTemp == null) return null;
  return {
    temperature: p.currentTemp - 273.15,
    maxTemperature: p.maxTemp - 273.15,
    temperatureK: p.currentTemp,
    maxTemperatureK: p.maxTemp,
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
 * shape — a field-for-field pass-through (see the mod's `PartResourceFlow`
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
      amount: row.amount,
      maxAmount: row.maxAmount,
      ...(row.flow != null ? { flow: row.flow } : {}),
      ...(row.nominalFlow != null ? { nominalFlow: row.nominalFlow } : {}),
    };
  }
  return out;
}

/** Builds the flightId-keyed resources lookup `usePartsLive` merges into its
 *  per-part live slices — the `vessel.parts` replacement for the legacy
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
 * shape (`{ seq, modules }`) — the `vessel.parts` replacement for the
 * legacy `v.partState[fid]` subscription. `seq` has no wire equivalent any
 * more: the whole `vessel.parts` payload re-emits atomically on change (see
 * `VesselParts`' doc comment), so there's no separate per-part dedup
 * counter left to carry forward. No `usePartsLive` consumer reads `.seq`
 * (confirmed by grep across ShipMap/PowerSystems), so this synthesizes a
 * value from the module count — stable across identical payloads, changes
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
