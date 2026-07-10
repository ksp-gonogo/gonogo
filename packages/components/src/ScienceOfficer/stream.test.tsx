import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ScienceOfficerComponent } from "./index";

/**
 * ScienceOfficer's M3 science.lab batch stream test-adapter proof:
 * genuinely running off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport` for `science.lab` — a NEW
 * capability, no legacy Telemachus/GonogoTelemetry analogue (`sci.
 * instruments` stays legacy-only regardless of whether a `TelemetryProvider`
 * is mounted; `sci.experiments` IS mapped (map-topic.ts) but isn't in THIS
 * fixture's `carriedChannels`, so it too resolves off the legacy path here —
 * a `setupMockDataSource` AUX carries both, the same MIXED-source shape
 * ScienceBench/PowerSystems' own M3 batches established). Uses the exact
 * idle-lab payload captured in
 * `local_docs/telemetry-mod/recordings/reference-lab-2026-07-08.json` (an
 * OPERATIONAL, 2-scientist, but IDLE Mobile Processing Lab — no data
 * loaded, `scienceRate` 0) — a valid steady state, not a placeholder.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("ScienceOfficer — genuinely runs off the stream (M3 science.lab batch)", () => {
  it("renders the idle-but-operational lab from science.lab", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["science.lab"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "sci.instruments" }, { key: "sci.experiments" }],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "so-stream" }}>
          <ScienceOfficerComponent id="so-stream" w={6} h={7} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("sci.instruments", []);
      legacyAux.source.emit("sci.experiments", []);
      fixture.emit("science.lab", [
        {
          partName: "Mobile Processing Lab MPL-LG-2",
          dataStored: 0,
          dataStorage: 750,
          storedScience: 0,
          processingData: false,
          statusText: "Operational",
          scientistCount: 2,
          scienceRate: 0,
          isOperational: true,
        },
      ]);
    });

    expect(fixture.transport.isSubscribed("science.lab")).toBe(true);

    await waitFor(() =>
      expect(screen.getByText("Mobile Processing Lab MPL-LG-2")).toBeTruthy(),
    );
    expect(screen.getByText("OPERATIONAL")).toBeTruthy();
    expect(screen.getByText("2 scientists")).toBeTruthy();
    expect(screen.getByText("0/750 data")).toBeTruthy();
    // Idle, not processing — no PROCESSING badge for a lab with nothing loaded.
    expect(screen.queryByText("PROCESSING")).not.toBeInTheDocument();

    teardownMockDataSource(legacyAux);
  });
});
