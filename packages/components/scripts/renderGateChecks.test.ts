import { describe, expect, it } from "vitest";
import { shiftedControls } from "./renderGateChecks";
import { debtKey, settleDebt } from "./renderGateDebt";
import { longestContractLabel } from "./renderGateStress";

const at = (key: string, x: number, y: number) => ({ key, x, y });

describe("shiftedControls", () => {
  it("reports a control pushed down by something inserted above it", () => {
    const before = [at("a", 0, 0), at("b", 0, 40), at("c", 0, 80)];
    const after = [at("a", 0, 0), at("b", 0, 60), at("c", 0, 80)];
    expect(shiftedControls(before, after)).toEqual(["b moved 0.0, 20.0px"]);
  });

  it("ignores a control that appears or goes", () => {
    expect(
      shiftedControls([at("a", 0, 0)], [at("a", 0, 0), at("b", 0, 9)]),
    ).toEqual([]);
    expect(
      shiftedControls([at("a", 0, 0), at("b", 0, 9)], [at("a", 0, 0)]),
    ).toEqual([]);
  });

  it("ignores everything moving together, which is a scroll", () => {
    const before = [at("a", 0, 0), at("b", 0, 40), at("c", 0, 80)];
    const after = [at("a", 0, -30), at("b", 0, 10), at("c", 0, 50)];
    expect(shiftedControls(before, after)).toEqual([]);
  });
});

describe("settleDebt", () => {
  const finding = "graph @ min-5x4 (stress-many-series): <text> x";

  it("removes a finding its debt covers and keeps one it does not", () => {
    const lines = [finding, "ship-map @ a (b): c"];
    const debt = new Set(["graph|stress-many-series|svgHtmlOverlaps"]);
    const settled = settleDebt(
      [["svgHtmlOverlaps", lines]],
      new Set(["graph", "ship-map"]),
      debt,
    );
    expect(settled.covered).toBe(1);
    expect(lines).toEqual(["ship-map @ a (b): c"]);
  });

  it("names an entry of a rendered widget that reported nothing, and none of an unrendered one", () => {
    const debt = new Set(["graph|svgHtmlOverlaps", "twr|hitTargets"]);
    const settled = settleDebt(
      [["svgHtmlOverlaps", []]],
      new Set(["graph"]),
      debt,
    );
    expect(settled.stale).toEqual(["graph|svgHtmlOverlaps"]);
  });

  it("covers a font-dependent finding when it shows and never calls its entry stale", () => {
    const fontDebt = new Set(["graph|stress-many-series|svgHtmlOverlaps"]);
    const shown = [finding];
    const withFinding = settleDebt(
      [["svgHtmlOverlaps", shown]],
      new Set(["graph"]),
      new Set(),
      fontDebt,
    );
    expect(withFinding.covered).toBe(1);
    expect(shown).toEqual([]);
    const without = settleDebt(
      [["svgHtmlOverlaps", []]],
      new Set(["graph"]),
      new Set(),
      fontDebt,
    );
    expect(without.stale).toEqual([]);
  });

  it("never covers the older checks on an authored scene", () => {
    expect(debtKey("overlaps", "graph @ m (authored): x")).toBeUndefined();
  });
});

describe("longestContractLabel", () => {
  it("builds the label from the longest enum members, split into words", () => {
    const source =
      "\tAlphaBetaGammaDelta = 1,\n\tShort = 2,\n\tOmegaSigmaKappaZeta = 3,\n";
    expect(longestContractLabel(source)).toBe(
      "Alpha Beta Gamma Delta Omega Sigma Kappa Zeta",
    );
  });
});
