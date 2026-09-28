import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { PowerSystemsComponent } from "./index";

// Unmount before clearActionHandlers(): RTL's auto-cleanup runs after afterEach, and clearing a mounted widget updates state outside act().
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

/** PowerSystems off the real telemetry pipeline via `StubTransport`, for `parts.power` and `vessel.parts`, whose per-part `resources` map feeds `usePartsLive`. */
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
        ElectricCharge: { amount: 10, maxAmount: 100, flow: 5, nominalFlow: 5 },
      },
      moduleStates: [],
    },
  ],
};

describe("PowerSystems: genuinely runs off the stream", () => {
  it("uses the SAME total for PROD/NET as the itemized per-part rows sum to, even when parts.power's totalProductionEc disagrees", async () => {
    // A single +5.00 producer row, while `totalProductionEc` disagrees at 42.
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [],
      connectSource: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ps-stream" }}>
          <PowerSystemsComponent id="ps-stream" w={8} h={12} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
    });

    await waitFor(() => expect(screen.getByText("PROD")).toBeTruthy());
    expect(visibleText()).toContain("+5.00/s");
    expect(screen.getAllByText("+5.00")).toHaveLength(2);

    expect(fixture.transport.isSubscribed("parts.power")).toBe(true);
    act(() => {
      fixture.emit("parts.power", {
        solarPanels: [],
        batteries: [],
        fuelCells: [],
        alternators: [],
        totalProductionEc: 42,
      });
    });

    // Settle the stream leg first, or the check can pass before the merge has applied.
    await waitFor(() => {
      if (visibleText(container).includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
      expect(screen.getByText("MEASURED")).toBeTruthy();
    });

    // A disagreeing measurement never wins PROD/NET over the itemised rows.
    expect(screen.queryByText("+42.00/s")).toBeNull();
    expect(visibleText()).toContain("+5.00/s");
    expect(screen.getAllByText("+5.00")).toHaveLength(2); // PROD cell + the one row

    // Nor is it dropped: it shows as a separate MEASURED reading.
    expect(visibleText()).toContain("42.00");

    teardownMockDataSource(legacyAux);
  });

  it("shows no separate MEASURED reading when parts.power's totalProductionEc agrees with the itemized total", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [],
      connectSource: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "ps-stream-agree" }}
        >
          <PowerSystemsComponent id="ps-stream-agree" w={8} h={12} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
    });
    await waitFor(() => expect(screen.getByText("PROD")).toBeTruthy());

    act(() => {
      fixture.emit("parts.power", {
        solarPanels: [],
        batteries: [],
        fuelCells: [],
        alternators: [],
        totalProductionEc: 5,
      });
    });

    await waitFor(() => {
      if (visibleText(container).includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
      expect(fixture.transport.isSubscribed("parts.power")).toBe(true);
    });
    expect(screen.queryByText("MEASURED")).toBeNull();

    teardownMockDataSource(legacyAux);
  });

  it("populates the Consumers section from a negative-flow part carried on vessel.parts (review finding I3)", async () => {
    // A negative-flow part on the `vessel.parts` stream lands in Consumers.
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [],
      connectSource: true,
    });

    const wireWithConsumer = {
      parts: [
        ...VESSEL_PARTS_WIRE.parts,
        {
          id: "2",
          name: "reactionWheel",
          title: "Advanced Reaction Wheel",
          position: { x: 0, y: 0, z: 0 },
          bounds: { size: { x: 1, y: 1, z: 1 } },
          dryMass: 0.05,
          inverseStage: 0,
          maxTemp: 1200,
          category: "Control",
          modules: ["ModuleReactionWheel"],
          isRobotics: false,
          isPowerRelated: false,
          resources: {
            ElectricCharge: { amount: 0, maxAmount: 0, flow: -1.8 },
          },
          moduleStates: [],
        },
      ],
    };

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ps-consumer" }}>
          <PowerSystemsComponent id="ps-consumer" w={8} h={12} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.parts", wireWithConsumer);
    });

    await waitFor(() => {
      expect(screen.getByText("Advanced Reaction Wheel")).toBeTruthy();
    });

    expect(screen.queryByText("Nothing consuming.")).toBeNull();
    // "-1.80" appears twice: the CONS totals cell and the single Consumers row.
    expect(visibleText()).toContain("+3.20/s");
    expect(screen.getAllByText("-1.80")).toHaveLength(2);

    teardownMockDataSource(legacyAux);
  });
});
