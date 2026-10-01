/**
 * The Transfer Window's body geometry and porkchop grid.
 *
 * Not a reckoner: the grid solves a transfer between two bodies for each departure and arrival pair, events that have not happened, from the bodies' elements and the game's body states. Every cell is a hypothetical, so there is no observed value being carried and no Topic the grid belongs to, and `registerReckoner` takes a `TopicId`.
 */
import {
  angleDelta,
  buildPorkchop,
  captureBurn,
  hohmannTransferTime,
  keplerTransferSolver,
  type PorkchopGrid,
  type StateLike,
  type TransferSolution,
} from "@ksp-gonogo/core";
import { type OrbitElements, solve } from "@ksp-gonogo/sitrep-client";
import type { CelestialBody } from "../SystemView/useCelestialBodies";

const toDeg = (rad: number): number => (rad * 180) / Math.PI;
const wrap360 = (deg: number): number => ((deg % 360) + 360) % 360;

/** The parent body's μ for `body` (looked up by `referenceBody` name). */
export function parentMu(
  body: CelestialBody,
  bodies: CelestialBody[],
): number | null {
  const parent = bodies.find((b) => b.name === body.referenceBody);
  return parent?.gravParameter ?? null;
}

/** True longitude (degrees, [0,360)) of a body: (Ω + ω) + ν. */
export function bodyTrueLongitudeDeg(body: CelestialBody): number | null {
  if (
    body.lan == null ||
    body.argumentOfPeriapsis == null ||
    body.trueAnomaly == null
  ) {
    return null;
  }
  return wrap360(toDeg(body.lan + body.argumentOfPeriapsis) + body.trueAnomaly);
}

/**
 * Current phase angle (degrees, wrapped to (-180,180]) of `dest` relative to
 * `origin`: how far the destination leads (+) or trails (-) the origin as seen
 * from their shared parent.
 */
export function phaseAngleDeg(
  origin: CelestialBody,
  dest: CelestialBody,
): number | null {
  const lo = bodyTrueLongitudeDeg(origin);
  const ld = bodyTrueLongitudeDeg(dest);
  if (lo == null || ld == null) return null;
  return angleDelta(ld, lo);
}

/** Build a Keplerian `OrbitElements` (for `solve`) from a body + its parent μ. */
export function celestialToOrbitElements(
  body: CelestialBody,
  bodies: CelestialBody[],
): OrbitElements | null {
  const mu = parentMu(body, bodies);
  if (
    mu == null ||
    body.semiMajorAxis == null ||
    body.eccentricity == null ||
    body.inclination == null ||
    body.lan == null ||
    body.argumentOfPeriapsis == null ||
    body.meanAnomalyAtEpoch == null ||
    body.epoch == null
  ) {
    return null;
  }
  return {
    sma: body.semiMajorAxis,
    ecc: body.eccentricity,
    inc: body.inclination,
    lan: body.lan,
    argPe: body.argumentOfPeriapsis,
    meanAnomalyAtEpoch: body.meanAnomalyAtEpoch,
    epoch: body.epoch,
    mu,
  };
}

export interface TransferComputeInput {
  /** The vessel's parent body (transfer origin, e.g. Kerbin/Earth). */
  origin: CelestialBody;
  /** The destination body (must share `origin`'s parent). */
  dest: CelestialBody;
  bodies: CelestialBody[];
  /** Parking-orbit radius around the origin body (m). */
  parkingRadius: number;
  nowUt: number;
}

/**
 * The coplanar MVP transfer solution (phase/window/ejection) via
 * `keplerTransferSolver`. `null` if the required elements aren't streamed yet.
 */
export function computeTransfer(
  input: TransferComputeInput,
): TransferSolution | null {
  const { origin, dest, bodies, parkingRadius, nowUt } = input;
  const muParent = parentMu(origin, bodies);
  if (
    muParent == null ||
    origin.semiMajorAxis == null ||
    dest.semiMajorAxis == null ||
    origin.period == null ||
    dest.period == null ||
    origin.gravParameter == null
  ) {
    return null;
  }
  const currentPhaseDeg = phaseAngleDeg(origin, dest);
  if (currentPhaseDeg == null) return null;
  return keplerTransferSolver.solve({
    muParent,
    originRadius: origin.semiMajorAxis,
    destRadius: dest.semiMajorAxis,
    originPeriod: origin.period,
    destPeriod: dest.period,
    currentPhaseDeg,
    muOriginBody: origin.gravParameter,
    parkingRadius,
    nowUt,
  });
}

