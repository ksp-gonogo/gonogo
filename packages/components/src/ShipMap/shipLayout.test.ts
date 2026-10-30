import { describe, expect, it } from "vitest";
import { computeShipBaseScale } from "./shipLayout";

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
