import { logger } from "@ksp-gonogo/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatEntityLabel,
  projectEntityPosition,
  projectOrbitRing,
  resolveSystemEntities,
  SYSTEM_ENTITY_DEFAULT_LAYER,
  type SystemEntitiesContext,
  type SystemEntity,
} from "./systemEntities";

const CTX: SystemEntitiesContext = {
  parentName: "Kerbin",
  width: 400,
  height: 400,
  plotScale: 1e-5, // 1e6 m -> 10 px
  center: { x: 0, y: 0 },
};

describe("projectEntityPosition", () => {
  it("projects an orbit position onto its Keplerian point, matching bodyPosition's convention", () => {
    // Circular, equatorial (ecc=0, lan=argPe=0): trueAnomaly=0 sits on +x.
    const p = projectEntityPosition(
      {
        kind: "orbit",
        parentName: "Kerbin",
        sma: 1_000_000,
        ecc: 0,
        lan: 0,
        argPe: 0,
        trueAnomaly: 0,
      },
      CTX,
    );
    expect(p).not.toBeNull();
    expect(p?.x).toBeCloseTo(10, 6);
    expect(p?.y).toBeCloseTo(0, 6);
  });

  it("places trueAnomaly=90deg on +y for a circular equatorial orbit", () => {
    const p = projectEntityPosition(
      {
        kind: "orbit",
        parentName: "Kerbin",
        sma: 1_000_000,
        ecc: 0,
        lan: 0,
        argPe: 0,
        trueAnomaly: 90,
      },
      CTX,
    );
    expect(p?.x).toBeCloseTo(0, 6);
    expect(p?.y).toBeCloseTo(10, 6);
  });

  it("returns null when the orbit's parent doesn't match the current frame", () => {
    const p = projectEntityPosition(
      {
        kind: "orbit",
        parentName: "Mun",
        sma: 1_000_000,
        ecc: 0,
        lan: 0,
        argPe: 0,
        trueAnomaly: 0,
      },
      CTX,
    );
    expect(p).toBeNull();
  });

  it("is case/whitespace insensitive on parent name, mirroring SystemDiagram", () => {
    const p = projectEntityPosition(
      {
        kind: "orbit",
        parentName: " kerbin ",
        sma: 1_000_000,
        ecc: 0,
        lan: 0,
        argPe: 0,
        trueAnomaly: 0,
      },
      CTX,
    );
    expect(p).not.toBeNull();
  });

  it("returns null for a non-positive or non-finite sma", () => {
    expect(
      projectEntityPosition(
        {
          kind: "orbit",
          parentName: "Kerbin",
          sma: 0,
          ecc: 0,
          lan: 0,
          argPe: 0,
          trueAnomaly: 0,
        },
        CTX,
      ),
    ).toBeNull();
    expect(
      projectEntityPosition(
        {
          kind: "orbit",
          parentName: "Kerbin",
          sma: Number.NaN,
          ecc: 0,
          lan: 0,
          argPe: 0,
          trueAnomaly: 0,
        },
        CTX,
      ),
    ).toBeNull();
  });

  it("scales a fixed metres position directly by plotScale, offset from center", () => {
    const p = projectEntityPosition(
      {
        kind: "fixed",
        parentName: "Kerbin",
        xMetres: 500_000,
        yMetres: -250_000,
      },
      CTX,
    );
    expect(p).toEqual({ x: 5, y: -2.5 });
  });

  it("offsets a fixed position from a non-zero center", () => {
    const p = projectEntityPosition(
      { kind: "fixed", parentName: "Kerbin", xMetres: 100_000, yMetres: 0 },
      { ...CTX, center: { x: 3, y: 7 } },
    );
    expect(p).toEqual({ x: 4, y: 7 });
  });

  it("returns null for a fixed position with non-finite metres", () => {
    expect(
      projectEntityPosition(
        {
          kind: "fixed",
          parentName: "Kerbin",
          xMetres: Number.NaN,
          yMetres: 0,
        },
        CTX,
      ),
    ).toBeNull();
  });

  it("returns null for a fixed position on a different frame", () => {
    expect(
      projectEntityPosition(
        { kind: "fixed", parentName: "Mun", xMetres: 0, yMetres: 0 },
        CTX,
      ),
    ).toBeNull();
  });
});

