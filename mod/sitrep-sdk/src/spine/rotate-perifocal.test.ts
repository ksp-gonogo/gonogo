import { describe, expect, it } from "vitest";
import { rotatePerifocalToInertial } from "./kepler";

describe("rotatePerifocalToInertial", () => {
  it("leaves a planar vector as it was when no out-of-plane part is given", () => {
    const planar = rotatePerifocalToInertial(3, 4, 0.7, 1.1, 2.2);
    expect(rotatePerifocalToInertial(3, 4, 0.7, 1.1, 2.2, 0)).toEqual(planar);
  });

  it("carries an out-of-plane component along the orbit normal", () => {
    const inc = 0.7;
    const lan = 1.1;
    const [x, y, z] = rotatePerifocalToInertial(0, 0, inc, lan, 2.2, 5);
    expect(x).toBeCloseTo(5 * Math.sin(lan) * Math.sin(inc), 12);
    expect(y).toBeCloseTo(-5 * Math.cos(lan) * Math.sin(inc), 12);
    expect(z).toBeCloseTo(5 * Math.cos(inc), 12);
  });

  it("keeps a vector's length whatever the frame angles", () => {
    const [x, y, z] = rotatePerifocalToInertial(3, -4, 2.5, 5.1, 0.3, 12);
    expect(Math.hypot(x, y, z)).toBeCloseTo(Math.hypot(3, 4, 12), 12);
  });
});