export interface PorkchopBuildInput {
  origin: CelestialBody;
  dest: CelestialBody;
  bodies: CelestialBody[];
  nowUt: number;
  /** Departure-axis samples. Default 32. */
  departureSamples?: number;
  /** Arrival-axis samples. Default 32. */
  arrivalSamples?: number;
  /** UT the grid centres its departure axis on; default `nowUt`. */
  centerDepUt?: number;
  /**
   * Where each body is, at an instant on the grid's own axes. Both default to
   * the client's Keplerian `solve`; the widget injects `system.bodies.statesAt`
   * so the grid uses the game's elected propagation provider.
   */
  propagateOrigin?: (ut: number) => StateLike;
  propagateDest?: (ut: number) => StateLike;
}

/** The instants a grid built from this input will ask about. */
export interface PorkchopAxes {
  departureUts: number[];
  arrivalUts: number[];
  muParent: number;
}

/**
 * The grid's two time axes, without solving anything on them, so a caller can
 * pre-fetch body states for exactly the instants the grid will plot.
 */
export function porkchopAxes(input: PorkchopBuildInput): PorkchopAxes | null {
  const { origin, dest, bodies, nowUt } = input;
  const muParent = parentMu(origin, bodies);
  if (
    muParent == null ||
    origin.semiMajorAxis == null ||
    dest.semiMajorAxis == null
  ) {
    return null;
  }

  const tHohmann = hohmannTransferTime(
    muParent,
    origin.semiMajorAxis,
    dest.semiMajorAxis,
  );
  const depHalf = 0.4 * tHohmann;
  const arrHalf = 0.4 * tHohmann;
  const centerDep = input.centerDepUt ?? nowUt;
  const centerArr = centerDep + tHohmann;

  const depStart = Math.max(nowUt, centerDep - depHalf);
  const depEnd = Math.max(depStart + 1, centerDep + depHalf);

  const linspace = (a: number, b: number, n: number): number[] =>
    Array.from({ length: n }, (_, k) => a + ((b - a) * k) / (n - 1));

  return {
    departureUts: linspace(depStart, depEnd, input.departureSamples ?? 32),
    arrivalUts: linspace(
      centerArr - arrHalf,
      centerArr + arrHalf,
      input.arrivalSamples ?? 32,
    ),
    muParent,
  };
}

/**
 * The porkchop grid for the origin to dest pair. A tight WINDOW around the
 * optimum (departure `centerDep ± 0.4·T_Hohmann`, arrival centred on
 * `centerDep + T_Hohmann`), so time of flight stays in `[0.2, 1.8]·T_Hohmann`,
 * every cell solves, and the Δv field is a single bowl. Departures are never
 * sampled before `nowUt`.
 */
export function buildTransferPorkchop(
  input: PorkchopBuildInput,
): PorkchopGrid | null {
  const { origin, dest, bodies } = input;

  const originEl = celestialToOrbitElements(origin, bodies);
  const destEl = celestialToOrbitElements(dest, bodies);
  const axes = porkchopAxes(input);
  if (
    !originEl ||
    !destEl ||
    !axes ||
    origin.period == null ||
    dest.period == null
  ) {
    return null;
  }

  return buildPorkchop({
    muParent: axes.muParent,
    propagateOrigin: input.propagateOrigin ?? ((ut) => solve(originEl, ut)),
    propagateDest: input.propagateDest ?? ((ut) => solve(destEl, ut)),
    departureUts: axes.departureUts,
    arrivalUts: axes.arrivalUts,
  });
}

export interface TransferWindowEntry {
  /** 0 = the next window; higher = successive synodic repeats. */
  index: number;
  /** Departure UT of this window's optimum. */
  departureUt: number;
  /** Seconds from now until departure. */
  waitSeconds: number;
  /** Characteristic transfer Δv (m/s): the porkchop optimum. */
  deltaV: number;
  /** Ejection burn Δv from the parking orbit (m/s). */
  ejectionDeltaV: number;
  /** Ejection angle from the parent's prograde (deg). */
  ejectionAngleDeg: number;
  /** Transfer time (s). */
  transferTimeSec: number;
  /** Arrival UT. */
  arrivalUt: number;
}

