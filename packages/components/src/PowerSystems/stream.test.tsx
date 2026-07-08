import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { PowerSystemsComponent } from "./index";

/**
 * The M3 science/parts batch's stream test-adapter proof for PowerSystems:
 * genuinely running off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport` for `parts.power` — a NEW
 * capability, no legacy Telemachus analogue. `useTopology`/`usePartsLive`
 * (the per-part Producers/Consumers/Idle breakdown) bypass `useDataValue`
 * entirely (`getDataSource().subscribe` directly) and therefore stay
 * legacy-only regardless of whether a `TelemetryProvider` is mounted — a
 * `setupMockDataSource` AUX feeds those here, same MIXED-source shape
 * DistanceToTarget/TargetPicker's own M3 batches established.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

const TOPOLOGY = {
  topologySeq: 1,
  rootFlightId: 1,
  parts: [{ flightId: 1, name: "probeCore", title: "Probe Core" }],
};

describe("PowerSystems — genuinely runs off the stream (M3 science/parts batch)", () => {
  it("prefers parts.power's totalProductionEc over the topology-summed total when carried", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["parts.power"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [
        { key: "v.topologySeq" },
        { key: "v.topology" },
        { key: "r.resourceFor[1]" },
      ],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ps-stream" }}>
          <PowerSystemsComponent id="ps-stream" w={8} h={12} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("v.topologySeq", 1);
      legacyAux.source.emit("v.topology", TOPOLOGY);
      legacyAux.source.emit("r.resourceFor[1]", {
        ElectricCharge: { amount: 10, maxAmount: 100, flow: 5, nominalFlow: 5 },
      });
    });

    await waitFor(() => expect(screen.getByText("PROD")).toBeTruthy());
    // Topology-only total (before the stream carries anything): NET reads
    // "+5.00/s"; PROD and the single per-part contribution row both read
    // the bare "+5.00".
    expect(screen.getByText("+5.00/s")).toBeTruthy();
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

    // The stream total (42.00) wins for NET + PROD; the per-part
    // contribution row is untouched (still legacy-only via usePartsLive)
    // and stays +5.00.
    await waitFor(() => expect(screen.getByText("+42.00/s")).toBeTruthy());
    expect(screen.getByText("+42.00")).toBeTruthy();
    expect(screen.getByText("+5.00")).toBeTruthy();

    teardownMockDataSource(legacyAux);
  });
});
