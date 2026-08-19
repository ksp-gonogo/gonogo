/**
 * Interplanetary/interlunar transfer-window math: pure, deterministic,
 * side-effect-free (SI units: metres, seconds, m/s; angles in degrees at the
 * public boundary). Client-derived from the body Keplerian elements already on
 * the wire (`system.bodies`), no mod channel.
 *
 * Two layers:
 *   - the coplanar Hohmann model (phase angle, synodic window timing, ejection
 *     Δv/angle): the MVP readout, and
 *   - `ITransferSolver` / `keplerTransferSolver`: the swappable seam. The
 *     default is this stock two-body Kepler solver; an n-body
 *     backend can register over it later, the same electable pattern as
 *     `ITargetApproachSolver`/`StockKeplerApproachSolver`. (The n-body
 *     backend is deliberately NOT built now.)
 *
 * The porkchop/Lambert layer (departure×arrival Δv surface, inclination-aware)
 * lives alongside in `./lambert` and consumes 3D state from the same body
 * elements: it is a separate, richer computation than this coplanar model.
 */

import type { Severity } from "@ksp-gonogo/ui-kit";

// ---------------------------------------------------------------------------
// Phase-angle core (moved here from packages/components SystemView so both the
// SystemView diagram and the Transfer Window widget share ONE implementation;
// SystemView/transferWindow.ts now re-exports these).
// ---------------------------------------------------------------------------

/**
 * Ideal coplanar Hohmann departure phase angle (degrees) for a transfer from
 * orbital radius `rA` to `rB` around a shared parent:
 *
 *   θ = 180° × (1 − ((rA + rB) / (2 rB))^1.5)
 *
 * Positive → the target should be that many degrees AHEAD at burn time (outer
 * target, rB > rA); negative → behind (inner target). Earth→Mars ≈ +44.3°,
 * Earth→Venus ≈ −54.2°.
 */
export function hohmannPhaseAngle(rA: number, rB: number): number {
  if (!Number.isFinite(rA) || !Number.isFinite(rB) || rA <= 0 || rB <= 0) {
    return Number.NaN;
  }
  const ratio = ((rA + rB) / (2 * rB)) ** 1.5;
  return 180 * (1 - ratio);
}

/**
 * Smallest signed angular distance from `current` to `target`, wrapped to
 * (−180, 180].
 */
