import { describe, expect, it } from "vitest";
import { resolveFrame } from "./frame";

const BODIES = [
  { name: "Sun", referenceBody: null, isHome: false },
  { name: "Kerbin", referenceBody: "Sun", isHome: true },
  { name: "Mun", referenceBody: "Kerbin", isHome: false },
];

describe("resolveFrame with no active vessel", () => {
  it("centres a following frame on the home world, not the root star", () => {
    expect(resolveFrame(BODIES, "auto", null)).toBe("Kerbin");
  });

  it("centres a saved current-body frame on the home world, not on nothing", () => {
    expect(resolveFrame(BODIES, "current", null)).toBe("Kerbin");
  });

  it("follows the vessel's body while there is one", () => {
    expect(resolveFrame(BODIES, "auto", "Mun")).toBe("Mun");
    expect(resolveFrame(BODIES, "current", "Mun")).toBe("Mun");
  });

  it("falls back to the root star before any body says it is home", () => {
    expect(
      resolveFrame(
        BODIES.map(({ isHome: _h, ...b }) => b),
        "auto",
        null,
      ),
    ).toBe("Sun");
  });
});
