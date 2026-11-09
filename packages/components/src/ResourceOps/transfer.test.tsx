import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ResourceOpsComponent } from "./index";

const CONVERTER = {
  partId: "201",
  partTitle: "Convert-O-Tron 250",
  converterName: "Ore to Fuel",
  running: true,
  inputs: [{ resource: "Ore", rate: 0.5 }],
  outputs: [{ resource: "LiquidFuel", rate: 0.45 }],
};

const tank = (amount: number) => ({
  amount,
  maxAmount: 100,
  flow: null,
  nominalFlow: null,
  transferable: true,
  flowMode: 3,
  locked: false,
});
const part = (id: string, title: string) => ({
  id,
  title,
  name: title,
  resources: { LiquidFuel: tank(50) },
  modules: [],
  moduleStates: [],
  actionBindings: [],
});

const JOB = {
  id: "t1",
  resource: "LiquidFuel",
  fromPartIds: ["1"],
  toPartIds: ["2"],
  untilFull: true,
  moved: 64.2,
  rate: 18,
  state: 0,
  startedUt: 1,
};

function renderWidget(
  transfers: unknown[],
  converters: unknown[] = [CONVERTER],
) {
  const fixture = setupStreamFixture({ suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ops" }}>
        <ResourceOpsComponent id="ops" config={{}} w={6} h={8} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("isru.drills", []);
    fixture.emit("isru.converters", converters);
    fixture.emit("vessel.parts", {
      parts: [part("1", "Drop tank"), part("2", "Radial")],
      meta: { source: "" },
    });
    fixture.emit("vessel.resourceTransfers", {
      transfers,
      meta: { source: "" },
    });
    fixture.emit("vessel.transferReach", {
      obeysCrossfeed: false,
      sets: [],
      resources: {},
      meta: { source: "" },
    });
  });
  return fixture;
}

describe("Resource Ops transfers", () => {
  it("lists a running transfer as a process with a stop", async () => {
    renderWidget([JOB]);
    expect(await screen.findByText("Liquid Fuel transfer")).toBeInTheDocument();
    expect(screen.getByText("Drop tank → Radial")).toBeInTheDocument();
  });

  it("shows a running transfer on a craft with no drills or converters", async () => {
    renderWidget([JOB], []);
    expect(await screen.findByText("Liquid Fuel transfer")).toBeInTheDocument();
  });

  it("opens the picker from a converter's transferable resource only", async () => {
    const user = userEvent.setup();
    renderWidget([]);
    await user.click(
      await screen.findByRole("button", { name: "Transfer Liquid Fuel" }),
    );
    expect(
      screen.getByRole("group", { name: "Drop tank" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Transfer Ore" }),
    ).not.toBeInTheDocument();
  });
});
