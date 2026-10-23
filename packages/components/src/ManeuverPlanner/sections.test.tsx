import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  installFixedSizeResizeObserver,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

afterEach(() => {
  clearActionHandlers();
  localStorage.clear();
});

function mount(id = "mnv-sections") {
  const fixture = setupStreamFixture({
    pinnedUt: 1_000_000,
    suspendFrames: true,
  });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: id }}>
        <ManeuverPlannerComponent id={id} config={{}} />
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
    fixture.emit("trackingStation.bodies", {
      bodies: [{ index: 1, name: "Kerbin", radius: 600000 }],
    });
    fixture.emit("vessel.maneuver", { nodes: [] });
  });
  return view;
}

describe("ManeuverPlanner: the plan and the flight plan", () => {
  it("lays them out side by side under their own headings in a wide tile", async () => {
    const restore = installFixedSizeResizeObserver({ width: 900, height: 700 });
    try {
      const { container } = mount();
      await waitFor(() => {
        expect(container.querySelector('[role="tablist"]')).toBeNull();
        expect(
          screen.getByRole("heading", { name: "New maneuver" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("heading", { name: "Flight plan" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("heading", { name: "Planned nodes" }),
        ).toBeInTheDocument();
      });
      await act(async () => {});
    } finally {
      restore();
    }
  });

  it("is two tabs in a wide tile too short to hold the flight plan beside the plan", async () => {
    const restore = installFixedSizeResizeObserver({
      width: 1100,
      height: 300,
    });
    try {
      const { container } = mount();
      const tablist = await screen.findByRole("tablist");
      expect(
        within(tablist)
          .getAllByRole("tab")
          .map((t) => t.textContent),
      ).toEqual(["New maneuver", "Flight plan"]);
      expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
      await act(async () => {});
    } finally {
      restore();
    }
  });

  it("is two tabs, one panel at a time, in a one-column tile", async () => {
    const { container } = mount();
    const tablist = await screen.findByRole("tablist");
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "New maneuver",
      "Flight plan",
    ]);
    expect(screen.queryByRole("heading", { name: "Planned nodes" })).toBeNull();
    act(() => {
      tabs[1].click();
    });
    await waitFor(() => {
      expect(screen.getByText("Planned nodes")).toBeInTheDocument();
      expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
    });
    await act(async () => {});
  });

  it("has no accessibility violations", async () => {
    const { container } = mount();
    await screen.findByRole("tablist");
    await expectNoA11yViolations(container);
    await act(async () => {});
  });

  it("keeps the chosen tab for that widget alone, across a remount", async () => {
    const first = mount("mnv-tab-a");
    const tabs = within(await screen.findByRole("tablist")).getAllByRole("tab");
    act(() => {
      tabs[1].click();
    });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Flight plan" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    first.unmount();

    const again = mount("mnv-tab-a");
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Flight plan" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    again.unmount();

    mount("mnv-tab-b");
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "New maneuver" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
  });
});
