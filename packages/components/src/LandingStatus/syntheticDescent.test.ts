import { describe, expect, it } from "vitest";
import {
  integrate,
  predictedPoint,
} from "../../scripts/synthesize-landing-descent";

// Metres per degree of longitude at the equator of the synthetic body (Mun, R =
// 200 km), used to turn the lat/lon error into a physical distance.
const M_PER_DEG = 200_000 * (Math.PI / 180);

describe("synthetic descent — predicted site converges on the actual touchdown", () => {
  const frames = integrate();
  const actualTouchdownLon = frames[frames.length - 1].lon;

  const errorMetresAt = (f: (typeof frames)[number]): number =>
    Math.abs(predictedPoint(f).lon - actualTouchdownLon) * M_PER_DEG;

  it("shrinks the prediction error toward zero as altitude drops", () => {
    const high = frames[0]; // ~8 km agl
    const mid = frames.find((f) => f.aglMeters <= 2000) ?? high;
    const low =
      frames.find((f) => f.aglMeters <= 50) ?? frames[frames.length - 1];
    const errHigh = errorMetresAt(high);
    const errMid = errorMetresAt(mid);
    const errLow = errorMetresAt(low);
    // Coarse high up, refining monotonically as the vessel descends.
    expect(errMid).toBeLessThan(errHigh);
    expect(errLow).toBeLessThan(errMid);
    // Effectively on the site by the final approach (tens of metres out of km).
    expect(errLow).toBeLessThan(30);
  });

  it("coincides with the actual touchdown by the end of the descent", () => {
    expect(errorMetresAt(frames[frames.length - 1])).toBeLessThan(1);
  });
});
