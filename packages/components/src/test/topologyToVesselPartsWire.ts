import type {
  PartResources,
  PartState,
  TopologyPart,
  VesselTopology,
} from "@ksp-gonogo/core";

/** One part's live-data overlay — the shape `usePartsLive` merges on top of
 *  topology, now sourced straight off the `vessel.parts` wire like every
 *  other topology field. */
export interface PartLiveWireInput {
  resources?: PartResources;
  partState?: PartState | null;
}

/**
 * Inverse of `@ksp-gonogo/data`'s `deriveTopologyFromVesselParts` — converts
 * one of ShipMap's existing `v.topology`-shaped fixtures (captured from a
 * live KSP session) into the `vessel.parts` wire shape, so a stream-fixture
 * test can drive the real `useTopology` hook off `StubTransport.emit`
 * instead of the retired legacy `v.topology`/`v.topologySeq` keys.
 *
 * Round-trips every field the diagram actually reads (see
 * `shipTopology.ts`'s `buildShipMapPart`); `persistentId`/`manufacturer`/
 * `crewCapacity`/`crashTolerance` have no `VesselPart` wire field (nothing
 * reads them back on the derive side either — see
 * `vesselPartsAdapter.ts`'s own doc comment) so they're simply dropped here.
 *
 * `liveByFlightId` (optional) overlays each part's `resources`/`moduleStates`
 * — the `usePartsLive` per-part slice, which now rides this SAME payload
 * instead of the retired `r.resourceFor[fid]`/`v.partState[fid]` keys. Pass
 * {@link extractLegacyPartLiveFromFixture}'s output when converting an
 * existing fixture that still carries those legacy keys.
 */
export function topologyToVesselPartsWire(
  topology: VesselTopology,
  liveByFlightId?: Map<number, PartLiveWireInput>,
) {
  return {
    parts: topology.parts.map((p) =>
      topologyPartToVesselPartWire(p, liveByFlightId?.get(p.flightId)),
    ),
  };
}

function topologyPartToVesselPartWire(
  p: TopologyPart,
  live: PartLiveWireInput | undefined,
) {
  return {
    id: String(p.flightId),
    parentId: p.parentFlightId != null ? String(p.parentFlightId) : undefined,
    name: p.name,
    title: p.title,
    position: { x: p.orgPos[0], y: p.orgPos[1], z: p.orgPos[2] },
    up: p.up ? { x: p.up[0], y: p.up[1], z: p.up[2] } : undefined,
    bounds: {
      size: p.bounds.size,
      center: p.bounds.center,
    },
    dryMass: p.dryMass,
    inverseStage: p.inverseStage,
    maxTemp: p.maxTemp,
    category: p.category,
    modules: p.modules,
    isRobotics: false,
    isPowerRelated: false,
    fuelLineTargetId:
      p.fuelLineTarget != null ? String(p.fuelLineTarget) : undefined,
    resources: resourcesToWire(live?.resources),
    moduleStates: moduleStatesToWire(live?.partState),
  };
}

function resourcesToWire(resources: PartResources | undefined) {
  const out: Record<string, unknown> = {};
  if (!resources) return out;
  for (const [name, row] of Object.entries(resources)) {
    out[name] = {
      amount: row.amount,
      maxAmount: row.maxAmount,
      flow: row.flow,
      nominalFlow: row.nominalFlow,
    };
  }
  return out;
}

function moduleStatesToWire(partState: PartState | null | undefined) {
  if (!partState) return [];
  return partState.modules.map((m) => ({
    type: m.type,
    state: m.state,
    tracking: m.tracking,
    flameout: m.flameout,
  }));
}

const RESOURCE_FOR_KEY = /^r\.resourceFor\[(\d+)\]$/;
const PART_STATE_KEY = /^v\.partState\[(\d+)\]$/;

/**
 * Scans a flat legacy fixture object (the `{ "r.resourceFor[1002]": {...},
 * "v.partState[1002]": {...}, ... }` shape captured off the old
 * `DataSource`) for per-flightId resource/module-state keys and collects
 * them into the `liveByFlightId` map {@link topologyToVesselPartsWire}
 * expects. Returns `undefined` (never an empty map) when the fixture
 * carries none of these keys, so a caller can `??` straight into "no
 * overlay" without an extra size check.
 */
export function extractLegacyPartLiveFromFixture(
  fixture: Record<string, unknown>,
): Map<number, PartLiveWireInput> | undefined {
  const out = new Map<number, PartLiveWireInput>();
  for (const [key, value] of Object.entries(fixture)) {
    const resourceMatch = RESOURCE_FOR_KEY.exec(key);
    if (resourceMatch) {
      const fid = Number(resourceMatch[1]);
      const entry = out.get(fid) ?? {};
      entry.resources = value as PartResources;
      out.set(fid, entry);
      continue;
    }
    const partStateMatch = PART_STATE_KEY.exec(key);
    if (partStateMatch) {
      const fid = Number(partStateMatch[1]);
      const entry = out.get(fid) ?? {};
      entry.partState = value as PartState | null;
      out.set(fid, entry);
    }
  }
  return out.size > 0 ? out : undefined;
}
