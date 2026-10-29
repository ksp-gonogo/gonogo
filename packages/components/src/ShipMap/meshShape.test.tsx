import type { TopologyPart } from "@ksp-gonogo/core";
import {
  type DecodedPartShape,
  type DecodedPartShapeMesh,
  decodePartShape,
} from "@ksp-gonogo/data";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import winglet from "./__fixtures__/shapes/R8winglet.json";
import decoupler from "./__fixtures__/shapes/radialDecoupler1-2.json";
import {
  type Affine,
  composeAffine,
  drawShape,
  SCREEN_LIGHT,
  type ShapeDrawing,
  shapeFitsBox,
  TONE_STEPS,
  viewMesh,
} from "./meshShape";
import { renderPartShape, toneFill } from "./partShape";
import { buildShipMapPart } from "./shipTopology";

type Vec = [number, number, number];

const IDENTITY: Affine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

function rotateX(a: number): Affine {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0];
}

function rotateY(a: number): Affine {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0];
}

function translate(x: number, y: number, z: number): Affine {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
}

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossOf = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Collects quads as two triangles each, wound so `cross(b - a, c - a)` points along `facing`. */
class MeshBuilder {
  points: number[] = [];
  triangles: number[] = [];

  quad(corners: [Vec, Vec, Vec, Vec], facing: Vec) {
    const base = this.points.length / 3;
    for (const c of corners) this.points.push(...c);
    const normal = crossOf(
      sub(corners[1], corners[0]),
      sub(corners[2], corners[0]),
    );
    const order =
      dot(normal, facing) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of order) this.triangles.push(base + i);
    return this;
  }

  /** A closed box, its corners not shared between faces, as a mesh split at its seams is. */
  box(min: Vec, max: Vec) {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    this.quad(
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      [0, 0, 1],
    );
    this.quad(
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
      ],
      [0, 0, -1],
    );
    this.quad(
      [
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
      ],
      [1, 0, 0],
    );
    this.quad(
      [
        [x0, y0, z0],
        [x0, y1, z0],
        [x0, y1, z1],
        [x0, y0, z1],
      ],
      [-1, 0, 0],
    );
    this.quad(
      [
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      [0, 1, 0],
    );
    this.quad(
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
      ],
      [0, -1, 0],
    );
    return this;
  }

  mesh(key = "body", shown = true): DecodedPartShapeMesh {
    return {
      key,
      shown,
      positions: new Float32Array(this.points),
      indices: new Uint16Array(this.triangles),
      sourceTriangles: this.triangles.length / 3,
    };
  }
}

function shapeOf(...meshes: DecodedPartShapeMesh[]): DecodedPartShape {
  return { name: "test", variant: null, meshes };
}

/** The closed loops of path data, as lists of points. */
function loopsOf(d: string): [number, number][][] {
  return d
    .split("M")
    .filter(Boolean)
    .map((loop) => {
      const numbers = loop.replace("Z", "").trim().split(/\s+/).map(Number);
      const points: [number, number][] = [];
      for (let i = 0; i < numbers.length; i += 2) {
        points.push([numbers[i], numbers[i + 1]]);
      }
      return points;
    });
}

