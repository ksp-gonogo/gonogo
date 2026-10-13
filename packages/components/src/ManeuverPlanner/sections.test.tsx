import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

afterEach(() => {
  clearActionHandlers();
});

function mount() {
  const fixture = setupStreamFixture({ pinnedUt: 1_000_000 });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "mnv-sections" }}>
        <ManeuverPlannerComponent id="mnv-sections" config={{}} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 1,
      sma: 700000,
      ecc: 0.01,
      inc: 0,
      lan: 0,
      argPe: 0,
      mu: 3.5316e12,
      meanAnomalyAtEpoch: 0,
      epoch: 1_000_000,
      horizon: ANALYTIC_UNBOUNDED_HORIZON,
      patches: [],
    });
    fixture.emit("system.bodies", {
      bodies: [{ index: 1, name: "Kerbin", radius: 600000 }],
    });
    fixture.emit("vessel.maneuver", { nodes: [] });
  });
  return view;
}

describe("ManeuverPlanner: the sections are the panel's to lay out", () => {
  it("gives planned nodes, new maneuver and preview to one section grid, none spanning it", async () => {
    const { container } = mount();
    const headings = await Promise.all(
      ["Planned nodes", "New maneuver", "Preview"].map((name) =>
        screen.findByRole("heading", { name }),
      ),
    );
    const grids = headings.map((h) => h.closest("[data-section-full]"));
    expect(grids).toEqual([null, null, null]);

    // Each section is a direct child of the same grid, so the panel decides rows or columns.
    const sectionOf = (h: HTMLElement) => {
      let node: HTMLElement | null = h;
      while (node && node.parentElement) {
        const display = getComputedStyle(node.parentElement).display;
        if (display === "grid") return node.parentElement;
        node = node.parentElement;
      }
      return null;
    };
    const parents = headings.map(sectionOf);
    expect(parents[0]).not.toBeNull();
    expect(new Set(parents).size).toBe(1);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    await act(async () => {});
  });

  it("has no accessibility violations", async () => {
    const { container } = mount();
    await screen.findByRole("heading", { name: "Preview" });
    await expectNoA11yViolations(container);
    await act(async () => {});
  });
});
