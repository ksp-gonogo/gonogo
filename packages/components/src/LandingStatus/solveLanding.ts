/**
 * The full-vector suicide-burn solve — the correctness core of the rebooted
 * landing widget. Client-side only; every input is already on the wire
 * (`vessel.flight`, `vessel.propulsion`, `vessel.orbit`, `system.bodies`).
 *
 * WHY THIS EXISTS. The predecessor (`vessel-state.ts:deriveLanding`) solves a
 * purely-VERTICAL burn: it kills `vDown` alone and ignores the horizontal
 * velocity a craft arrives with from orbit. On a standard low-Mun descent that
 * under-states the burn by ~2 orders of magnitude and reports "burn now ->
 * touchdown at 0 m/s" while the craft still carries ~540 m/s horizontally —
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
 * still a vacuum model — no drag — so the widget suppresses it on atmospheric
 * bodies rather than emit a confidently wrong number.
 */

export type LandingSolutionState =
  | "not-descending"
  | "vacuum-solved"
  | "no-solution";

export interface SuicideBurnInputs {
  /** Height of the vessel's LOWEST point above terrain, metres (the burn datum). */
  heightFromTerrain: number | undefined;
  /** Altitude above sea level, metres — used only to evaluate local gravity. */
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
  /** Total vessel mass, tonnes (`vessel.propulsion.totalMass`). */
  totalMass: number | undefined;
}

export interface LandingSolution {
  state: LandingSolutionState;
  /** Local gravitational acceleration at the current radius, m/s^2. */
  gravity: number | null;
  /** Descent rate (downward-positive), m/s. */
  verticalSpeed: number | null;
  /** Horizontal component of the surface velocity, m/s — the tip-over axis. */
  horizontalSpeed: number | null;
  /** Ballistic (no-burn) time to terrain impact, seconds. */
  timeToImpact: number | null;
  /** Impact speed if nothing is done — full surface speed plus the drop's energy, m/s. */
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

/** `availableThrust/totalMass` (kN/t = m/s^2), guarded — the max deceleration. */
function deriveMaxAccel(
  availableThrust: number | undefined,
  totalMass: number | undefined,
): number | null {
  if (availableThrust === undefined || totalMass === undefined) return null;
  if (!(totalMass > 0)) return null;
  return finiteOrNull(availableThrust / totalMass);
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
  // (spuriously) below the vertical component — horizontal is never negative.
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
  // No-burn impact speed — full surface speed plus the drop's added energy.
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

  // A suicide burn needs net deceleration — thrust must beat gravity (TWR > 1).
  if (aMax === null || !(aMax > g)) return solved;

  const aNet = aMax - g;
  // FULL-VECTOR: distance to null the whole surface-speed vector, not vDown.
  const burnDistance = (surf * surf) / (2 * aNet);
  // Best (minimum) touchdown speed if the burn starts now: 0 when the whole
  // vector can be nulled within the remaining height, else the residual.
  const bestSpeedAtImpact =
    burnDistance <= h
      ? 0
      : finiteOrNull(Math.sqrt(Math.max(0, surf * surf - 2 * aNet * h)));
  const burnDuration = finiteOrNull(surf / aNet);
  // Propellant dV = thrust integrated over the burn (aMax * t); the excess over
  // `surf` is the gravity loss. This is the figure to weigh against stage dV.
  const burnDeltaV =
    burnDuration === null ? null : finiteOrNull(aMax * burnDuration);

  const ignitionAltitude = h - burnDistance;
  // Countdown to the latest ignition: ballistic fall through `burnDistance` of
  // vertical altitude. 0 ("IGNITE") once already at or past the ignition point.
  const suicideBurnCountdown =
    ignitionAltitude <= 0
      ? 0
      : finiteOrNull(
          (-vDown + Math.sqrt(vDown * vDown + 2 * g * burnDistance)) / g,
        );

  return {
    ...solved,
    bestSpeedAtImpact,
    burnDeltaV,
    burnDuration,
    ignitionAltitude: finiteOrNull(ignitionAltitude),
    suicideBurnCountdown,
  };
}
