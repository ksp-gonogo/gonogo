import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ScienceBenchComponent } from "./index";

/**
 * Stream test-adapter proof for ScienceBench:
 * genuinely running off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport`. `sci.experiments` is mapped
 * onto `science.experiments` (map-topic.ts) — a raw array read wholesale,
 * same shape as `TargetPicker`'s `system.vessels` migration. `sci.count`/
 * `sci.dataAmount` no longer exist as reads at all — the widget
 * derives both from this same experiments array. Every other science/career
 * key (`v.body`/`v.situationString`/`s.sensor.*`/`science.sensors`/
 * `career.*`) stays legacy-only (still-gapped, or mapped-but-not-carried-in-
 * this-fixture) throughout — a `setupMockDataSource` AUX carries those, the
 * same MIXED-source shape DistanceToTarget and TargetPicker
 * established.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("ScienceBench — genuinely runs off the stream (M3 science/parts batch)", () => {
  it("renders experiment titles/dataAmount from science.experiments' partName-keyed shape", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["science.experiments"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "v.body" }, { key: "v.situationString" }],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "sb-stream" }}>
          <ScienceBenchComponent id="sb-stream" w={8} h={10} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("science.experiments")).toBe(true);

    act(() => {
      legacyAux.source.emit("v.body", "Kerbin");
      legacyAux.source.emit("v.situationString", "In flight");
      fixture.emit("science.experiments", [
        {
          partName: "Double-C Seismic Accelerometer",
          location: "experiment",
          experimentId: "seismicScan",
          subjectId: "seismicScan@KerbinSrfLandedLaunchPad",
          title: "Seismic Scan from LaunchPad",
          dataAmount: 50,
        },
      ]);
    });

    await waitFor(() =>
      expect(screen.getByText("Seismic Scan from LaunchPad")).toBeTruthy(),
    );
    expect(screen.getByText("50.0 mits")).toBeTruthy();

    teardownMockDataSource(legacyAux);
  });
});
