import { type LockedValue, Quality } from "../__generated__/contract";
import { unlessLocked } from "../locked";
import { magnitudeOr, type Quantityish } from "../magnitude";
import type { Reading, ReckoningDecline } from "../reading";
import type { TimelinePoint } from "../timeline";
import type {
  Anomalies,
  OrbitElements,
  PropagationHorizonLike,
  StateVector,
  Vec3Tuple,
} from "./kepler";
import {
  canPropagate,
  PropagationHorizonKindLike,
  solve,
  solveAnomalies,
  TrajectoryKindLike,
} from "./kepler";

/**
 * The conic, in one place, for every path that reaches it.
 *
 * The guard withdraws off rails, at an SOI transition, past the producer's
 * stated horizon and at the atmosphere interface. The registered reckoners in
 * `core-reckoners.ts` ask {@link keplerAdmissibility} and then solve, and so
 * does the map's impact point. A second copy of these conditions is how two
 * models come to disagree about where the conic ends, which is a disagreement
 * no widget could report.
 */

/**
 * The fields of `vessel.orbit` that {@link keplerAdmissibility} reads. A
 * `vessel.orbit` payload can be passed as it is. Useful for deciding whether
 * the operator's displayed orbit can be carried forward in time. Taken by
 * {@link keplerAdmissibility} and by the powered-flight reckoner.
 *
 * @category Reckoners
 */
export interface ConicOrbitInput {
  /** Index into `trackingStation.bodies` of the body the orbit is around. */
  referenceBodyIndex: number;
  /** Semi-major axis. */
  sma: Quantityish;
  /** Eccentricity. */
  ecc: Quantityish;
  /** Inclination. */
  inc: Quantityish;
  /** Longitude of the ascending node. Absent or `null` for an orbit with no defined node. */
  lan?: Quantityish | null;
  /** Argument of periapsis. Absent or `null` for an orbit with no defined periapsis. */
  argPe?: Quantityish | null;
  /** Mean anomaly at `epoch`. */
  meanAnomalyAtEpoch: Quantityish;
  /** The instant the elements are given for. */
  epoch: Quantityish;
  /** The body's gravitational parameter. */
  mu: Quantityish;
  /** A `LockedValue` while the save cannot compute one; read as no encounter. */
  encounter?: { transitionUt: Quantityish } | LockedValue | null;
  /** How far ahead the elements hold. */
  horizon?: PropagationHorizonLike;
  /** The patch chain, element 0 being the current patch, as `vessel.orbit` carries it. */
  patches?: readonly ConicPatchInput[] | null;
}

/**
 * One entry of a `vessel.orbit` patch chain, with the fields needed to carry
 * the craft onto it. Useful for deciding where the craft is after the
 * sphere-of-influence change that ends the current patch. Taken by
 * {@link keplerAdmissibilityAcrossPatches}.
 *
 * @category Reckoners
 */
export interface ConicPatchInput {
  /** Index into `trackingStation.bodies` of the body the patch is around. Absent on a patch recorded without it. */
  referenceBodyIndex?: number | null;
  /** Semi-major axis. */
  sma: Quantityish;
  /** Eccentricity. */
  ecc: Quantityish;
  /** Inclination. */
  inc: Quantityish;
  /** Longitude of the ascending node. */
  lan?: Quantityish | null;
  /** Argument of periapsis. */
  argPe?: Quantityish | null;
  /** Mean anomaly at `epoch`. Absent on a patch recorded without it. */
  meanAnomalyAtEpoch?: Quantityish | null;
  /** The instant the elements are given for. */
  epoch: Quantityish;
  /** The universal time the patch begins. */
  startUt: Quantityish;
  /** The universal time the patch ends. Not a number on a patch that never ends. */
  endUt?: Quantityish | null;
  /** The body's gravitational parameter. Absent on a patch recorded without it. */
  mu?: Quantityish | null;
}

/**
 * The fields of `trackingStation.bodies` used to find where a body's atmosphere starts.
 * A `trackingStation.bodies` payload can be passed as it is. Useful for deciding whether
 * a vessel's orbit passes through the atmosphere. Taken by
 * {@link entryInterfaceRadius}, {@link atmosphereDepthOf} and the atmospheric
 * reckoner.
 *
 * @category Reckoners
 */
export interface ConicBodiesInput {
  /** The bodies, as `trackingStation.bodies` lists them. */
  bodies: readonly {
    index: number;
    radius?: Quantityish;
    atmosphere?: { depth?: Quantityish | null } | null;
    sphereOfInfluence?: Quantityish | null;
  }[];
}

