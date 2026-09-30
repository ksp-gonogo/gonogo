import { describe, expect, it } from "vitest";
import { deriveCelestialFacts } from "./celestial-facts";
import {
  PropagationHorizonKindLike as Reach,
  TrajectoryKindLike as Shape,
} from "./kepler";
import {
  TrajectoryFrameKindLike as Frame,
  frameCoordinatesArePulsating,
  orbitTrajectory,
  trajectoryFrameLabel,
} from "./orbit-trajectory";
import { resolveReadFrame } from "./reference-frame";

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
    // A second lap would retrace the first, which asserts a closure osculating elements cannot promise.
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

/** An arc as the wire delivers it: a named frame, points, and a stated span. */
const INTEGRATED = {
  kind: Reach.Until,
  untilUt: 500,
  trajectoryKind: Shape.Integrated,
};

describe("orbitTrajectory: what the far end of a sampled conic means", () => {
  it("calls a lap a revolution, not a horizon", () => {
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
    expect(answer.farEnd).toBe("revolution");
  });

  it("calls a stated bound a horizon", () => {
    const answer = orbitTrajectory({
      orbit: lko({ horizon: INTEGRATED }),
      viewUt: 0,
    });
    expect(answer.shape).toBe("arc");
    if (answer.shape !== "arc") return;
    expect(answer.farEnd).toBe("horizon");
  });

  it("gives a conic a real zero out of plane, not an unfilled field", () => {
    const answer = orbitTrajectory({
      orbit: lko({ horizon: INTEGRATED }),
      viewUt: 0,
    });
    expect(answer.shape).toBe("arc");
    if (answer.shape !== "arc") return;
    for (const p of answer.points) expect(p.z).toBe(0);
    expect(answer.frame.kind).toBe(Frame.Perifocal);
  });
});

// ---------------------------------------------------------------------------
// Read frames: the curve re-expressed in a frame the widget chose.
// ---------------------------------------------------------------------------

const PLANET_MU = 3.986e14;
const MOON_MU = 4.905e12;
const STAR_MU = 1.327e20;
const AU = 1.496e11;
const LUNAR_DISTANCE = 3.844e8;

function bodyEntry(spec: {
  index: number;
  name: string;
  parentIndex?: number;
  mu: number;
  sma?: number;
}) {
  return {
    index: spec.index,
    name: spec.name,
    parentIndex: spec.parentIndex,
    gravParameter: { magnitude: spec.mu },
    orbit:
      spec.sma === undefined
        ? undefined
        : {
            sma: { magnitude: spec.sma },
            ecc: { magnitude: 0 },
            inc: { magnitude: 0 },
            lan: { magnitude: 0 },
            argPe: { magnitude: 0 },
            meanAnomalyAtEpoch: { magnitude: 0 },
            epoch: { magnitude: 0 },
          },
  };
}

const SYSTEM = deriveCelestialFacts(
  [
    bodyEntry({ index: 0, name: "Star", mu: STAR_MU }),
    bodyEntry({
      index: 1,
      name: "Home",
      parentIndex: 0,
      mu: PLANET_MU,
      sma: AU,
    }),
    bodyEntry({
      index: 2,
      name: "Moon",
      parentIndex: 1,
      mu: MOON_MU,
      sma: LUNAR_DISTANCE,
    }),
  ] as never,
  0,
);

/** A high orbit of Home, analytic, so the conic arm is the one under test. */
function homeOrbit(overrides: Record<string, unknown> = {}) {
  return {
    ...lko({
      sma: { magnitude: 2.0e7 },
      mu: { magnitude: PLANET_MU },
      horizon: ANALYTIC,
    }),
    referenceBodyIndex: 1,
    ...overrides,
  };
}