function makeWindow(
  index: number,
  departureUt: number,
  deltaV: number,
  transferTimeSec: number,
  solution: TransferSolution,
  nowUt: number,
): TransferWindowEntry {
  return {
    index,
    departureUt,
    waitSeconds: Math.max(0, departureUt - nowUt),
    deltaV,
    ejectionDeltaV: solution.ejectionDeltaV,
    ejectionAngleDeg: solution.ejectionAngleDeg,
    transferTimeSec,
    arrivalUt: departureUt + transferTimeSec,
  };
}

/**
 * The next `count` transfer windows, each a synodic period after the last.
 * Window TIMING comes from the phase solution, not the porkchop's global-min
 * departure (which can land a synodic away); the Δv magnitude comes from the
 * porkchop optimum. Empty when no transfer solves.
 */
export function upcomingWindows(
  solution: TransferSolution,
  grid: PorkchopGrid,
  nowUt: number,
  count: number,
): TransferWindowEntry[] {
  const best = grid.best;
  if (!best) return [];
  const baseDep = solution.departureUt;
  const tof = solution.transferTimeSec;
  const dv = best.deltaV;
  const synodic = solution.synodicPeriodSec;
  if (!Number.isFinite(synodic) || synodic <= 0) {
    // Co-orbital / degenerate: only the one window is meaningful.
    return [makeWindow(0, baseDep, dv, tof, solution, nowUt)];
  }
  const out: TransferWindowEntry[] = [];
  for (let k = 0; k < count; k++) {
    out.push(makeWindow(k, baseDep + k * synodic, dv, tof, solution, nowUt));
  }
  return out;
}

/** The bodies eligible as transfer destinations from `origin`: its solvable siblings. */
export function transferDestinations(
  origin: CelestialBody,
  bodies: CelestialBody[],
): CelestialBody[] {
  return bodies.filter(
    (b) =>
      b.index !== origin.index &&
      b.referenceBody != null &&
      b.referenceBody === origin.referenceBody &&
      b.semiMajorAxis != null &&
      b.period != null,
  );
}

/** Metres of clearance above a destination's atmosphere (or surface) to circularise at. */
const CAPTURE_CLEARANCE_M = 10_000;

/**
 * The radius to quote a capture burn at: clear of the atmosphere if there is
 * one, clear of the ground if not. A convention stated in the widget's footer,
 * chosen to agree with the community Δv map's low-orbit figures.
 */
function captureRadiusOf(body: CelestialBody): number | null {
  if (body.radius == null || !Number.isFinite(body.radius)) return null;
  return body.radius + (body.maxAtmosphere ?? 0) + CAPTURE_CLEARANCE_M;
}

/** What a transfer to one destination costs and when it can be flown. */
export interface ReachEntry {
  body: CelestialBody;
  /** Departure burn from the current parking orbit (m/s), null when unsolvable. */
  ejectionDeltaV: number | null;
  /** Orbit-insertion burn at the destination (m/s), null when unsolvable. */
  captureDeltaV: number | null;
  /** `ejectionDeltaV + captureDeltaV`, the figure a budget is compared against. */
  totalDeltaV: number | null;
  /** Ideal departure UT of the next window, null when unsolvable. */
  departureUt: number | null;
  /** Seconds from now until that departure. */
  waitSeconds: number | null;
  /** Coasting time on the transfer (s). */
  transferTimeSec: number | null;
}

export interface ReachComputeInput {
  origin: CelestialBody;
  bodies: CelestialBody[];
  /** Parking-orbit radius around the origin body (m). */
  parkingRadius: number;
  nowUt: number;
}

/**
 * Every sibling destination with what it costs THIS craft and when it can go,
 * cheapest first. Closed-form throughout, with no porkchop per destination. A
 * destination whose elements have not arrived keeps its row with null figures:
 * a missing row and an unaffordable one are not the same fact.
 */
