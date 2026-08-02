/**
 * The full-vector suicide-burn solve: the correctness core of the rebooted
 * landing widget. Client-side only; every input is already on the wire
 * (`vessel.flight`, `vessel.propulsion`, `vessel.orbit`, `system.bodies`).
 *
 * WHY THIS EXISTS. The predecessor (`vessel-state.ts:deriveLanding`) solves a
 * purely-VERTICAL burn: it kills `vDown` alone and ignores the horizontal
 * velocity a craft arrives with from orbit. On a standard low-Mun descent that
 * under-states the burn by ~2 orders of magnitude and reports "burn now ->
 * touchdown at 0 m/s" while the craft still carries ~540 m/s horizontally,
 * wrong in the fatal (fires-too-late) direction. A vacuum landing is
 * overwhelmingly a HORIZONTAL problem: the burn's job is to null the whole
 * velocity VECTOR, so the stopping distance and the ignition point must be
 * computed from the full surface speed, not its vertical component.
 *
 * The model here treats the suicide burn as a 1-D deceleration of the full
 * surface-speed magnitude `vSurf` over the available terrain height `h`, at net
 * deceleration `aNet = aMax - g`. This matches the spec's worked Appendix-A
 * numbers and, unlike the vertical-only model, correctly reports the burn as
 * unsurvivable / already-committed when horizontal velocity dominates. It is
 * still a vacuum model with no drag, so the widget suppresses it on atmospheric
 * bodies rather than emit a confidently wrong number.
 *
 * ENGINE MODEL. Given the vessel's actual fuel, thrust and specific impulse,
 * the solve is a real rocket-equation burn: as fuel burns the mass falls, so
 * the deceleration RISES through the burn (constant thrust, shrinking mass).
 * That makes the stopping distance SHORTER than a naive constant-`aMax`
 * estimate, and it caps the burn at the active stage's fuel, so a NO LANDING
 * VECTOR verdict means there is genuinely no achievable burn path that lands
 * safely, not a fixed-decel artefact. The exhaust velocity `ve` is the ACTIVE
 * engine's (derived caller-side from `dv.stages[currentStage]`'s ΔV + mass
 * ratio, atmosphere-adjusted), NOT a whole-vessel multi-stage average, and the
 * burn floor is the active stage's burnout mass. When those inputs
 * (`exhaustVelocity`, `burnoutMass`) are absent the solve falls back to a
 * constant-deceleration estimate at the current mass (see `constantDecelBurn`).
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
  /** Effective exhaust velocity ve = Isp·g0, m/s, of the ACTIVE ENGINE(S) doing
   * the landing burn, derived caller-side from the active stage's ΔV and mass
   * ratio (`dv.stages[currentStage]`), atmosphere-adjusted (the "actual"
   * variant). With `burnoutMass` this unlocks the rocket-equation burn model;
   * absent, the solve falls back to constant-deceleration at the current mass.
   * (Must be the ACTIVE stage, not a whole-vessel multi-stage average.) */
  exhaustVelocity?: number | undefined;
  /** Vessel mass, tonnes, at the moment the active stage's fuel is exhausted
   * (the active stage's burnout mass): the floor the burn can decelerate down
   * to before it runs dry. Fuel available now = `totalMass − burnoutMass`. */
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
  /** Terrain height (AGL) at which the burn must begin; <= 0 means "ignite now / past". */
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

/** The burn-solve outputs the two engine models share. `stopDistance` is the
 * along-vector distance an optimal burn (starting now) needs to null the whole
 * surface-speed vector: the datum for the ignition point. `bestSpeedAtImpact`
 * is the minimum achievable touchdown speed (0 when the burn stops the vessel
 * at or above terrain with fuel to spare). */
interface BurnResult {
  stopDistance: number;
  bestSpeedAtImpact: number;
  burnDuration: number;
  burnDeltaV: number;
}

/** Constant-deceleration fallback: `aNet = aMax − g` held at the CURRENT mass.
 * Used when dry-mass / dV aren't on the wire. Over-states the stopping distance
 * (ignores the accel rising as fuel burns) but errs on the safe side. */
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