function inside(loop: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

const xRange = (loop: [number, number][]) => [
  Math.min(...loop.map((p) => p[0])),
  Math.max(...loop.map((p) => p[0])),
];

/** A cube turned so its top, front and right faces all show. */
const THREE_FACES = composeAffine(rotateX(0.5), rotateY(-0.7));

describe("projecting a shape", () => {
  it("draws a box seen square on as the face toward the viewer, placed by the frame", () => {
    const cube = new MeshBuilder()
      .box([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5])
      .mesh();
    const square = loopsOf(
      drawShape(shapeOf(cube), IDENTITY, SCREEN_LIGHT).outline,
    );
    expect(square).toHaveLength(1);
    expect(square[0]).toHaveLength(4);
    expect(xRange(square[0])).toEqual([-0.5, 0.5]);

    const moved = loopsOf(
      drawShape(shapeOf(cube), translate(2, 1, 0), SCREEN_LIGHT).outline,
    );
    expect(xRange(moved[0])).toEqual([1.5, 2.5]);
    expect(Math.min(...moved[0].map((p) => p[1]))).toBe(0.5);
  });

  it("keeps two loose pieces of one mesh as two outlines", () => {
    const pair = new MeshBuilder()
      .box([-2.5, -0.5, -0.5], [-1.5, 0.5, 0.5])
      .box([1.5, -0.5, -0.5], [2.5, 0.5, 0.5])
      .mesh();
    const loops = loopsOf(
      drawShape(shapeOf(pair), THREE_FACES, SCREEN_LIGHT).outline,
    );
    expect(loops).toHaveLength(2);
    const [left, right] = loops.map(xRange).sort((a, b) => a[0] - b[0]);
    expect(left[1]).toBeLessThan(right[0]);
  });

  it("keeps a concave outline concave", () => {
    // A U-shaped sheet facing the viewer, its base in three squares so each arm shares an edge with it: the notch between the arms is not part of it.
    const u = new MeshBuilder()
      .quad(
        [
          [-1, -1, 0],
          [-0.5, -1, 0],
          [-0.5, -0.5, 0],
          [-1, -0.5, 0],
        ],
        [0, 0, 1],
      )
      .quad(
        [
          [-0.5, -1, 0],
          [0.5, -1, 0],
          [0.5, -0.5, 0],
          [-0.5, -0.5, 0],
        ],
        [0, 0, 1],
      )
      .quad(
        [
          [0.5, -1, 0],
          [1, -1, 0],
          [1, -0.5, 0],
          [0.5, -0.5, 0],
        ],
        [0, 0, 1],
      )
      .quad(
        [
          [-1, -0.5, 0],
          [-0.5, -0.5, 0],
          [-0.5, 1, 0],
          [-1, 1, 0],
        ],
        [0, 0, 1],
      )
      .quad(
        [
          [0.5, -0.5, 0],
          [1, -0.5, 0],
          [1, 1, 0],
          [0.5, 1, 0],
        ],
        [0, 0, 1],
      )
      .mesh();
    const loops = loopsOf(
      drawShape(shapeOf(u), IDENTITY, SCREEN_LIGHT).outline,
    );
    expect(loops).toHaveLength(1);
    const [outline] = loops;
    expect(inside(outline, 0, 0.5)).toBe(false);
    expect(inside(outline, -0.75, 0.5)).toBe(true);
    expect(inside(outline, 0, -0.75)).toBe(true);
  });

  it("draws the far side of an open sheet and leaves out the far side of a closed box", () => {
    const sheet = new MeshBuilder()
      .quad(
        [
          [-1, -1, 0],
          [1, -1, 0],
          [1, 1, 0],
          [-1, 1, 0],
        ],
        [0, 0, -1],
      )
      .mesh();
    expect(drawShape(shapeOf(sheet), IDENTITY, SCREEN_LIGHT).outline).not.toBe(
      "",
    );
    const cube = new MeshBuilder().box([-1, -1, -1], [1, 1, 1]).mesh();
    const view = viewMesh(cube, IDENTITY, SCREEN_LIGHT);
    // Only the face toward the viewer remains, as its two triangles.
    expect(view.triangles.length / 9).toBe(2);
  });
});

/** The centre of a patch's outline. */
function centreOf(loops: number[][]): [number, number] {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i += 2) {
      x += loop[i];
      y += loop[i + 1];
      n++;
    }
  }
  return [x / n, y / n];
}

describe("lighting a shape", () => {
  it("lights the face toward the upper left lightest and the face turned right darkest", () => {
    const cube = new MeshBuilder()
      .box([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5])
      .mesh();
    const { regions } = viewMesh(cube, THREE_FACES, SCREEN_LIGHT);
    expect(regions).toHaveLength(3);
    const byCentre = regions.map((r) => ({
      tone: r.tone,
      at: centreOf(r.loops),
    }));
    const top = byCentre.reduce((a, b) => (a.at[1] > b.at[1] ? a : b));
    const right = byCentre.reduce((a, b) => (a.at[0] > b.at[0] ? a : b));
    expect(top.tone).toBeGreaterThan(right.tone);
    for (const r of regions) {
      expect(r.tone).toBeGreaterThanOrEqual(0);
      expect(r.tone).toBeLessThan(TONE_STEPS);
    }
  });

  it("gives the same face the same tone wherever the light is fixed, and a turned light a different one", () => {
    const sheet = new MeshBuilder()
      .quad(
        [
          [-1, -1, 0],
          [1, -1, 0],
          [1, 1, 0],
          [-1, 1, 0],
        ],
        [0, 0, 1],
      )
      .mesh();
    const facing = viewMesh(sheet, IDENTITY, [0, 0, 1]).regions[0].tone;
    const away = viewMesh(sheet, IDENTITY, [1, 0, 0]).regions[0].tone;
    expect(facing).toBe(TONE_STEPS - 1);
    expect(away).toBeLessThan(facing);
  });

  it("fills the middle tone with the part's own colour and mixes the others toward black or white", () => {
    const fill = "var(--color-info-mark)";
    expect(toneFill(fill, 2)).toBe(fill);
    expect(toneFill(fill, 0)).toContain("black");
    expect(toneFill(fill, TONE_STEPS - 1)).toContain("white");
  });
});