export function angleDelta(current: number, target: number): number {
  let d = (current - target) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export type TransferStatus = "go" | "soon" | "off";

/**
 * Highlight tier for a phase-angle readout: "go" within ±2° of ideal, "soon"
 * within ±10°, "off" otherwise. Two thresholds so the readout telegraphs the
 * approaching window as well as "burn now".
 */
export function transferStatus(deltaDeg: number): TransferStatus {
  const a = Math.abs(deltaDeg);
  if (a < 2) return "go";
  if (a < 10) return "soon";
  return "off";
}

/**
 * Fold `TransferStatus` onto the canonical `Severity` scale so SystemView and
 * the Transfer Window widget can contribute their window state to a panel
 * summary and read the same colours as every other status surface. Per the spec
 * mapping table (Scale B): `go` is nominal, the approaching `soon` window is a
 * caution, and an `off` window is critical.
 *
 * `Severity` lives in `@ksp-gonogo/ui-kit` (which core already depends on),
 * because a shared severity type in core would be a circular import for the
 * Badge/Panel that consume it.
 */
export function transferSeverity(status: TransferStatus): Severity {
  switch (status) {
    case "go":
      return "nominal";
    case "soon":
      return "caution";
    case "off":
      return "critical";
  }
}

// ---------------------------------------------------------------------------
// Net-new transfer math
// ---------------------------------------------------------------------------

/**
 * Synodic period (seconds): how often the same relative geometry, and thus
 * the same transfer window: recurs. `|T1·T2 / (T1 − T2)|`. Diverges as the
 * two periods converge (co-orbital bodies never realign).
 */
export function synodicPeriod(t1: number, t2: number): number {
  if (t1 <= 0 || t2 <= 0) return Number.NaN;
  const denom = Math.abs(t1 - t2);
  if (denom === 0) return Number.POSITIVE_INFINITY;
  return (t1 * t2) / denom;
}

/**
 * Time of flight (seconds) for a coplanar Hohmann transfer between circular
 * radii `r1` and `r2` around a parent of gravitational parameter `muParent`:
 * half the period of the transfer ellipse, `π·√(a_t³/μ)` with
 * `a_t = (r1 + r2)/2`. Earth→Mars ≈ 259 days.
 */
export function hohmannTransferTime(
  muParent: number,
  r1: number,
  r2: number,
): number {
  const aT = (r1 + r2) / 2;
  return Math.PI * Math.sqrt((aT * aT * aT) / muParent);
}

export interface EjectionInput {
  /** Shared parent's gravitational parameter (Sun for interplanetary). */
  muParent: number;
  /** Origin body's orbital radius around the parent (m). */
  originRadius: number;
  /** Destination body's orbital radius around the parent (m). */
  destRadius: number;
  /** Origin body's own gravitational parameter (for the ejection hyperbola). */
  muOriginBody: number;
  /** Parking-orbit radius from the origin body's centre (m). */
  parkingRadius: number;
}

export interface EjectionResult {
  /** Hyperbolic excess velocity leaving the origin body's SOI (m/s). */
  vInf: number;
  /** Ejection burn Δv from the circular parking orbit (m/s). */
  ejectionDeltaV: number;
  /** Angle of the burn (periapsis) from the origin body's prograde (deg). */
  ejectionAngleDeg: number;
}

/**
 * Ejection (departure-hyperbola) figures for a coplanar Hohmann transfer.
 *
 * Heliocentric leg: transfer-ellipse periapsis speed at the origin radius
 * `v_t = √(μ_p·(2/r1 − 1/a_t))` minus the origin's circular speed
 * `v1 = √(μ_p/r1)` gives the hyperbolic excess `v∞ = |v_t − v1|`.
 * Planetary leg: at parking radius `r_p` about the origin body,
 * `v_hyp = √(v∞² + 2·μ_b/r_p)`, `v_circ = √(μ_b/r_p)`,
 * so ejection Δv = `v_hyp − v_circ`. The burn sits where the outgoing
 * asymptote is parallel to the body's orbital velocity: with hyperbola
 * eccentricity `e = 1 + r_p·v∞²/μ_b`, the ejection angle is
 * `180° − arccos(1/e)`.
 */
export function ejectionBurn(input: EjectionInput): EjectionResult {
  const { muParent, originRadius, destRadius, muOriginBody, parkingRadius } =
    input;
  const aT = (originRadius + destRadius) / 2;
  const vTransfer = Math.sqrt(muParent * (2 / originRadius - 1 / aT));
  const vOrigin = Math.sqrt(muParent / originRadius);
  const vInf = Math.abs(vTransfer - vOrigin);

  const vHyp = Math.sqrt(vInf * vInf + (2 * muOriginBody) / parkingRadius);
  const vCirc = Math.sqrt(muOriginBody / parkingRadius);
  const ejectionDeltaV = vHyp - vCirc;

  const e = 1 + (parkingRadius * vInf * vInf) / muOriginBody;
  const ejectionAngleDeg = 180 - (Math.acos(1 / e) * 180) / Math.PI;

  return { vInf, ejectionDeltaV, ejectionAngleDeg };
}

export interface CaptureInput {
  /** Shared parent's gravitational parameter (Sun for interplanetary). */
  muParent: number;
  /** Origin body's orbital radius around the parent (m). */
  originRadius: number;
  /** Destination body's orbital radius around the parent (m). */
  destRadius: number;
  /** Destination body's own gravitational parameter (for the arrival hyperbola). */
  muDestBody: number;
  /** Radius from the destination body's centre to circularise at (m). */
  captureRadius: number;
}

export interface CaptureResult {
  /** Hyperbolic excess velocity entering the destination's SOI (m/s). */
  vInf: number;
  /** Burn to circularise from the arrival hyperbola at `captureRadius` (m/s). */
  captureDeltaV: number;
}

/**
 * Capture (arrival-hyperbola) figures: `ejectionBurn` read at the far end of the
 * same transfer, and deliberately the same algebra rather than a second model.
 *
 * Heliocentric leg: the transfer ellipse's APOAPSIS speed at the destination
 * radius `v_t = √(μ_p·(2/r2 − 1/a_t))` against the destination's circular speed
 * `v2 = √(μ_p/r2)` gives the arrival excess `v∞ = |v_t − v2|`. Planetary leg: at
 * capture radius `r_c` about the destination, `v_hyp = √(v∞² + 2·μ_d/r_c)` and
 * `v_circ = √(μ_d/r_c)`, so the insertion burn is `v_hyp − v_circ`.
 *
 * **Why this is not the porkchop's number.** `lambertDeltaV` sums the two legs'
 * excesses and its own doc says it excludes the parking-orbit Oberth discount.
 * That makes it a comparison scale for colouring cells, not a cost: Oberth means
 * departure costs MORE than its excess and arrival costs LESS, so a characteristic
 * Δv is neither an upper nor a lower bound on what a craft actually spends. A
 * budget can only honestly be compared against ejection + capture.
 *
 * Returns `null` rather than a number when the geometry cannot produce one (a
 * non-positive radius or μ, a non-finite input), on the same "absent, never
 * fabricated" discipline the rest of this file follows: an invented insertion cost
 * is a reachability verdict built on a guess.
 */
export function captureBurn(input: CaptureInput): CaptureResult | null {
  const { muParent, originRadius, destRadius, muDestBody, captureRadius } =
    input;
  const finite = [
    muParent,
    originRadius,
    destRadius,
    muDestBody,
    captureRadius,
  ].every((n) => Number.isFinite(n) && n > 0);
  if (!finite) return null;

  const aT = (originRadius + destRadius) / 2;
  const vTransfer = Math.sqrt(muParent * (2 / destRadius - 1 / aT));
  const vDest = Math.sqrt(muParent / destRadius);
  const vInf = Math.abs(vTransfer - vDest);

  const vHyp = Math.sqrt(vInf * vInf + (2 * muDestBody) / captureRadius);
  const vCirc = Math.sqrt(muDestBody / captureRadius);
  const captureDeltaV = vHyp - vCirc;
  if (!Number.isFinite(vInf) || !Number.isFinite(captureDeltaV)) return null;

  return { vInf, captureDeltaV };
}

export interface NextWindowInput {
  /** Current phase angle (destination relative to origin), degrees. */
  currentPhaseDeg: number;
  /** Ideal Hohmann departure phase angle, degrees. */
  idealPhaseDeg: number;
  /** Origin body's orbital period (s). */
  originPeriod: number;
  /** Destination body's orbital period (s). */
  destPeriod: number;
  /** Precomputed synodic period (s): pass `synodicPeriod(...)`. */
  synodicPeriodSec: number;
}

/**
 * Seconds until the next departure window: the time for the phase angle to
 * drift from `currentPhaseDeg` to `idealPhaseDeg` at the relative rate
 * `dφ/dt = 360/T_dest − 360/T_origin` (deg/s), reduced into `[0, synodic)`.
 * One synodic period equals exactly 360° of relative phase, so a single
 * modulo by the synodic period selects the next (soonest, non-negative)
 * occurrence regardless of the sign of the drift rate.
 */
export function nextTransferWindowWait(input: NextWindowInput): number {
  const { currentPhaseDeg, idealPhaseDeg, originPeriod, destPeriod } = input;
  const syn = input.synodicPeriodSec;
  if (!Number.isFinite(syn) || syn <= 0) return Number.NaN;
  const rate = 360 / destPeriod - 360 / originPeriod; // deg/s
  if (rate === 0) return Number.NaN;
  const dPhi = idealPhaseDeg - currentPhaseDeg; // deg to traverse
  const raw = dPhi / rate; // seconds (may be negative)
  return ((raw % syn) + syn) % syn;
}

export interface CoplanarTransferInput {
  /** Shared parent's gravitational parameter. */
  muParent: number;
  /** Origin body's orbital radius around the parent (m). */
  originRadius: number;
  /** Destination body's orbital radius around the parent (m). */
  destRadius: number;
  /** Origin body's orbital period (s). */
  originPeriod: number;
  /** Destination body's orbital period (s). */
  destPeriod: number;
  /** Live phase angle, destination relative to origin (deg). */
  currentPhaseDeg: number;
  /** Origin body's own gravitational parameter. */
  muOriginBody: number;
  /** Parking-orbit radius from the origin body's centre (m). */
  parkingRadius: number;
  /** Current universal time (s). */
  nowUt: number;
}

export interface TransferSolution {
  idealPhaseDeg: number;
  currentPhaseDeg: number;
  phaseDeltaDeg: number;
  status: TransferStatus;
  synodicPeriodSec: number;
  waitSeconds: number;
  nowUt: number;
  departureUt: number;
  transferTimeSec: number;
  arrivalUt: number;
  vInf: number;
  ejectionDeltaV: number;
  ejectionAngleDeg: number;
}

/**
 * The swappable transfer-solution seam. The default `keplerTransferSolver`
 * uses the coplanar two-body model above; an n-body backend can be
 * elected over it later (deferred: same pattern as the target-approach
 * solver). `id` names the backend for diagnostics/UI, mirroring
 * `ITargetApproachSolver.BackendId`.
 */
export interface ITransferSolver {
  id: string;
  solve(input: CoplanarTransferInput): TransferSolution;
}

export const keplerTransferSolver: ITransferSolver = {
  id: "kepler-coplanar",
  solve(input: CoplanarTransferInput): TransferSolution {
    const idealPhaseDeg = hohmannPhaseAngle(
      input.originRadius,
      input.destRadius,
    );
    const phaseDeltaDeg = angleDelta(input.currentPhaseDeg, idealPhaseDeg);
    const synodicPeriodSec = synodicPeriod(
      input.originPeriod,
      input.destPeriod,
    );
    const status = transferStatus(phaseDeltaDeg);
    // At the ideal phase (status "go") the window is open NOW, so the wait is
    // zero. Computing it from the drift rate is numerically ambiguous right at
    // the ideal (a hair either side wraps to 0 or a full synodic), so key it
    // off the phase status instead.
    const waitSeconds =
      status === "go"
        ? 0
        : nextTransferWindowWait({
            currentPhaseDeg: input.currentPhaseDeg,
            idealPhaseDeg,
            originPeriod: input.originPeriod,
            destPeriod: input.destPeriod,
            synodicPeriodSec,
          });
    const transferTimeSec = hohmannTransferTime(
      input.muParent,
      input.originRadius,
      input.destRadius,
    );
    const departureUt = input.nowUt + waitSeconds;
    const ejection = ejectionBurn({
      muParent: input.muParent,
      originRadius: input.originRadius,
      destRadius: input.destRadius,
      muOriginBody: input.muOriginBody,
      parkingRadius: input.parkingRadius,
    });
    return {
      idealPhaseDeg,
      currentPhaseDeg: input.currentPhaseDeg,
      phaseDeltaDeg,
      status,
      synodicPeriodSec,
      waitSeconds,
      nowUt: input.nowUt,
      departureUt,
      transferTimeSec,
      arrivalUt: departureUt + transferTimeSec,
      vInf: ejection.vInf,
      ejectionDeltaV: ejection.ejectionDeltaV,
      ejectionAngleDeg: ejection.ejectionAngleDeg,
    };
  },
};