/** Bisection root of a monotonic `f` on `[lo, hi]` (f(lo) and f(hi) opposite
 * sign). 60 iterations → ~1e-18 relative on a full-range bracket; ample. */
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

/** The real rocket-equation suicide burn: constant thrust `F`, mass falling from
 * `m0` to `mdry` as fuel burns, so the deceleration RISES through the burn.
 *
 * Given the active engine's exhaust velocity `ve` (= Isp·g0) and mass-flow
 * ṁ = F/ve, the along-vector speed is
 *   s(t) = surf + g·t + ve·ln(1 − t/τ),   τ = m0/ṁ
 * (the ln term is the delivered ΔV; `g·t` the gravity loss). s is strictly
 * decreasing while TWR>1, so the null time `t_stop` is a clean bisection root;
 * the distance is the closed-form integral of s. The burn is capped at the fuel
 * (t_fuel = (m0−mdry)/ṁ): if the vessel can't null the vector within that, or
 * within the remaining height `h`, it arrives at terrain still moving: a
 * genuine NO LANDING VECTOR, not a fixed-decel artefact. */
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
    // ∫₀ᵗ ve·ln(1−t'/τ) dt' = −ve·τ·(u·ln u − u + 1); u·ln u → 0 as u → 0.
    const uLnU = u <= 0 ? 0 : u * Math.log(u);
    return surf * t + 0.5 * g * t * t - ve * tau * (uLnU - u + 1);
  };

  // Ideal (fuel-unbounded) null time, always exists in (0, τ): s(0)=surf>0 and
  // s→−∞ as t→τ. This is the datum for the ignition point + the full-null dV.
  const tStopIdeal = bisect(speed, 0, tau * (1 - 1e-12));
  const stopDistance = dist(tStopIdeal);
  const burnDeltaV = surf + g * tStopIdeal; // = ve·ln(m0/m(t_stop))

  // The powered phase ends at whichever comes first: the vessel stops, or the
  // tank runs dry. `bestSpeedAtImpact` is the speed once it reaches terrain.
  const tPowerEnd = Math.min(tStopIdeal, tFuel);
  const distPowerEnd = dist(tPowerEnd);
  let bestSpeedAtImpact: number;
  if (distPowerEnd >= h) {
    // Hits terrain while still under power → residual at the ground.
    const tGround = bisect((t) => dist(t) - h, 0, tPowerEnd);
    bestSpeedAtImpact = Math.max(0, speed(tGround));
  } else if (tStopIdeal <= tFuel) {
    // Stopped above terrain with fuel to spare → a safe touchdown.
    bestSpeedAtImpact = 0;
  } else {
    // Fuel exhausted above terrain, still moving → free-fall the rest.
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

  // Full velocity vector magnitude. Guard against a surfaceSpeed that is
  // (spuriously) below the vertical component: horizontal is never negative.
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

  // A suicide burn needs net deceleration, thrust must beat gravity (TWR > 1).
  if (aMax === null || !(aMax > g)) return solved;

  // The rocket-equation model needs the active engine's ve + the active stage's
  // burnout mass; when either is missing (legacy callers / tests) fall back to
  // constant-deceleration at the current mass. Both paths return a `BurnResult`.
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

  const ignitionAltitude = h - burn.stopDistance;
  // Countdown to the latest ignition: ballistic fall through `stopDistance` of
  // vertical altitude. 0 ("IGNITE") once already at or past the ignition point.
  const suicideBurnCountdown =
    ignitionAltitude <= 0
      ? 0
      : finiteOrNull(
          (-vDown + Math.sqrt(vDown * vDown + 2 * g * burn.stopDistance)) / g,
        );

  return {
    ...solved,
    bestSpeedAtImpact: finiteOrNull(burn.bestSpeedAtImpact),
    burnDeltaV: finiteOrNull(burn.burnDeltaV),
    burnDuration: finiteOrNull(burn.burnDuration),
    ignitionAltitude: finiteOrNull(ignitionAltitude),
    suicideBurnCountdown,
  };
}
