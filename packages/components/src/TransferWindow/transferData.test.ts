import type { PorkchopGrid, TransferSolution } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import type { CelestialBody } from "../SystemView/useCelestialBodies";
import {
  bodyTrueLongitudeDeg,
  buildTransferPorkchop,
  celestialToOrbitElements,
  computeTransfer,
  parentMu,
  phaseAngleDeg,
  transferDestinations,
  upcomingWindows,
} from "./transferData";

const MU_SUN = 1.32712440018e20;
const MU_EARTH = 3.986004418e14;
const MU_MARS = 4.282837e13;
const DAY = 86400;
const DEG = Math.PI / 180;

function mkBody(
  over: Partial<CelestialBody> & { index: number },
): CelestialBody {
  return {
    index: over.index,
    name: null,
    referenceBody: null,
    radius: null,
    soi: null,
    gravParameter: null,
    semiMajorAxis: null,
    eccentricity: null,
    inclination: null,
    lan: null,
    argumentOfPeriapsis: null,
    meanAnomalyAtEpoch: null,
    epoch: null,
    period: null,
    trueAnomaly: null,
    mass: null,
    geeASL: null,
    escapeVelocity: null,
    hillSphere: null,
    rotationPeriod: null,
    tidallyLocked: null,
    rotates: null,
    hasOcean: null,
    description: null,
    atmosphere: null,
    hasAtmosphere: null,
    maxAtmosphere: null,
    hasOxygen: null,
    ...over,
  };
}

const sun = mkBody({ index: 0, name: "Sun", gravParameter: MU_SUN });
const earth = mkBody({
  index: 1,
  name: "Earth",
  referenceBody: "Sun",
  gravParameter: MU_EARTH,
  semiMajorAxis: 1.495978707e11,
  eccentricity: 0,
  inclination: 0,
  lan: 0,
  argumentOfPeriapsis: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  period: 365.256 * DAY,
  trueAnomaly: 0,
});
const mars = mkBody({
  index: 2,
  name: "Mars",
  referenceBody: "Sun",
  gravParameter: MU_MARS,
  semiMajorAxis: 2.279392e11,
  eccentricity: 0,
  inclination: 0,
  lan: 0,
  argumentOfPeriapsis: 0,
  meanAnomalyAtEpoch: 44.3 * DEG,
  epoch: 0,
  period: 686.98 * DAY,
  trueAnomaly: 44.3,
});
const bodies = [sun, earth, mars];

describe("transferData bridge", () => {
  it("parentMu resolves the shared parent's μ", () => {
    expect(parentMu(earth, bodies)).toBe(MU_SUN);
    expect(parentMu(sun, bodies)).toBeNull();
  });

  it("bodyTrueLongitudeDeg = (Ω+ω)+ν, wrapped", () => {
    expect(bodyTrueLongitudeDeg(earth)).toBeCloseTo(0, 6);
    expect(bodyTrueLongitudeDeg(mars)).toBeCloseTo(44.3, 6);
  });

  it("phaseAngleDeg = dest longitude − origin longitude", () => {
    expect(phaseAngleDeg(earth, mars)).toBeCloseTo(44.3, 6);
  });

  it("celestialToOrbitElements carries the parent μ + raw (radian) elements", () => {
    const el = celestialToOrbitElements(mars, bodies);
    expect(el).not.toBeNull();
    if (!el) return;
    expect(el.mu).toBe(MU_SUN);
    expect(el.sma).toBe(2.279392e11);
    expect(el.meanAnomalyAtEpoch).toBeCloseTo(44.3 * DEG, 9);
  });

  it("celestialToOrbitElements returns null when elements are missing", () => {
    expect(celestialToOrbitElements(sun, bodies)).toBeNull();
  });

  it("transferDestinations lists same-parent siblings only", () => {
    expect(transferDestinations(earth, bodies).map((b) => b.name)).toEqual([
      "Mars",
    ]);
    // Sun (no parent) has no siblings here
    expect(transferDestinations(sun, bodies)).toEqual([]);
  });

  it("computeTransfer produces a GO solution when phase sits on the ideal", () => {
    const sol = computeTransfer({
      origin: earth,
      dest: mars,
      bodies,
      parkingRadius: 6.571e6,
      nowUt: 0,
    });
    expect(sol).not.toBeNull();
    if (!sol) return;
    expect(sol.status).toBe("go");
    expect(sol.ejectionDeltaV).toBeCloseTo(3613, -2);
  });

  it("buildTransferPorkchop returns a grid with a finite best cell", () => {
    const grid = buildTransferPorkchop({
      origin: earth,
      dest: mars,
      bodies,
      nowUt: 0,
      departureSamples: 12,
      arrivalSamples: 12,
    });
    expect(grid).not.toBeNull();
    if (!grid) return;
    expect(grid.cells).toHaveLength(12);
    expect(grid.best).not.toBeNull();
    expect(grid.best && Number.isFinite(grid.best.deltaV)).toBe(true);
    expect(grid.best && grid.best.deltaV > 0).toBe(true);
  });

  // Correctness oracle (main's brief): a correct Earth→Mars window is a fully
  // solved SMOOTH BOWL with a single central minimum — that, and only that,
  // contours to the canonical nested-bullseye porkchop. Holes, edge minima or
  // corners that beat the centre would mean the grid (not the visuals) is wrong.
  // `nowUt` sits well before the window so the departure axis isn't clamped and
  // the bowl is symmetric around its known optimum (Earth→Mars ideal at UT 0).
  it("buildTransferPorkchop is a hole-free bowl with an interior minimum", () => {
    const N = 16;
    const grid = buildTransferPorkchop({
      origin: earth,
      dest: mars,
      bodies,
      nowUt: -10 * 365 * DAY,
      centerDepUt: 0,
      departureSamples: N,
      arrivalSamples: N,
    });
    expect(grid).not.toBeNull();
    if (!grid?.best) return;

    // 1. No holes: every cell solved (a smooth field, not scattered blocks).
    const nulls = grid.cells
      .flat()
      .filter((c) => c.deltaV == null || !Number.isFinite(c.deltaV));
    expect(nulls).toHaveLength(0);

    // 2. Single central minimum: the best cell is in the interior, not on an
    //    edge (an edge minimum means the window missed the optimum).
    expect(grid.best.i).toBeGreaterThan(0);
    expect(grid.best.i).toBeLessThan(N - 1);
    expect(grid.best.j).toBeGreaterThan(0);
    expect(grid.best.j).toBeLessThan(N - 1);

    // 3. Bowl shape: all four corners cost strictly more than the centre.
    const corner = (i: number, j: number) => grid.cells[i][j].deltaV ?? 0;
    const best = grid.best.deltaV;
    expect(corner(0, 0)).toBeGreaterThan(best);
    expect(corner(0, N - 1)).toBeGreaterThan(best);
    expect(corner(N - 1, 0)).toBeGreaterThan(best);
    expect(corner(N - 1, N - 1)).toBeGreaterThan(best);
  });
});

