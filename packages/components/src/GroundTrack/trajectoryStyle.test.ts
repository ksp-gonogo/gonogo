import { describe, expect, it } from "vitest";
import { getTrajectoryStyle } from "./trajectoryStyle";

const atmospheric = {
  alt: 10_000,
  maxAtmosphere: 70_000,
  hasAtmosphere: true,
  mach: 1,
  speed: 400,
};

describe("getTrajectoryStyle", () => {
  it("reads dynamic pressure in kPa, so max-Q warms the trail", () => {
    const calm = getTrajectoryStyle({ ...atmospheric, q: 0 });
    const maxQ = getTrajectoryStyle({ ...atmospheric, q: 30 });
    expect(maxQ.alpha - calm.alpha).toBeGreaterThan(0.2);
    expect(maxQ.color[1] - calm.color[1]).toBeGreaterThan(10);
  });

  it("saturates the pressure term at 50 kPa", () => {
    const at50 = getTrajectoryStyle({ ...atmospheric, q: 50 });
    const beyond = getTrajectoryStyle({ ...atmospheric, q: 80 });
    expect(beyond).toEqual(at50);
  });

  it("leaves a missing figure out of the style", () => {
    const missing = getTrajectoryStyle({
      alt: 10_000,
      maxAtmosphere: 70_000,
      hasAtmosphere: true,
    });
    const zero = getTrajectoryStyle({
      ...atmospheric,
      q: 0,
      mach: 0,
      speed: 0,
    });
    expect(missing).toEqual(zero);
  });
});
