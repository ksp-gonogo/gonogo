/**
 * Where the craft's first-hop peer IS, at a view time.
 *
 * ## The one leg worth propagating
 *
 * `comms.path` publishes each hop's `distanceMeters` and nothing about where its
 * endpoints are. For every hop except the first that is enough: both ends are
 * ground stations or relays in known orbits, neither moving appreciably against
 * the other over a telemetry timescale, so the length the mod measured carries
 * forward unchanged. The FIRST hop is the one with the craft at one end, and the
 * craft is the thing that has moved since the light left. Re-measuring that leg
 * needs two positions at the view time: the craft's, which a client already
 * propagates, and its peer's, which is what this module answers.
 *
 * ## Why a body-fixed latitude and longitude was not enough on its own
 *
 * A ground-station peer is the commonest case by a distance: one hop ending at a
 * station IS the whole delay. `commandCentre.roster` has always published that
 * station's latitude and longitude, and they are BODY-FIXED, so placing the
 * station in the frame a propagated craft arrives in needs the body's rotation
 * PHASE at the view time. Until `BodyEntry.initialRotation` the wire carried
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
import type { OrbitElements, Vector3 } from "./kepler";
import {
  buildElements,
  trySolve,
  type WireOrbitElements,
} from "./kepler-reckoning";
import type { SystemInstant } from "./reference-frame";

/**
 * The slice of a `fleet.<guid>.orbit` payload a peer's position needs: the
 * elements, and the body they are measured about. Structural rather than the
 * generated `VesselOrbit`, on the same terms as `ConicOrbitInput`: a payload
 * passes without a cast, and a caller holding only the elements need not
 * manufacture a patch chain and a horizon to be allowed to place a relay.
 */
export type CommsPeerOrbit = WireOrbitElements & { referenceBodyIndex: number };

const DEG = Math.PI / 180;

/**
 * The body's rotation angle at `ut`, degrees, in KSP's own definition:
 * `initialRotation + 360 · ut / rotationPeriod`, the expression
 * `CelestialBody.updateBody` evaluates every frame. Unwrapped, because every
 * caller feeds it to a sine and a cosine.
 *
 * Null when the body does not rotate, or when either half of the pair is
 * missing: half a phase places nothing.
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
 * A body-fixed surface point as a BODY-CENTRED inertial position at `ut`.
 *
 * `latitudeDeg`/`longitudeDeg` are the wire's geographic pair; `altitudeMetres`
 * is height above the body's mean radius, and 0 is the right value for a ground
 * station, whose altitude the roster does not carry (KSC sits some tens of
 * metres up, a light-time well under a microsecond).
 *
 * Null when the body carries no radius or no rotation phase. Returning the
 * body-fixed vector unturned would be a confidently wrong position where a
 * refusal is the honest answer.
 */
export function surfacePositionAt(
  body: CelestialBody,
  latitudeDeg: number,
  longitudeDeg: number,
  altitudeMetres: number,
  ut: number,
): Vector3 | null {
  if (body.radius === null) return null;
  const rotationDeg = bodyRotationAngleDegAt(body, ut);
  if (rotationDeg === null) return null;

  const lat = latitudeDeg * DEG;
  const lon = longitudeDeg * DEG;
  const r = body.radius + altitudeMetres;
  // KSP's own Planetarium.SphericalVector: z-up, right-handed, the basis an
  // element set's inclination and ascending node are already measured in.
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
 * A hop endpoint located well enough to be propagated: a point turning with a
 * body's surface, or a craft on an orbit about one.
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

/** The far end of a hop: its node id, and whether that node is a ground station. */
export interface CommsPeerEndpoint {
  id: string;
  isHome: boolean;
}

/**
 * The far end of the first hop, or null when there is no path home.
 *
 * `hops` is ordered craft-to-centre (`CommsBackendBase.Path` preserves the
 * backend's own order onto `from`/`to`), so the craft is `hops[0].from` and its
 * peer is `hops[0].to`. The LAST hop's far end is the command centre, which on a
 * multi-hop path is a different node entirely.
 */
export function firstHopPeer(
  hops: readonly CommsHop[] | undefined,
): CommsPeerEndpoint | null {
  const first = hops?.[0];
  if (first === undefined) return null;
  return { id: first.to, isHome: first.toIsHome };
}

/**
 * Locate a hop endpoint against the two channels that can say where it is.
 *
 * A ground-station endpoint joins to `commandCentre.roster` BY DISPLAY NAME,
 * because the two id spaces differ: a hop carries the station's own name
 * (`CommNetBackend.NodeId`) where a roster entry carries `"ground:<name>"`.
 * Two stations sharing a name collapse to one hop id, so this join cannot tell
 * them apart, and neither can the hop: the ambiguity starts upstream of here.
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
      // The roster carries no altitude for a station, and a station's height
      // above mean radius is a light-time well under a microsecond.
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
 * A located peer's ROOT-CENTRED position at `ut`.
 *
 * Root-centred rather than body-centred so a station on one body and a craft
 * about another subtract directly. `system` is the whole catalogue solved at the
 * same `ut`: one instant serves every peer in a frame, where re-solving a body's
 * parent chain per peer is the usual way this gets slow.
 *
 * Null when the peer's body is not in the instant (its parent chain would not
 * solve) or the peer's own solve refuses, a hyperbolic relay orbit included.
 */
export function commsPeerPositionAt(
  peer: CommsPeerLocation,
  facts: CelestialFacts,
  system: SystemInstant,
  ut: number,
): Vector3 | null {
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

function add(a: Vector3, b: Vector3): Vector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
