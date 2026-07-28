/**
 * Porkchop grid builder: the departure×arrival Δv surface a Transfer Window
 * widget renders as a heatmap (MechJeb/alexmoon style). Pure and deterministic:
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

import type { Vec3Tuple } from "./lambert";
import { type LambertResult, lambertDeltaV, solveLambert } from "./lambert";

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