describe("projectOrbitRing", () => {
  it("derives rx/ry/rotation for an eccentric, rotated orbit", () => {
    const ring = projectOrbitRing(
      {
        kind: "orbit",
        parentName: "Kerbin",
        sma: 1_000_000,
        ecc: 0.5,
        lan: 30,
        argPe: 15,
        trueAnomaly: 0, // ignored by the ring
      },
      CTX,
    );
    expect(ring).not.toBeNull();
    const a = 1_000_000 * CTX.plotScale; // 10
    const b = a * Math.sqrt(1 - 0.5 * 0.5);
    expect(ring?.rx).toBeCloseTo(a, 6);
    expect(ring?.ry).toBeCloseTo(b, 6);
    expect(ring?.rotationDeg).toBe(45); // lan + argPe
    expect(ring?.cx).toBeCloseTo(-a * 0.5, 6); // -focusOffset
    expect(ring?.cy).toBe(0);
  });

  it("returns null when the orbit's parent doesn't match the frame", () => {
    expect(
      projectOrbitRing(
        {
          kind: "orbit",
          parentName: "Mun",
          sma: 1_000_000,
          ecc: 0,
          lan: 0,
          argPe: 0,
          trueAnomaly: 0,
        },
        CTX,
      ),
    ).toBeNull();
  });

  it("returns null for a degenerate sma", () => {
    expect(
      projectOrbitRing(
        {
          kind: "orbit",
          parentName: "Kerbin",
          sma: -1,
          ecc: 0,
          lan: 0,
          argPe: 0,
          trueAnomaly: 0,
        },
        CTX,
      ),
    ).toBeNull();
  });
});

function pointEntity(
  id: string,
  overrides: Partial<SystemEntity> = {},
): SystemEntity {
  return {
    id,
    position: {
      kind: "orbit",
      parentName: "Kerbin",
      sma: 1_000_000,
      ecc: 0,
      lan: 0,
      argPe: 0,
      trueAnomaly: 0,
    },
    shape: { kind: "point" },
    ...overrides,
  };
}

