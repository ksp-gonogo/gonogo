/*
 * Published so a contributor to a velocity-height plot uses the same integrator as the host:
 * two independent integrators would put two answers on one plot.
 */

/**
 * A projected descent to the ground, as {@link projectDescent} returns it, in
 * the axes of a velocity-height plot.
 *
 * @category Orbits and trajectories
 */
export interface DescentProjection {
  /** Speed in m/s and height above the ground in metres, from the craft's current state to the ground. */
  points: readonly { speed: number; altitude: number }[];
  /**
   * The height in metres at which the descent reaches terminal velocity, or
   * `null` when it does not before the ground, or was already there at the
   * start.
   */
  settleAltitude: number | null;
  /** The speed at the ground, in m/s. */
  touchdownSpeed: number;
}

/**
 * How many height steps {@link projectDescent} uses unless told otherwise.
 *
 * @category Orbits and trajectories
 */
export const DESCENT_TRACE_STEPS = 48;

/**
 * How close to terminal velocity, as a fraction of it, a descent must come to
 * count as having reached it.
 *
 * @category Orbits and trajectories
 */
export const DESCENT_SETTLE_TOLERANCE = 0.12;

/**
 * The starting state and atmosphere for {@link projectDescent}.
 *
 * @category Orbits and trajectories
 */
export interface ProjectDescentOptions {
  /** The craft's speed now, in m/s. */
  startSpeed: number;
  /** The craft's height above the ground now, in metres. */
  startAltitude: number;
  /** The body's surface gravity, in m/s². */
  surfaceGravity: number;
  /** Terminal velocity in m/s at a height in metres, such as from {@link terminalVelocityCurve}. */
  terminalVelocityAt: (altitudeM: number) => number;
  /** How many height steps to use. Defaults to {@link DESCENT_TRACE_STEPS}. */
  steps?: number;
}

/**
 * Returns the descent from the craft's current speed and height down to the
 * ground, under gravity and drag, with drag given as terminal velocity by
 * height. It stays accurate however far above terminal velocity the craft
 * starts.
 *
 * Not a reckoner: it projects something that has not happened, so it
 * carries no state or forward model of its own.
 *
 * @category Orbits and trajectories
 */
// Each step solves du/dh = -2g(1 - u/v_t²), with u = v², exactly for constant v_t: a forward Euler step is unstable high in an entry.
export function projectDescent(
  opts: Readonly<ProjectDescentOptions>,
): DescentProjection {
  const { startSpeed, startAltitude, surfaceGravity } = opts;
  const steps = opts.steps ?? DESCENT_TRACE_STEPS;
  const dh = -startAltitude / steps;
  const points: { speed: number; altitude: number }[] = [
    { speed: startSpeed, altitude: startAltitude },
  ];
  let u = startSpeed * startSpeed;
  let settleAltitude: number | null = null;
  // A vessel already riding the curve has nothing to settle onto; a tick at its own altitude would be a mark pointing at the mark beside it.
  const vtStart = opts.terminalVelocityAt(startAltitude);
  const startedSettled =
    vtStart > 0 &&
    Math.abs(startSpeed - vtStart) / vtStart <= DESCENT_SETTLE_TOLERANCE;
  for (let i = 0; i < steps; i++) {
    const alt = startAltitude + dh * i;
    const vt = opts.terminalVelocityAt(alt);
    if (vt > 0 && Number.isFinite(vt)) {
      const vtSq = vt * vt;
      u = vtSq + (u - vtSq) * Math.exp((2 * surfaceGravity * dh) / vtSq);
    }
    const nextAlt = Math.max(0, startAltitude + dh * (i + 1));
    const speed = Math.sqrt(Math.max(0, u));
    points.push({ speed, altitude: nextAlt });
    const vtHere = opts.terminalVelocityAt(nextAlt);
    if (
      settleAltitude === null &&
      vtHere > 0 &&
      Math.abs(speed - vtHere) / vtHere <= DESCENT_SETTLE_TOLERANCE
    ) {
      settleAltitude = nextAlt;
    }
  }
  return {
    points,
    settleAltitude: startedSettled ? null : settleAltitude,
    touchdownSpeed: points[points.length - 1].speed,
  };
}

/**
 * Returns terminal velocity as a function of height, through two known points:
 * `groundSpeed` at the ground and `speedNow` at `altitudeNow`. It assumes air
 * density falls exponentially with height, which makes the curve exponential
 * too. `vessel.landing` and `vessel.flight` carry the values it needs.
 *
 * @category Orbits and trajectories
 */
export function terminalVelocityCurve(opts: {
  speedNow: number;
  altitudeNow: number;
  groundSpeed: number;
}): (altitudeM: number) => number {
  const { speedNow, altitudeNow, groundSpeed } = opts;
  if (!(groundSpeed > 0) || !(altitudeNow > 0)) return () => groundSpeed;
  const ratio = speedNow / groundSpeed;
  return (altitudeM) => groundSpeed * ratio ** (altitudeM / altitudeNow);
}

/**
 * Returns air density as a fraction of the density at the ground, as a
 * function of height, from the same model as {@link terminalVelocityCurve}, so
 * the two drawn on one plot agree. It is 1 at the ground and falls with height.
 *
 * @category Orbits and trajectories
 */
export function relativeDensityCurve(opts: {
  speedNow: number;
  altitudeNow: number;
  groundSpeed: number;
}): (altitudeM: number) => number {
  const terminal = terminalVelocityCurve(opts);
  const ground = opts.groundSpeed;
  return (altitudeM) => {
    const vt = terminal(altitudeM);
    return vt > 0 ? Math.min(1, (ground / vt) ** 2) : 0;
  };
}
