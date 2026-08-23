import type { OrbitPatch } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import {
  nextEncounter,
  type PatchPoint,
  predictTrajectory,
} from "./predictedTrajectory";

function patch(overrides: Partial<OrbitPatch> = {}): OrbitPatch {
  return {
    startUT: 0,
    endUT: 100,
    patchStartTransition: "INITIAL",
    patchEndTransition: "FINAL",
    PeA: 1_000_000,
    ApA: 1_000_000,
    inclination: 0,
    eccentricity: 0,
    epoch: 0,
    period: 100,
    argumentOfPeriapsis: 0,
    sma: 1_000_000,
    lan: 0,
    maae: 0,
    referenceBody: "Kerbin",
    semiLatusRectum: 1_000_000,
    semiMinorAxis: 1_000_000,
    closestEncounterBody: null,
    ...overrides,
  };
}

const NO_CHILDREN: ReadonlyMap<string, PatchPoint> = new Map();

describe("predictTrajectory", () => {
  it("returns nothing without patches", () => {
    expect(
      predictTrajectory({
        patches: [],
        parentName: "Kerbin",
        ut: 0,
        childOffsets: NO_CHILDREN,
      }).patches,
    ).toEqual([]);
  });

  it("samples a circular equatorial patch onto a centred ring in metres", () => {
    const { patches } = predictTrajectory({
      patches: [patch({ startUT: 0, endUT: 100 })],
      parentName: "Kerbin",
      ut: 0,
      childOffsets: NO_CHILDREN,
    });
    expect(patches).toHaveLength(1);
    const pts = patches[0].points;
    expect(pts.length).toBeGreaterThan(2);
    // Metres, not plot units: the diagram places these into the frame in force
    // and scales them, so a plot scale applied here would be a second one.
    for (const p of pts) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1e6, 1);
      expect(p.z).toBeCloseTo(0, 6);
    }
  });

  it("keeps the out-of-plane component of an inclined patch", () => {
    const { patches } = predictTrajectory({
      patches: [patch({ inclination: 30, startUT: 0, endUT: 100 })],
      parentName: "Kerbin",
      ut: 0,
      childOffsets: NO_CHILDREN,
    });
    // This used to be dropped here, on the stated grounds that the diagram was
    // flat, and the diagram is not flat: `patchStateAt` already answers in three
    // dimensions and two components of it were being taken.
    const depths = patches[0].points.map((p) => p.z);
    const peak = 1e6 * Math.sin((30 * Math.PI) / 180);
    expect(Math.max(...depths)).toBeCloseTo(peak, 1);
    expect(Math.min(...depths)).toBeCloseTo(-peak, 1);
  });

  it("marks the live patch (containing ut) as current and starts it at ut", () => {
    const { patches } = predictTrajectory({
      patches: [patch({ startUT: 0, endUT: 100 })],
      parentName: "Kerbin",
      ut: 25,
      childOffsets: NO_CHILDREN,
    });
    expect(patches).toHaveLength(1);
    expect(patches[0].isCurrent).toBe(true);
    // First sample is the vessel's position at ut=25 (quarter orbit), not at
    // startUT. For a circular orbit with maae=0, ut=25 → 90° → +y axis.
    const first = patches[0].points[0];
    expect(first.x).toBeCloseTo(0, 1);
    expect(first.y).toBeCloseTo(1e6, 1);
  });

  it("draws an encounter patch offset to the child body position and records the marker", () => {
    const munOffset = { x: 120e5, y: 0, z: 0 };
    const childOffsets = new Map<string, PatchPoint>([["Mun", munOffset]]);
    const patches = [
      patch({ startUT: 0, endUT: 50, patchEndTransition: "ENCOUNTER" }),
      patch({
        startUT: 50,
        endUT: 100,
        patchStartTransition: "ENCOUNTER",
        referenceBody: "Mun",
        sma: 200_000,
        eccentricity: 0,
        period: 60,
        maae: 0,
      }),
    ];
    const { patches: projected, encounters } = predictTrajectory({
      patches,
      parentName: "Kerbin",
      ut: 0,
      childOffsets,
    });
    expect(projected).toHaveLength(2);
    const munPatch = projected.find((p) => p.referenceBody === "Mun");
    expect(munPatch).toBeDefined();
    expect(munPatch?.startEncounter).toBe("encounter");
    // The Mun arc is centred on Mun's offset, not the origin, and the offset is
    // composed in METRES: a frame transform is affine, so adding a placed offset
    // to a placed arc would apply the frame's own translation twice.
    for (const p of munPatch?.points ?? []) {
      expect(Math.hypot(p.x - munOffset.x, p.y - munOffset.y)).toBeCloseTo(
        200_000,
        1,
      );
    }
    expect(encounters).toHaveLength(1);
    expect(encounters[0].kind).toBe("encounter");
    expect(encounters[0].body).toBe("Mun");
    expect(encounters[0].ut).toBe(50);
    // Marker sits at the first sample of the Mun patch.
    expect(encounters[0].x).toBeCloseTo(munPatch?.points[0].x ?? NaN, 6);
  });

  it("records an escape transition", () => {
    const patches = [
      patch({ startUT: 50, endUT: 100, patchStartTransition: "ESCAPE" }),
    ];
    const { encounters } = predictTrajectory({
      patches,
      parentName: "Kerbin",
      ut: 0,
      childOffsets: NO_CHILDREN,
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
      childOffsets: NO_CHILDREN,
    });
    expect(projected).toHaveLength(1);
    expect(projected[0].referenceBody).toBe("Kerbin");
  });

  it("skips hyperbolic patches the elliptical solver can't propagate", () => {
    const patches = [
      patch({ eccentricity: 1.4, period: Number.NaN }),
      patch({ referenceBody: "Kerbin" }),
    ];
    const { patches: projected } = predictTrajectory({
      patches,
      parentName: "Kerbin",
      ut: 0,
      childOffsets: NO_CHILDREN,
    });
    expect(projected).toHaveLength(1);
    expect(projected[0].referenceBody).toBe("Kerbin");
  });

  it("is case/whitespace insensitive on body names", () => {
    const { patches } = predictTrajectory({
      patches: [patch({ referenceBody: " kerbin " })],
      parentName: "Kerbin",
      ut: 0,
      childOffsets: NO_CHILDREN,
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
      childOffsets: NO_CHILDREN,
    });
    expect(nextEncounter(traj, 0)).toBeNull();
  });

  it("picks the earliest encounter after ut", () => {
    const childOffsets = new Map<string, PatchPoint>([
      ["Mun", { x: 100e5, y: 0, z: 0 }],
    ]);
    const patches = [
      patch({ startUT: 0, endUT: 50 }),
      patch({
        startUT: 50,
        endUT: 100,
        patchStartTransition: "ENCOUNTER",
        referenceBody: "Mun",
        sma: 200_000,
        period: 60,
      }),
    ];
    const traj = predictTrajectory({
      patches,
      parentName: "Kerbin",
      ut: 10,
      childOffsets,
    });
    const next = nextEncounter(traj, 10);
    expect(next).not.toBeNull();
    expect(next?.body).toBe("Mun");
    expect(next?.kind).toBe("encounter");
    expect(next?.ut).toBe(50);
  });
});
