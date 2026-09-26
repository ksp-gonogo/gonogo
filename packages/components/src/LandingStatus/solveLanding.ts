/**
 * The full-vector suicide-burn solve, client-side from `vessel.flight`, `vessel.propulsion`, `vessel.orbit` and `system.bodies`.
 *
 * The burn must null the whole velocity VECTOR: a vacuum landing is mostly a horizontal problem, and a vertical-only solve under-states the burn by orders of magnitude, firing too late. The model decelerates the full surface speed over the terrain height at `aNet = aMax - g`; it has no drag, so the widget suppresses it on atmospheric bodies.
 *
 * With the active engine's exhaust velocity and burnout mass it is a rocket-equation burn whose deceleration rises as mass falls, capped at the stage's fuel, so NO LANDING VECTOR means no achievable burn lands safely. Without them it falls back to `constantDecelBurn`.
 */

export type LandingSolutionState =
  | "not-descending"
  | "vacuum-solved"
  | "no-solution";

export interface SuicideBurnInputs {
  /** Height of the vessel's LOWEST point above terrain, metres (the burn datum). */
  heightFromTerrain: number | undefined;
  /** Altitude above sea level, metres: used only to evaluate local gravity. */
  altitudeAsl: number | undefined;
  /** Vertical speed, m/s; NEGATIVE while descending (KSP sign convention). */
  verticalSpeed: number | undefined;
  /** Surface speed magnitude (full velocity vector), m/s. */
  surfaceSpeed: number | undefined;
  /** Parent body standard gravitational parameter GM, m^3/s^2 (`vessel.orbit.mu`). */
  mu: number | undefined;
  /** Parent body mean radius, metres. */
  bodyRadius: number | undefined;
  /** Available thrust, kN (`vessel.propulsion.availableThrust`). */
  availableThrust: number | undefined;
  /** Total (wet) vessel mass, tonnes (`vessel.propulsion.totalMass`). */
  totalMass: number | undefined;
  /** Effective exhaust velocity ve = Isp * g0, m/s, of the ACTIVE engines (not a whole-vessel average); with `burnoutMass` it enables the rocket-equation model. */
  exhaustVelocity?: number | undefined;
  /** Vessel mass, tonnes, when the active stage's fuel runs out; fuel available now is `totalMass - burnoutMass`. */
  burnoutMass?: number | undefined;
}

export interface LandingSolution {
  state: LandingSolutionState;
  /** Local gravitational acceleration at the current radius, m/s^2. */
  gravity: number | null;
  /** Descent rate (downward-positive), m/s. */
  verticalSpeed: number | null;
  /** Horizontal component of the surface velocity, m/s, the tip-over axis. */
  horizontalSpeed: number | null;
  /** Ballistic (no-burn) time to terrain impact, seconds. */
  timeToImpact: number | null;
  /** Impact speed if nothing is done, full surface speed plus the drop's energy, m/s. */
  speedAtImpact: number | null;
  /** Best achievable touchdown speed if the burn starts NOW, m/s (0 when it fits). */
  bestSpeedAtImpact: number | null;
  /** Propellant dV the full-vector burn consumes (includes gravity loss), m/s. */
  burnDeltaV: number | null;
  /** Burn duration to null the surface-speed vector, seconds. */
  burnDuration: number | null;
  /** Terrain height (AGL) at which the burn must begin; a vessel at or below it is past the ignition point. */
  ignitionAltitude: number | null;
  /** Seconds until the latest ignition; 0 when at or past the ignition point. */
  suicideBurnCountdown: number | null;
  /** Max achievable deceleration from thrust, m/s^2 (`availableThrust/totalMass`). */
  maxAccel: number | null;
}

