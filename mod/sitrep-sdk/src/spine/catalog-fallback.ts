import type {
  PayloadMeta,
  SystemBodies,
  TrackingStationCatalog,
  VesselIdentity,
  VesselOrbit,
} from "../__generated__/contract";
import {
  PropagationHorizonKind,
  Quality,
  TrajectoryKind,
} from "../__generated__/contract";
import type { TimelinePoint } from "../timeline";
import type { CommsPeerOrbit } from "./comms-path-geometry";

/**
 * What the command centre's catalog says about the craft the game names as
 * active, shaped as that craft's own `vessel.orbit` and `vessel.identity`.
 *
 * The catalog is the centre's record of every craft it tracks, heard or sighted,
 * link or none, so it holds an orbit for a craft whose own telemetry has not
 * arrived. Stock keeps an unloaded craft on rails, so the elements are an exact
 * conic. A point built from them stands in until the craft's own sample
 * arrives, and is only ever read through the orbit model, which marks every
 * figure it carries forward as modelled.
 */

/** The topics a fallback is built from, besides the active vessel's id. */
export const CATALOG_FALLBACK_INPUTS = [
  "trackingStation.catalog",
  "trackingStation.bodies",
] as const;

/** The topics a fallback can stand in for. */
export const CATALOG_FALLBACK_TOPICS = ["vessel.orbit", "vessel.identity"];

export function catalogOrbitPoint(
  catalog: TimelinePoint<TrackingStationCatalog> | undefined,
  bodies: TimelinePoint<SystemBodies> | undefined,
  vesselId: string,
): TimelinePoint<VesselOrbit> | undefined {
  const entry = catalog?.payload?.entries?.find((e) => e.vesselId === vesselId);
  const orbit = entry?.orbit;
  const bodyIndex = entry?.bodyIndex;
  if (!catalog || orbit == null || bodyIndex == null) return undefined;
  const mu = bodies?.payload?.bodies?.find(
    (b) => b.index === bodyIndex,
  )?.gravParameter;
  const { sma, ecc, inc, meanAnomalyAtEpoch, epoch } = orbit;
  if (
    sma == null ||
    ecc == null ||
    inc == null ||
    meanAnomalyAtEpoch == null ||
    epoch == null ||
    mu == null
  ) {
    return undefined;
  }
  const payload: VesselOrbit = {
    referenceBodyIndex: bodyIndex,
    sma,
    ecc,
    inc,
    lan: orbit.lan,
    argPe: orbit.argPe,
    meanAnomalyAtEpoch,
    epoch,
    mu,
    timeToAp: null,
    timeToPe: null,
    encounter: null,
    patches: [],
    horizon: {
      kind: PropagationHorizonKind.Unbounded,
      trajectoryKind: TrajectoryKind.Analytic,
    },
    meta: { source: `vessel:${vesselId}`, quality: Quality.OnRails },
  };
  return {
    ...catalog,
    payload,
    meta: {
      ...catalog.meta,
      source: `vessel:${vesselId}`,
      quality: Quality.OnRails,
    },
  };
}

export function catalogIdentityPoint(
  catalog: TimelinePoint<TrackingStationCatalog> | undefined,
  vesselId: string,
): TimelinePoint<VesselIdentity> | undefined {
  const entry = catalog?.payload?.entries?.find((e) => e.vesselId === vesselId);
  if (!catalog || !entry) return undefined;
  const meta: PayloadMeta = { source: `vessel:${vesselId}` };
  const payload: VesselIdentity = {
    vesselId,
    name: entry.name,
    vesselType: entry.vesselType,
    situation: entry.situation,
    parentBodyIndex: entry.bodyIndex ?? null,
    launchUt: null,
    meta,
  };
  return {
    ...catalog,
    payload,
    meta: { ...catalog.meta, source: `vessel:${vesselId}` },
  };
}

/**
 * The orbit the command centre's catalog records for the relay `vesselId`,
 * with the gravitational parameter of the body it orbits, or `undefined` when
 * the entry, any element the solve needs, or that body's parameter is unread.
 * An unread element is never filled with a zero.
 */
export function catalogRelayOrbit(
  catalog: TrackingStationCatalog | null | undefined,
  bodies: SystemBodies | null | undefined,
  vesselId: string,
): CommsPeerOrbit | undefined {
  const entry = catalog?.entries?.find((e) => e.vesselId === vesselId);
  const orbit = entry?.orbit;
  const bodyIndex = entry?.bodyIndex;
  if (orbit == null || bodyIndex == null) return undefined;
  const mu = bodies?.bodies?.find((b) => b.index === bodyIndex)?.gravParameter;
  const { sma, ecc, inc, meanAnomalyAtEpoch, epoch } = orbit;
  if (
    sma == null ||
    ecc == null ||
    inc == null ||
    meanAnomalyAtEpoch == null ||
    epoch == null ||
    mu == null
  ) {
    return undefined;
  }
  return {
    sma,
    ecc,
    inc,
    lan: orbit.lan,
    argPe: orbit.argPe,
    meanAnomalyAtEpoch,
    epoch,
    mu,
    referenceBodyIndex: bodyIndex,
  };
}
