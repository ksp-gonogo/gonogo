/**
 * Atmospheric descent against a terminal-velocity model.
 *
 * Published rather than kept in the widget that first needed it, because it is
 * the one thing a contributor to a velocity-height plot cannot reconstruct from
 * the wire: every other input it wants is already carried (`vessel.landing`
 * has both terminal anchors, `vessel.flight` the speed and height,
 * `system.bodies` the surface gravity), but a second, independently written
 * integrator would put two answers on one plot and blame the physics for the
 * disagreement.
 */

/** One integrated descent, in a velocity-height plot's own axes. */
export interface DescentProjection {
  /** Sampled (speed, height-above-ground) pairs, vessel first, ground last. */
  points: readonly { speed: number; altitude: number }[];
  /**
   * Height the descent settles onto the terminal curve at, when it does so
   * before the ground. Null means it never settles, which is the honest read of
   * an entry that is still slowing when it arrives.
   */
  settleAltitude: number | null;
  /** Speed the projection reaches the ground at. */
  touchdownSpeed: number;
}

/** How many altitude steps the descent is integrated in by default. The
 *  per-step solution is exact for a constant terminal velocity, so this only
 *  has to be fine enough that the curve's own shape is followed. */
export const DESCENT_TRACE_STEPS = 48;

/** Within this fraction of the terminal curve the descent has settled: drag and
 *  weight are in balance to the eye and the remaining fall is the curve. */
export const DESCENT_SETTLE_TOLERANCE = 0.12;

export interface ProjectDescentOptions {
  startSpeed: number;
  startAltitude: number;
  surfaceGravity: number;
  terminalVelocityAt: (altitudeM: number) => number;
  steps?: number;
}

/**
 * Integrate a descent from a starting speed down to the ground.
 *
 * The step is the exact solution of the equation rather than an Euler step, and
 * that is what makes it usable: writing the motion in terms of u = v² turns
 * `dv/dh = -g(1 - (v/v_t)²)/v` into `du/dh = -2g(1 - u/v_t²)`, which is linear,
 * so over a step with v_t held constant `u' = v_t² + (u - v_t²)·e^(2g·Δh/v_t²)`.
 * A plain forward step is violently unstable at the top of an entry, where the
 * vessel is many times terminal velocity and the derivative is enormous; this
 * form relaxes toward the curve however large the step or the excess is, which
 * is also the physical behaviour.
 */
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
  // A vessel already riding the curve has nothing to settle onto; a tick at its
  // own altitude would be a mark pointing at the mark beside it.
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
 * The terminal-velocity curve a velocity-height plot draws, from the two
 * anchors the wire already carries.
 *
 * `v_t ∝ 1/√ρ` and `ρ ∝ e^(−alt/H)`, so terminal velocity is log-linear in
 * altitude: the curve through `groundSpeed` at zero and `speedNow` at
 * `altitudeNow` IS the exponential-atmosphere shape, exactly, with no third
 * anchor and no extra wire data.
 *
 * Published alongside the integrator for the same reason: a contributor that
 * re-derives the density column from its own assumptions draws a curve that
 * disagrees with the host's for reasons no operator can see.
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
 * Air density relative to the ground, from the SAME model as
 * {@link terminalVelocityCurve}, so a haze and a curve drawn from one plot's
 * anchors can never disagree. 1 at the surface, decaying with altitude.
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
