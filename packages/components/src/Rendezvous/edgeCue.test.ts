import { describe, expect, it } from "vitest";
import {
  dockEdgeCue,
  dockMarkCues,
  edgeTangent,
  FULL_GROW_OVER,
  type Picture,
} from "./edgeCue";

const WIDE: Picture = { frameWidth: 320, frameHeight: 180, vfovDeg: 60 };
const half = Math.tan((30 * Math.PI) / 180);

describe("edgeTangent", () => {
  it("is the vertical half-angle's tangent for a picture wider than tall", () => {
    expect(edgeTangent(WIDE)).toBeCloseTo(half, 9);
  });

  it("shows less across than up in a picture taller than wide", () => {
    expect(
      edgeTangent({ frameWidth: 90, frameHeight: 180, vfovDeg: 60 }),
    ).toBeCloseTo(half * 0.5, 9);
  });

  it("is null for a picture that is empty or a field that is not a field", () => {
    expect(edgeTangent({ ...WIDE, frameWidth: 0 })).toBeNull();
    expect(edgeTangent({ ...WIDE, vfovDeg: 0 })).toBeNull();
    expect(edgeTangent({ ...WIDE, vfovDeg: 180 })).toBeNull();
    expect(edgeTangent({ ...WIDE, vfovDeg: Number.NaN })).toBeNull();
  });
});

describe("dockEdgeCue", () => {
  it("is null while the port is in the picture, on the axis or off it", () => {
    expect(dockEdgeCue({ ax: 0, ay: 0, picture: WIDE })).toBeNull();
    expect(dockEdgeCue({ ax: 20, ay: 10, picture: WIDE })).toBeNull();
  });

  it("lights at the direction the port left by once it passes the half-angle the circle shows", () => {
    const right = dockEdgeCue({ ax: 35, ay: 0, picture: WIDE });
    expect(right?.angle).toBeCloseTo(0, 6);
    const up = dockEdgeCue({ ax: 0, ay: 35, picture: WIDE });
    expect(up?.angle).toBeCloseTo(90, 6);
    const left = dockEdgeCue({ ax: -40, ay: 0, picture: WIDE });
    expect(Math.abs(left?.angle ?? 0)).toBeCloseTo(180, 6);
    const down = dockEdgeCue({ ax: 0, ay: -40, picture: WIDE });
    expect(down?.angle).toBeCloseTo(-90, 6);
  });

  it("is lit at the edge itself and grows with how far past it the port is", () => {
    const atEdge = dockEdgeCue({ ax: 30, ay: 0, picture: WIDE });
    expect(atEdge?.grow).toBeCloseTo(0, 6);
    const near = dockEdgeCue({ ax: 35, ay: 0, picture: WIDE });
    const far = dockEdgeCue({ ax: 45, ay: 0, picture: WIDE });
    expect(near?.grow).toBeGreaterThan(0);
    expect(far?.grow).toBeGreaterThan(near?.grow ?? 0);
  });

  it("reaches its full growth half a radius past the edge and holds there", () => {
    const over = Math.atan(half * (1 + FULL_GROW_OVER)) * (180 / Math.PI);
    expect(dockEdgeCue({ ax: over, ay: 0, picture: WIDE })?.grow).toBeCloseTo(
      1,
      6,
    );
    expect(dockEdgeCue({ ax: 80, ay: 0, picture: WIDE })?.grow).toBe(1);
  });

  it("measures the distance off the picture across both axes, not each alone", () => {
    // 25 degrees across and 25 up is inside either axis's 30 degrees, and outside the circle.
    const diagonal = dockEdgeCue({ ax: 25, ay: 25, picture: WIDE });
    expect(diagonal).not.toBeNull();
    expect(diagonal?.angle).toBeCloseTo(45, 6);
  });

  it("is amber off the picture, and green only when both angles are within a degree", () => {
    expect(dockEdgeCue({ ax: 40, ay: 0, picture: WIDE })?.tone).toBe("warn");
    // A very wide-angle picture with a tiny field of view is the only place the port is off it while lined up.
    expect(
      dockEdgeCue({
        ax: 0.9,
        ay: 0.4,
        picture: { frameWidth: 320, frameHeight: 180, vfovDeg: 1 },
      })?.tone,
    ).toBe("accent");
  });

  it("is null without a picture, an angle or a field, and for a port behind the lens", () => {
    expect(dockEdgeCue({ ax: 40, ay: 0, picture: null })).toBeNull();
    expect(dockEdgeCue({ ax: undefined, ay: 0, picture: WIDE })).toBeNull();
    expect(dockEdgeCue({ ax: 40, ay: Number.NaN, picture: WIDE })).toBeNull();
    expect(
      dockEdgeCue({ ax: 40, ay: 0, picture: { ...WIDE, vfovDeg: 0 } }),
    ).toBeNull();
    expect(dockEdgeCue({ ax: 120, ay: 0, picture: WIDE })).toBeNull();
  });
});

describe("dockMarkCues", () => {
  const centred = (distance: number) =>
    dockMarkCues({ ax: 0, ay: 0, distance, picture: WIDE });

  it("lights nothing while the triangles are inside the picture", () => {
    expect(centred(10)).toEqual([]);
    expect(centred(2)).toEqual([]);
  });

  it("lights all four sides, green, once a centred port's triangles have grown past the rim", () => {
    const cues = centred(1);
    expect(cues.map((c) => c.angle).sort((a, b) => a - b)).toEqual([
      0, 90, 180, 270,
    ]);
    expect(cues.every((c) => c.tone === "accent")).toBe(true);
  });

  it("grows the arcs as the range closes", () => {
    expect(centred(0.5)[0]?.grow).toBeGreaterThan(centred(1.5)[0]?.grow ?? 1);
  });

  it("lights only the side that has gone out for a port off to one side, in that side's tone", () => {
    const cues = dockMarkCues({
      ax: 5,
      ay: 0,
      distance: 2.2,
      picture: WIDE,
    });
    expect(cues.map((c) => c.angle)).toEqual([0]);
    expect(cues[0]?.tone).toBe("warn");
  });

  it("is empty with no picture, no range or no angle", () => {
    expect(dockMarkCues({ ax: 0, ay: 0, distance: 1, picture: null })).toEqual(
      [],
    );
    expect(dockMarkCues({ ax: 0, ay: 0, distance: 0, picture: WIDE })).toEqual(
      [],
    );
    expect(
      dockMarkCues({ ax: undefined, ay: 0, distance: 1, picture: WIDE }),
    ).toEqual([]);
  });
});
