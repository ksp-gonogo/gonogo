import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { NodeRow } from "./NodeRow";

const NODE: ParsedManeuverNode = {
  id: "node-1",
  UT: 100,
  deltaV: [0, 0, 300],
  frame: null,
  deltaVMagnitude: 300,
  ignitionUt: 96,
  cutoffUt: 104,
  orbitPatches: [],
};

function row(
  now: number,
  thrust?: { thrusting: boolean; startedUt: number | null },
) {
  render(
    <ul>
      <NodeRow
        node={NODE}
        currentUT={value("ut", now)}
        availableDv={2000}
        thrust={
          thrust && {
            thrusting: thrust.thrusting,
            startedUt:
              thrust.startedUt === null ? null : value("ut", thrust.startedUt),
            lastThrustEndUt: thrust.thrusting ? null : 108,
          }
        }
      />
    </ul>,
  );
}

describe("a planned node past its planned cutoff", () => {
  it("reads BURNING while the engine lit for it is still running", () => {
    row(106, { thrusting: true, startedUt: 96 });
    expect(screen.getByText("BURNING")).toBeInTheDocument();
    expect(screen.queryByText("PASSED")).toBeNull();
    expect(screen.getByText("burn still running")).toBeInTheDocument();
  });

  it("reads PASSED once the engine has stopped", () => {
    row(110, { thrusting: false, startedUt: null });
    expect(screen.getByText("PASSED")).toBeInTheDocument();
  });

  it("reads PASSED when the engine running was lit for a different burn", () => {
    row(600, { thrusting: true, startedUt: 500 });
    expect(screen.getByText("PASSED")).toBeInTheDocument();
  });

  it("reads PASSED with no propulsion reading at all", () => {
    row(106);
    expect(screen.getByText("PASSED")).toBeInTheDocument();
  });
});
