/**
 * `vessel.maneuver.legacy` — a narrow derived channel reshaping
 * `vessel.maneuver.nodes` (`mod/Sitrep.Contract/VesselManeuver.cs`) into the
 * legacy Telemachus `o.maneuverNodes` shape ManeuverPlanner/MapView already
 * consume (`packages/core/src/schemas/orbit.ts`'s `ManeuverNode`).
 *
 * Deliberately a SEPARATE channel from `vessel.state`, not a new field on
 * it: `vessel.state`'s `DerivedChannelDefinition.inputs` list is
 * carried-channels-gated at the PARENT level (`vessel-state.ts`'s own doc
 * comment on `vesselStateChannel`) — adding `vessel.maneuver` there would
 * make EVERY `vessel.state.*` consumer (including the ones that never touch
 * maneuver data) require `vessel.maneuver` in its `carriedChannels`
 * allowlist too, a wide, unrelated blast radius across every existing
 * `vessel.state.*` test fixture. A dedicated channel scopes that
 * requirement to just this reshape's own consumers.
 */
import {
  type LegacyOrbitPatch,
  mapOrbitPatch,
  type OrbitPatchWirePayload,
} from "./orbit-patches";
import type { DerivedChannelDefinition, DerivedGet } from "./timeline-store";

/**
 * Wire shape of one `vessel.maneuver.nodes` entry (mirrors
 * `mod/Sitrep.Contract/VesselManeuver.cs`'s `ManeuverNode`). Hand-mirrored,
 * same convention as `vessel-state.ts`'s payload types.
 */
export interface ManeuverNodeWirePayload {
  id: string;
  ut: number;
  dvRadial?: number | null;
  dvNormal?: number | null;
  dvPrograde?: number | null;
  dvTotal?: number | null;
  patches: OrbitPatchWirePayload[];
}

/** The `vessel.maneuver` channel payload (mirrors `VesselManeuver.cs`). */
export interface VesselManeuverPayload {
  nodes: ManeuverNodeWirePayload[];
}

/**
 * The legacy `o.maneuverNodes` entry shape (`@ksp-gonogo/core`'s
 * `ManeuverNode`, `packages/core/src/schemas/orbit.ts`) — re-declared
 * here for the same reason `orbit-patches.ts`'s `LegacyOrbitPatch` is
 * (`sitrep-client` cannot depend on `@ksp-gonogo/core`).
 */
export interface LegacyManeuverNode {
  UT: number;
  deltaV: [number, number, number];
  PeA: number;
  ApA: number;
  inclination: number;
  eccentricity: number;
  epoch: number;
  period: number;
  argumentOfPeriapsis: number;
  sma: number;
  lan: number;
  maae: number;
  referenceBody: string;
  closestEncounterBody: string | null;
  orbitPatches: LegacyOrbitPatch[];
}

/**
 * Reshapes one wire maneuver node into the legacy shape. `deltaV` is the
 * `[radialOut, normal, prograde]` tuple Telemachus's own
 * `addManeuverNode[ut,x,y,z]` arg order used (see the project's "Telemachus
 * maneuver-node arg order" finding) — `dvRadial`/`dvNormal`/`dvPrograde` are
 * already that same frame, just named instead of positional (kills the
 * arg-order footgun `mod/Sitrep.Contract/VesselManeuver.cs`'s own doc
 * comment describes). The node-level PeA/ApA/inclination/... fields mirror
 * `orbitPatches[0]` exactly — that is how Telemachus's own
 * `o.maneuverNodes` always behaved (the node's headline numbers ARE its
 * post-burn patch's numbers) — defaulting to 0/""/null when the solver
 * hasn't produced a post-burn patch yet (a just-added node, still mid-tick).
 */
export function mapManeuverNode(
  wire: ManeuverNodeWirePayload,
): LegacyManeuverNode {
  const orbitPatches = wire.patches.map(mapOrbitPatch);
  const first = orbitPatches[0];
  return {
    UT: wire.ut,
    deltaV: [wire.dvRadial ?? 0, wire.dvNormal ?? 0, wire.dvPrograde ?? 0],
    PeA: first?.PeA ?? 0,
    ApA: first?.ApA ?? 0,
    inclination: first?.inclination ?? 0,
    eccentricity: first?.eccentricity ?? 0,
    epoch: first?.epoch ?? 0,
    period: first?.period ?? 0,
    argumentOfPeriapsis: first?.argumentOfPeriapsis ?? 0,
    sma: first?.sma ?? 0,
    lan: first?.lan ?? 0,
    maae: first?.maae ?? 0,
    referenceBody: first?.referenceBody ?? "",
    closestEncounterBody: first?.closestEncounterBody ?? null,
    orbitPatches,
  };
}

export interface VesselManeuverLegacyState {
  nodes: LegacyManeuverNode[];
}

/**
 * `undefined` while `vessel.maneuver` hasn't arrived yet (not whole); `null`
 * on a confirmed tombstone; otherwise ALWAYS a `nodes` array (R2 — empty
 * when the vessel has no maneuvers queued, the common case), same discipline
 * as `VesselManeuver.Nodes` itself.
 */
export function deriveVesselManeuverLegacy(
  get: DerivedGet,
): VesselManeuverLegacyState | null | undefined {
  const point = get<VesselManeuverPayload>("vessel.maneuver");
  if (!point) return undefined;
  if (point.payload === null) return null;
  return { nodes: point.payload.nodes.map(mapManeuverNode) };
}

/**
 * Ready-to-register definition — `store.registerDerivedChannel(vesselManeuverLegacyChannel)`.
 * `fields: true` exposes `vessel.maneuver.legacy.nodes` — the target of
 * `map-topic.ts`'s `"o.maneuverNodes"` mapping.
 */
export const vesselManeuverLegacyChannel: DerivedChannelDefinition<VesselManeuverLegacyState> =
  {
    topic: "vessel.maneuver.legacy",
    inputs: ["vessel.maneuver"],
    derive: (get) => deriveVesselManeuverLegacy(get),
    fields: true,
  };
