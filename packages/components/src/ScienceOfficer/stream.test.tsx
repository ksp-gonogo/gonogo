import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ScienceOfficerComponent } from "./index";

/**
 * ScienceOfficer's stream test-adapter proof: genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport` for `science.lab` (a NEW capability, no legacy
 * Telemachus/GonogoTelemetry analogue), `science.instruments`
 * (`sci.instruments`'s new wire home, `map-topic.ts`) AND `science.experiments`
 * (the derived vessel-wide data total). All three reads are canonical one-arg
 * Topics now — no legacy `DataSource` is registered anywhere in this file. The
 * `science.instruments` payload below uses the NEW `InstrumentEntry` field
 * names (`partId` as a string, `partName`, `experimentId`, `dataIsCollectable`)
 * to prove `parseInstruments`'s shape fix reads the new wire correctly, not
 * just the legacy shape. Uses the exact idle-lab payload captured in
 * `local_docs/telemetry-mod/recordings/reference-lab-2026-07-08.json` (an
 * OPERATIONAL, 2-scientist, but IDLE Mobile Processing Lab — no data
 * loaded, `scienceRate` 0) — a valid steady state, not a placeholder.
 */
// Rendered trees, tracked so afterEach can unmount them BEFORE clearing the
// action-handler registry — clearActionHandlers() firing on a still-mounted
// widget is a state update outside act(). RTL auto-cleanup runs after this
// file's afterEach, too late to unmount first.
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

describe("ScienceOfficer — genuinely runs off the stream (M3 science.lab + P4a science.instruments)", () => {
  it("renders the idle-but-operational lab from science.lab and an instrument from science.instruments", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "science.lab",
        "science.instruments",
        "science.experiments",
      ],
      pinnedUt: 10,
    });

    const { unmount } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "so-stream" }}>
          <ScienceOfficerComponent id="so-stream" w={6} h={7} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);

    act(() => {
      fixture.emit("science.experiments", []);
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
    // parseInstruments's shape fix (string partId, partName/
    // experimentId/dataIsCollectable renames) reads the new wire, not just
    // the legacy shape.
    expect(screen.getByText("Mystery Goo™ Containment Unit")).toBeTruthy();
    expect(screen.getByText("mysteryGoo")).toBeTruthy();
    expect(screen.getByText("DATA")).toBeTruthy();
  });
});