/**
 * The fields of `vessel.propulsion` that say whether the engines are firing.
 * Useful for deciding whether a vessel's path can be predicted without
 * following a burn. Taken by {@link isUnderThrust} and the powered-flight
 * reckoner.
 *
 * @category Reckoners
 */
export interface ConicThrustInput {
  /** The thrust now. */
  currentThrust: Quantityish;
  /** When the current burn began. */
  thrustStartedUt?: Quantityish | null;
  /** When the last burn ended. */
  lastThrustEndUt?: Quantityish | null;
}

/**
 * The fields of `system.uplink.pending` that say when each travelling command
 * reaches the vessel: its `dispatchedAt` plus its `oneWaySeconds`. Useful for
 * telling whether a command could change a vessel's path before the view time.
 * Taken by {@link loadedCoastEvidence} and the powered-flight reckoner.
 *
 * @category Reckoners
 */
export interface ConicPendingInput {
  /** The commands sent and not yet answered. */
  pending: readonly {
    dispatchedAt: Quantityish;
    /** Absent while the sending centre knows no route: such a command is held, and reaches nothing until it is sent. */
    oneWaySeconds?: Quantityish | null;
  }[];
}

/**
 * What {@link keplerAdmissibility} needs to carry forward the orbit of a vessel
 * the game is fully simulating: whether its engines are firing, and which
 * commands will reach it. Useful for deciding whether the operator's displayed
 * orbit stays valid while the vessel is simulated in full. Build it with
 * {@link loadedCoastEvidence}.
 *
 * @category Reckoners
 */
export interface LoadedCoastEvidence {
  /** The engines' last stated condition, `undefined` where nothing has said. */
  readonly thrust: ConicThrustInput | undefined;
  /** The commands in flight, `undefined` where the queue has not arrived. */
  readonly pending: ConicPendingInput | undefined;
}

/**
 * Returns a {@link LoadedCoastEvidence} from the `vessel.propulsion` and
 * `system.uplink.pending` readings a reckoner declared as `{ reading }`
 * dependencies. Useful for deciding whether the operator's displayed orbit
 * stays valid while the vessel is simulated in full. Used by the orbit
 * reckoner. A held reading counts: its last value is still the current one.
 *
 * @category Reckoners
 */
export function loadedCoastEvidence(
  thrust: Pick<Reading<ConicThrustInput>, "state" | "value">,
  pending: Pick<Reading<ConicPendingInput>, "state" | "value">,
): LoadedCoastEvidence {
  return {
    thrust:
      thrust.state === "observed" || thrust.state === "held"
        ? thrust.value
        : undefined,
    pending:
      pending.state === "observed" || pending.state === "held"
        ? pending.value
        : undefined,
  };
}

/**
 * Orbital elements as a payload carries them. Each angle may be a `Value` or a
 * plain number. Useful for solving a vessel's position from the elements a
 * `vessel.orbit` payload carries. Taken by {@link buildElements} and
 * {@link propagateVesselOrbit}.
 *
 * @category Reckoners
 */
export interface WireOrbitElements {
  /** Semi-major axis. */
  sma: Quantityish;
  /** Eccentricity. */
  ecc: Quantityish;
  /** Inclination. */
  inc: Quantityish;
  /** Longitude of the ascending node. Absent or `null` for an orbit with no defined node. */
  lan?: Quantityish | null;
  /** Argument of periapsis. Absent or `null` for an orbit with no defined periapsis. */
  argPe?: Quantityish | null;
  /** Mean anomaly at `epoch`. */
  meanAnomalyAtEpoch: Quantityish;
  /** The instant the elements are given for. */
  epoch: Quantityish;
  /** The body's gravitational parameter. */
  mu: Quantityish;
}

/**
 * A wire quantity as the bare number the orbit and the burn models compute on,
 * `NaN` for anything absent. Useful for feeding a payload field into the orbit
 * solver. Used by the reckoners that compute on plain numbers.
 */