/** A sheet folded along the x axis, both halves leaning back from the viewer by half of `fold` radians. */
function folded(fold: number): DecodedPartShapeMesh {
  const lean = fold / 2;
  const y = Math.cos(lean);
  const z = -Math.sin(lean);
  return new MeshBuilder()
    .quad(
      [
        [-1, 0, 0],
        [1, 0, 0],
        [1, y, z],
        [-1, y, z],
      ],
      [0, 0, 1],
    )
    .quad(
      [
        [-1, -y, z],
        [1, -y, z],
        [1, 0, 0],
        [-1, 0, 0],
      ],
      [0, 0, 1],
    )
    .mesh();
}

const segments = (creases: number[]) => creases.length / 6;

describe("finding a shape's sharp edges", () => {
  it("draws the edges of a box between faces it shows and where it turns away, never across a flat face", () => {
    const cube = new MeshBuilder()
      .box([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5])
      .mesh();
    // Three edges between the three faces shown, six round the outline.
    expect(segments(viewMesh(cube, THREE_FACES, SCREEN_LIGHT).creases)).toBe(9);
    const drawn = drawShape(shapeOf(cube), THREE_FACES, SCREEN_LIGHT);
    expect(drawn.creases.match(/M/g)).toHaveLength(9);
  });

  it("draws a fold sharper than the crease angle and not a gentler one", () => {
    // A sheet's six open edges are always drawn; the fold adds a seventh.
    expect(
      segments(
        viewMesh(folded((30 * Math.PI) / 180), IDENTITY, SCREEN_LIGHT).creases,
      ),
    ).toBe(6);
    expect(
      segments(
        viewMesh(folded((60 * Math.PI) / 180), IDENTITY, SCREEN_LIGHT).creases,
      ),
    ).toBe(7);
  });

  it("leaves out an edge hidden behind the part's own nearer faces", () => {
    const near = new MeshBuilder().box([-1, -1, 1], [1, 1, 2]).mesh("near");
    const far = new MeshBuilder()
      .box([-0.5, -0.5, -1], [0.5, 0.5, 0])
      .mesh("far");
    const drawn = drawShape(shapeOf(near, far), IDENTITY, SCREEN_LIGHT);
    // The near box's face covers the far box entirely, so only its own four outline edges show.
    expect(drawn.creases.match(/M/g)).toHaveLength(4);
  });
});

