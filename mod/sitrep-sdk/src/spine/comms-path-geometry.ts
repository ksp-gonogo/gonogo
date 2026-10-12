/**
 * Where the craft's first-hop peer is, at a view time.
 *
 * ## The one leg worth propagating
 *
 * `comms.path` publishes each hop's `distanceMeters` and nothing about where its
 * endpoints are. For every hop except the first that is enough: both ends are
 * ground stations or relays in known orbits, neither moving appreciably against
 * the other over a telemetry timescale, so the length the mod measured carries
 * forward unchanged. The first hop is the one with the craft at one end, and the
 * craft is the thing that has moved since the light left. Re-measuring that leg
 * needs two positions at the view time: the craft's, which a client already
 * propagates, and its peer's, which is what this module answers.
 *
 * ## Why a body-fixed latitude and longitude was not enough on its own
 *
 * A ground-station peer is the commonest case by a distance: one hop ending at a
 * station is the whole delay. `commandCentre.roster` has always published that
 * station's latitude and longitude, and they are BODY-FIXED, so placing the
 * station in the frame a propagated craft arrives in needs the body's rotation
 * phase at the view time. Until `BodyEntry.initialRotation` the wire carried
 * only `rotationPeriod`, which fixes the rate and leaves the phase unknowable,
 * and a rate alone cannot place a point on a sphere. So the direct-link case
 * was not computable at all, and publishing the station's position per frame
 * would not have fixed it either: a position sampled when the light left is not
 * a position at the view time.
 *
 * ## The frame
 *
 * Every vector here is in the frame `kepler.solve` returns: right-handed, +Z
 * along the reference pole, metres. {@link surfacePositionAt} is body-CENTRED;
 * {@link commsPeerPositionAt} is root-centred, having added the body's own
 * position from `systemInstantAt`, so a peer on one body and a craft about
 * another are directly subtractable.
 */

import type { CommandCentreEntry, CommsHop } from "../__generated__/contract";
import { magnitudeOr } from "../magnitude";
import type { CelestialBody, CelestialFacts } from "./celestial-facts";
import type { OrbitElements, Vec3Tuple } from "./kepler";
import {
  buildElements,
  trySolve,
  type WireOrbitElements,
} from "./kepler-reckoning";
import type { SystemInstant } from "./reference-frame";

/**
 * The orbit elements of a relay vessel and the body they are measured about,
 * the part of a `fleet.<guid>.orbit` payload needed to place that relay. Useful
 * for finding where the far end of a comms hop is. Taken by `locateCommsPeer`
 * and by the `comms.delay` reckoner.
 */
export type CommsPeerOrbit = WireOrbitElements & { referenceBodyIndex: number };

const DEG = Math.PI / 180;

/**
 * The body's rotation angle at the UT `ut`, in degrees, as
 * `initialRotation + 360 · ut / rotationPeriod`. The angle is not wrapped to a
 * single turn. Useful for turning a point fixed to a body's surface into a
 * position in space. Used by `surfacePositionAt`.
 *
 * Null when the body does not rotate, or when its initial rotation or rotation
 * period is missing.
 */
export function bodyRotationAngleDegAt(
  body: CelestialBody,
  ut: number,
): number | null {
  const { initialRotation, rotationPeriod } = body;
  if (initialRotation === null || rotationPeriod === null) return null;
  if (!Number.isFinite(ut) || rotationPeriod === 0) return null;
  return initialRotation + (360 * ut) / rotationPeriod;
}

/**
 * A point on a body's surface as a position relative to the body's centre at
 * the UT `ut`, in metres. Useful for placing a ground station in the same frame
 * as a propagated vessel. Used by `commsPeerPositionAt`.
 *
 * `latitudeDeg` and `longitudeDeg` are the wire's geographic pair. `altitudeMetres`
 * is height above the body's mean radius, and 0 is the right value for a ground
 * station, whose altitude the roster does not carry.
 *
 * Null when the body carries no radius or no rotation phase.
 */
export function surfacePositionAt(
  body: CelestialBody,
  latitudeDeg: number,
  longitudeDeg: number,
  altitudeMetres: number,
  ut: number,
): Vec3Tuple | null {
  if (body.radius === null) return null;
  const rotationDeg = bodyRotationAngleDegAt(body, ut);
  if (rotationDeg === null) return null;

  const lat = latitudeDeg * DEG;
  const lon = longitudeDeg * DEG;
  const r = body.radius + altitudeMetres;
  // KSP's own Planetarium.SphericalVector: z-up, right-handed, the basis an element set's inclination and ascending node are already measured in.
  const x = Math.cos(lat) * Math.cos(lon) * r;
  const y = Math.cos(lat) * Math.sin(lon) * r;
  const z = Math.sin(lat) * r;

  /*
   * CelestialBody builds its body frame as PlanetaryFrame(0, 90, rotationAngle),
   * and that reduces to a turn about +Z by rotationAngle, which is why this is
   * two terms rather than a full frame build.
   */
  const rot = rotationDeg * DEG;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return [x * cos - y * sin, x * sin + y * cos, z];
}

