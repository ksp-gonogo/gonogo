import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
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
  it("uses the SAME total for PROD/NET as the itemized per-part rows sum to, even when parts.power's totalProductionEc disagrees (M3 whole-branch review #3)", async () => {
    // Before the fix: `totalProduced` preferred the streamed scalar
    // whenever present, so PROD/NET could show a number that contradicts
    // the itemized Producers rows below it — and NET drives a
    // charge/consume read the operator relies on. This is the concrete
    // case from the review: a single +5.00 producer row, but
    // `totalProductionEc` (a stale/disagreeing measurement) says 42.
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

    const { container } = render(
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

    // Wait for the stream leg to actually settle (mirrors dual-run.test.tsx's
    // "has not settled to live yet" idiom) before asserting — otherwise the
    // check can race the async store update and pass for the wrong reason
    // (checked before the merge would even have applied).
    await waitFor(() => {
      if (container.textContent?.includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
      expect(screen.getByText("MEASURED")).toBeTruthy();
    });

    // A disagreeing measurement must never win PROD/NET over the itemized
    // rows — the header must stay CONSISTENT with what's actually listed
    // below it. "+42.00/s"/"+42.00" (the old, wrong, enshrined behavior)
    // must never appear.
    expect(screen.queryByText("+42.00/s")).toBeNull();
    expect(screen.getByText("+5.00/s")).toBeTruthy();
    expect(screen.getAllByText("+5.00")).toHaveLength(2); // PROD cell + the one row

    // The disagreeing measurement must not be silently dropped either —
    // it's surfaced as a clearly separate, explicitly-labeled reading so
    // the operator isn't blind to a real sensor/topology mismatch.
    expect(screen.getByText("42.00")).toBeTruthy();

    teardownMockDataSource(legacyAux);
  });

  it("shows no separate MEASURED reading when parts.power's totalProductionEc agrees with the itemized total", async () => {
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
      legacyAux.source.emit("v.topologySeq", 1);
      legacyAux.source.emit("v.topology", TOPOLOGY);
      legacyAux.source.emit("r.resourceFor[1]", {
        ElectricCharge: { amount: 10, maxAmount: 100, flow: 5, nominalFlow: 5 },
      });
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
      if (container.textContent?.includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
      expect(fixture.transport.isSubscribed("parts.power")).toBe(true);
    });
    expect(screen.queryByText("MEASURED")).toBeNull();

    teardownMockDataSource(legacyAux);
  });
});
