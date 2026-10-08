import { describe, expect, it } from "vitest";
import { phaseAngleBetween } from "./phase-angle";

const FROM = {
  position: [1, 0, 0] as [number, number, number],
  velocity: [0, 1, 0] as [number, number, number],
};

describe("phaseAngleBetween", () => {
  it("is positive for a body ahead in the direction of motion", () => {
    expect(phaseAngleBetween(FROM, [0, 5, 0])).toBeCloseTo(90, 9);
  });

  it("is negative for a body behind", () => {
    expect(phaseAngleBetween(FROM, [0, -5, 0])).toBeCloseTo(-90, 9);
  });

  it("is 180 for a body opposite, never -180", () => {
    expect(phaseAngleBetween(FROM, [-3, 0, 0])).toBe(180);
  });

  it("measures a retrograde mover the same way about its own motion", () => {
    const retro = {
      position: [1, 0, 0] as [number, number, number],
      velocity: [0, -1, 0] as [number, number, number],
    };
    expect(phaseAngleBetween(retro, [0, -5, 0])).toBeCloseTo(90, 9);
  });

  it("projects an inclined body onto the plane of motion, so the angle is not its longitude difference", () => {
    // 60 degrees out of plane at an in-plane bearing of 45 degrees: the in-plane bearing is the answer.
    const lift = Math.sin(Math.PI / 3);
    const flat = Math.cos(Math.PI / 3);
    const to: [number, number, number] = [
      flat * Math.cos(Math.PI / 4),
      flat * Math.sin(Math.PI / 4),
      lift,
    ];
    expect(phaseAngleBetween(FROM, to)).toBeCloseTo(45, 9);
  });

  it("has no answer without motion, or for a body at the centre", () => {
    expect(
      phaseAngleBetween(
        { position: [1, 0, 0], velocity: [0, 0, 0] },
        [0, 1, 0],
      ),
    ).toBeNull();
    expect(phaseAngleBetween(FROM, [0, 0, 0])).toBeNull();
  });
});
