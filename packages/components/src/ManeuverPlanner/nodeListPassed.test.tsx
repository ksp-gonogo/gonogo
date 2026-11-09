import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ManeuverNodeList } from "./ManeuverNodeList";

function node(id: string, ut: number, dv: number): ParsedManeuverNode {
  return {
    id,
    UT: ut,
    deltaV: [0, 0, dv],
    frame: null,
    deltaVMagnitude: dv,
    ignitionUt: null,
    cutoffUt: null,
    orbitPatches: [],
  };
}

function list(nodes: ParsedManeuverNode[], now: number) {
  render(
    <ManeuverNodeList
      nodes={nodes}
      awaiting={false}
      completedNodes={new Map()}
      currentUT={value("ut", now)}
      availableDv={2000}
      onDelete={() => {}}
      onEdit={() => {}}
      onClearAll={() => {}}
      removing={false}
      adding={false}
    />,
  );
}

describe("ManeuverNodeList and a passed node", () => {
  it("does not list a passed node that has nothing to burn", () => {
    list([node("a", 100, 0)], 5000);
    expect(screen.queryByText("PASSED")).toBeNull();
    expect(screen.getByText("No maneuver nodes planned")).toBeInTheDocument();
  });

  it("still lists a passed node that has a burn", () => {
    list([node("a", 100, 12)], 5000);
    expect(screen.getByText("PASSED")).toBeInTheDocument();
  });

  it("still lists a node with nothing to burn while it is yet to come", () => {
    list([node("a", 9000, 0)], 5000);
    expect(screen.queryByText("No maneuver nodes planned")).toBeNull();
  });
});
