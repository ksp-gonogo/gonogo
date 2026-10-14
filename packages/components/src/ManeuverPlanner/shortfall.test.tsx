import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { ManeuverFrame, value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { NodeRow } from "./NodeRow";
import type { PlanResult } from "./planning";
import { ShortfallBanner } from "./ShortfallBanner";

function node(over: Partial<ParsedManeuverNode>): ParsedManeuverNode {
  return {
    id: "planner:0",
    UT: 1_000,
    deltaV: [0, 0, 600],
    deltaVMagnitude: 600,
    frame: ManeuverFrame.RadialNormalPrograde,
    ignitionUt: 990,
    cutoffUt: 1_010,
    orbitPatches: [],
    ...over,
  };
}

describe("a node row's shortfall verdict", () => {
  it("says SHORT for a node ahead that the available total cannot fly", () => {
    render(
      <NodeRow node={node({})} currentUT={value("ut", 0)} availableDv={500} />,
    );
    expect(screen.getByText("SHORT")).toBeInTheDocument();
  });

  it("says nothing mid-burn, where the available total is already being drawn down", () => {
    render(
      <NodeRow
        node={node({})}
        currentUT={value("ut", 1_000)}
        availableDv={500}
      />,
    );
    expect(screen.getByText("BURNING")).toBeInTheDocument();
    expect(screen.queryByText("SHORT")).toBeNull();
  });
});

describe("the shortfall banner", () => {
  it("names the vacuum basis of the available figure", () => {
    render(
      <ShortfallBanner
        feasible={false}
        plan={{} as PlanResult}
        requiredDeltaV={600}
        availableDeltaV={500}
        marking={null}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("available (VAC)");
  });
});
