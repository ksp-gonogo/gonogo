import type { SystemBodiesPayload } from "@ksp-gonogo/sitrep-sdk/spine";
import { describe, expect, it } from "vitest";
import { deriveSystemState } from "./system-state";

const THREE_BODIES: SystemBodiesPayload = {
  bodies: [
    { name: "Kerbol", index: 0, parentIndex: null, radius: 1, orbit: null },
    { name: "Kerbin", index: 1, parentIndex: 0, radius: 1, orbit: null },
    { name: "Mun", index: 2, parentIndex: 1, radius: 1, orbit: null },
  ],
};

describe("deriveSystemState: bodyCount (batch-2: b.number off the raw trackingStation.bodies array)", () => {
  it("counts the bodies in trackingStation.bodies", () => {
    expect(deriveSystemState(THREE_BODIES)).toEqual({
      bodyCount: 3,
    });
  });

  it("reports 0 for an empty (but present) body array, a defined count, not resyncing", () => {
    expect(deriveSystemState({ bodies: [] })).toEqual({
      bodyCount: 0,
    });
  });

  it("undefined while trackingStation.bodies hasn't arrived (resyncing): never throws", () => {
    expect(deriveSystemState(undefined)).toBeUndefined();
  });

  it("null on a confirmed trackingStation.bodies tombstone", () => {
    expect(deriveSystemState(null)).toBeNull();
  });
});
