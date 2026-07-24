import { describe, expect, it } from "vitest";
import { deriveBoard } from "./board";

// Characterization of the landing board state machine — pins the exact
// precedence the widget shipped with inline, so the presentation redesign
// cannot silently change which readouts are shown. Extracted 2026-07-24.

describe("deriveBoard", () => {
  it("not-descending wins over everything, regardless of atmosphere", () => {
    expect(
      deriveBoard({ solutionState: "not-descending", atmospheric: false }),
    ).toBe("not-descending");
    expect(
      deriveBoard({ solutionState: "not-descending", atmospheric: true }),
    ).toBe("not-descending");
  });

  it("an atmospheric body suppresses the vacuum solve (even when it would solve)", () => {
    expect(
      deriveBoard({ solutionState: "vacuum-solved", atmospheric: true }),
    ).toBe("atmospheric-unmodelled");
  });

  it("an atmospheric body shows the atmosphere-aware estimate when the source provides one", () => {
    expect(
      deriveBoard({
        solutionState: "vacuum-solved",
        atmospheric: true,
        atmosphereAware: true,
      }),
    ).toBe("atmospheric-aware");
    // but not-descending still wins over an available estimate
    expect(
      deriveBoard({
        solutionState: "not-descending",
        atmospheric: true,
        atmosphereAware: true,
      }),
    ).toBe("not-descending");
  });

  it("an atmospheric body suppresses even a no-solution vacuum result", () => {
    expect(
      deriveBoard({ solutionState: "no-solution", atmospheric: true }),
    ).toBe("atmospheric-unmodelled");
  });

  it("a vacuum body with missing data is no-solution", () => {
    expect(
      deriveBoard({ solutionState: "no-solution", atmospheric: false }),
    ).toBe("no-solution");
  });

  it("a vacuum body with a valid solve is vacuum-solved", () => {
    expect(
      deriveBoard({ solutionState: "vacuum-solved", atmospheric: false }),
    ).toBe("vacuum-solved");
  });
});
