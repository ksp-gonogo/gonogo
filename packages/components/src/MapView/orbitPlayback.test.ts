import { describe, expect, it } from "vitest";
import {
  groundPoint,
  INCLINATION,
  KERBIN_ROTATION_PERIOD,
  ORBIT_PERIOD,
  orbitFrames,
  START_LONGITUDE,
} from "../../scripts/mapOrbitModel";

describe("orbit playback", () => {
  it("starts on the equator over the space centre and rises to the orbit's inclination", () => {
    const start = groundPoint(0);
    expect(start.lat).toBeCloseTo(0, 6);
    expect(start.lon).toBeCloseTo(START_LONGITUDE, 6);
    expect(groundPoint(ORBIT_PERIOD / 4).lat).toBeCloseTo(INCLINATION, 3);
    expect(groundPoint((3 * ORBIT_PERIOD) / 4).lat).toBeCloseTo(
      -INCLINATION,
      3,
    );
  });

  it("returns to the node one orbit later, west by the planet's turn in that time", () => {
    const west = (360 * ORBIT_PERIOD) / KERBIN_ROTATION_PERIOD;
    expect(groundPoint(ORBIT_PERIOD).lat).toBeCloseTo(0, 6);
    expect(groundPoint(ORBIT_PERIOD).lon).toBeCloseTo(
      START_LONGITUDE - west,
      3,
    );
  });

  it("plays 30 to 60 seconds and stamps each sample at its own instant", () => {
    const frames = orbitFrames();
    const seconds = frames.at(-1)?.seconds ?? 0;
    expect(seconds).toBeGreaterThanOrEqual(30);
    expect(seconds).toBeLessThanOrEqual(60);
    for (const frame of frames) {
      for (const e of frame.emits) expect(e.meta?.validAt).toBe(frame.ut);
    }
  });
});