describe("orbitTrajectory read frames", () => {
  it("leaves the curve alone when no frame was asked for", () => {
    expect(orbitTrajectory({ orbit: homeOrbit(), viewUt: 0 })).toEqual({
      shape: "conic",
    });
  });

  it("stops answering conic once a frame is asked for, because an ellipse is not one in a rotating frame", () => {
    const answer = orbitTrajectory({
      orbit: homeOrbit(),
      viewUt: 0,
      samples: 16,
      readFrame: {
        choice: { kind: "parent-direction", bodyIndex: 1 },
        facts: SYSTEM,
      },
    });
    expect(answer.shape).toBe("arc");
  });

  it("names the frame it drew in, and it is the one that was asked for", () => {
    const answer = orbitTrajectory({
      orbit: homeOrbit(),
      viewUt: 0,
      samples: 16,
      readFrame: {
        choice: { kind: "parent-direction", bodyIndex: 1 },
        facts: SYSTEM,
      },
    });
    if (answer.shape !== "arc") throw new Error("expected an arc");
    expect(answer.frame.kind).toBe(Frame.BodyCentredParentDirection);
    expect(answer.frame.primaryBodyIndex).toBe(1);
    expect(answer.frame.secondaryBodyIndex).toBe(0);
    expect(trajectoryFrameLabel(answer.frame, SYSTEM)).toBe("Star-Home-Orbit");
  });

  it("keeps every radius, because a rotating frame turns the axes and moves nothing", () => {
    const turned = orbitTrajectory({
      orbit: homeOrbit(),
      viewUt: 0,
      samples: 16,
      readFrame: {
        choice: { kind: "parent-direction", bodyIndex: 1 },
        facts: SYSTEM,
      },
    });
    if (turned.shape !== "arc") throw new Error("expected an arc");
    // The orbit is near-circular at this semi-major axis, so every point of it
    // is that far from Home whichever way the axes point. A transform that
    // forgot to move the origin onto Home would put every point an AU away.
    for (const p of turned.points) {
      expect(Math.hypot(p.x, p.y, p.z) / 2.0e7).toBeCloseTo(1, 1);
    }
    // And the curve is genuinely somewhere else: a rotating frame is not the orbit plane, so the same index is a different point.
    const perifocal = orbitTrajectory({
      orbit: { ...homeOrbit(), horizon: INTEGRATED },
      viewUt: 0,
      samples: 16,
    });
    if (perifocal.shape !== "arc") throw new Error("expected a perifocal arc");
    expect(perifocal.frame.kind).toBe(Frame.Perifocal);
    expect(turned.points[8].x).not.toBeCloseTo(perifocal.points[8].x, -3);
  });

  it("says lengths pulsate, and what to multiply by, in a pulsating frame", () => {
    const answer = orbitTrajectory({
      orbit: homeOrbit(),
      viewUt: 0,
      samples: 16,
      readFrame: {
        choice: { kind: "rotating-pulsating", bodyIndex: 1 },
        facts: SYSTEM,
      },
    });
    if (answer.shape !== "arc") throw new Error("expected an arc");
    expect(answer.frame.lengthsPulsate).toBe(true);
    expect(frameCoordinatesArePulsating(answer.frame)).toBe(true);
    expect(answer.frame.unitLength).toBeCloseTo(AU, -8);
    expect(answer.frame.centreBodyIndex).toBeUndefined();
    expect(trajectoryFrameLabel(answer.frame, SYSTEM)).toBe(
      "Star-Home Lagrange",
    );
    // A coordinate here is a ratio, so the whole orbit is a small fraction of
    // one. That IS the frame: quoting it in metres would be off by an AU.
    for (const p of answer.points) {
      expect(Math.abs(p.x)).toBeLessThan(1.1);
    }
  });

  it("refuses rather than drawing when the frame cannot be formed", () => {
    // A rotating frame on the root star, which has no parent to rotate about.
    expect(
      orbitTrajectory({
        orbit: homeOrbit(),
        viewUt: 0,
        samples: 16,
        readFrame: {
          choice: { kind: "parent-direction", bodyIndex: 0 },
          facts: SYSTEM,
        },
      }),
    ).toEqual({ shape: "withheld", reason: "frame-unavailable" });
  });

  it("refuses when the curve cannot be placed in the system", () => {
    const orbit = homeOrbit();
    delete (orbit as { referenceBodyIndex?: number }).referenceBodyIndex;
    expect(
      orbitTrajectory({
        orbit,
        viewUt: 0,
        samples: 16,
        readFrame: {
          choice: { kind: "parent-direction", bodyIndex: 1 },
          facts: SYSTEM,
        },
      }),
    ).toEqual({ shape: "withheld", reason: "frame-unavailable" });
  });

  it("draws in the frame the curve came in when the control frame is not being published", () => {
    // "Follow the control frame" with nothing publishing one is the ordinary case, and it must draw rather than refuse.
    expect(
      orbitTrajectory({
        orbit: homeOrbit(),
        viewUt: 0,
        readFrame: {
          choice: { kind: "follow-control-frame" },
          facts: SYSTEM,
        },
      }),
    ).toEqual({ shape: "conic" });
  });

  it("resolves follow-control-frame against whatever the control frame is", () => {
    expect(
      resolveReadFrame(
        { kind: "follow-control-frame" },
        { kind: "rotating-pulsating", bodyIndex: 1 },
      ),
    ).toEqual({ kind: "rotating-pulsating", bodyIndex: 1 });
    expect(resolveReadFrame({ kind: "follow-control-frame" }, null)).toBeNull();
    expect(
      resolveReadFrame({ kind: "body-centred-inertial", bodyIndex: 2 }, null),
    ).toEqual({ kind: "body-centred-inertial", bodyIndex: 2 });
  });
});

describe("trajectoryFrameLabel", () => {
  it("says the frame was not stated rather than guessing one", () => {
    expect(trajectoryFrameLabel(undefined, SYSTEM)).toBe("frame not stated");
    expect(
      trajectoryFrameLabel(
        { kind: Frame.Unspecified, lengthsPulsate: false },
        SYSTEM,
      ),
    ).toBe("frame not stated");
  });

  it("names a body by index when the catalogue has not named it", () => {
    expect(
      trajectoryFrameLabel(
        {
          kind: Frame.BodyCentredInertial,
          centreBodyIndex: 44,
          lengthsPulsate: false,
        },
        SYSTEM,
      ),
    ).toBe("body 44-Centred Inertial");
  });

  it("names the perifocal frame as the orbit's own plane, which is what every widget drew in before", () => {
    expect(
      trajectoryFrameLabel(
        { kind: Frame.Perifocal, lengthsPulsate: false },
        SYSTEM,
      ),
    ).toBe("orbit plane");
  });
});
