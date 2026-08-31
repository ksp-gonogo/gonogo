/**
 * Porkchop grid builder: the departure×arrival Δv surface a Transfer Window
 * widget renders as a heatmap. Pure and deterministic:
 * for each (departure UT, arrival UT) cell it solves Lambert's problem for the
 * transfer and records the characteristic Δv.
 *
 * Decoupled from any propagator: the caller injects `propagateOrigin` /
 * `propagateDest`: functions returning a body's parent-relative state
 * (position + velocity) at a UT. The widget wires the streaming Keplerian
 * propagator (`@ksp-gonogo/sitrep-client`'s `solve`); tests inject an analytic
 * one. This keeps core free of a sitrep-client dependency and keeps the builder
 * trivially testable.
 */

import { PerfBudget } from "@ksp-gonogo/sitrep-sdk";
import type { Vec3Tuple } from "./lambert";
import { type LambertResult, lambertDeltaV, solveLambert } from "./lambert";

/**
 * Lambert solves per second across every porkchop grid.
 *
 * A porkchop is the most expensive client-side computation in the app: a 32x32 grid is
 * 1,024 Lambert solves and measures at ~7ms on a dev machine. That fits inside a frame,
 * which is exactly why this needs a budget rather than a test. A correctness bug fails
 * loudly; a grid rebuilt every frame just burns 42% of a core for an answer that does
 * not change, and nothing notices for a month.
 *
 * Threshold is four full grids per second: generous for any real interaction (picking a
 * window, changing destination) and still 15x under the 60Hz rebuild this was written to
 * catch. Sized against the grid, not the frame, so it stays meaningful if the sample
 * count changes.
 */
export const PORKCHOP_SOLVE_BUDGET = new PerfBudget({
  name: "Porkchop Lambert solves/sec",
  threshold: 4 * 32 * 32,
  windowMs: 1000,
  unit: "solves",
});

/** A body's parent-relative state at an instant. Structurally matches sitrep-client's `StateVector`. */
export interface StateLike {
  position: Vec3Tuple;
  velocity: Vec3Tuple;
}

export interface PorkchopCell {
  depUt: number;
  arrUt: number;
  tofSec: number;
  /** Characteristic transfer Δv (m/s), or null for a skipped/degenerate cell. */
  deltaV: number | null;
}

export interface PorkchopBest {
  depUt: number;
  arrUt: number;
  tofSec: number;
  deltaV: number;
  /** Cell indices (departure row, arrival column). */
  i: number;
  j: number;
  /** The Lambert solution for the best cell (for maneuver-node handoff). */
  solution: LambertResult;
}

export interface PorkchopGrid {
  /** `cells[i][j]` for departure `i`, arrival `j`. */
  cells: PorkchopCell[][];
  departureUts: number[];
  arrivalUts: number[];
  best: PorkchopBest | null;
  minDeltaV: number | null;
  maxDeltaV: number | null;
}

export interface PorkchopInput {
  muParent: number;
  propagateOrigin: (ut: number) => StateLike;
  propagateDest: (ut: number) => StateLike;
  departureUts: number[];
  arrivalUts: number[];
  /** Transfer direction; prograde by default. */
  prograde?: boolean;
  /**
   * Force the ≤180° short-way arc for every cell. A planner porkchop sets this
   * so the whole grid is one coherent lobe of sensible transfers (no divergent
   * Type-II long-way region punching holes through the plot). Default false.
   */
  shortWay?: boolean;
  /**
   * Minimum time of flight (s) to attempt a Lambert solve, skips near-zero
   * and (optionally) near-degenerate transfers. Defaults to 0 (only arr>dep is
   * required).
   */
  minTofSec?: number;
}

/**
 * Build the porkchop Δv grid. Cells with `arrUt <= depUt` (or below
 * `minTofSec`), or where Lambert fails to converge, get `deltaV: null` and are
 * skipped in the min/max/best reduction.
 */
export function buildPorkchop(input: PorkchopInput): PorkchopGrid {
  const {
    muParent,
    propagateOrigin,
    propagateDest,
    departureUts,
    arrivalUts,
    prograde = true,
    shortWay = false,
    minTofSec = 0,
  } = input;

  const cells: PorkchopCell[][] = [];
  let best: PorkchopBest | null = null;
  let minDeltaV: number | null = null;
  let maxDeltaV: number | null = null;

  // Cache per-UT states so each grid line is propagated once, not per cell.
  const originCache = new Map<number, StateLike>();
  const destCache = new Map<number, StateLike>();
  const origin = (ut: number): StateLike => {
    let s = originCache.get(ut);
    if (!s) {
      s = propagateOrigin(ut);
      originCache.set(ut, s);
    }
    return s;
  };
  const dest = (ut: number): StateLike => {
    let s = destCache.get(ut);
    if (!s) {
      s = propagateDest(ut);
      destCache.set(ut, s);
    }
    return s;
  };

  // Recorded per GRID rather than per cell: one `Date.now()` and one array push for a
  // 1,024-solve build, instead of 1,024 of each. The budget is about how often the grid
  // is rebuilt, and the cell count is known up front.
  PORKCHOP_SOLVE_BUDGET.record(departureUts.length * arrivalUts.length);

  for (let i = 0; i < departureUts.length; i++) {
    const depUt = departureUts[i];
    const row: PorkchopCell[] = [];
    for (let j = 0; j < arrivalUts.length; j++) {
      const arrUt = arrivalUts[j];
      const tofSec = arrUt - depUt;
      if (tofSec <= 0 || tofSec < minTofSec) {
        row.push({ depUt, arrUt, tofSec, deltaV: null });
        continue;
      }
      const depState = origin(depUt);
      const arrState = dest(arrUt);
      const sol = solveLambert(
        depState.position,
        arrState.position,
        tofSec,
        muParent,
        prograde,
        shortWay,
      );
      if (!sol) {
        row.push({ depUt, arrUt, tofSec, deltaV: null });
        continue;
      }
      const deltaV = lambertDeltaV(sol, depState.velocity, arrState.velocity);
      if (!Number.isFinite(deltaV)) {
        row.push({ depUt, arrUt, tofSec, deltaV: null });
        continue;
      }
      row.push({ depUt, arrUt, tofSec, deltaV });
      if (minDeltaV === null || deltaV < minDeltaV) minDeltaV = deltaV;
      if (maxDeltaV === null || deltaV > maxDeltaV) maxDeltaV = deltaV;
      if (!best || deltaV < best.deltaV) {
        best = { depUt, arrUt, tofSec, deltaV, i, j, solution: sol };
      }
    }
    cells.push(row);
  }

  return {
    cells,
    departureUts,
    arrivalUts,
    best,
    minDeltaV,
    maxDeltaV,
  };
}
