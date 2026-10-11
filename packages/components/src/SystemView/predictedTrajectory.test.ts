import {
  type OrbitPatch,
  TransitionType,
  type WireOf,
  wrapTypePayload,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { nextEncounter, predictTrajectory } from "./predictedTrajectory";

function patch(overrides: Partial<WireOf<OrbitPatch>> = {}): OrbitPatch {
  return wrapTypePayload<OrbitPatch>("OrbitPatch", {
    startUt: 0,
    endUt: 100,
    patchStartTransition: TransitionType.Initial,
    patchEndTransition: TransitionType.Final,
    peA: 1_000_000,
    apA: 1_000_000,
    inc: 0,
    ecc: 0,
    epoch: 0,
    period: 100,
    argPe: 0,
    sma: 1_000_000,
    lan: 0,
    meanAnomalyAtEpoch: 0,
    referenceBody: "Kerbin",
    semiLatusRectum: 1_000_000,
    semiMinorAxis: 1_000_000,
    closestEncounterBody: null,
    ...overrides,
  });
}

const NO_BODIES = () => null;

describe("predictTrajectory", () => {
  it("returns nothing without patches", () => {
    expect(
      predictTrajectory({
        patches: [],
        parentName: "Kerbin",
        ut: 0,
        offsetAt: NO_BODIES,
      }).patches,
    ).toEqual([]);
  });

  it("samples a circular equatorial patch onto a centred ring in metres", () => {
    const { patches } = predictTrajectory({
      patches: [patch({ startUt: 0, endUt: 100 })],
      parentName: "Kerbin",
      ut: 0,
      offsetAt: NO_BODIES,
    });
    expect(patches).toHaveLength(1);
    const pts = patches[0].points;
    expect(pts.length).toBeGreaterThan(2);
    // Metres, not plot units: the diagram places and scales these, so a plot scale here would apply twice.
    for (const p of pts) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1e6, 1);
      expect(p.z).toBeCloseTo(0, 6);
    }
  });

  it("keeps the out-of-plane component of an inclined patch", () => {
    const { patches } = predictTrajectory({
      patches: [patch({ inc: 30, startUt: 0, endUt: 100 })],
      parentName: "Kerbin",
      ut: 0,
      offsetAt: NO_BODIES,
    });
    // `patchStateAt` answers in three dimensions, and depth is kept.
    const depths = patches[0].points.map((p) => p.z);
    const peak = 1e6 * Math.sin((30 * Math.PI) / 180);
    expect(Math.max(...depths)).toBeCloseTo(peak, 1);
    expect(Math.min(...depths)).toBeCloseTo(-peak, 1);
  });

  it("marks the live patch (containing ut) as current and starts it at ut", () => {
    const { patches } = predictTrajectory({
      patches: [patch({ startUt: 0, endUt: 100 })],
      parentName: "Kerbin",
      ut: 25,
      offsetAt: NO_BODIES,
    });
    expect(patches).toHaveLength(1);
    expect(patches[0].isCurrent).toBe(true);
    // The first sample is the vessel's position at ut=25 (quarter orbit), not at startUt: 90 degrees, the +y axis.
    const first = patches[0].points[0];
    expect(first.x).toBeCloseTo(0, 1);
    expect(first.y).toBeCloseTo(1e6, 1);
  });

  it("draws an encounter patch offset to the child body position and records the marker", () => {
    const munOffset = { x: 120e5, y: 0, z: 0 };
    const patches = [
      patch({
        startUt: 0,
        endUt: 50,
        patchEndTransition: TransitionType.Encounter,
      }),
      patch({
        startUt: 50,
        endUt: 100,
        patchStartTransition: TransitionType.Encounter,
        referenceBody: "Mun",
        sma: 200_000,
        ecc: 0,
        period: 60,
        meanAnomalyAtEpoch: 0,
      }),
    ];
    const { patches: projected, encounters } = predictTrajectory({
      patches,
      parentName: "Kerbin",
      ut: 0,
      offsetAt: (body) => (body === "Mun" ? munOffset : null),
    });
    expect(projected).toHaveLength(2);
    const munPatch = projected.find((p) => p.referenceBody === "Mun");
    expect(munPatch).toBeDefined();
    expect(munPatch?.startEncounter).toBe("encounter");
    // Centred on Mun's offset, composed in metres: adding a placed offset to a placed arc would apply the frame's translation twice.
    for (const p of munPatch?.points ?? []) {
      expect(Math.hypot(p.x - munOffset.x, p.y - munOffset.y)).toBeCloseTo(
        200_000,
        1,
      );
    }
    expect(encounters).toHaveLength(1);
    expect(encounters[0].kind).toBe("encounter");
    expect(encounters[0].body).toBe("Mun");
    expect(encounters[0].ut.magnitude).toBe(50);
    expect(encounters[0].x).toBeCloseTo(munPatch?.points[0].x ?? NaN, 6);
  });

  it("records an escape transition", () => {
    const patches = [
      patch({
        startUt: 50,
        endUt: 100,
        patchStartTransition: TransitionType.Escape,
      }),
    ];
    const { encounters } = predictTrajectory({
      patches,
      parentName: "Kerbin",
      ut: 0,
      offsetAt: NO_BODIES,
    });
    expect(encounters).toHaveLength(1);
    expect(encounters[0].kind).toBe("escape");
  });

  it("skips patches whose reference body isn't on the current frame", () => {
    const patches = [
      patch({ referenceBody: "Eve" }),
      patch({ referenceBody: "Kerbin" }),
    ];
    const { patches: projected } = predictTrajectory({
      patches,
      parentName: "Kerbin",
      ut: 0,
      offsetAt: NO_BODIES,
    });
    expect(projected).toHaveLength(1);
    expect(projected[0].referenceBody).toBe("Kerbin");
  });

  it("skips an open patch that carries no gravitational parameter to propagate it by", () => {
    const patches = [
      patch({ ecc: 1.4, sma: -1_000_000, period: null, apA: null }),
      patch({ referenceBody: "Kerbin" }),
    ];
    const { patches: projected } = predictTrajectory({
      patches,
      parentName: "Kerbin",
      ut: 0,
      offsetAt: NO_BODIES,
    });
    expect(projected).toHaveLength(1);
    expect(projected[0].referenceBody).toBe("Kerbin");
  });

  it("draws the open leg of a flyby about the body it passes, from the encounter to the escape", () => {
    const mu = 6.5138398e10;
    const sma = -800_000;
    const ecc = 1.3;
    const edge = 1.7;
    const edgeAnomaly = ecc * Math.sinh(edge) - edge;
    const halfSpan = edgeAnomaly / Math.sqrt(mu / Math.abs(sma) ** 3);
    const edgeRadius = Math.abs(sma) * (ecc * Math.cosh(edge) - 1);
    const munAt = { x: 12_000_000, y: 0, z: 0 };
    const { patches: projected, encounters } = predictTrajectory({
      patches: [
        patch({
          endUt: 100,
          patchEndTransition: TransitionType.Encounter,
        }),
        patch({
          referenceBody: "Mun",
          sma,
          ecc,
          period: null,
          apA: null,
          mu,
          meanAnomalyAtEpoch: -edgeAnomaly,
          epoch: 100,
          startUt: 100,
          endUt: 100 + 2 * halfSpan,
          patchStartTransition: TransitionType.Encounter,
          patchEndTransition: TransitionType.Escape,
        }),
      ],
      parentName: "Kerbin",
      ut: 0,
      offsetAt: (name) => (name === "Mun" ? munAt : null),
    });
    expect(projected).toHaveLength(2);
    const leg = projected[1];
    expect(leg.referenceBody).toBe("Mun");
    expect(leg.startEncounter).toBe("encounter");
    const radii = leg.points.map((p) =>
      Math.hypot(p.x - munAt.x, p.y - munAt.y, p.z - munAt.z),
    );
    expect(radii[0]).toBeCloseTo(edgeRadius, 2);
    expect(radii[radii.length - 1]).toBeCloseTo(edgeRadius, 2);
    expect(Math.min(...radii)).toBeCloseTo(Math.abs(sma) * (ecc - 1), -2);
    expect(encounters).toHaveLength(1);
    expect(encounters[0]).toMatchObject({ kind: "encounter", body: "Mun" });
    expect(encounters[0].x).toBe(leg.points[0].x);
  });

  it("offsets each sample of an open leg by where the body is at that sample's instant", () => {
    const mu = 6.5138398e10;
    const asked: number[] = [];
    const { patches: projected } = predictTrajectory({
      patches: [
        patch({
          referenceBody: "Mun",
          sma: -800_000,
          ecc: 1.3,
          period: null,
          apA: null,
          mu,
          meanAnomalyAtEpoch: -2,
          epoch: 100,
          startUt: 100,
          endUt: 4100,
          patchStartTransition: TransitionType.Encounter,
        }),
      ],
      parentName: "Kerbin",
      ut: 0,
      samplesPerPatch: 4,
      offsetAt: (_name, ut) => {
        asked.push(ut);
        // The Mun moving along +y at 500 m/s.
        return { x: 12_000_000, y: 500 * ut, z: 0 };
      },
    });
    expect(asked).toEqual([100, 1100, 2100, 3100, 4100]);
    expect(projected[0].points).toHaveLength(5);
  });

  it("is case/whitespace insensitive on body names", () => {
    const { patches } = predictTrajectory({
      patches: [patch({ referenceBody: " kerbin " })],
      parentName: "Kerbin",
      ut: 0,
      offsetAt: NO_BODIES,
    });
    expect(patches).toHaveLength(1);
  });
});

