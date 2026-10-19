import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { PowerSystemsComponent } from "./index";

const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

/** The vessel from the rig: a probe core the game itemises at 0.028 EC/s, and a battery. */
const RIG_PARTS = {
  parts: [
    {
      id: "1",
      name: "probeCoreOcto",
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
        ElectricCharge: { amount: 5, maxAmount: 10, flow: -0.028 },
      },
      moduleStates: [],
    },
    {
      id: "2",
      name: "batteryBank",
      title: "Battery Bank",
      position: { x: 0, y: 1, z: 0 },
      bounds: { size: { x: 1, y: 1, z: 1 } },
      dryMass: 0.1,
      inverseStage: 0,
      maxTemp: 1200,
      category: "Electrical",
      modules: [],
      isRobotics: false,
      isPowerRelated: true,
      resources: {
        ElectricCharge: { amount: 395, maxAmount: 400 },
      },
      moduleStates: [],
    },
  ],
};

async function mountWith(power: Record<string, unknown>, w = 8, h = 12) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const { container } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ps-measured" }}>
        <PowerSystemsComponent id="ps-measured" w={w} h={h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.parts", RIG_PARTS);
  });
  await waitFor(() => expect(visibleText(container)).toContain("EC/s"));
  act(() => {
    fixture.emit("parts.power", power);
  });
  await waitFor(() => {
    if (visibleText(container).includes("SYNCING")) {
      throw new Error("stream status has not settled to live yet");
    }
  });
  await act(async () => {});
  return container;
}

describe("PowerSystems: the measured draw", () => {
  it("shows the total the batteries lose, the part rows, and the rest as Other", async () => {
    await mountWith({
      totalProductionEc: 0,
      netChargeRateEc: -0.0687,
      totalConsumptionEc: 0.0687,
      unattributedConsumptionEc: 0.0407,
    });

    expect(screen.getByText("Probe Core")).toBeTruthy();
    expect(screen.getAllByText("-0.03")).toHaveLength(1);
    expect(screen.getByText("Other")).toBeTruthy();
    expect(screen.getAllByText("-0.04")).toHaveLength(1);
    expect(visibleText()).toContain("-0.07 EC/s");
    expect(screen.getAllByText("-0.07")).toHaveLength(2);
  });

  it("shows NET, CONS and Other as unknown, never a partial sum, while the batteries are full", async () => {
    await mountWith({
      totalProductionEc: 0,
      netChargeRateEc: null,
      totalConsumptionEc: null,
      unattributedConsumptionEc: null,
    });

    expect(screen.getByLabelText("Other draw unknown").textContent).toBe(
      NULL_DISPLAY,
    );
    expect(screen.getByLabelText("Net rate unknown").textContent).toBe(
      NULL_DISPLAY,
    );
    expect(screen.getByLabelText("Total draw unknown").textContent).toBe(
      NULL_DISPLAY,
    );
    expect(visibleText()).not.toContain("-0.03 EC/s");
    expect(screen.getAllByText("-0.03")).toHaveLength(1);
  });

  it("reads the measured net at the tiny size", async () => {
    await mountWith(
      {
        totalProductionEc: 0,
        netChargeRateEc: -0.0687,
        totalConsumptionEc: 0.0687,
        unattributedConsumptionEc: 0.0407,
      },
      3,
      3,
    );

    expect(visibleText()).toContain("-0.07 EC/s");
  });
});
