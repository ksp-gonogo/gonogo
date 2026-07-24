/**
 * Interplanetary/interlunar transfer-window math — pure, deterministic,
 * side-effect-free (SI units: metres, seconds, m/s; angles in degrees at the
 * public boundary). Client-derived from the body Keplerian elements already on
 * the wire (`system.bodies`), no mod channel.
 *
 * Two layers:
 *   - the coplanar Hohmann model (phase angle, synodic window timing, ejection
 *     Δv/angle) — the MVP readout, and
 *   - `ITransferSolver` / `keplerTransferSolver` — the swappable seam. The
 *     default is this stock two-body Kepler solver; a Principia (n-body)
 *     backend can register over it later, the same electable pattern as
 *     `ITargetApproachSolver`/`StockKeplerApproachSolver`. (The Principia
 *     backend is deliberately NOT built now.)
 *
 * The porkchop/Lambert layer (departure×arrival Δv surface, inclination-aware)
 * lives alongside in `./lambert` and consumes 3D state from the same body
 * elements — it is a separate, richer computation than this coplanar model.
 */

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

// ---------------------------------------------------------------------------
// Net-new transfer math
// ---------------------------------------------------------------------------

/**
 * Synodic period (seconds): how often the same relative geometry — and thus
 * the same transfer window — recurs. `|T1·T2 / (T1 − T2)|`. Diverges as the
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

export interface NextWindowInput {
  /** Current phase angle (destination relative to origin), degrees. */
  currentPhaseDeg: number;
  /** Ideal Hohmann departure phase angle, degrees. */
  idealPhaseDeg: number;
  /** Origin body's orbital period (s). */
  originPeriod: number;
  /** Destination body's orbital period (s). */
  destPeriod: number;
  /** Precomputed synodic period (s) — pass `synodicPeriod(...)`. */
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
 * uses the coplanar two-body model above; a Principia-aware backend can be
 * elected over it later (deferred — same pattern as the target-approach
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
    const waitSeconds = nextTransferWindowWait({
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
      status: transferStatus(phaseDeltaDeg),
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
