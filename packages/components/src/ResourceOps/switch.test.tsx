import { DashboardItemContext, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ResourceOpsComponent } from "./index";

const DRILL = {
  partId: "101",
  partTitle: "Drill-O-Matic",
  converterName: "Ore Drill",
  resource: "Ore",
  deployed: true,
  running: false,
  abundance: 0.075,
  rate: 0,
};

const CONVERTER = {
  partId: "201",
  partTitle: "Convert-O-Tron 250",
  converterName: "Ore to Fuel",
  running: true,
  inputs: [{ resource: "Ore", rate: 0.5 }],
  outputs: [{ resource: "LiquidFuel", rate: 0.45 }],
};

function renderWidget() {
  const fixture = setupStreamFixture({ suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "res-switch" }}>
        <WidgetMetaContext.Provider
          value={{ componentId: "resource-ops", contributionSlots: [] }}
        >
          <ResourceOpsComponent id="res-switch" w={6} h={8} />
        </WidgetMetaContext.Provider>
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, view };
}

const sentOf = (
  fixture: ReturnType<typeof setupStreamFixture>,
  command: string,
) => fixture.transport.sentCommands.filter((c) => c.command === command);

describe("Resource Ops start and stop", () => {
  it("offers Stop on a running converter and Start on a stopped drill", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", [DRILL]);
      fixture.emit("isru.converters", [CONVERTER]);
    });

    expect(
      await screen.findByRole("button", { name: "Stop" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("sends the converter start with the part id and converter name", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", [DRILL]);
      fixture.emit("isru.converters", [CONVERTER]);
    });

    await userEvent.click(await screen.findByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(sentOf(fixture, "vessel.converter.start")).toHaveLength(1);
    });
    expect(sentOf(fixture, "vessel.converter.start")[0].args).toEqual({
      partId: "101",
      converterName: "Ore Drill",
    });
    expect(sentOf(fixture, "vessel.converter.stop")).toHaveLength(0);
  });

  it("sends the converter stop from the running converter", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
      fixture.emit("isru.converters", [CONVERTER]);
    });

    await userEvent.click(await screen.findByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(sentOf(fixture, "vessel.converter.stop")).toHaveLength(1);
    });
    expect(sentOf(fixture, "vessel.converter.stop")[0].args).toEqual({
      partId: "201",
      converterName: "Ore to Fuel",
    });
  });

  it("offers neither control on a unit whose run state is unread", async () => {
    const { fixture } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
      fixture.emit("isru.converters", [{ ...CONVERTER, running: null }]);
    });

    await screen.findByText("Convert-O-Tron 250");
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("has no accessibility violations with the controls drawn", async () => {
    const { fixture, view } = renderWidget();
    act(() => {
      fixture.emit("isru.drills", [DRILL]);
      fixture.emit("isru.converters", [CONVERTER]);
    });
    await screen.findByRole("button", { name: "Stop" });

    await expectNoA11yViolations(view.container);
  });
});
