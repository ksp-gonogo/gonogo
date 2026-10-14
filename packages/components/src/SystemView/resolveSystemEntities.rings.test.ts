import { describe, expect, it, vi } from "vitest";
import { INERTIAL_PLACEMENT, type Placement } from "./projection";
import {
  createRingCache,
  resolveSystemEntities,
} from "./resolveSystemEntities";
import type { SystemEntitiesContext, SystemEntity } from "./systemEntities";

const CRAFT: SystemEntity = {
  id: "craft",
  position: {
    kind: "orbit",
    parentName: "Kerbin",
    sma: 800_000,
    ecc: 0.1,
    lan: 0,
    argPe: 0,
    inclination: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
  },
  shape: { kind: "orbit-path" },
};

function context(over: Partial<SystemEntitiesContext>): SystemEntitiesContext {
  return {
    parentName: "Kerbin",
    width: 400,
    height: 400,
    plotScale: 0.0001,
    center: { x: 0, y: 0 },
    muOf: () => 3.5316e12,
    soiOf: () => null,
    ...over,
  };
}

describe("an orbit ring across the frames of a ticking clock", () => {
  it("is projected once while only the instant moves, and again once the scale does", () => {
    const place = vi.fn((p: Parameters<Placement["place"]>[0]) => p);
    const placement: Placement = { ...INERTIAL_PLACEMENT, place };
    const ringOf = createRingCache();
    const soiOf = () => null;
    const frame = (ut: number, plotScale = 0.0001) =>
      resolveSystemEntities(
        [CRAFT],
        context({ ut, placement, soiOf, plotScale }),
        undefined,
        ringOf,
      );

    frame(0);
    const projected = place.mock.calls.length;
    const first = frame(0);
    for (let ut = 1; ut <= 30; ut++) frame(ut);
    const dotsOnly = place.mock.calls.length - projected;
    // One placement for each dot, none for a ring, on each of the 31 later frames.
    expect(dotsOnly).toBe(31);
    expect(first[0]).toMatchObject({ kind: "orbit-path" });

    const before = place.mock.calls.length;
    frame(31, 0.0002);
    expect(place.mock.calls.length - before).toBeGreaterThan(50);
  });
});
