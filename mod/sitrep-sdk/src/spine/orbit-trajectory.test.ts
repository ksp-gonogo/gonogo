import { describe, expect, it } from "vitest";
import {
  PropagationHorizonKindLike as Reach,
  TrajectoryKindLike as Shape,
} from "./kepler";
import { orbitTrajectory } from "./orbit-trajectory";

/** Kerbin's GM, so the periods below are the real ~2000 s of a low orbit. */
const KERBIN_MU = 3.5316e12;

/** A low, near-circular Kerbin orbit in WIRE units: degrees where KSP uses degrees. */
function lko(overrides: Record<string, unknown> = {}) {
  return {
    sma: { magnitude: 681_500 },
    ecc: { magnitude: 0.005 },
    inc: { magnitude: 0 },
    lan: { magnitude: 0 },
    argPe: { magnitude: 0 },
    meanAnomalyAtEpoch: { magnitude: 0 },
    epoch: { magnitude: 0 },
    mu: { magnitude: KERBIN_MU },
    ...overrides,
  };
}

const ANALYTIC = { kind: Reach.Unbounded, trajectoryKind: Shape.Analytic };

describe("orbitTrajectory", () => {
  it("answers conic for the analytic provider", () => {
    expect(
      orbitTrajectory({ orbit: lko({ horizon: ANALYTIC }), viewUt: 0 }),
    ).toEqual({ shape: "conic" });
  });

  it("answers conic for an analytic ESCAPE trajectory too", () => {
    // A hyperbola is still a conic, and the conic renderer already draws one.
    // The shape question is about the provider's physics, not the eccentricity.
    expect(
      orbitTrajectory({
        orbit: lko({ ecc: { magnitude: 1.4 }, horizon: ANALYTIC }),
        viewUt: 0,
      }),
    ).toEqual({ shape: "conic" });
  });

  it("answers an arc, not a conic, when the provider integrates", () => {
    const answer = orbitTrajectory({
      orbit: lko({
        horizon: {
          kind: Reach.Until,
          untilUt: 500,
          trajectoryKind: Shape.Integrated,
        },
      }),
      viewUt: 0,
    });
    expect(answer.shape).toBe("arc");
    if (answer.shape !== "arc") return;
    expect(answer.fromUt).toBe(0);
    expect(answer.toUt).toBe(500);
    expect(answer.points).toHaveLength(128);
    // Every point sits on the orbit, so its radius is between the apsides.
    for (const p of answer.points) {
      const r = Math.hypot(p.x, p.y);
      expect(r).toBeGreaterThan(681_500 * (1 - 0.005) - 1);
      expect(r).toBeLessThan(681_500 * (1 + 0.005) + 1);
    }
  });

  it("stops the arc at one revolution when the horizon reaches further", () => {
    const period = 2 * Math.PI * Math.sqrt(681_500 ** 3 / KERBIN_MU);
    const answer = orbitTrajectory({
      orbit: lko({
        horizon: {
          kind: Reach.Until,
          untilUt: 1e9,
          trajectoryKind: Shape.Integrated,
        },
      }),
      viewUt: 0,
    });
    expect(answer.shape).toBe("arc");
    if (answer.shape !== "arc") return;
    // A second lap would retrace the first, which asserts a closure osculating
    // elements cannot promise.
    expect(answer.toUt).toBeCloseTo(period, 6);
  });

  it("takes the arc from the VIEW instant, not the elements' epoch", () => {
    const answer = orbitTrajectory({
      orbit: lko({
        epoch: { magnitude: 0 },
        horizon: {
          kind: Reach.Until,
          untilUt: 9_000,
          trajectoryKind: Shape.Integrated,
        },
      }),
      viewUt: 8_000,
    });
    expect(answer.shape).toBe("arc");
    if (answer.shape !== "arc") return;
    expect(answer.fromUt).toBe(8_000);
    expect(answer.toUt).toBe(9_000);
  });

  it("withholds when the producer stated reach but not shape", () => {
    expect(
      orbitTrajectory({
        orbit: lko({ horizon: { kind: Reach.Unbounded } }),
        viewUt: 0,
      }),
    ).toEqual({
      shape: "withheld",
      reason: "shape-not-stated",
      trajectoryKind: undefined,
    });
  });

  it("withholds when no horizon rides on the sample at all", () => {
    expect(orbitTrajectory({ orbit: lko(), viewUt: 0 })).toEqual({
      shape: "withheld",
      reason: "no-horizon-stated",
      trajectoryKind: undefined,
    });
  });

  it("withholds past a stated horizon, naming the kind that was bounded", () => {
    expect(
      orbitTrajectory({
        orbit: lko({
          horizon: {
            kind: Reach.Until,
            untilUt: 100,
            trajectoryKind: Shape.Integrated,
          },
        }),
        viewUt: 500,
      }),
    ).toEqual({
      shape: "withheld",
      reason: "past-horizon",
      trajectoryKind: Shape.Integrated,
    });
  });

  it("withholds an integrated ESCAPE trajectory rather than throwing", () => {
    // `solveAnomalies` refuses `ecc >= 1`. There is no arc to sample and no
    // conic authorised, so the honest answer is neither.
    expect(
      orbitTrajectory({
        orbit: lko({
          ecc: { magnitude: 1.4 },
          horizon: {
            kind: Reach.Until,
            untilUt: 500,
            trajectoryKind: Shape.Integrated,
          },
        }),
        viewUt: 0,
      }),
    ).toEqual({
      shape: "withheld",
      reason: "no-arc-available",
      trajectoryKind: Shape.Integrated,
    });
  });

  it("unwraps a horizon UT that arrives wrapped, as the wire delivers it", () => {
    const answer = orbitTrajectory({
      orbit: lko({
        horizon: {
          kind: Reach.Until,
          untilUt: { magnitude: 500 },
          trajectoryKind: Shape.Integrated,
        },
      }),
      viewUt: 0,
    });
    expect(answer.shape).toBe("arc");
    if (answer.shape !== "arc") return;
    expect(answer.toUt).toBe(500);
  });
});