export function reachEntries(input: ReachComputeInput): ReachEntry[] {
  const { origin, bodies, parkingRadius, nowUt } = input;
  const muParent = parentMu(origin, bodies);

  const entries = transferDestinations(origin, bodies).map<ReachEntry>(
    (dest) => {
      const blank: ReachEntry = {
        body: dest,
        ejectionDeltaV: null,
        captureDeltaV: null,
        totalDeltaV: null,
        departureUt: null,
        waitSeconds: null,
        transferTimeSec: null,
      };

      const solution = computeTransfer({
        origin,
        dest,
        bodies,
        parkingRadius,
        nowUt,
      });
      if (!solution) return blank;

      const captureRadius = captureRadiusOf(dest);
      const capture =
        muParent != null &&
        dest.gravParameter != null &&
        captureRadius != null &&
        origin.semiMajorAxis != null &&
        dest.semiMajorAxis != null
          ? captureBurn({
              muParent,
              originRadius: origin.semiMajorAxis,
              destRadius: dest.semiMajorAxis,
              muDestBody: dest.gravParameter,
              captureRadius,
            })
          : null;

      const ejectionDeltaV = Number.isFinite(solution.ejectionDeltaV)
        ? solution.ejectionDeltaV
        : null;
      const captureDeltaV = capture?.captureDeltaV ?? null;
      return {
        body: dest,
        ejectionDeltaV,
        captureDeltaV,
        totalDeltaV:
          ejectionDeltaV != null && captureDeltaV != null
            ? ejectionDeltaV + captureDeltaV
            : null,
        departureUt: solution.departureUt,
        waitSeconds: solution.waitSeconds,
        transferTimeSec: solution.transferTimeSec,
      };
    },
  );

  // Cheapest first; rows with no cost sort last, where a null cannot read as free.
  return entries.sort((a, b) => {
    if (a.totalDeltaV == null && b.totalDeltaV == null) return 0;
    if (a.totalDeltaV == null) return 1;
    if (b.totalDeltaV == null) return -1;
    return a.totalDeltaV - b.totalDeltaV;
  });
}

/**
 * How a destination's cost sits against the budget.
 *
 * - `go`: departure and capture are both covered
 * - `one-way`: departure is covered, capture is not. A flyby is a real mission, so this is a different answer from `no`
 * - `marginal`: within a tenth of the departure threshold, since the coplanar model ignores plane change
 * - `no`: departure is not covered
 * - `null`: no budget or no cost, which is not a `no`
 */
export type ReachVerdict = "go" | "one-way" | "marginal" | "no";

/** Fraction of the ejection threshold inside which the coplanar model will not commit. */
const MARGINAL_BAND = 0.1;

export function reachVerdict(
  cost: Pick<ReachEntry, "ejectionDeltaV" | "captureDeltaV" | "totalDeltaV">,
  budgetDeltaV: number | null | undefined,
  reserveDeltaV: number,
): ReachVerdict | null {
  const { ejectionDeltaV, totalDeltaV } = cost;
  if (budgetDeltaV == null || !Number.isFinite(budgetDeltaV)) return null;
  if (ejectionDeltaV == null || totalDeltaV == null) return null;

  const spendable = budgetDeltaV - reserveDeltaV;
  if (spendable >= totalDeltaV) return "go";
  if (Math.abs(spendable - ejectionDeltaV) <= ejectionDeltaV * MARGINAL_BAND) {
    return "marginal";
  }
  return spendable >= ejectionDeltaV ? "one-way" : "no";
}

/** Fraction of the Hohmann transfer time the porkchop's UT inputs are rounded to, well below one grid sample. */
const GRID_UT_QUANTUM_FRACTION = 500;

/**
 * The quantum the porkchop's UT inputs are rounded to before they reach a memo,
 * or `null` with no transfer time. Scaled to the chart rather than a fixed
 * number of seconds, so it stays stable under high time warp.
 */
export function porkchopGridQuantum(transferTimeSec: number): number | null {
  if (!Number.isFinite(transferTimeSec) || transferTimeSec <= 0) return null;
  return transferTimeSec / GRID_UT_QUANTUM_FRACTION;
}

/** Round a UT down to `quantum`. A null quantum passes the value through unchanged. */
export function quantiseGridUt(ut: number, quantum: number | null): number {
  if (quantum === null || !Number.isFinite(ut)) return ut;
  return Math.floor(ut / quantum) * quantum;
}
