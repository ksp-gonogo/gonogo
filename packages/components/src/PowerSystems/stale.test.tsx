import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { PowerSystemsComponent } from "./index";

/**
 * What this widget does when `vessel.parts` stops being current.
 *
 * Every figure it draws, the totals row and all three breakdown sections, comes
 * off that one read, which is the case a panel-wide statement is honest in: the
 * host does not derive one precisely because a worst-of pill across five topics
 * cannot say which is degraded, and here there is only the one to name.
 *
 * The rates are KEPT. A vessel that was drawing 6/s is still the last thing it
 * reported, and a blank NET would read as a craft with no load on it, which is
 * a claim about the vessel made out of the absence of a frame.
 */

const CARRIED = ["vessel.parts", "parts.power"];

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

const VESSEL_PARTS_WIRE = {
  parts: [
    {
      id: "1",
      name: "probeCore",
      title: "Probe Core",
      position: { x: 0, y: 0, z: 0 },
      bounds: { size: { x: 1, y: 1, z: 1 } },
      dryMass: 0.1,
      inverseStage: 0,
      maxTemp: 1200,
      category: "Pods",
      modules: [],
      isRobotics: false,
      isPowerRelated: false,
      resources: {
        ElectricCharge: {
          amount: 10,
          maxAmount: 100,
          flow: -6,
          nominalFlow: -8,
        },
      },
      moduleStates: [],
    },
    {
      id: "2",
      name: "rtg",
      title: "PB-NUK Radioisotope Thermoelectric Generator",
      position: { x: 0, y: 1, z: 0 },
      bounds: { size: { x: 1, y: 1, z: 1 } },
      dryMass: 0.08,
      inverseStage: 0,
      maxTemp: 2000,
      category: "Electrical",
      modules: [],
      isRobotics: false,
      isPowerRelated: true,
      resources: {
        ElectricCharge: {
          amount: 0,
          maxAmount: 0,
          flow: 0.75,
          nominalFlow: 0.75,
        },
      },
      moduleStates: [],
    },
  ],
};

function mount(fixture: ReturnType<typeof setupStreamFixture>) {
  const { container, unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "power-stale" }}>
        <PowerSystemsComponent id="power-stale" w={8} h={12} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return container;
}

/** Drop the link, then run a frame: nothing else re-derives the readings. */
function goStale(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

describe("PowerSystems when vessel.parts is no longer current", () => {
  it("keeps every rate and says the read behind them has stopped", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
    const container = mount(fixture);
    act(() => {
      fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
    });
    await waitFor(() => expect(visibleText(container)).toContain("-6.00"));
    // The control: a live widget says nothing, which is what makes the
    // assertion after `goStale` evidence of anything at all.
    expect(screen.queryByText("OFFLINE")).toBeNull();

    goStale(fixture);

    // Held, not withheld. A blank NET would say the vessel has no load.
    expect(visibleText(container)).toContain("-6.00");
    expect(visibleText(container)).toContain("+0.75");
    expect(screen.getByText("OFFLINE")).toBeTruthy();
  });

  it("marks the per-part efficiency figures on the figures themselves", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
    const container = mount(fixture);
    act(() => {
      fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
    });
    await waitFor(() => expect(visibleText(container)).toContain("-6.00"));
    expect(container.querySelectorAll("[data-not-current]")).toHaveLength(0);

    goStale(fixture);

    const marks = container.querySelectorAll("[data-not-current]");
    // One per breakdown row that reports an efficiency: the producer and the
    // consumer, each drawn from the read that stopped.
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      // A mark with no caption looks marked and says nothing, which is the one
      // outcome worse than no mark at all.
      expect(mark.querySelector("[data-unit-currency]")).not.toBeNull();
    }
  });
});