describe("nextEncounter", () => {
  it("returns null when the trajectory stays in one SOI", () => {
    const traj = predictTrajectory({
      patches: [patch()],
      parentName: "Kerbin",
      ut: 0,
      offsetAt: NO_BODIES,
    });
    expect(nextEncounter(traj, 0)).toBeNull();
  });

  it("picks the earliest encounter after ut", () => {
    const patches = [
      patch({ startUt: 0, endUt: 50 }),
      patch({
        startUt: 50,
        endUt: 100,
        patchStartTransition: TransitionType.Encounter,
        referenceBody: "Mun",
        sma: 200_000,
        period: 60,
      }),
    ];
    const traj = predictTrajectory({
      patches,
      parentName: "Kerbin",
      ut: 10,
      offsetAt: (body) => (body === "Mun" ? { x: 100e5, y: 0, z: 0 } : null),
    });
    const next = nextEncounter(traj, 10);
    expect(next).not.toBeNull();
    expect(next?.body).toBe("Mun");
    expect(next?.kind).toBe("encounter");
    expect(next?.ut.magnitude).toBe(50);
  });

  it("asks where a body is at the instant the patch around it begins, not at the instant on screen", () => {
    const asked: Array<[string, number]> = [];
    const patches = [
      patch({ startUt: 0, endUt: 50 }),
      patch({
        startUt: 50,
        endUt: 100,
        patchStartTransition: TransitionType.Encounter,
        referenceBody: "Mun",
        sma: 200_000,
        period: 60,
      }),
    ];
    predictTrajectory({
      patches,
      parentName: "Kerbin",
      ut: 10,
      offsetAt: (body, ut) => {
        asked.push([body, ut]);
        return { x: ut * 1e5, y: 0, z: 0 };
      },
    });
    expect(asked).toEqual([["Mun", 50]]);
  });

  it("centres the arc about the body where it is when the patch begins", () => {
    const patches = [
      patch({
        startUt: 50,
        endUt: 100,
        patchStartTransition: TransitionType.Encounter,
        referenceBody: "Mun",
        sma: 200_000,
        period: 60,
      }),
    ];
    const { patches: projected } = predictTrajectory({
      patches,
      parentName: "Kerbin",
      ut: 0,
      offsetAt: (_body, ut) => ({ x: ut * 1e5, y: 0, z: 0 }),
    });
    for (const p of projected[0]?.points ?? []) {
      expect(Math.hypot(p.x - 50e5, p.y)).toBeCloseTo(200_000, -2);
    }
  });

  it("leaves out a patch that ended before the instant on screen", () => {
    const { patches: projected } = predictTrajectory({
      patches: [
        patch({ startUt: 0, endUt: 50 }),
        patch({ startUt: 50, endUt: 100 }),
      ],
      parentName: "Kerbin",
      ut: 70,
      offsetAt: NO_BODIES,
    });
    expect(projected.map((p) => p.patchIndex)).toEqual([1]);
  });
});
