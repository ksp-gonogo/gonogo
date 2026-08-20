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
  porkchopGridQuantum,
  quantiseGridUt,
  reachEntries,
  reachVerdict,
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
  // solved SMOOTH BOWL with a single central minimum, that, and only that,
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

describe("reachEntries: what this craft can get to, and on what", () => {
  const venus = mkBody({
    index: 3,
    name: "Venus",
    referenceBody: "Sun",
    gravParameter: 3.24859e14,
    radius: 6.0518e6,
    maxAtmosphere: 2.5e5,
    semiMajorAxis: 1.08209e11,
    eccentricity: 0,
    inclination: 0,
    lan: 0,
    argumentOfPeriapsis: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
    period: 224.7 * DAY,
    trueAnomaly: 0,
  });
  // Mars needs a surface to circularise above; the shared fixture has none.
  const marsWithSurface = mkBody({
    ...mars,
    radius: 3.3895e6,
    maxAtmosphere: 1.25e5,
  });
  const reachBodies = [sun, earth, marsWithSurface, venus];
  const R_LEO = 6.571e6;

  const entries = () =>
    reachEntries({
      origin: earth,
      bodies: reachBodies,
      parkingRadius: R_LEO,
      nowUt: 0,
    });

  it("covers every sibling destination, cheapest first", () => {
    const rows = entries();
    expect(rows.map((r) => r.body.name).sort()).toEqual(["Mars", "Venus"]);
    expect(rows[0].totalDeltaV).toBeLessThan(rows[1].totalDeltaV!);
  });

  /*
   * The case that justifies quoting capture at all, and it is not a contrived one.
   * Venus is CHEAPER to depart for than Mars and more expensive to arrive at, so a
   * list ranked on ejection alone would order these two backwards and call Venus
   * the nearer destination. Insertion into Venus orbit is famously costly: a deep
   * well and a high arrival excess.
   */
  it("ranks on the whole trip, which reverses the departure-only order here", () => {
    const rows = entries();
    const mars_ = rows.find((r) => r.body.name === "Mars")!;
    const venus_ = rows.find((r) => r.body.name === "Venus")!;

    expect(venus_.ejectionDeltaV!).toBeLessThan(mars_.ejectionDeltaV!);
    expect(venus_.captureDeltaV!).toBeGreaterThan(mars_.captureDeltaV!);
    expect(venus_.totalDeltaV!).toBeGreaterThan(mars_.totalDeltaV!);
    expect(rows[0].body.name).toBe("Mars");
  });

  it("quotes ejection + capture, not the porkchop's characteristic figure", () => {
    const mars_ = entries().find((r) => r.body.name === "Mars")!;
    expect(mars_.ejectionDeltaV).toBeCloseTo(3613, -2);
    expect(mars_.captureDeltaV).toBeCloseTo(2081, -2);
    expect(mars_.totalDeltaV).toBeCloseTo(3613 + 2081, -2);
  });

  it("carries the window timing alongside the cost", () => {
    const mars_ = entries().find((r) => r.body.name === "Mars")!;
    expect(mars_.departureUt).toBeGreaterThanOrEqual(0);
    expect(mars_.transferTimeSec).toBeCloseTo(258.9 * DAY, -4);
  });

  /*
   * A destination whose elements have not arrived is a row with no numbers, NOT a
   * row that vanishes. An operator who cannot see that Mars exists cannot tell the
   * difference between "unreachable" and "we have not been told about it".
   */
  it("keeps a destination whose elements are incomplete, with null figures", () => {
    const halfSynced = mkBody({
      index: 4,
      name: "Halfsynced",
      referenceBody: "Sun",
      semiMajorAxis: 3e11,
      period: 900 * DAY,
    });
    const rows = reachEntries({
      origin: earth,
      bodies: [...reachBodies, halfSynced],
      parkingRadius: R_LEO,
      nowUt: 0,
    });
    const row = rows.find((r) => r.body.name === "Halfsynced");
    expect(row).toBeDefined();
    expect(row!.totalDeltaV).toBeNull();
    expect(row!.captureDeltaV).toBeNull();
  });

  it("rows with no cost sort last, so the affordable list reads top-down", () => {
    const rows = reachEntries({
      origin: earth,
      bodies: [
        ...reachBodies,
        mkBody({
          index: 4,
          name: "Halfsynced",
          referenceBody: "Sun",
          semiMajorAxis: 3e11,
          period: 900 * DAY,
        }),
      ],
      parkingRadius: R_LEO,
      nowUt: 0,
    });
    expect(rows[rows.length - 1].body.name).toBe("Halfsynced");
  });
});