describe("upcomingWindows", () => {
  const DAY = 86400;
  const SYNODIC = 780 * DAY;

  function mkGrid(bestDepUt: number, bestDv: number): PorkchopGrid {
    return {
      cells: [
        [
          {
            depUt: bestDepUt,
            arrUt: bestDepUt + 1e7,
            tofSec: 1e7,
            deltaV: bestDv,
          },
        ],
      ],
      departureUts: [bestDepUt],
      arrivalUts: [bestDepUt + 1e7],
      best: {
        depUt: bestDepUt,
        arrUt: bestDepUt + 1e7,
        tofSec: 259 * DAY,
        deltaV: bestDv,
        i: 0,
        j: 0,
        solution: { v1: [0, 0, 0], v2: [0, 0, 0] },
      },
      minDeltaV: bestDv,
      maxDeltaV: bestDv,
    };
  }

  function mkSolution(
    overrides: Partial<TransferSolution> = {},
  ): TransferSolution {
    return {
      idealPhaseDeg: 44.3,
      currentPhaseDeg: 44.3,
      phaseDeltaDeg: 0,
      status: "go",
      synodicPeriodSec: SYNODIC,
      waitSeconds: 0,
      nowUt: 0,
      departureUt: 0,
      transferTimeSec: 259 * DAY,
      arrivalUt: 259 * DAY,
      vInf: 2945,
      ejectionDeltaV: 3511,
      ejectionAngleDeg: 151,
      ...overrides,
    };
  }

  it("returns [] when no transfer solves", () => {
    const empty: PorkchopGrid = {
      cells: [],
      departureUts: [],
      arrivalUts: [],
      best: null,
      minDeltaV: null,
      maxDeltaV: null,
    };
    expect(upcomingWindows(mkSolution(), empty, 0, 4)).toEqual([]);
  });

  it("enumerates `count` windows from solution.departureUt, one synodic apart", () => {
    const sol = mkSolution({ departureUt: 100 * DAY });
    const windows = upcomingWindows(sol, mkGrid(0, 5600), 0, 4);
    expect(windows).toHaveLength(4);
    expect(windows.map((w) => w.index)).toEqual([0, 1, 2, 3]);
    // window 0 departs at solution.departureUt (the phase-based next window)
    expect(windows[0].departureUt).toBeCloseTo(100 * DAY, 6);
    expect(windows[1].departureUt).toBeCloseTo(100 * DAY + SYNODIC, 6);
    expect(windows[3].departureUt).toBeCloseTo(100 * DAY + 3 * SYNODIC, 6);
  });

  it("carries countdown, Δv (porkchop), transfer time, arrival + ejection per window", () => {
    const sol = mkSolution({ departureUt: 100 * DAY });
    const windows = upcomingWindows(sol, mkGrid(0, 5600), 0, 2);
    const w = windows[0];
    expect(w.waitSeconds).toBeCloseTo(100 * DAY, 6);
    expect(w.deltaV).toBe(5600); // from the porkchop optimum
    expect(w.transferTimeSec).toBe(259 * DAY); // from the solution
    expect(w.arrivalUt).toBeCloseTo(100 * DAY + 259 * DAY, 6);
    expect(w.ejectionDeltaV).toBe(3511);
    expect(w.ejectionAngleDeg).toBe(151);
  });

  it("clamps a negative countdown to zero (window already at now)", () => {
    const windows = upcomingWindows(
      mkSolution(),
      mkGrid(0, 5600),
      500 * DAY,
      1,
    );
    expect(windows[0].waitSeconds).toBe(0);
  });

  it("returns a single window when the synodic period is degenerate", () => {
    const windows = upcomingWindows(
      mkSolution({ synodicPeriodSec: Number.POSITIVE_INFINITY }),
      mkGrid(0, 5600),
      0,
      4,
    );
    expect(windows).toHaveLength(1);
  });
});
