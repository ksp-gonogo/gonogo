import { renderHook } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { useTrajectoryBuffer } from "./useTrajectoryBuffer";

interface Sample {
  lon: number;
  track: string;
  trajectoryLength?: number;
}

function flying(first: Sample) {
  const hook = renderHook(
    ({ lon, track, trajectoryLength = 100 }: Sample) =>
      useTrajectoryBuffer({
        lat: 0,
        lon,
        altSea: 80_000,
        q: 0,
        mach: 0,
        speed: 2_200,
        vSpeed: 0,
        trajectoryLength,
        track,
      }),
    { initialProps: first },
  );
  return {
    fly: (next: Sample) => hook.rerender(next),
    lons: () => hook.result.current.trajectoryRef.current.map((p) => p.lon),
    count: () => hook.result.current.trajectoryCount,
  };
}

describe("the flown trail's buffer", () => {
  it("takes each new position and keeps the newest", () => {
    const trail = flying({ lon: 1, track: "a", trajectoryLength: 3 });
    for (const lon of [2, 3, 4])
      trail.fly({ lon, track: "a", trajectoryLength: 3 });

    expect(trail.lons()).toEqual([2, 3, 4]);
  });

  it("holds nothing of the last craft once the active vessel has changed", () => {
    const trail = flying({ lon: 10, track: "a" });
    trail.fly({ lon: 11, track: "a" });
    // The identity moves on before the new craft's first position arrives.
    trail.fly({ lon: 11, track: "b" });
    expect(trail.lons()).toEqual([]);

    trail.fly({ lon: -140, track: "b" });
    trail.fly({ lon: -139, track: "b" });
    expect(trail.lons()).toEqual([-140, -139]);
  });

  it("holds nothing of the last craft when the new one's position arrives ahead of its identity", () => {
    const trail = flying({ lon: 10, track: "a" });
    trail.fly({ lon: 11, track: "a" });
    trail.fly({ lon: -140, track: "a" });
    trail.fly({ lon: -140, track: "b" });
    trail.fly({ lon: -139, track: "b" });

    expect(trail.lons()).toEqual([-139]);
  });

  it("empties in one step when the position and the identity change together", () => {
    const trail = flying({ lon: 10, track: "a" });
    trail.fly({ lon: 11, track: "a" });
    trail.fly({ lon: -140, track: "b" });
    expect(trail.lons()).toEqual([]);

    trail.fly({ lon: -139, track: "b" });
    expect(trail.lons()).toEqual([-139]);
  });

  it("moves its count when it empties, so the map repaints without the old trail", () => {
    const trail = flying({ lon: 10, track: "a" });
    const before = trail.count();
    trail.fly({ lon: 10, track: "b" });

    expect(trail.count()).toBeGreaterThan(before);
  });
});
