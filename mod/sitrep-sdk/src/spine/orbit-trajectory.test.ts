import { describe, expect, it } from "vitest";
import { deriveCelestialFacts } from "./celestial-facts";
import {
  PropagationHorizonKindLike as Reach,
  TrajectoryKindLike as Shape,
} from "./kepler";
import {
  TrajectoryDerivationLike as Derivation,
  TrajectoryFrameKindLike as Frame,
  frameCoordinatesArePulsating,
  orbitTrajectory,
  TrajectoryRefusalLike as Refusal,
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

/** An arc as the wire delivers it: a named frame, points, and a stated span. */
function wireArc(overrides: Record<string, unknown> = {}) {
  return {
    frame: { kind: Frame.Perifocal, lengthsPulsate: false },
    points: [
      {
        ut: { magnitude: 0 },
        x: { magnitude: 700_000 },
        y: { magnitude: 0 },
        z: { magnitude: 0 },
      },
      {
        ut: { magnitude: 250 },
        x: { magnitude: 0 },
        y: { magnitude: 700_000 },
        z: { magnitude: 1_000 },
      },
      {
        ut: { magnitude: 500 },
        x: { magnitude: -700_000 },
        y: { magnitude: 0 },
        z: { magnitude: 0 },
      },
    ],
    fromUt: { magnitude: 0 },
    toUt: { magnitude: 500 },
    sourcePointCount: { magnitude: 4096 },
    derivation: Derivation.OwnNBody,
    ...overrides,
  };
}

const INTEGRATED = {
  kind: Reach.Until,
  untilUt: 500,
  trajectoryKind: Shape.Integrated,
};

describe("orbitTrajectory: the provider's own points", () => {
  it("draws the carried points rather than the conic they are tangent to", () => {
    const answer = orbitTrajectory({
      orbit: lko({ horizon: INTEGRATED, arc: wireArc() }),
      viewUt: 0,
    });
    expect(answer.shape).toBe("arc");
    if (answer.shape !== "arc") return;
    // Three carried points, not the 128 a sampled conic would produce.
    expect(answer.points).toHaveLength(3);
    expect(answer.points[1]).toEqual({ x: 0, y: 700_000, z: 1_000, ut: 250 });
    expect(answer.derivation).toBe(Derivation.OwnNBody);
  });

  it("names the far end as the horizon, never as a revolution", () => {
    // An integrated path does not retrace, so it has no lap convention to stop
    // at: wherever a carried arc ends, that is where the provider's authority
    // stopped, and the mark on the diagram says exactly that.
    const answer = orbitTrajectory({
      orbit: lko({ horizon: INTEGRATED, arc: wireArc() }),
      viewUt: 0,
    });
    expect(answer.shape).toBe("arc");
    if (answer.shape !== "arc") return;
    expect(answer.farEnd).toBe("horizon");
  });

  it("carries the pre-decimation count so a thinned curve is not read as a short one", () => {
    const answer = orbitTrajectory({
      orbit: lko({ horizon: INTEGRATED, arc: wireArc() }),
      viewUt: 0,
    });
    expect(answer.shape).toBe("arc");
    if (answer.shape !== "arc") return;
    expect(answer.points.length).toBe(3);
    expect(answer.sourcePointCount).toBe(4096);
  });

  it("rotates inertial points into the frame the diagrams draw in", () => {
    // A polar orbit with the node and periapsis on the reference axis: the
    // perifocal +y axis then points along inertial +z, so a purely inertial-z
    // point must come back as a purely perifocal-y one. A sign error in the
    // rotation shows up here as a mirrored curve rather than as a crash.
    const answer = orbitTrajectory({
      orbit: lko({
        inc: { magnitude: 90 },
        lan: { magnitude: 0 },
        argPe: { magnitude: 0 },
        horizon: INTEGRATED,
        arc: wireArc({
          frame: { kind: Frame.BodyCentredInertial, lengthsPulsate: false },
          points: [
            { ut: 0, x: 700_000, y: 0, z: 0 },
            { ut: 250, x: 0, y: 0, z: 700_000 },
            // Inertial +y is perifocal -z for this orbit. The out-of-plane
            // component is the ONLY one whose sign this case can see: the two
            // points above both land on a perifocal axis with z genuinely zero,
            // and a sign error there is invisible because zero has no sign.
            { ut: 500, x: 0, y: 700_000, z: 0 },
          ],
        }),
      }),
      viewUt: 0,
    });
    expect(answer.shape).toBe("arc");
    if (answer.shape !== "arc") return;
    expect(answer.points[0].x).toBeCloseTo(700_000, 6);
    expect(answer.points[0].y).toBeCloseTo(0, 6);
    expect(answer.points[0].z).toBeCloseTo(0, 6);
    expect(answer.points[1].x).toBeCloseTo(0, 6);
    expect(answer.points[1].y).toBeCloseTo(700_000, 6);
    expect(answer.points[2].z).toBeCloseTo(-700_000, 6);
    // And the arc names the frame it ENDED in, not the one it arrived in.
    expect(answer.frame.kind).toBe(Frame.Perifocal);
  });

  it("declines an arc whose frame nobody named", () => {
    // The same points are a different curve per frame, so guessing one produces
    // a plausible wrong shape. Falling back to the conic is the visible answer.
    const answer = orbitTrajectory({
      orbit: lko({
        horizon: INTEGRATED,
        arc: wireArc({
          frame: { kind: Frame.Unspecified, lengthsPulsate: false },
        }),
      }),
      viewUt: 0,
    });
    expect(answer.shape).toBe("arc");
    if (answer.shape !== "arc") return;
    expect(answer.points).toHaveLength(128);
    expect(answer.derivation).toBe(Derivation.OwnClosedForm);
  });

  it("declines an arc of one point, which is not a path", () => {
    const answer = orbitTrajectory({
      orbit: lko({
        horizon: INTEGRATED,
        arc: wireArc({ points: [{ ut: 0, x: 700_000, y: 0, z: 0 }] }),
      }),
      viewUt: 0,
    });
    expect(answer.shape).toBe("arc");
    if (answer.shape !== "arc") return;
    expect(answer.points).toHaveLength(128);
  });
});

describe("orbitTrajectory: the two refusals only an integrating provider has", () => {
  it("says beyond-budget rather than borrowing the horizon's sentence", () => {
    expect(
      orbitTrajectory({
        orbit: lko({ horizon: INTEGRATED, arcRefusal: Refusal.BeyondBudget }),
        viewUt: 0,
      }),
    ).toEqual({
      shape: "withheld",
      reason: "beyond-budget",
      trajectoryKind: Shape.Integrated,
    });
  });

  it("says no-force-model, which has no operator remedy at all", () => {
    expect(
      orbitTrajectory({
        orbit: lko({ horizon: INTEGRATED, arcRefusal: Refusal.NoForceModel }),
        viewUt: 0,
      }),
    ).toEqual({
      shape: "withheld",
      reason: "no-force-model",
      trajectoryKind: Shape.Integrated,
    });
  });

  it("answers the arc refusal ahead of the horizon gate", () => {
    // A producer with no force model never got as far as having a horizon
    // opinion. Letting `no-horizon-stated` answer for it would name a producer
    // bug where the truth is a missing install, and send the operator looking
    // in the wrong place.
    expect(
      orbitTrajectory({
        orbit: lko({ arcRefusal: Refusal.NoForceModel }),
        viewUt: 0,
      }),
    ).toEqual({
      shape: "withheld",
      reason: "no-force-model",
      trajectoryKind: undefined,
    });
  });

  it("treats an unattempted arc as nothing refused", () => {
    expect(
      orbitTrajectory({
        orbit: lko({ horizon: ANALYTIC, arcRefusal: Refusal.NotAttempted }),
        viewUt: 0,
      }),
    ).toEqual({ shape: "conic" });
  });

  it("treats a drawn arc's own value as nothing refused", () => {
    expect(
      orbitTrajectory({
        orbit: lko({ horizon: ANALYTIC, arcRefusal: Refusal.NotRefused }),
        viewUt: 0,
      }),
    ).toEqual({ shape: "conic" });
  });

  it("keeps an unattempted arc distinguishable from a drawn one", () => {
    // The two were one value, so a client could not tell an install where the
    // integrated path never runs from one where it runs cleanly.
    expect(Refusal.NotAttempted).not.toBe(Refusal.NotRefused);
    expect(Refusal.NotAttempted).toBe(0);
  });
});

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
    expect(trajectoryFrameLabel(answer.frame, SYSTEM)).toBe(
      "Home-centred, Star held still",
    );
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
    // And the curve is genuinely somewhere else: a rotating frame is not the
    // orbit plane, so the same index is a different point.
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
      "Star-Home rotating-pulsating",
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
    // "Follow the control frame" with nothing publishing one is the ordinary
    // case, and it must draw rather than refuse.
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
    ).toBe("body 44-centred, fixed stars");
  });

  it("names the perifocal frame as the orbit's own plane, which is what every widget drew in before", () => {
    expect(
      trajectoryFrameLabel(
        { kind: Frame.Perifocal, lengthsPulsate: false },
        SYSTEM,
      ),
    ).toBe("the orbit's own plane");
  });
});