describe("posing a shape", () => {
  const body = new MeshBuilder().box([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]);
  const leg = () => new MeshBuilder().box([1, -0.5, -0.5], [1.5, 0.5, 0.5]);

  it("moves a posed mesh by its matrix", () => {
    const shape = shapeOf(body.mesh("body"), leg().mesh("leg"));
    const rest = loopsOf(drawShape(shape, IDENTITY, SCREEN_LIGHT).outline);
    const out = loopsOf(
      drawShape(shape, IDENTITY, SCREEN_LIGHT, [
        { mesh: "leg", shown: true, transform: [...translate(3, 0, 0)] },
      ]).outline,
    );
    const legAt = (loops: [number, number][][]) =>
      Math.max(...loops.map((l) => xRange(l)[1]));
    expect(legAt(rest)).toBe(1.5);
    expect(legAt(out)).toBe(4.5);
  });

  it("lets a pose show a mesh the shape hides, and hide one it shows", () => {
    const shape = shapeOf(body.mesh("body"), leg().mesh("leg", false));
    expect(
      loopsOf(drawShape(shape, IDENTITY, SCREEN_LIGHT).outline),
    ).toHaveLength(1);
    expect(
      loopsOf(
        drawShape(shape, IDENTITY, SCREEN_LIGHT, [{ mesh: "leg", shown: true }])
          .outline,
      ),
    ).toHaveLength(2);
    expect(
      drawShape(shape, IDENTITY, SCREEN_LIGHT, [{ mesh: "body", shown: false }])
        .outline,
    ).toBe("");
  });

  it("reuses one drawing for the same place and poses, and makes a new one when a mesh moves", () => {
    const shape = shapeOf(body.mesh("body"), leg().mesh("leg"));
    const first = drawShape(shape, IDENTITY, SCREEN_LIGHT);
    expect(drawShape(shape, [...IDENTITY], SCREEN_LIGHT)).toBe(first);
    const moved = drawShape(shape, IDENTITY, SCREEN_LIGHT, [
      { mesh: "leg", shown: true, transform: [...translate(0.1, 0, 0)] },
    ]);
    expect(moved).not.toBe(first);
  });
});

function partRow(overrides: Partial<TopologyPart> = {}): TopologyPart {
  return {
    flightId: 1,
    parentFlightId: null,
    name: "radialDecoupler1-2",
    title: "TT-38K Radial Decoupler",
    category: "Coupling",
    categoryOrdinal: 0,
    orgPos: [0, 0, 0],
    up: [0, 1, 0],
    forward: [0, 0, 1],
    bounds: {
      size: { x: 0.333, y: 1.796, z: 0.818 },
      center: { x: -0.086, y: 0, z: 0 },
    },
    dryMass: 0.025,
    inverseStage: 1,
    maxTemp: 2000,
    shape: "radialDecoupler1-2",
    modules: [],
    ...overrides,
  } as TopologyPart;
}

describe("a Ship Map part with a shape", () => {
  it("is drawn from its real shape once it has arrived, and by its type until then", () => {
    const shape = decodePartShape(decoupler);
    const waiting = buildShipMapPart(partRow(), null, undefined, 0);
    expect(waiting.shapeDrawing).toBeUndefined();

    const drawn = buildShipMapPart(partRow(), null, undefined, 0, null, shape);
    expect(drawn.shapeDrawing?.outline).not.toBe("");
    expect(drawn.shapeDrawing?.faces.length).toBeGreaterThan(0);
  });

  it("is drawn by its type when it was built or stretched in the game and its shape does not fill its box", () => {
    const shape = decodePartShape(decoupler);
    const stretched = partRow({
      bounds: {
        size: { x: 0.333, y: 3.6, z: 0.818 },
        center: { x: -0.086, y: 0, z: 0 },
      },
    });
    expect(
      buildShipMapPart(stretched, null, undefined, 0, null, shape).shapeDrawing,
    ).toBeUndefined();
    expect(shapeFitsBox(shape, stretched.bounds.size)).toBe(false);
    expect(shapeFitsBox(shape, partRow().bounds.size)).toBe(true);
  });

  it("draws a fairing whose shell the game built by its type, and one with no shell from its shape", () => {
    // The kind's shape holds the base ring and a tall truss the part never draws, as a stock fairing's model does.
    const shape = shapeOf(
      new MeshBuilder().box([-0.6, 0, -0.6], [0.6, 0.2, 0.6]).mesh("base"),
      new MeshBuilder()
        .box([-0.6, 0, -0.6], [0.6, 3, 0.6])
        .mesh("truss", false),
    );
    const fairing = (height: number) =>
      partRow({
        name: "fairingSize1",
        shape: "fairingSize1.White",
        modules: ["ModuleProceduralFairing", "ModuleCargoBay"],
        bounds: {
          size: { x: 1.2, y: height, z: 1.2 },
          center: { x: 0, y: height / 2, z: 0 },
        },
      });
    const shell = buildShipMapPart(fairing(3), null, undefined, 0, null, shape);
    expect(shell.type).toBe("fairing");
    expect(shell.shapeDrawing).toBeUndefined();
    const bare = buildShipMapPart(
      fairing(0.2),
      null,
      undefined,
      0,
      null,
      shape,
    );
    expect(bare.shapeDrawing?.outline).not.toBe("");
  });

  it("counts a mesh the part does not draw toward its box on any part but a fairing", () => {
    const shape = shapeOf(
      new MeshBuilder().box([-0.6, 0, -0.6], [0.6, 2, 0.6]).mesh("body"),
      new MeshBuilder()
        .box([-0.6, 2, -0.6], [0.6, 3, 0.6])
        .mesh("shroud", false),
    );
    const size = { x: 1.2, y: 3, z: 1.2 };
    expect(shapeFitsBox(shape, size)).toBe(true);
    expect(shapeFitsBox(shape, size, undefined, true)).toBe(false);
    expect(
      shapeFitsBox(shape, size, [{ mesh: "shroud", shown: true }], true),
    ).toBe(true);
  });

  it("fills its box as its poses move its meshes", () => {
    const shape = decodePartShape(decoupler);
    const size = partRow().bounds.size;
    const lifted = shape.meshes.map((m) => ({
      mesh: m.key,
      shown: true,
      transform: [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0],
    }));
    expect(shapeFitsBox(shape, size, lifted)).toBe(true);
    expect(shapeFitsBox(shape, size, lifted.slice(0, 1))).toBe(false);
  });

  it("shares one projection between parts of one kind standing the same way", () => {
    const shape = decodePartShape(winglet);
    const wing = {
      size: { x: 1.629, y: 2.016, z: 0.107 },
      center: { x: -0.075, y: -0.034, z: 0 },
    };
    const a = buildShipMapPart(
      partRow({ flightId: 1, orgPos: [0, 0, 0], bounds: wing }),
      null,
      undefined,
      0,
      null,
      shape,
    );
    const b = buildShipMapPart(
      partRow({ flightId: 2, orgPos: [0, 4, 0], bounds: wing }),
      null,
      undefined,
      0,
      null,
      shape,
    );
    expect(a.shapeDrawing).toBeDefined();
    expect(b.shapeDrawing).toBe(a.shapeDrawing);
  });
});

