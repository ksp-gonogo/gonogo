import { describe, expect, it } from "vitest";
import {
  hottestAt,
  PARTS,
  REENTRY_FRAMES,
  ratioOf,
  thermalReentryScenario,
} from "./thermalReentryModel";

describe("the re-entry model", () => {
  it("starts and ends cool, with every part well under its limit", () => {
    for (const t of [0, 1]) {
      for (const part of PARTS) expect(ratioOf(part, t)).toBeLessThan(0.5);
    }
  });

  it("hands the hottest part from the antenna to the shield as the heat soaks in", () => {
    const names = Array.from(
      { length: 101 },
      (_, i) => hottestAt(i / 100).part.name,
    );
    const order = [...new Set(names)];
    expect(order[0]).toBe("Communotron 16");
    expect(order.at(-1)).toBe("Heat Shield (2.5m)");
  });

  it("takes every part into the critical band without any passing its limit", () => {
    for (const part of PARTS) {
      const peak = Math.max(
        ...Array.from({ length: 101 }, (_, i) => ratioOf(part, i / 100)),
      );
      expect(peak).toBeLessThan(1);
    }
    expect(ratioOf(PARTS[0], PARTS[0].center)).toBeGreaterThanOrEqual(0.97);
  });

  it("has a frame for every step, plus the entry interface", () => {
    expect(thermalReentryScenario().frames).toHaveLength(REENTRY_FRAMES + 1);
  });
});