/**
 * The far end of a comms hop, placed well enough to be propagated: a ground
 * station turning with a body's surface, or a vessel on an orbit about a body.
 * Useful for working out how far the vessel is from its first-hop peer. Returned
 * by `locateCommsPeer` and taken by `commsPeerPositionAt`.
 */
export type CommsPeerLocation =
  | {
      kind: "surface";
      bodyIndex: number;
      latitudeDeg: number;
      longitudeDeg: number;
      altitudeMetres: number;
    }
  | { kind: "orbiting"; bodyIndex: number; elements: OrbitElements };

/**
 * The far end of a comms hop: its node id, and whether that node is a ground
 * station. Returned by `firstHopPeer` and taken by `locateCommsPeer`.
 */
export interface CommsPeerEndpoint {
  id: string;
  isHome: boolean;
}

/**
 * The far end of the vessel's first comms hop, or null when there is no path
 * home. Useful for finding which node the vessel talks to first. Used by the
 * `comms.delay` reckoner.
 *
 * `hops` is ordered from the vessel to the command centre, so the vessel is
 * `hops[0].from` and its peer is `hops[0].to`. On a multi-hop path the last
 * hop's far end is the command centre, a different node.
 */
export function firstHopPeer(
  hops: readonly CommsHop[] | undefined,
): CommsPeerEndpoint | null {
  const first = hops?.[0];
  if (first === undefined) return null;
  return { id: first.to, isHome: first.toIsHome };
}

/**
 * Places a comms hop endpoint using the two channels that can say where it is,
 * or returns null when neither does. Useful for finding the position of the
 * ground station or relay at the far end of a hop. Used by the `comms.delay`
 * reckoner.
 *
 * A ground-station endpoint joins to `commandCentre.roster` by display name,
 * because a hop carries the station's own name where a roster entry carries
 * `"ground:<name>"`. Two stations sharing a name have one hop id, so they
 * cannot be told apart.
 *
 * A relay endpoint joins to `fleet.<guid>.orbit` directly, both keying on the
 * bare vessel guid.
 */
export function locateCommsPeer(
  endpoint: CommsPeerEndpoint,
  roster: readonly CommandCentreEntry[] | undefined,
  orbitOf: (vesselId: string) => CommsPeerOrbit | undefined,
): CommsPeerLocation | null {
  if (endpoint.isHome) {
    const entry = roster?.find((e) => e.displayName === endpoint.id);
    if (entry == null || entry.bodyIndex == null) return null;
    const lat = magnitudeOr(entry.latitude, Number.NaN);
    const lon = magnitudeOr(entry.longitude, Number.NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      kind: "surface",
      bodyIndex: entry.bodyIndex,
      latitudeDeg: lat,
      longitudeDeg: lon,
      // The roster carries no altitude for a station, and a station's height above mean radius is a light-time well under a microsecond.
      altitudeMetres: 0,
    };
  }

  const orbit = orbitOf(endpoint.id);
  if (orbit === undefined) return null;
  return {
    kind: "orbiting",
    bodyIndex: orbit.referenceBodyIndex,
    elements: buildElements(orbit),
  };
}

/**
 * A placed peer's position at the UT `ut`, in metres relative to the system's
 * root body rather than the peer's own body, so a station on one body and a
 * vessel about another can be subtracted directly. Useful for measuring the
 * distance from the vessel to its first-hop peer. Used by the `comms.delay`
 * reckoner.
 *
 * `system` is every body of the catalogue solved at that same `ut`, so one
 * instant serves every peer in a frame.
 *
 * Null when the peer's body is not in the instant or the peer's own solve
 * refuses, as it does for a parabolic orbit.
 */
export function commsPeerPositionAt(
  peer: CommsPeerLocation,
  facts: CelestialFacts,
  system: SystemInstant,
  ut: number,
): Vec3Tuple | null {
  const centre = system.positionByIndex.get(peer.bodyIndex);
  if (centre === undefined) return null;

  if (peer.kind === "orbiting") {
    const state = trySolve(peer.elements, ut);
    return state === null ? null : add(centre, state.position);
  }

  const body = facts.bodies.find((b) => b.index === peer.bodyIndex);
  if (body === undefined) return null;
  const local = surfacePositionAt(
    body,
    peer.latitudeDeg,
    peer.longitudeDeg,
    peer.altitudeMetres,
    ut,
  );
  return local === null ? null : add(centre, local);
}

function add(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