function finiteOrNull(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

function base(state: LandingSolutionState): LandingSolution {
  return {
    state,
    gravity: null,
    verticalSpeed: null,
    horizontalSpeed: null,
    timeToImpact: null,
    speedAtImpact: null,
    bestSpeedAtImpact: null,
    burnDeltaV: null,
    burnDuration: null,
    ignitionAltitude: null,
    suicideBurnCountdown: null,
    maxAccel: null,
  };
}

/** `availableThrust/totalMass` (kN/t = m/s^2), guarded: the max deceleration. */
function deriveMaxAccel(
  availableThrust: number | undefined,
  totalMass: number | undefined,
): number | null {
  if (availableThrust === undefined || totalMass === undefined) return null;
  if (!(totalMass > 0)) return null;
  return finiteOrNull(availableThrust / totalMass);
}

/** Outputs both engine models share: `stopDistance` is the along-vector distance an optimal burn from now needs, the datum for ignition; `bestSpeedAtImpact` is 0 when the burn fits. */
interface BurnResult {
  stopDistance: number;
  bestSpeedAtImpact: number;
  burnDuration: number;
  burnDeltaV: number;
}

/** Constant-deceleration fallback at the current mass, `aNet = aMax - g`: over-states the stopping distance, erring safe. */
function constantDecelBurn(
  surf: number,
  h: number,
  g: number,
  aMax: number,
): BurnResult {
  const aNet = aMax - g;
  const stopDistance = (surf * surf) / (2 * aNet);
  const bestSpeedAtImpact =
    stopDistance <= h ? 0 : Math.sqrt(Math.max(0, surf * surf - 2 * aNet * h));
  const burnDuration = surf / aNet;
  return {
    stopDistance,
    bestSpeedAtImpact,
    burnDuration,
    burnDeltaV: aMax * burnDuration,
  };
}

/** Bisection root of a monotonic `f` on `[lo, hi]`; 60 iterations are ample for a full-range bracket. */
function bisect(f: (t: number) => number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    if (f(a) * f(m) <= 0) b = m;
    else a = m;
  }
  return (a + b) / 2;
}

/**
 * The rocket-equation suicide burn: constant thrust `F` with mass falling from `m0` to `mdry`, so deceleration rises through the burn.
 *
 * With mass flow mdot = F / ve, the along-vector speed is
 *   s(t) = surf + g*t + ve*ln(1 - t/tau),   tau = m0 / mdot
 * s falls strictly while TWR > 1, so the null time is a bisection root and the distance is s's closed-form integral. The burn is capped at t_fuel = (m0 - mdry) / mdot; failing to null within that or the remaining height is a genuine NO LANDING VECTOR.
 */
function rocketEquationBurn(
  surf: number,
  h: number,
  g: number,
  thrust: number,
  m0: number,
  mdry: number,
  ve: number,
): BurnResult {
  const mdot = thrust / ve; // t/s
  const tau = m0 / mdot; // s to burn ALL mass (hypothetical)
  const tFuel = (m0 - mdry) / mdot; // s to burn just the fuel

  const speed = (t: number) => surf + g * t + ve * Math.log(1 - t / tau);
  const dist = (t: number) => {
    const u = 1 - t / tau;
    // Integral of ve*ln(1 - t'/tau) from 0 to t is -ve*tau*(u*ln u - u + 1), with u*ln u going to 0 as u does.
    const uLnU = u <= 0 ? 0 : u * Math.log(u);
    return surf * t + 0.5 * g * t * t - ve * tau * (uLnU - u + 1);
  };

  // The ideal null time always exists in (0, tau): s(0) = surf > 0 and s falls without bound as t nears tau.
  const tStopIdeal = bisect(speed, 0, tau * (1 - 1e-12));
  const stopDistance = dist(tStopIdeal);
  const burnDeltaV = surf + g * tStopIdeal;

  // The powered phase ends at whichever comes first: the vessel stops, or the tank runs dry. `bestSpeedAtImpact` is the speed once it reaches terrain.
  const tPowerEnd = Math.min(tStopIdeal, tFuel);
  const distPowerEnd = dist(tPowerEnd);
  let bestSpeedAtImpact: number;
  if (distPowerEnd >= h) {
    // Hits terrain while still under power: the residual at the ground.
    const tGround = bisect((t) => dist(t) - h, 0, tPowerEnd);
    bestSpeedAtImpact = Math.max(0, speed(tGround));
  } else if (tStopIdeal <= tFuel) {
    // Stopped above terrain with fuel to spare: a safe touchdown.
    bestSpeedAtImpact = 0;
  } else {
    // Fuel exhausted above terrain, still moving: free-fall the rest.
    const vOut = Math.max(0, speed(tFuel));
    bestSpeedAtImpact = Math.sqrt(vOut * vOut + 2 * g * (h - distPowerEnd));
  }

  return {
    stopDistance,
    bestSpeedAtImpact,
    burnDuration: tStopIdeal,
    burnDeltaV,
  };
}