describe("resolveSystemEntities", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("z-orders shape kinds back to front by SYSTEM_ENTITY_DEFAULT_LAYER: orbit-path, blob, connection-line, point", () => {
    const orbitPos = pointEntity("dummy").position;
    const entities: SystemEntity[] = [
      { id: "pt", position: orbitPos, shape: { kind: "point" } },
      {
        id: "conn",
        position: orbitPos,
        shape: { kind: "connection-line", to: orbitPos },
      },
      {
        id: "blob",
        position: orbitPos,
        shape: { kind: "blob", radiusMetres: 100 },
      },
      { id: "ring", position: orbitPos, shape: { kind: "orbit-path" } },
    ];
    const resolved = resolveSystemEntities(entities, CTX);
    expect(resolved.map((r) => r.id)).toEqual(["ring", "blob", "conn", "pt"]);
    expect(resolved.map((r) => r.kind)).toEqual([
      "orbit-path",
      "blob",
      "connection-line",
      "point",
    ]);
    // Sanity: the default layer table itself is what the sort keyed off.
    expect(SYSTEM_ENTITY_DEFAULT_LAYER["orbit-path"]).toBeLessThan(
      SYSTEM_ENTITY_DEFAULT_LAYER.blob,
    );
    expect(SYSTEM_ENTITY_DEFAULT_LAYER.blob).toBeLessThan(
      SYSTEM_ENTITY_DEFAULT_LAYER["connection-line"],
    );
    expect(SYSTEM_ENTITY_DEFAULT_LAYER["connection-line"]).toBeLessThan(
      SYSTEM_ENTITY_DEFAULT_LAYER.point,
    );
  });

  it("lets an explicit zHint override the default layer", () => {
    const entities = [
      pointEntity("normal-point"),
      pointEntity("forced-back", { zHint: -100 }),
    ];
    const resolved = resolveSystemEntities(entities, CTX);
    expect(resolved.map((r) => r.id)).toEqual(["forced-back", "normal-point"]);
  });

  it("keeps input array order as the tie-break within the same effective layer", () => {
    const entities = [pointEntity("a"), pointEntity("b"), pointEntity("c")];
    const resolved = resolveSystemEntities(entities, CTX);
    expect(resolved.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("silently skips an entity whose position doesn't project onto the current frame", () => {
    const entities = [
      pointEntity("off-frame", {
        position: {
          kind: "orbit",
          parentName: "Mun",
          sma: 1_000_000,
          ecc: 0,
          lan: 0,
          argPe: 0,
          trueAnomaly: 0,
        },
      }),
      pointEntity("on-frame"),
    ];
    const resolved = resolveSystemEntities(entities, CTX);
    expect(resolved.map((r) => r.id)).toEqual(["on-frame"]);
  });

  it("skips and warns on an orbit-path shape paired with a fixed position", () => {
    const entities: SystemEntity[] = [
      {
        id: "bad-ring",
        position: {
          kind: "fixed",
          parentName: "Kerbin",
          xMetres: 0,
          yMetres: 0,
        },
        shape: { kind: "orbit-path" },
      },
    ];
    const resolved = resolveSystemEntities(entities, CTX);
    expect(resolved).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("bad-ring");
  });

  it("resolves an orbit-path entity's own dot alongside the ring, at its declared anomaly (not the ring's periapsis)", () => {
    const entities: SystemEntity[] = [
      {
        id: "ring-with-dot",
        position: {
          kind: "orbit",
          parentName: "Kerbin",
          sma: 1_000_000,
          ecc: 0,
          lan: 0,
          argPe: 0,
          trueAnomaly: 90, // +y for a circular equatorial orbit
        },
        shape: { kind: "orbit-path" },
      },
    ];
    const [resolved] = resolveSystemEntities(entities, CTX);
    expect(resolved.kind).toBe("orbit-path");
    const orbitPath = resolved as Extract<
      typeof resolved,
      { kind: "orbit-path" }
    >;
    expect(orbitPath.dotX).toBeCloseTo(0, 6);
    expect(orbitPath.dotY).toBeCloseTo(10, 6);
  });

  it("skips a connection-line whose 'to' endpoint doesn't project", () => {
    const entities: SystemEntity[] = [
      {
        id: "dangling",
        position: pointEntity("dummy").position,
        shape: {
          kind: "connection-line",
          to: {
            kind: "orbit",
            parentName: "Mun",
            sma: 1_000_000,
            ecc: 0,
            lan: 0,
            argPe: 0,
            trueAnomaly: 0,
          },
        },
      },
    ];
    expect(resolveSystemEntities(entities, CTX)).toEqual([]);
  });

  it("draws a connection-line between its two projected endpoints", () => {
    const entities: SystemEntity[] = [
      {
        id: "link",
        position: {
          kind: "fixed",
          parentName: "Kerbin",
          xMetres: 0,
          yMetres: 0,
        },
        shape: {
          kind: "connection-line",
          to: {
            kind: "fixed",
            parentName: "Kerbin",
            xMetres: 100_000,
            yMetres: 0,
          },
        },
      },
    ];
    const [resolved] = resolveSystemEntities(entities, CTX);
    expect(resolved).toMatchObject({
      kind: "connection-line",
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
    });
  });

  it("scales a blob's radius by plotScale and skips a non-positive result", () => {
    const grown = resolveSystemEntities(
      [
        {
          id: "cme",
          position: pointEntity("dummy").position,
          shape: { kind: "blob", radiusMetres: 500_000 },
        },
      ],
      CTX,
    );
    expect(grown).toHaveLength(1);
    expect(grown[0]).toMatchObject({ kind: "blob", radiusPx: 5 });

    const collapsed = resolveSystemEntities(
      [
        {
          id: "empty",
          position: pointEntity("dummy").position,
          shape: { kind: "blob", radiusMetres: 0 },
        },
      ],
      CTX,
    );
    expect(collapsed).toEqual([]);
  });

  it("resolves a travelling-pulse's apex + tip endpoints and scales segmentLengthMetres by plotScale", () => {
    const [resolved] = resolveSystemEntities(
      [
        {
          id: "cme",
          position: {
            kind: "fixed",
            parentName: "Kerbin",
            xMetres: 0,
            yMetres: 0,
          },
          shape: {
            kind: "travelling-pulse",
            to: {
              kind: "fixed",
              parentName: "Kerbin",
              xMetres: 1_000_000,
              yMetres: 0,
            },
            segmentLengthMetres: 200_000,
            arriveUt: 1_000,
            clearUt: 1_600,
          },
        },
      ],
      CTX,
    );
    expect(resolved).toMatchObject({
      kind: "travelling-pulse",
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 0,
      segmentLengthPx: 2,
      arriveUt: 1_000,
      clearUt: 1_600,
    });
  });

  it("skips a travelling-pulse whose tip doesn't project, or whose segmentLengthMetres resolves to non-positive", () => {
    expect(
      resolveSystemEntities(
        [
          {
            id: "off-frame-tip",
            position: {
              kind: "fixed",
              parentName: "Kerbin",
              xMetres: 0,
              yMetres: 0,
            },
            shape: {
              kind: "travelling-pulse",
              to: {
                kind: "fixed",
                parentName: "Mun",
                xMetres: 1_000_000,
                yMetres: 0,
              },
              segmentLengthMetres: 200_000,
              arriveUt: 1_000,
              clearUt: 1_600,
            },
          },
        ],
        CTX,
      ),
    ).toEqual([]);

    expect(
      resolveSystemEntities(
        [
          {
            id: "zero-length",
            position: {
              kind: "fixed",
              parentName: "Kerbin",
              xMetres: 0,
              yMetres: 0,
            },
            shape: {
              kind: "travelling-pulse",
              to: {
                kind: "fixed",
                parentName: "Kerbin",
                xMetres: 1_000_000,
                yMetres: 0,
              },
              segmentLengthMetres: 0,
              arriveUt: 1_000,
              clearUt: 1_600,
            },
          },
        ],
        CTX,
      ),
    ).toEqual([]);
  });

  it("skips a travelling-pulse whose apex and tip project onto the same point (no bearing to travel along)", () => {
    expect(
      resolveSystemEntities(
        [
          {
            id: "coincident",
            position: {
              kind: "fixed",
              parentName: "Kerbin",
              xMetres: 0,
              yMetres: 0,
            },
            shape: {
              kind: "travelling-pulse",
              to: {
                kind: "fixed",
                parentName: "Kerbin",
                xMetres: 0,
                yMetres: 0,
              },
              segmentLengthMetres: 200_000,
              arriveUt: 1_000,
              clearUt: 1_600,
            },
          },
        ],
        CTX,
      ),
    ).toEqual([]);
  });

  it("gives travelling-pulse the same default z-tier as blob (both physical ambient effects)", () => {
    expect(SYSTEM_ENTITY_DEFAULT_LAYER["travelling-pulse"]).toBe(
      SYSTEM_ENTITY_DEFAULT_LAYER.blob,
    );
  });

  it("applies the decorate hook's style override on top of the entity's own style, keyed by id", () => {
    const entities = [
      pointEntity("a", { style: { emphasis: "faint" } }),
      pointEntity("b", { style: { emphasis: "faint" } }),
    ];
    const resolved = resolveSystemEntities(entities, CTX, (id) =>
      id === "a" ? { colour: "red" } : undefined,
    );
    const a = resolved.find((r) => r.id === "a");
    const b = resolved.find((r) => r.id === "b");
    expect(a?.colour).toBe("red");
    expect(b?.colour).not.toBe("red");
  });
});

describe("formatEntityLabel", () => {
  it("joins meta rows into a readable label", () => {
    expect(
      formatEntityLabel("vessel-1", { name: "Kerbal X", status: "active" }),
    ).toBe("name: Kerbal X, status: active");
  });

  it("falls back to the id when meta is absent or empty", () => {
    expect(formatEntityLabel("vessel-1", undefined)).toBe("vessel-1");
    expect(formatEntityLabel("vessel-1", {})).toBe("vessel-1");
  });
});
