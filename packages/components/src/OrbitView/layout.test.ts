import { describe, expect, it } from "vitest";
import { type OrbitViewLayout, orbitViewLayout } from "./layout";

const GROWS: ReadonlyArray<keyof OrbitViewLayout> = [
  "showInclination",
  "showApProgress",
  "showEccentricityAndPeriod",
  "hasDiagramRoom",
];

const SHRINKS: ReadonlyArray<keyof OrbitViewLayout> = [
  "tight",
  "narrow",
  "compactTitle",
  "compactBadge",
];

describe("orbitViewLayout", () => {
  it("never loses a figure or the diagram when a tile grows in either direction", () => {
    for (let c = 3; c <= 24; c++) {
      for (let r = 4; r <= 24; r++) {
        const small = orbitViewLayout(c, r);
        for (const larger of [
          orbitViewLayout(c + 1, r),
          orbitViewLayout(c, r + 1),
        ]) {
          for (const key of GROWS) {
            if (small[key])
              expect(larger[key], `${key} at ${c}x${r}`).toBe(true);
          }
          for (const key of SHRINKS) {
            if (!small[key])
              expect(larger[key], `${key} at ${c}x${r}`).toBe(false);
          }
        }
      }
    }
  });

  it("shows the figures alone at the smallest size the widget can be given", () => {
    const layout = orbitViewLayout(3, 4);
    expect(layout.hasDiagramRoom).toBe(false);
    expect(layout.showInclination).toBe(false);
  });

  it("opens the diagram in a tall tile and in a wide one, not in a small or a short one", () => {
    expect(orbitViewLayout(5, 8).hasDiagramRoom).toBe(true);
    expect(orbitViewLayout(12, 5).hasDiagramRoom).toBe(true);
    expect(orbitViewLayout(5, 7).hasDiagramRoom).toBe(false);
    expect(orbitViewLayout(11, 6).hasDiagramRoom).toBe(false);
    expect(orbitViewLayout(12, 4).hasDiagramRoom).toBe(false);
  });
});
