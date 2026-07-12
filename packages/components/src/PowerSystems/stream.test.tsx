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
 * The stream test-adapter proof for PowerSystems:
 * genuinely running off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport` for `parts.power` AND
 * `vessel.parts` (`useTopology` reads the latter canonically —
 * bypasses `useDataValue`/the carried-channels gate entirely, so it streams
 * as soon as ANY provider is mounted, same as `OrbitView`'s `vessel.orbit`
 * read). `usePartsLive`'s per-part `resources` join now rides the SAME
 * `vessel.parts` payload (each part's `resources` map) — a
 * `setupMockDataSource` AUX still feeds `parts.power`'s legacy MEASURED
 * reading, the same MIXED-source shape DistanceToTarget/TargetPicker's own
 * stream tests established.
 */
afterEach(() => {
  cleanup();
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

describe("PowerSystems — genuinely runs off the stream (M3 science/parts batch)", () => {
  it("uses the SAME total for PROD/NET as the itemized per-part rows sum to, even when parts.power's totalProductionEc disagrees (M3 whole-branch review #3)", async () => {
    // Before the fix: `totalProduced` preferred the streamed scalar
    // whenever present, so PROD/NET could show a number that contradicts
    // the itemized Producers rows below it — and NET drives a
    // charge/consume read the operator relies on. This is the concrete
    // failure case: a single +5.00 producer row, but
    // `totalProductionEc` (a stale/disagreeing measurement) says 42.
    const fixture = setupStreamFixture({
      carriedChannels: ["parts.power", "vessel.parts"],
      pinnedUt: 10,
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
      carriedChannels: ["parts.power", "vessel.parts"],
      pinnedUt: 10,
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
      if (container.textContent?.includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
      expect(fixture.transport.isSubscribed("parts.power")).toBe(true);
    });
    expect(screen.queryByText("MEASURED")).toBeNull();

    teardownMockDataSource(legacyAux);
  });

  it("populates the Consumers section from a negative-flow part carried on vessel.parts (review finding I3)", async () => {
    // KspHost.BuildPartResources now walks EC-consuming modules
    // (ModuleReactionWheel/ModuleLight/ModuleCommand/ModuleDataTransmitter/
    // BaseConverter's inputList) and emits negative flow alongside the
    // existing production rows — this is the widget-side proof that a
    // consumer part carried on the real vessel.parts stream actually lands
    // in the Consumers section (previously empty on the live stream: the
    // mod never emitted a negative-flow row for anything to filter into it).
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.parts"],
      pinnedUt: 10,
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
    // NET = +5.00 (producer) + -1.80 (consumer) = +3.20/s. "-1.80" appears
    // twice: the CONS totals cell and the Consumers row itself (a single
    // consumer, so they agree).
    expect(screen.getByText("+3.20/s")).toBeTruthy();
    expect(screen.getAllByText("-1.80")).toHaveLength(2);

    teardownMockDataSource(legacyAux);
  });
});