describe("reachVerdict: the band, not a boolean", () => {
  const cost = { ejectionDeltaV: 1000, captureDeltaV: 500, totalDeltaV: 1500 };

  it("affords the whole trip: GO", () => {
    expect(reachVerdict(cost, 2000, 0)).toBe("go");
  });

  it("affords departure but not capture: a different answer from unreachable", () => {
    expect(reachVerdict(cost, 1200, 0)).toBe("one-way");
  });

  it("cannot afford departure: no", () => {
    expect(reachVerdict(cost, 500, 0)).toBe("no");
  });

  /*
   * The model is coplanar and ignores plane change entirely, so a hard boundary
   * drawn on it would be more confident than the arithmetic supports. Within 10%
   * of the ejection threshold reads MARGINAL rather than a crisp yes or no.
   */
  it("reads marginal within a tenth of the ejection threshold, either side", () => {
    expect(reachVerdict(cost, 1000 * 1.05, 0)).toBe("marginal");
    expect(reachVerdict(cost, 1000 * 0.95, 0)).toBe("marginal");
  });

  it("spends the reserve before the verdict, so a held-back budget cannot be promised", () => {
    expect(reachVerdict(cost, 2000, 0)).toBe("go");
    expect(reachVerdict(cost, 2000, 600)).toBe("one-way");
  });

  it("has no verdict at all without a budget or without a cost", () => {
    expect(reachVerdict(cost, null, 0)).toBeNull();
    expect(reachVerdict({ ...cost, totalDeltaV: null }, 2000, 0)).toBeNull();
  });
});

describe("porkchop grid quantisation: why it scales with the chart", () => {
  const T_EARTH_MARS = 258.9 * DAY;

  it("rounds a frame-rate sequence of UTs onto one value", () => {
    const q = porkchopGridQuantum(T_EARTH_MARS);
    const base = 1_000_000;
    // Sixty frames of a 1x clock: about 16.7ms of game time each.
    const buckets = new Set(
      Array.from({ length: 60 }, (_, f) =>
        quantiseGridUt(base + f * 0.0167, q),
      ),
    );
    expect(buckets.size).toBe(1);
  });

  /*
   * The property a fixed quantum does not have, and the reason this is expressed in
   * transfer times. At 100,000x warp a frame advances UT by ~1,670 seconds, so a
   * 60-second bucket changes on EVERY frame and a memo keyed on it rebuilds on every
   * frame: the churn returns exactly when the clock is fastest.
   */
  it("still holds at 100,000x warp, where a fixed 60-second bucket would not", () => {
    const q = porkchopGridQuantum(T_EARTH_MARS);
    const base = 1_000_000;
    const utPerFrame = 0.0167 * 100_000; // ~1,670 UT-seconds per frame

    const scaled = new Set(
      Array.from({ length: 60 }, (_, f) =>
        quantiseGridUt(base + f * utPerFrame, q),
      ),
    );
    const fixed60 = new Set(
      Array.from(
        { length: 60 },
        (_, f) => Math.floor((base + f * utPerFrame) / 60) * 60,
      ),
    );

    // The scaled quantum still collapses a second of frames into a handful of rebuilds;
    // the fixed one collapses nothing at all.
    expect(fixed60.size).toBe(60);
    expect(scaled.size).toBeLessThan(5);
  });

  it("is far below one departure sample, so the chart cannot show the rounding", () => {
    const q = porkchopGridQuantum(T_EARTH_MARS) as number;
    // The departure axis spans 0.8·T across 32 samples.
    const oneSample = (0.8 * T_EARTH_MARS) / 31;
    expect(q).toBeLessThan(oneSample / 10);
  });

  it("declines rather than dividing by zero when there is no transfer time", () => {
    expect(porkchopGridQuantum(0)).toBeNull();
    expect(porkchopGridQuantum(Number.NaN)).toBeNull();
    // A null quantum must pass the UT through, never zero it.
    expect(quantiseGridUt(12_345, null)).toBe(12_345);
  });
});

describe("reach list recompute quantum: derived from what the column can show", () => {
  // The widget quantises `nowUt` to one Kerbin day before the reach memo (see
  // `REACH_RECOMPUTE_UT`). Kept as a literal here rather than imported from the widget,
  // so a change to the widget's constant fails this rather than silently agreeing.
  const KERBIN_DAY = 21_600;

  it("holds under warp, where the old 60-second bucket did not", () => {
    const base = 1_000_000;
    // 100,000x: a frame advances UT by ~1,670 seconds.
    const utPerFrame = 0.0167 * 100_000;
    const bucket = (ut: number, q: number) => Math.floor(ut / q) * q;

    const day = new Set(
      Array.from({ length: 60 }, (_, f) =>
        bucket(base + f * utPerFrame, KERBIN_DAY),
      ),
    );
    const sixtySeconds = new Set(
      Array.from({ length: 60 }, (_, f) => bucket(base + f * utPerFrame, 60)),
    );

    // The old bucket changed on every frame at this warp, which is the whole defect.
    expect(sixtySeconds.size).toBe(60);
    expect(day.size).toBeLessThanOrEqual(5);
  });

  it("does not move the delta-v columns at all, which is why coarsening it is safe", () => {
    // The costs are functions of radii and μ, so the same destination priced at two very
    // different UTs must give identical Δv. Only the timing columns may differ.
    const mk = (nowUt: number) =>
      reachEntries({ origin: earth, bodies, parkingRadius: 6.571e6, nowUt });
    const early = mk(0).find((r) => r.body.name === "Mars");
    const late = mk(500 * DAY).find((r) => r.body.name === "Mars");
    expect(early?.totalDeltaV).toBeCloseTo(late?.totalDeltaV as number, 6);
    expect(early?.transferTimeSec).toBeCloseTo(
      late?.transferTimeSec as number,
      6,
    );
  });
});
