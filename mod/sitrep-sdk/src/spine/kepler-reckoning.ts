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
 * The conic, in ONE place, for every path that reaches it.
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
 * `vessel.orbit` payload can be passed as it is.
 *
 * @category Reckoners
 */
export interface ConicOrbitInput {
  /** Index into `system.bodies` of the body the orbit is around. */
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
}

/**
 * The fields of `system.bodies` used to find where a body's atmosphere starts.
 * A `system.bodies` payload can be passed as it is.
 *
 * @category Reckoners
 */
export interface ConicBodiesInput {
  /** The bodies, as `system.bodies` lists them. */
  bodies: readonly {
    index: number;
    radius?: Quantityish;
    atmosphere?: { depth?: Quantityish | null } | null;
    sphereOfInfluence?: Quantityish | null;
  }[];
}

/**
 * The fields of `vessel.propulsion` that say whether the engines are firing.
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
 * reaches the craft: its `dispatchedAt` plus its `oneWaySeconds`.
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
 * What {@link keplerAdmissibility} needs to carry forward the orbit of a craft
 * the game is fully simulating: whether its engines are firing, and which
 * commands will reach it. Build it with {@link loadedCoastEvidence}.
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
 * dependencies. A held reading counts: its last value is still the current
 * one.
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
 * Orbital elements as a payload carries them, which {@link buildElements}
 * takes. Each angle may be a `Value` or a plain number.
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
 * A wire quantity as the bare number the conic and the burn compute on, `NaN`
 * for anything absent. The one place either model leaves the unit algebra:
 * Kepler's equation and a Runge-Kutta step are arithmetic on plain numbers,
 * and every input crosses into them here.
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
 * or circular orbit, becomes 0.
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
 * Returns whether an orbit with eccentricity `ecc` is not elliptical: 1 or
 * more, as on an escape or a flyby. {@link solve} throws for such an orbit;
 * {@link trySolve} returns `null`.
 *
 * @category Reckoners
 */
export function isHyperbolic(ecc: number): boolean {
  return ecc >= 1;
}

/**
 * Returns the same as {@link solve}, or `null` for an orbit that is not
 * elliptical instead of throwing.
 *
 * @category Reckoners
 */
export function trySolve(
  elements: OrbitElements,
  ut: number,
): StateVector | null {
  return isHyperbolic(elements.ecc) ? null : solve(elements, ut);
}

/**
 * Returns the same as {@link solveAnomalies}, or `null` for an orbit that is
 * not elliptical instead of throwing.
 *
 * @category Reckoners
 */
export function trySolveAnomalies(
  elements: OrbitElements,
  ut: number,
): Anomalies | null {
  return isHyperbolic(elements.ecc) ? null : solveAnomalies(elements, ut);
}

/**
 * Returns a craft's position and velocity relative to its parent body at
 * `ut`, from its orbital elements as a payload carries them, or `null` for an
 * orbit that is not elliptical. The same computation Gonogo uses for the
 * active craft.
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
 * `undefined` when the body is not in `bodies`, which callers treat as no
 * evidence either way.
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
   * `magnitudeOr` rather than the raw field: `system.bodies` arrives unwrapped
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
 * {@link entryInterfaceRadius} is built on the same figure, so the two never
 * disagree about where the air ends.
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
 * Whether an UNBOUNDED reach is one a conic may be carried across, or the
 * refusal that says nobody vouched for it.
 *
 * The question is a CAPABILITY's, not a mod's. `PropagationElection` runs one
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
 * An `Until` bound is not a producer admitting a limit, it is a MEASUREMENT:
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
 * model, or a {@link ReckoningDecline} naming the input that rules it out. It
 * declines when:
 *
 * - the propagation provider says the orbit holds forever but is not a fixed
 *   ellipse, or does not say what it is
 * - the craft is being fully simulated by the game, and `coast` does not show
 *   that its engines are cold, that the elements were taken after the last
 *   burn ended, that it is above the atmosphere, and that no command reaches
 *   it before `viewUt`
 * - `viewUt` is at or past the next change of sphere of influence
 * - `viewUt` is past the orbit's own `horizon`
 * - the orbit reaches into the atmosphere by `viewUt`
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
          note: "this patch ends at the SOI transition",
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
  const floor = entryInterfaceRadius(bodies, orbit.referenceBodyIndex);
  if (floor !== undefined) {
    const solved = trySolve(buildElements(orbit), viewUt);
    const radius = solved == null ? Number.NaN : magnitude(solved.position);
    if (Number.isFinite(radius) && radius <= floor) {
      return {
        declined: {
          reason: "beyond-horizon",
          input: "@system.bodies",
          note: "below the atmosphere interface, where drag the conic does not model takes over",
        },
      };
    }
  }
  return { ok: true };
}

/**
 * Why a loaded craft's elements are not a coast to carry to `viewUt`, or `null`
 * when they are.
 *
 * Under physics KSP rebuilds the elements from the integrated state every
 * frame, so in vacuum with the engines cold they ARE the two-body orbit the
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
 * firing.
 *
 * @category Reckoners
 */
export function isUnderThrust(thrust: ConicThrustInput): boolean {
  return !(mag(thrust.currentThrust) === 0) || thrust.thrustStartedUt != null;
}

/**
 * Returns a decline for a craft the game is fully simulating when either of
 * two conditions fails, or `null` when both hold: the craft is above the
 * atmosphere when its elements were taken, and no command reaches it between
 * then and `viewUt`. A command arriving in that gap can change the throttle,
 * the attitude or the stage, which no model follows.
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
      "@system.bodies",
      "the craft is under physics and nothing places the air it might be in",
    );
  }
  const now = trySolve(buildElements(orbit), mag(orbit.epoch));
  if (now === null) {
    return underPhysics(
      "@vessel.orbit",
      "hyperbolic elements: there is no position to show the craft clear of the air",
    );
  }
  if (!(magnitude(now.position) > floor)) {
    return underPhysics(
      "@system.bodies",
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
 * `input` and with `note` for the operator: the craft is being fully simulated,
 * so its motion is not carried forward. Its current orbit can still be solved
 * at its own epoch.
 *
 * @category Reckoners
 */
export function underPhysics(input: string, note: string): ReckoningDecline {
  return { reason: "under-physics", input, note };
}

/** The length of a bare three-component vector. */
export function magnitude(v: Vec3Tuple): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * Returns `position` moved at `velocity` for `dt` seconds, all as plain
 * numbers: the whole of the `linear-dead-reckoning` model.
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
