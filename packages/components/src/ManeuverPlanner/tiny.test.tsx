import { act, screen, waitFor } from "@ksp-gonogo/test-utils";
import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./index";

function node(over: Record<string, unknown>) {
  return {
    id: "3aabdda0-9d2a-4931-8511-d9bfa4be4b4e",
    dvRadial: 0,
    dvNormal: 0,
    dvPrograde: 30,
    dvTotal: 30,
    ...over,
  };
}

describe("ManeuverPlanner tiny mode", () => {
  it("labels the available figure as the vacuum total", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderWidget("maneuver-planner", { w: 3, h: 3, wrapper: fixture.Provider });
    act(() => {
      fixture.emit("vessel.maneuver", { nodes: [node({ ut: 100 })] });
    });
    await waitFor(() => expect(visibleText()).toContain("Avail (VAC)"));
    await act(async () => {});
  });

  it("says PASSED where every node is behind the craft, rather than drawing a dash", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderWidget("maneuver-planner", { w: 3, h: 3, wrapper: fixture.Provider });
    act(() => {
      fixture.emit("vessel.maneuver", { nodes: [node({ ut: 5 })] });
    });
    await waitFor(() => expect(visibleText()).toContain("PASSED"));
    await act(async () => {});
  });

  it("names a burn in progress, with its figure as the planned size", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderWidget("maneuver-planner", { w: 3, h: 3, wrapper: fixture.Provider });
    act(() => {
      fixture.emit("vessel.maneuver", {
        nodes: [node({ ut: 12, ignitionUt: 8, cutoffUt: 20 })],
      });
    });
    await waitFor(() => expect(visibleText()).toContain("Burn ΔV planned"));
    expect(screen.queryByText("PASSED")).toBeNull();
    await act(async () => {});
  });
});
