import { describe, expect, it } from "vitest";
import { classifyPart } from "./classifyPart";
import {
  computeShipBaseScale,
  type ProjectedPart,
  paintOrder,
} from "./shipLayout";

describe("computeShipBaseScale", () => {
  const small = { w: 1.2, h: 1.4 };

  it("fills the viewport with no cap", () => {
    expect(computeShipBaseScale(small, 400, 500)).toBeGreaterThan(100);
  });

  it("never draws a metre larger than the cap", () => {
    expect(computeShipBaseScale(small, 400, 500, 60)).toBe(60);
  });

  it("still shrinks a tall craft below the cap to fit", () => {
    const tall = { w: 3, h: 40 };
    const scale = computeShipBaseScale(tall, 400, 500, 60);
    expect(scale).toBe(computeShipBaseScale(tall, 400, 500));
    expect(scale).toBeLessThan(60);
  });
});

describe("paintOrder for parachutes", () => {
  const part = (
    flightId: number,
    type: string,
    parentFlightId: number | null,
    depth: number,
  ) =>
    ({ flightId, type, parentFlightId, depth, spineDist: 0 }) as ProjectedPart;

  it("draws a parachute before the part it is mounted on, whatever its depth", () => {
    for (const chuteDepth of [-0.02, 0, 0.02]) {
      const order = paintOrder([
        part(1, "capsule", null, 0),
        part(2, "parachute", 1, chuteDepth),
        part(3, "tank", 1, 0),
      ]).map((p) => p.flightId);
      expect(order.indexOf(2)).toBeLessThan(order.indexOf(1));
    }
  });

  it("keeps a radial parachute standing out in front of its mount in front of it", () => {
    const order = paintOrder([
      part(1, "capsule", null, 0),
      part(2, "parachute", 1, 0.6),
      part(3, "parachute", 1, -0.6),
    ]).map((p) => p.flightId);
    expect(order).toEqual([3, 1, 2]);
  });

  it("leaves a parachute whose parent is not drawn where depth puts it", () => {
    const order = paintOrder([
      part(2, "parachute", 9, 0.5),
      part(1, "capsule", null, 0),
    ]).map((p) => p.flightId);
    expect(order).toEqual([1, 2]);
  });
});

describe("every stock parachute", () => {
  it.each([
    "parachuteSingle",
    "parachuteRadial",
    "radialDrogue",
    "parachuteLarge",
    "parachuteDrogue",
    "RC_stack",
    "RC_radial",
    "RC_cone",
    "RC_cone_double",
  ])("%s is classified as a parachute by its module", (name) => {
    for (const chuteModule of ["ModuleParachute", "RealChuteModule"]) {
      const row = {
        name,
        title: name,
        modules: [chuteModule, "ModuleCargoPart"],
        categoryOrdinal: 4,
      };
      expect(classifyPart(row as never), chuteModule).toBe("parachute");
    }
  });
});
