import { DashboardItemContext, type VesselTopology } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { topologyToVesselPartsWire } from "../test/topologyToVesselPartsWire";
import fuellinePostStage2 from "./__fixtures__/fuelline-tester-poststage2.json";
import { ShipMapComponent } from "./index";

const TOPOLOGY = fuellinePostStage2["v.topology"] as VesselTopology;
const [A, B, C] = TOPOLOGY.parts.map((p) => String(p.flightId));

function partsWire() {
  const wire = topologyToVesselPartsWire(TOPOLOGY) as {
    parts: { id: string; title: string; resources: Record<string, unknown> }[];
  };
  const tank = (amount: number, flowMode = 3, locked = false) => ({
    amount,
    maxAmount: 100,
    flow: null,
    nominalFlow: null,
    transferable: true,
    flowMode,
    locked,
  });
  for (const part of wire.parts) {
    if (part.id === A) part.resources = { LiquidFuel: tank(50, 3, true) };
    if (part.id === B) part.resources = { LiquidFuel: tank(0) };
    if (part.id === C) part.resources = { LiquidFuel: tank(10, 1) };
  }
  return wire;
}

const job = {
  id: "t1",
  resource: "LiquidFuel",
  fromPartIds: [A],
  toPartIds: [B],
  untilFull: true,
  moved: 64.2,
  rate: 18,
  state: 0,
  startedUt: 1,
};

function open(transfers: unknown[] = []) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "s" }}>
        <ShipMapComponent id="s" w={12} h={10} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.parts", partsWire());
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

const partLabelled = (id: string) =>
  document.querySelector(`[data-flight-id="${id}"]`) as Element;

describe("Vessel Schematic transfers", () => {
  it("offers a transfer in a tank's menu and sends the pick made on the diagram", async () => {
    const user = userEvent.setup();
    const fixture = open();
    await waitFor(() => expect(partLabelled(A)).toBeTruthy());

    await user.click(partLabelled(A));
    await user.click(
      await screen.findByRole("menuitem", {
        name: /Transfer Liquid Fuel from or to/,
      }),
    );
    await user.click(partLabelled(B));
    await user.click(partLabelled(B));
    await user.click(screen.getByRole("button", { name: /^Transfer/ }));

    const sent = fixture.transport.sentCommands.filter(
      (c) => c.command === "vessel.resource.transfer.start",
    );
    expect(sent[0].args).toMatchObject({
      resource: "LiquidFuel",
      fromPartIds: [A],
      toPartIds: [B],
      untilFull: true,
    });
  });

  it("gives an out-only tank a From and skips To", async () => {
    const user = userEvent.setup();
    open();
    await waitFor(() => expect(partLabelled(A)).toBeTruthy());
    await user.click(partLabelled(A));
    await user.click(
      await screen.findByRole("menuitem", { name: /Transfer Liquid Fuel/ }),
    );

    await user.click(partLabelled(C));
    expect(document.querySelectorAll('[data-mark="from"]').length).toBe(2);
    await user.click(partLabelled(C));
    expect(document.querySelectorAll('[data-mark="from"]').length).toBe(1);
  });

  it("draws a running transfer, with its figures and a stop", async () => {
    const user = userEvent.setup();
    const fixture = open([job]);
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-role="transfer-pipe"]').length,
      ).toBe(2),
    );

    expect(document.querySelector('[data-mark="out"]')).toBeTruthy();
    expect(document.querySelector('[data-mark="in"]')).toBeTruthy();
    expect(screen.getByText("64.2", { exact: false })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Stop/ }));
    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "vessel.resource.transfer.stop",
      )[0].args,
    ).toEqual({ all: false, transferId: "t1" });
  });

  it("draws nothing when no transfer is running or being picked", async () => {
    open();
    await waitFor(() => expect(partLabelled(A)).toBeTruthy());
    expect(document.querySelector('[data-role="transfer-layer"]')).toBeNull();
  });
});
