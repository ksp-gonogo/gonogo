import { DashboardItemContext, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ResourceOpsComponent } from "./index";

const FUEL_CELL = {
  partId: "301",
  partTitle: "Fuel Cell",
  converterName: "Fuel Cell",
  running: true,
  throughput: 0,
  shortfall: "missing Liquid Fuel",
  inputs: [
    { resource: "LiquidFuel", rate: 0.0016875 },
    { resource: "Oxidizer", rate: 0.0020625 },
  ],
  outputs: [{ resource: "ElectricCharge", rate: 1.5 }],
};

function renderWidget() {
  const fixture = setupStreamFixture({ suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "res-starved" }}>
        <WidgetMetaContext.Provider
          value={{ componentId: "resource-ops", contributionSlots: [] }}
        >
          <ResourceOpsComponent id="res-starved" w={6} h={8} />
        </WidgetMetaContext.Provider>
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return fixture;
}

describe("Resource Ops starved converters", () => {
  it("marks a running converter the game says achieved nothing, and withholds its nominal rates", async () => {
    const fixture = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
      fixture.emit("isru.converters", [FUEL_CELL]);
    });

    expect(await screen.findByText("no output")).toBeInTheDocument();
    expect(screen.queryByText("1.500")).toBeNull();
    expect(screen.queryByText("0.0017")).toBeNull();
  });

  it("shows the rates of a converter that is running at a share of its recipe", async () => {
    const fixture = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
      fixture.emit("isru.converters", [
        { ...FUEL_CELL, throughput: 0.5, shortfall: null },
      ]);
    });

    await screen.findByText("Fuel Cell");
    expect(screen.queryByText("no output")).toBeNull();
    expect(screen.getByText("1.500")).toBeInTheDocument();
  });

  it("counts a starved fuel cell as no generation in the net electric charge", async () => {
    const fixture = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
      fixture.emit("isru.converters", [FUEL_CELL]);
    });

    await screen.findByText("no output");
    expect(screen.queryByText(/-1\.5/)).toBeNull();
  });
});
