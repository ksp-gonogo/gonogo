import type { TopologyPart } from "@ksp-gonogo/core";
import type { DecodedPartShape } from "@ksp-gonogo/data";
import { describe, expect, it } from "vitest";
import {
  type FairingProfile,
  fairingBounds,
  fairingShellShape,
} from "./fairingShell";
import { buildShipMapPart } from "./shipTopology";

/* The stock ComSat Lx's AE-FF1 shell: its craft file's sections and the nose tip the game adds, as the mod sends them. */
const COMSAT_RINGS = [
  { h: 0, r: 0.625 },
  { h: 1.1307, r: 0.5193 },
  { h: 1.869, r: 0.2 },
  { h: 2.1927, r: 0 },
];

const profile = (rings = COMSAT_RINGS): FairingProfile => ({
  pivot: { x: 0, y: 0.17, z: 0 },
  axis: { x: 0, y: 1, z: 0 },
  rings,
});

/* A base ring 0.4 m tall and a 3 m truss the part never draws, as the AE-FF1's model holds. */
function baseShape(): DecodedPartShape {
  const box = (lo: number[], hi: number[]) => {
    const positions: number[] = [];
    for (const x of [lo[0], hi[0]])
      for (const y of [lo[1], hi[1]])
        for (const z of [lo[2], hi[2]]) positions.push(x, y, z);
    const quads = [
      [0, 1, 3, 2],
      [4, 6, 7, 5],
      [0, 4, 5, 1],
      [2, 3, 7, 6],
      [0, 2, 6, 4],
      [1, 5, 7, 3],
    ];
    const indices = quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
    return {
      positions: new Float32Array(positions),
      indices: new Uint16Array(indices),
    };
  };
  return {
    name: "fairingSize1",
    variant: null,
    meshes: [
      {
        key: "Mesh",
        shown: true,
        ...box([-0.656, -0.2, -0.656], [0.656, 0.2, 0.656]),
        sourceTriangles: 12,
      },
      {
        key: "Truss1",
        shown: false,
        ...box([-0.3, 0, -0.3], [0.3, 3.24, 0.3]),
        sourceTriangles: 12,
      },
    ],
  };
}

function fairingRow(
  cargoBay: "retracted" | "extended",
  fairing?: FairingProfile,
): TopologyPart {
  return {
    flightId: 7,
    persistentId: 7,
    parentFlightId: null,
    name: "fairingSize1",
    title: "AE-FF1 Airstream Protective Shell (1.25m)",
    category: "Payload",
    categoryOrdinal: 13,
    orgPos: [0, 0, 0],
    up: [0, 1, 0],
    forward: [0, 0, 1],
    bounds: {
      size: { x: 1.3125, y: 3.48, z: 1.3125 },
      center: { x: 0, y: 1.53, z: 0 },
    },
    dryMass: 0.136,
    inverseStage: 2,
    maxTemp: 2600,
    shape: "fairingSize1.White",
    modules: ["ModuleProceduralFairing", "ModuleCargoBay"],
    moduleStates: [{ type: "cargoBay", state: cargoBay }],
    fairing,
  } as unknown as TopologyPart;
}

describe("fairing shell from its profile", () => {
  it("winds every panel so its face points out of the shell", () => {
    const mesh = fairingShellShape(profile())?.meshes[0];
    if (!mesh) throw new Error("no shell");
    const p = mesh.positions;
    let inward = 0;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((e) => mesh.indices[t + e] * 3);
      const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const mid = [0, 1, 2].map((k) => (p[a + k] + p[b + k] + p[c + k]) / 3);
      const out = n[0] * mid[0] + n[1] * (mid[1] - 1.27) + n[2] * mid[2];
      if (out < 0) inward++;
    }
    expect(inward).toBe(0);
  });

  it("takes the box of the drawn base and the shell, not the hidden truss", () => {
    const box = fairingBounds(profile(), baseShape(), undefined);
    expect(box?.size.y).toBeCloseTo(0.17 + 2.1927 + 0.2, 4);
    expect(box?.size.x).toBeCloseTo(1.312, 3);
    expect(fairingBounds(profile([]), undefined, undefined)).toBeNull();
  });

  it("draws a standing shell over the base ring, and the base ring alone once the shell is gone", () => {
    const closed = buildShipMapPart(
      fairingRow("retracted", profile()),
      null,
      undefined,
      0,
      null,
      baseShape(),
    );
    expect(closed.shapeDrawing?.silhouette).toBeTruthy();
    expect(closed.shellDrawing?.drawing.silhouette).toBeTruthy();
    expect(closed.shellDrawing?.joins).toMatch(/^M/);
    expect(closed.size.y).toBeCloseTo(2.5627, 3);

    const jettisoned = buildShipMapPart(
      fairingRow("extended", profile([])),
      null,
      undefined,
      0,
      null,
      baseShape(),
    );
    expect(jettisoned.shapeDrawing?.silhouette).toBeTruthy();
    expect(jettisoned.shellDrawing).toBeUndefined();
    expect(jettisoned.size.y).toBeCloseTo(0.4, 3);
  });

  it("draws a fairing whose row predates the shell by its type, within its own box", () => {
    const unknown = buildShipMapPart(
      fairingRow("retracted"),
      null,
      undefined,
      0,
      null,
      baseShape(),
    );
    expect(unknown.shapeDrawing).toBeUndefined();
    expect(unknown.shellDrawing).toBeUndefined();
    expect(unknown.size.y).toBe(3.48);
  });
});