function drawingOf(): ShapeDrawing {
  const cube = new MeshBuilder()
    .box([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5])
    .mesh();
  return drawShape(shapeOf(cube), THREE_FACES, SCREEN_LIGHT);
}

function drawnWithShape(type: Parameters<typeof renderPartShape>[0]) {
  return renderPartShape(
    type,
    { x: 10, y: 20, w: 40, h: 80 },
    { x: 30, y: 60 },
    "var(--color-info-mark)",
    false,
    1,
    1,
    undefined,
    true,
    {
      shape: { drawing: drawingOf(), center: { x: 30, y: 60 }, pxPerMetre: 20 },
    },
  );
}

describe("drawing a part from its shape", () => {
  it("strokes the outline first, fills it with no edge, then the lit faces, then the sharp edges", () => {
    const markup = renderToStaticMarkup(drawnWithShape("tank"));
    const roles = [...markup.matchAll(/data-role="([a-z-]+)"/g)].map(
      (m) => m[1],
    );
    expect(roles[0]).toBe("mesh-outline-edge");
    expect(roles[1]).toBe("mesh-outline");
    expect(roles.slice(2, -1).every((r) => r === "mesh-face")).toBe(true);
    expect(roles.at(-1)).toBe("mesh-crease");
    for (const fill of markup.match(
      /<path data-role="mesh-(outline|face)"[^>]*>/g,
    ) ?? []) {
      expect(fill).toContain('stroke="none"');
    }
    expect(markup).toContain("scale(20 -20)");
  });

  it("keeps a parachute, a strut and a clamp drawn by what they do, and draws a landing leg from its shape", () => {
    for (const type of ["parachute", "strut", "clamp"] as const) {
      expect(renderToStaticMarkup(drawnWithShape(type))).not.toContain(
        "mesh-face",
      );
    }
    expect(renderToStaticMarkup(drawnWithShape("gear"))).toContain("mesh-face");
  });

  it("stays decorative inside a hidden diagram", async () => {
    const { container } = render(
      <svg aria-hidden="true">{drawnWithShape("engine")}</svg>,
    );
    expect(container.querySelector('[data-role="mesh-crease"]')).not.toBeNull();
    await expectNoA11yViolations(container);
  });
});
