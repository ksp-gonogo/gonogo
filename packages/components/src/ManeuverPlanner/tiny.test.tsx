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

  describe("a burn running past its planned cutoff", () => {
    async function mount(nodeFields: Record<string, unknown>) {
      const fixture = setupStreamFixture({ pinnedUt: 98, suspendFrames: true });
      renderWidget("maneuver-planner", {
        w: 3,
        h: 3,
        wrapper: fixture.Provider,
      });
      act(() => {
        fixture.emit("vessel.maneuver", { nodes: [node(nodeFields)] });
        fixture.emit("vessel.propulsion", {
          thrustStartedUt: 96,
          lastThrustEndUt: null,
        });
      });
      await waitFor(() => expect(visibleText()).toContain("Burn ΔV planned"));
      return fixture;
    }

    it("stays a burn in progress from ignition before the node until the engine stops, not until the node's instant or the planned cutoff", async () => {
      const fixture = await mount({ ut: 100, ignitionUt: 96, cutoffUt: 104 });
      for (const ut of [102, 106, 108]) {
        act(() => fixture.scrubTo(ut));
        expect(visibleText()).toContain("Burn ΔV planned");
        expect(visibleText()).not.toContain("PASSED");
      }
      act(() => {
        fixture.emit("vessel.propulsion", {
          thrustStartedUt: null,
          lastThrustEndUt: 109,
        });
        fixture.scrubTo(110);
      });
      await waitFor(() => expect(visibleText()).toContain("PASSED"));
      await act(async () => {});
    });

    it("stays a burn in progress when ignition came after the node's instant", async () => {
      const fixture = setupStreamFixture({ pinnedUt: 98, suspendFrames: true });
      renderWidget("maneuver-planner", {
        w: 3,
        h: 3,
        wrapper: fixture.Provider,
      });
      act(() => {
        fixture.emit("vessel.maneuver", {
          nodes: [node({ ut: 100, ignitionUt: 103, cutoffUt: 104 })],
        });
        fixture.emit("vessel.propulsion", {
          thrustStartedUt: 103,
          lastThrustEndUt: null,
        });
        fixture.scrubTo(107);
      });
      await waitFor(() => expect(visibleText()).toContain("Burn ΔV planned"));
      expect(visibleText()).not.toContain("PASSED");
      await act(async () => {});
    });

    it("stays a burn in progress on a long burn whose planned ignition drifts later as the craft lightens", async () => {
      const fixture = setupStreamFixture({ pinnedUt: 80, suspendFrames: true });
      renderWidget("maneuver-planner", {
        w: 3,
        h: 3,
        wrapper: fixture.Provider,
      });
      act(() => {
        fixture.emit("vessel.maneuver", {
          nodes: [node({ ut: 100, ignitionUt: 70, cutoffUt: 130 })],
        });
        fixture.emit("vessel.propulsion", {
          thrustStartedUt: 70,
          lastThrustEndUt: null,
        });
      });
      await waitFor(() => expect(visibleText()).toContain("Burn ΔV planned"));
      // Re-planned from the lighter craft: the same node, lit later and cut off sooner than the engine's own start and the burn it began.
      act(() => {
        fixture.emit("vessel.maneuver", {
          nodes: [node({ ut: 100, ignitionUt: 95, cutoffUt: 125 })],
        });
        fixture.scrubTo(128);
      });
      await waitFor(() => expect(visibleText()).toContain("Burn ΔV planned"));
      expect(visibleText()).not.toContain("PASSED");
      await act(async () => {});
    });

    it("says PASSED for a node whose burn never happened while an engine lit long after it is running", async () => {
      const fixture = setupStreamFixture({ pinnedUt: 98, suspendFrames: true });
      renderWidget("maneuver-planner", {
        w: 3,
        h: 3,
        wrapper: fixture.Provider,
      });
      act(() => {
        fixture.emit("vessel.maneuver", {
          nodes: [node({ ut: 100, ignitionUt: 96, cutoffUt: 104 })],
        });
        fixture.emit("vessel.propulsion", {
          thrustStartedUt: 500,
          lastThrustEndUt: null,
        });
        fixture.scrubTo(600);
      });
      await waitFor(() => expect(visibleText()).toContain("PASSED"));
      await act(async () => {});
    });
  });
});
