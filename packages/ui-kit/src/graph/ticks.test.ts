import { describe, expect, it } from "vitest";
import { unitTick } from "./ticks";

describe("an axis tick in a unit", () => {
  it("writes every tick exactly, with the fewest decimals its unit's ticks need", () => {
    const ticks = [0, 500, 1000, 1500];
    expect(ticks.map((t) => unitTick("m", t, ticks))).toEqual([
      "0 m",
      "500 m",
      "1.0 km",
      "1.5 km",
    ]);
  });

  it("never writes two ticks the same", () => {
    const ticks = [1000, 1050, 1100, 1150];
    const labels = ticks.map((t) => unitTick("m", t, ticks));
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain("1.05 km");
  });

  it("writes a figure alone at no decimals, as before", () => {
    expect(unitTick("m", 1500)).toBe("2 km");
  });

  it("writes a tick at zero as 0, never -0, and one below zero as its real value", () => {
    const ticks = [-500, -1e-13, 500];
    expect(ticks.map((t) => unitTick("m", t, ticks))).toEqual([
      "-500 m",
      "0 m",
      "500 m",
    ]);
  });
});