export function mag(v: Quantityish): number {
  return magnitudeOr(v, Number.NaN);
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Returns {@link OrbitElements} from elements as a payload carries them,
 * converting the inclination, ascending node and argument of periapsis from
 * degrees to radians (the mean anomaly already arrives in radians). An
 * ascending node or argument of periapsis that is `null`, as on an equatorial
 * or circular orbit, becomes 0. Useful for solving a vessel's position from a
 * `vessel.orbit` payload. Used by the orbit reckoners.
 *
 * @category Reckoners
 */
export function buildElements(o: WireOrbitElements): OrbitElements {
  return {
    sma: mag(o.sma),
    ecc: mag(o.ecc),
    inc: degToRad(mag(o.inc)),
    lan: o.lan == null ? 0 : degToRad(mag(o.lan)),
    argPe: o.argPe == null ? 0 : degToRad(mag(o.argPe)),
    meanAnomalyAtEpoch: mag(o.meanAnomalyAtEpoch),
    epoch: mag(o.epoch),
    mu: mag(o.mu),
  };
}

/**
 * Returns whether an orbit with eccentricity `ecc` is open: 1 or more, as on
 * an escape or a flyby. An open orbit has no apoapsis and no period, and its
 * periapsis is passed once. Useful for choosing what to show the operator for
 * an escape or flyby orbit. Used by the powered-flight reckoner. {@link solve}
 * carries one with `ecc` above 1 along its hyperbola and throws for `ecc`
 * exactly 1.
 *
 * @category Reckoners
 */
export function isHyperbolic(ecc: number): boolean {
  return ecc >= 1;
}

/**
 * Returns the same as {@link solve}, or `null` for a parabolic orbit (`ecc`
 * exactly 1) instead of throwing. Useful for placing a vessel or a relay on its
 * orbit at a view time. Used by the comms delay and target range reckoners.
 *
 * @category Reckoners
 */
export function trySolve(
  elements: OrbitElements,
  ut: number,
): StateVector | null {
  return elements.ecc === 1 ? null : solve(elements, ut);
}

/**
 * Returns the same as {@link solveAnomalies}, or `null` for a parabolic
 * orbit (`ecc` exactly 1) instead of throwing. Useful for showing the operator
 * the vessel's anomalies at a view time. Used by the orbit reckoner. On an open
 * orbit the answer's mean motion is not a period; see {@link Anomalies}.
 *
 * @category Reckoners
 */
export function trySolveAnomalies(
  elements: OrbitElements,
  ut: number,
): Anomalies | null {
  return elements.ecc === 1 ? null : solveAnomalies(elements, ut);
}

/**
 * Returns a vessel's position and velocity relative to its parent body at
 * `ut`, from its orbital elements as a payload carries them, closed or open,
 * or `null` for a parabolic orbit (`ecc` exactly 1). Useful for showing where a
 * vessel is between samples. It is the computation used for the active vessel,
 * by the orbit reckoner.
 *
 * @category Reckoners
 */
export function propagateVesselOrbit(
  orbit: WireOrbitElements,
  ut: number,
): StateVector | null {
  return trySolve(buildElements(orbit), ut);
}

/**
 * Returns the distance from the body's centre, in metres, below which an
 * orbit model stops holding: the top of the atmosphere, or the surface of a
 * body with none. Drag at the atmosphere changes the path within minutes.
 * Useful for telling the operator where a vessel's predicted orbit ends. Used
 * by the atmospheric and powered-flight reckoners. `undefined` when the body is
 * not in `bodies`, which callers treat as no evidence either way.
 *
 * @category Reckoners
 */
export function entryInterfaceRadius(
  bodies: ConicBodiesInput | undefined,
  index: number | null | undefined,
): number | undefined {
  if (index == null || !bodies) return undefined;
  const body = bodies.bodies.find((b) => b.index === index);
  if (!body) return undefined;
  /*
   * `magnitudeOr` rather than the raw field: `trackingStation.bodies` arrives unwrapped
   * today and wrapped the moment its type shape is registered, and a floor that
   * silently became NaN would stop declining without saying so.
   */
  const radius = magnitudeOr(body.radius, Number.NaN);
  if (!Number.isFinite(radius)) return undefined;
  return radius + (atmosphereDepthOf(bodies, index) ?? 0);
}

/**
 * Returns how high the parent body's atmosphere reaches, in metres above sea
 * level, or `undefined` for a body with no atmosphere or one not in `bodies`.
 * Useful for showing the operator where the air ends. Used by the atmospheric
 * reckoner. {@link entryInterfaceRadius} is built on the same figure.
 *
 * @category Reckoners
 */
export function atmosphereDepthOf(
  bodies: ConicBodiesInput | undefined,
  index: number | null | undefined,
): number | undefined {
  if (index == null || !bodies) return undefined;
  const body = bodies.bodies.find((b) => b.index === index);
  const depth = magnitudeOr(body?.atmosphere?.depth, 0);
  return depth > 0 ? depth : undefined;
}

/**
 * Whether an unbounded reach is one a conic may be carried across, or the
 * refusal that says nobody vouched for it.
 *
 * The question is a capability's, not a mod's. `PropagationElection` runs one
 * exclusive `propagation` capability whose vanilla factory is the two-body
 * solver, because stock KSP physics genuinely is two-body; an n-body backend
 * registers a higher-priority provider only when its own probe finds the
 * physics loaded, and `HorizonFor` then stamps every element set that provider
 * publishes with `TrajectoryKind.Integrated`. So what a reckoner needs is
 * already on the wire, on a field that names no vendor and that every provider
 * can state, stock included. That is also why this reads the horizon rather
 * than a planner or a provider id: `VesselManeuver.Planner`'s doc forbids a
 * consumer special-casing an elected implementation by name, and
 * `TrajectoryKind` says "what is this like" rather than "who computed this".
 *
 * **Only `Unbounded` is asked about, and the narrowness is the whole design.**
 * An `Until` bound is not a producer admitting a limit, it is a measurement:
 * `IntegratedHorizon.UntilUt` recovers it by bisecting the integrating
 * provider's own `CanPropagate`, and its subject is "how far a two-body
 * extrapolation of an integrated trajectory stays trustworthy". A provider that
 * publishes one has vouched for a conic across exactly that window, per craft,
 * and the reach gate below already enforces it. Declining there would discard
 * the measurement and leave that machinery unused. `Unspecified`
 * reach is already refused by the same gate. So the one case left over is an
 * unbounded reach with nothing vouching for its shape, which is the failure
 * `IIntegratedTrajectorySource`'s own doc names: an integrating provider in a
 * low-perturbation regime can honestly report no limit, and a client reasoning
 * "unbounded, therefore analytic, therefore an ellipse is fine" draws a path
 * the craft will not fly.
 *
 * `null` when a conic is vouched for. An absent `horizon` is left alone: the
 * reach gate owns that case and refuses it in its own words.
 */
function trajectoryAuthority(
  horizon: PropagationHorizonLike | undefined,
): ReckoningDecline | null {
  if (horizon == null) return null;
  if (horizon.kind !== PropagationHorizonKindLike.Unbounded) return null;
  if (horizon.trajectoryKind === TrajectoryKindLike.Analytic) return null;
  if (horizon.trajectoryKind === TrajectoryKindLike.Integrated) {
    return {
      reason: "model-inapplicable",
      input: "@vessel.orbit#horizon",
      note: "the provider integrates these elements and bounded nothing, so there is no window in which they are a conic to advance",
    };
  }
  return {
    reason: "model-inapplicable",
    input: "@vessel.orbit#horizon",
    note: "no provider stated what kind of answer these elements are, so nothing vouches for carrying them forever as a conic",
  };
}

/**
 * Returns whether an orbit may be carried forward to `viewUt` by a two-body
 * model, or a {@link ReckoningDecline} naming the input that rules it out.
 * Useful for deciding whether the operator can be shown a predicted orbit for a
 * view time. Used by the orbit reckoner. It declines when:
 *
 * - the propagation provider says the orbit holds forever but is not a fixed
 *   ellipse, or does not say what it is
 * - an element is absent or not a number, or the elements describe no orbit:
 *   a negative eccentricity, a gravitational parameter of zero or below, or a
 *   semi-major axis that does not fit the eccentricity
 * - the craft is being fully simulated by the game, and `coast` does not show
 *   that its engines are cold, that the elements were taken after the last
 *   burn ended, that it is above the atmosphere, and that no command reaches
 *   it before `viewUt`
 * - `viewUt` is at or past the next change of sphere of influence
 * - `viewUt` is past the orbit's own `horizon`
 * - the orbit is outside its body's sphere of influence at `viewUt`
 * - the orbit is inside the atmosphere at `viewUt`, or under the surface of a
 *   body with none, or passed through either since the elements were taken
 * - no position can be solved at `viewUt`, as for parabolic elements
 *
 * A missing `bodies` or encounter is not a reason to decline. A burn that
 * nothing has reported, such as by a craft out of contact, cannot be seen
 * here.
 *
 * @category Reckoners
 */
export function keplerAdmissibility(
  orbitPoint: TimelinePoint<ConicOrbitInput> | undefined,
  bodies: ConicBodiesInput | undefined,
  viewUt: number,
  coast?: LoadedCoastEvidence,
): { readonly ok: true } | { readonly declined: ReckoningDecline } {
  if (orbitPoint?.payload == null) {
    return {
      declined: { reason: "input-absent", input: "@vessel.orbit" },
    };
  }
  const authority = trajectoryAuthority(orbitPoint.payload.horizon);
  if (authority !== null) return { declined: authority };
  const unsolvable = unsolvableElements(orbitPoint.payload);
  if (unsolvable !== null) return { declined: unsolvable };
  if (orbitPoint.meta.quality !== Quality.OnRails) {
    const loaded = loadedCoastDecline(
      orbitPoint,
      orbitPoint.payload,
      bodies,
      viewUt,
      coast,
    );
    if (loaded !== null) return { declined: loaded };
  }
  const orbit = orbitPoint.payload;
  const transitionUt = unlessLocked(orbit.encounter ?? null)?.transitionUt;
  if (transitionUt != null) {
    const at = mag(transitionUt);
    if (Number.isFinite(at) && viewUt >= at) {
      return {
        declined: {
          reason: "beyond-horizon",
          input: "@vessel.orbit",
          note: PATCH_END_NOTE,
        },
      };
    }
  }
  if (!canPropagate(orbit.horizon, viewUt, viewUt).propagatable) {
    return {
      declined: {
        reason: "beyond-horizon",
        input: "@vessel.orbit",
        note: "past the reach the propagation provider states for these elements",
      },
    };
  }
  const elements = buildElements(orbit);
  const solved = trySolve(elements, viewUt);
  const radius = solved == null ? Number.NaN : magnitude(solved.position);
  if (!Number.isFinite(radius)) {
    return {
      declined:
        solved == null
          ? {
              reason: "model-inapplicable",
              input: "@vessel.orbit#ecc",
              note: "parabolic elements: there is no position to carry forward",
            }
          : {
              reason: "model-inapplicable",
              input: "@vessel.orbit",
              note: "no position can be solved for these elements at that time",
            },
    };
  }
  /*
   * The encounter says when the patch ends, and it is locked until the save can
   * compute one. The body's own sphere of influence is the same boundary stated
   * as a distance, which every save has.
   */
  const reach = sphereOfInfluenceRadius(bodies, orbit.referenceBodyIndex);
  if (reach !== undefined && radius > reach) {
    return {
      declined: {
        reason: "beyond-horizon",
        input: "@trackingStation.bodies",
        note: "outside the body's sphere of influence, where another body's gravity takes over",
      },
    };
  }
  const floor = entryInterfaceRadius(bodies, orbit.referenceBodyIndex);
  if (floor !== undefined) {
    if (radius <= floor) {
      return {
        declined: {
          reason: "beyond-horizon",
          input: "@trackingStation.bodies",
          note: "below the atmosphere interface, where drag the conic does not model takes over",
        },
      };
    }
    /*
     * A conic whose periapsis is under the floor climbs back above it on the
     * far side, so where it is at `viewUt` does not say whether it went
     * through the floor on the way there.
     */
    if (
      elements.sma * (1 - elements.ecc) <= floor &&
      periapsisPassedBy(elements, orbitPoint.validAt, viewUt)
    ) {
      return {
        declined: {
          reason: "beyond-horizon",
          input: "@trackingStation.bodies",
          note: "the conic passed below the atmosphere interface or the surface before then",
        },
      };
    }
  }
  return { ok: true };
}

/** The plain name of each element {@link unsolvableElements} checks, for the note naming one that is absent. */
const ELEMENT_NAMES = {
  sma: "semi-major axis",
  ecc: "eccentricity",
  inc: "inclination",
  lan: "longitude of the ascending node",
  argPe: "argument of periapsis",
  meanAnomalyAtEpoch: "mean anomaly at epoch",
  epoch: "epoch",
  mu: "gravitational parameter",
} as const;

/** How near zero an inclination (as a sine) or an eccentricity must be for the angle it anchors to be undefined. */
const UNDEFINED_ANGLE_TOLERANCE = 1e-9;

/**
 * Whether `field` is an angle the orbit leaves undefined: the ascending node of
 * an orbit with no inclination, the argument of periapsis of one with no
 * eccentricity. Any other field is never undefined.
 */
function isUndefinedAngle(field: string, orbit: ConicOrbitInput): boolean {
  if (field === "lan") {
    return (
      Math.abs(Math.sin(degToRad(mag(orbit.inc)))) < UNDEFINED_ANGLE_TOLERANCE
    );
  }
  if (field === "argPe") {
    return Math.abs(mag(orbit.ecc)) < UNDEFINED_ANGLE_TOLERANCE;
  }
  return false;
}

/**
 * Why `orbit`'s elements place the craft nowhere, or `null` when every one is
 * a number and together they describe an orbit. An ascending node or argument
 * of periapsis that is `null` is an undefined one and reads as 0 only where the
 * orbit leaves it undefined (see {@link isUndefinedAngle}); anywhere else, and
 * for one that is present and not a number, it is absent. Parabolic elements pass, so that a burn
 * through an eccentricity of 1 still reaches the coast and powered-flight
 * checks, and are declined where their position is asked for.
 */
function unsolvableElements(orbit: ConicOrbitInput): ReckoningDecline | null {
  for (const field of Object.keys(
    ELEMENT_NAMES,
  ) as (keyof typeof ELEMENT_NAMES)[]) {
    const raw = orbit[field];
    if (raw == null && isUndefinedAngle(field, orbit)) continue;
    if (!Number.isFinite(mag(raw))) {
      return {
        reason: "input-absent",
        input: `@vessel.orbit#${field}`,
        note: `the orbit's ${ELEMENT_NAMES[field]} is absent, so there is no position to carry forward`,
      };
    }
  }
  const ecc = mag(orbit.ecc);
  const sma = mag(orbit.sma);
  if (ecc < 0) {
    return {
      reason: "model-inapplicable",
      input: "@vessel.orbit#ecc",
      note: "a negative eccentricity describes no orbit",
    };
  }
  if (!(mag(orbit.mu) > 0)) {
    return {
      reason: "model-inapplicable",
      input: "@vessel.orbit#mu",
      note: "a gravitational parameter of zero or below describes no orbit",
    };
  }
  if (sma === 0 || (ecc < 1 && sma < 0)) {
    return {
      reason: "model-inapplicable",
      input: "@vessel.orbit#sma",
      note: "the semi-major axis does not fit the eccentricity, so the elements describe no orbit",
    };
  }
  return null;
}

/** The note a decline carries when the view time is past the end of the current patch. */
const PATCH_END_NOTE = "this patch ends at the SOI transition";

/** Slack, in seconds, between a patch's `startUt` and the transition that ends the one before it. */
const PATCH_JOIN_SLACK = 1;

/**
 * The patch the craft is on once the current one has ended at `transitionUt`,
 * as an orbit of its own, or `undefined` when the chain does not carry it.
 * A patch missing its body, its gravitational parameter, its phase or the
 * orientation of its plane is not used, because none of them can be guessed.
 */
function successorOrbit(
  orbit: ConicOrbitInput,
  transitionUt: number,
  viewUt: number,
): ConicOrbitInput | undefined {
  const chain = orbit.patches ?? [];
  const at = chain.findIndex(
    (patch, i) =>
      i > 0 && Math.abs(mag(patch.startUt) - transitionUt) <= PATCH_JOIN_SLACK,
  );
  if (at < 1) return undefined;
  const patch = chain[at];
  const endUt = mag(patch.endUt);
  if (endUt <= viewUt) return undefined;
  const mu = mag(patch.mu);
  const body = patch.referenceBodyIndex;
  if (!(mu > 0) || body == null) return undefined;
  if (!Number.isFinite(mag(patch.meanAnomalyAtEpoch))) return undefined;
  if (!Number.isFinite(mag(patch.lan)) || !Number.isFinite(mag(patch.argPe))) {
    return undefined;
  }
  const followed = chain[at + 1];
  const follows =
    followed !== undefined && Number.isFinite(endUt)
      ? { transitionUt: patch.endUt as Quantityish }
      : null;
  return {
    referenceBodyIndex: body,
    sma: patch.sma,
    ecc: patch.ecc,
    inc: patch.inc,
    lan: patch.lan,
    argPe: patch.argPe,
    meanAnomalyAtEpoch: patch.meanAnomalyAtEpoch as Quantityish,
    epoch: patch.epoch,
    mu: patch.mu as Quantityish,
    encounter: follows,
    horizon: orbit.horizon,
    patches: chain.slice(at),
  };
}

/**
 * Returns whether the craft's orbit may be carried forward to `viewUt`, and the
 * orbit it is carried on: the point's own, or the next patch of its chain when
 * `viewUt` is past the sphere-of-influence change that ends the current one.
 * Useful for showing the operator the body the craft is about to be around
 * before the game's next sample arrives. The next patch is a prediction already
 * in the delivered sample, so nothing is shown that the link has not carried.
 * Used by the orbit reckoner.
 *
 * @category Reckoners
 */
export function keplerAdmissibilityAcrossPatches(
  orbitPoint: TimelinePoint<ConicOrbitInput> | undefined,
  bodies: ConicBodiesInput | undefined,
  viewUt: number,
  coast?: LoadedCoastEvidence,
):
  | {
      readonly ok: true;
      readonly orbit: ConicOrbitInput;
      readonly carried: boolean;
    }
  | { readonly declined: ReckoningDecline } {
  const own = keplerAdmissibility(orbitPoint, bodies, viewUt, coast);
  const orbit = orbitPoint?.payload;
  if (orbitPoint === undefined || orbit == null) return own as never;
  if ("ok" in own) return { ok: true, orbit, carried: false };
  const declined = own.declined;
  if (
    declined.reason !== "beyond-horizon" ||
    declined.note !== PATCH_END_NOTE
  ) {
    return own;
  }
  const transitionUt = mag(
    (unlessLocked(orbit.encounter ?? null) as { transitionUt: Quantityish })
      .transitionUt,
  );
  const next = successorOrbit(orbit, transitionUt, viewUt);
  if (next === undefined) return own;
  const onward = keplerAdmissibility(
    { ...orbitPoint, payload: next },
    bodies,
    viewUt,
    coast,
  );
  if ("declined" in onward) return onward;
  return { ok: true, orbit: next, carried: true };
}

/** The radius of a body's sphere of influence, in metres, or `undefined` when `bodies` does not state one for it. */
function sphereOfInfluenceRadius(
  bodies: ConicBodiesInput | undefined,
  index: number | null | undefined,
): number | undefined {
  if (index == null || !bodies) return undefined;
  const radius = mag(
    bodies.bodies.find((b) => b.index === index)?.sphereOfInfluence,
  );
  return radius > 0 ? radius : undefined;
}

/**
 * Whether the orbit passes periapsis after `fromUt` and at or before `toUt`.
 * A closed orbit does so once a period; an open one does so once, and only
 * while it is still inbound at `fromUt`. `false` for a parabolic orbit, which
 * has no anomaly to time it by.
 */
function periapsisPassedBy(
  elements: OrbitElements,
  fromUt: number,
  toUt: number,
): boolean {
  const from = trySolveAnomalies(elements, fromUt);
  if (from === null || !(from.meanMotion > 0)) return false;
  if (isHyperbolic(elements.ecc)) {
    return (
      from.meanAnomaly < 0 &&
      fromUt - from.meanAnomaly / from.meanMotion <= toUt
    );
  }
  return fromUt + (2 * Math.PI - from.meanAnomaly) / from.meanMotion <= toUt;
}

/**
 * Why a loaded craft's elements are not a coast to carry to `viewUt`, or `null`
 * when they are.
 *
 * Under physics KSP rebuilds the elements from the integrated state every
 * frame, so in vacuum with the engines cold they are the two-body orbit the
 * craft is on and a conic advances them as well as it advances a craft on
 * rails. What it takes is positive evidence of each half of that, which is the
 * opposite posture to the atmosphere floor's: a loaded craft is the one most
 * likely to be in air or under thrust, so a missing fact is a refusal here, not
 * a pass.
 *
 * - **the engines are cold.** `vessel.propulsion` states no thrust and no
 *   period of thrust in progress
 * - **the elements post-date the burn.** A burn that ended after these
 *   elements were taken left them describing an orbit the craft has since
 *   left
 * - **the craft is clear of the air.** Drag acts from the interface down, so
 *   the craft must be above it at the elements' own epoch. Where it will be at
 *   `viewUt` is the floor condition's question, asked after this one
 * - **no command reaches it first.** A command arriving between the elements
 *   and `viewUt` can change the throttle, the attitude or the stage, and none
 *   of that is modelled. One already arrived by the elements' epoch has had its
 *   effect observed
 *
 * Every refusal is `"under-physics"`: the orbit exists, the craft is loaded,
 * and what is withheld is carrying it forward. That keeps the one thing a
 * consumer does with the reason, solving a current reading at its own epoch,
 * true of all of them.
 */
function loadedCoastDecline(
  point: TimelinePoint<unknown>,
  orbit: ConicOrbitInput,
  bodies: ConicBodiesInput | undefined,
  viewUt: number,
  coast: LoadedCoastEvidence | undefined,
): ReckoningDecline | null {
  const thrust = coast?.thrust;
  if (thrust === undefined) {
    return underPhysics(
      "@vessel.propulsion",
      "the craft is under physics and nothing says whether its engines are firing",
    );
  }
  if (isUnderThrust(thrust)) {
    return underPhysics(
      "@vessel.propulsion",
      "the craft is under thrust, so its elements are not a coast a conic can advance",
    );
  }
  const burnEnded = thrust.lastThrustEndUt;
  if (burnEnded != null && mag(burnEnded) > point.validAt) {
    return underPhysics(
      "@vessel.propulsion",
      "these elements were taken before the last burn ended",
    );
  }
  return loadedRegimeDecline(point, orbit, bodies, viewUt, coast?.pending);
}

/**
 * Returns whether `vessel.propulsion` shows the engines firing, now or in a
 * burn still in progress. A thrust figure that is not a number counts as
 * firing. Useful for deciding whether a vessel's path can be carried forward
 * without following a burn. Used by the orbit reckoner.
 *
 * @category Reckoners
 */
export function isUnderThrust(thrust: ConicThrustInput): boolean {
  return !(mag(thrust.currentThrust) === 0) || thrust.thrustStartedUt != null;
}

/**
 * Returns a decline for a vessel the game is fully simulating when either of
 * two conditions fails, or `null` when both hold: the vessel is above the
 * atmosphere when its elements were taken, and no command reaches it between
 * then and `viewUt`. A command arriving in that interval can change the
 * throttle, the attitude or the stage, which no model follows. Useful for
 * deciding whether the operator's displayed orbit stays valid. Used by the
 * powered-flight reckoner.
 *
 * @category Reckoners
 */
export function loadedRegimeDecline(
  point: TimelinePoint<unknown>,
  orbit: ConicOrbitInput,
  bodies: ConicBodiesInput | undefined,
  viewUt: number,
  pending: ConicPendingInput | undefined,
): ReckoningDecline | null {
  const floor = entryInterfaceRadius(bodies, orbit.referenceBodyIndex);
  if (floor === undefined) {
    return underPhysics(
      "@trackingStation.bodies",
      "the craft is under physics and nothing places the air it might be in",
    );
  }
  const now = trySolve(buildElements(orbit), mag(orbit.epoch));
  if (now === null) {
    return underPhysics(
      "@vessel.orbit",
      "parabolic elements: there is no position to show the craft clear of the air",
    );
  }
  if (!(magnitude(now.position) > floor)) {
    return underPhysics(
      "@trackingStation.bodies",
      "the craft is inside the atmosphere, where drag the conic does not model acts on it",
    );
  }
  const reaches = (pending?.pending ?? []).some((command) => {
    if (command.oneWaySeconds == null) return false;
    const arrival = mag(command.dispatchedAt) + mag(command.oneWaySeconds);
    return arrival > point.validAt && arrival <= viewUt;
  });
  if (reaches) {
    return underPhysics(
      "@system.uplink.pending",
      "a command reaches the craft before then, and what it does there is not modelled",
    );
  }
  return null;
}

/**
 * Returns a {@link ReckoningDecline} with reason `"under-physics"`, naming
 * `input` and with `note` for the operator: the vessel is being fully
 * simulated, so its motion is not carried forward. Its current orbit can still
 * be solved at its own epoch. Useful for telling the operator why a prediction
 * is withdrawn. Used by the powered-flight reckoner.
 *
 * @category Reckoners
 */
export function underPhysics(input: string, note: string): ReckoningDecline {
  return { reason: "under-physics", input, note };
}

/**
 * The length of a bare three-component vector. Useful for turning a position or
 * velocity vector into a distance or a speed. Used by the comms delay
 * reckoner.
 */
export function magnitude(v: Vec3Tuple): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * Returns `position` moved at `velocity` for `dt` seconds, all as plain
 * numbers: the whole of the `linear-dead-reckoning` model. Useful for placing a
 * vessel between samples when no orbit applies. Used by the core reckoners.
 *
 * @category Reckoners
 */
export function advanceByVelocity(
  position: readonly [number, number, number],
  velocity: readonly [number, number, number],
  dt: number,
): [number, number, number] {
  return [
    position[0] + velocity[0] * dt,
    position[1] + velocity[1] * dt,
    position[2] + velocity[2] * dt,
  ];
}
