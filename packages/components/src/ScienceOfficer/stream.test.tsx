import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ScienceOfficerComponent } from "./index";
import { renderWithTheme } from "./testTheme";

/**
 * ScienceOfficer's stream test-adapter proof: genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport` for BOTH `science.lab` (M3 science/parts batch — a NEW
 * capability, no legacy Telemachus/GonogoTelemetry analogue) AND
 * `science.instruments` (P4a shared-map batch — `sci.instruments`'s new wire
 * home, `map-topic.ts`). `sci.experiments` IS also mapped (map-topic.ts,
 * an earlier M3 batch) but isn't in THIS fixture's `carriedChannels`, so it
 * still resolves off the legacy path here — a `setupMockDataSource` AUX
 * carries it, the same MIXED-source shape ScienceBench/PowerSystems' own M3
 * batches established. The `science.instruments` payload below uses the
 * NEW `InstrumentEntry` field names (`partId` as a string, `partName`,
 * `experimentId`, `dataIsCollectable`) to prove `parseInstruments`'s P4a
 * shape fix reads the new wire correctly, not just the legacy shape. Uses
 * the exact idle-lab payload captured in
 * `local_docs/telemetry-mod/recordings/reference-lab-2026-07-08.json` (an
 * OPERATIONAL, 2-scientist, but IDLE Mobile Processing Lab — no data
 * loaded, `scienceRate` 0) — a valid steady state, not a placeholder.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("ScienceOfficer — genuinely runs off the stream (M3 science.lab + P4a science.instruments)", () => {
  it("renders the idle-but-operational lab from science.lab and an instrument from science.instruments", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["science.lab", "science.instruments"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "sci.experiments" }],
      connectSource: true,
    });

    renderWithTheme(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "so-stream" }}>
          <ScienceOfficerComponent id="so-stream" w={6} h={7} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("sci.experiments", []);
      fixture.emit("science.instruments", [
        {
          partId: "77",
          partName: "Mystery Goo™ Containment Unit",
          experimentId: "mysteryGoo",
          title: "Mystery Goo Observation",
          deployed: false,
          inoperable: false,
          rerunnable: false,
          resettable: false,
          dataIsCollectable: true,
        },
      ]);
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
    expect(fixture.transport.isSubscribed("science.instruments")).toBe(true);

    await waitFor(() =>
      expect(screen.getByText("Mobile Processing Lab MPL-LG-2")).toBeTruthy(),
    );
    expect(screen.getByText("OPERATIONAL")).toBeTruthy();
    expect(screen.getByText("2 scientists")).toBeTruthy();
    expect(screen.getByText("0/750 data")).toBeTruthy();
    // Idle, not processing — no PROCESSING badge for a lab with nothing loaded.
    expect(screen.queryByText("PROCESSING")).not.toBeInTheDocument();

    // The new-shape science.instruments entry rendered too — proves
    // parseInstruments's P4a shape fix (string partId, partName/
    // experimentId/dataIsCollectable renames) reads the new wire, not just
    // the legacy shape.
    expect(screen.getByText("Mystery Goo™ Containment Unit")).toBeTruthy();
    expect(screen.getByText("mysteryGoo")).toBeTruthy();
    expect(screen.getByText("DATA")).toBeTruthy();

    teardownMockDataSource(legacyAux);
  });
});