export function solveSuicideBurn(inp: SuicideBurnInputs): LandingSolution {
  const h = inp.heightFromTerrain;
  const vDown =
    inp.verticalSpeed === undefined ? undefined : -inp.verticalSpeed;

  // Only meaningful while descending toward terrain still below the vessel.
  if (h === undefined || vDown === undefined || !(h > 0) || !(vDown > 0)) {
    return base("not-descending");
  }

  const { bodyRadius, mu, altitudeAsl } = inp;
  if (
    bodyRadius === undefined ||
    mu === undefined ||
    altitudeAsl === undefined
  ) {
    return base("no-solution");
  }
  const r = bodyRadius + altitudeAsl;
  const g = mu / (r * r);
  if (!(g > 0) || !Number.isFinite(g)) return base("no-solution");

  // The full vector's magnitude, guarded so a surface speed below its vertical component never gives a negative horizontal.
  const surf =
    inp.surfaceSpeed !== undefined && inp.surfaceSpeed > vDown
      ? inp.surfaceSpeed
      : vDown;
  const horizontal = finiteOrNull(
    Math.sqrt(Math.max(0, surf * surf - vDown * vDown)),
  );

  // Ballistic no-burn fall to terrain: positive root of 1/2 g t^2 + vDown t - h = 0.
  const timeToImpact = finiteOrNull(
    (-vDown + Math.sqrt(vDown * vDown + 2 * g * h)) / g,
  );
  // No-burn impact speed: full surface speed plus the drop's added energy.
  const speedAtImpact = finiteOrNull(Math.sqrt(surf * surf + 2 * g * h));

  const aMax = deriveMaxAccel(inp.availableThrust, inp.totalMass);

  const solved: LandingSolution = {
    state: "vacuum-solved",
    gravity: finiteOrNull(g),
    verticalSpeed: finiteOrNull(vDown),
    horizontalSpeed: horizontal,
    timeToImpact,
    speedAtImpact,
    bestSpeedAtImpact: null,
    burnDeltaV: null,
    burnDuration: null,
    ignitionAltitude: null,
    suicideBurnCountdown: null,
    maxAccel: aMax,
  };

  // A suicide burn needs thrust to beat gravity (TWR > 1).
  if (aMax === null || !(aMax > g)) return solved;

  // The rocket-equation model needs the active engine's ve and burnout mass; without either it falls back to constant deceleration.
  const { exhaustVelocity, burnoutMass, totalMass, availableThrust } = inp;
  const canRocketSolve =
    exhaustVelocity !== undefined &&
    burnoutMass !== undefined &&
    totalMass !== undefined &&
    availableThrust !== undefined &&
    exhaustVelocity > 0 &&
    burnoutMass > 0 &&
    totalMass > burnoutMass;
  const burn = canRocketSolve
    ? rocketEquationBurn(
        surf,
        h,
        g,
        availableThrust as number,
        totalMass as number,
        burnoutMass as number,
        exhaustVelocity as number,
      )
    : constantDecelBurn(surf, h, g, aMax);

  // The burn must begin `stopDistance` above terrain; the countdown is the ballistic fall down to that height, 0 ("IGNITE") at or below it.
  const ignitionAltitude = burn.stopDistance;
  const coast = h - burn.stopDistance;
  const suicideBurnCountdown =
    coast <= 0
      ? 0
      : finiteOrNull((-vDown + Math.sqrt(vDown * vDown + 2 * g * coast)) / g);

  return {
    ...solved,
    bestSpeedAtImpact: finiteOrNull(burn.bestSpeedAtImpact),
    burnDeltaV: finiteOrNull(burn.burnDeltaV),
    burnDuration: finiteOrNull(burn.burnDuration),
    ignitionAltitude: finiteOrNull(ignitionAltitude),
    suicideBurnCountdown,
  };
}
