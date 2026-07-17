import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { render as rtlRender, screen, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ScienceBenchComponent } from "./index";

// Rendered trees, tracked so afterEach can unmount them BEFORE clearing the
// action-handler registry — clearActionHandlers() firing on a still-mounted
// widget is a state update outside act(). RTL auto-cleanup runs after this
// file's afterEach, too late to unmount first.
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

/**
 * Stream test-adapter proof for ScienceBench: genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport`. ScienceBench now reads its whole state off canonical
 * Topics (`science.experiments`/`science.sensors`/`science.experimentBreakdown`
 * + the derived `vessel.state`/`vessel.surface`/`career.status` channels), so
 * there is no legacy `DataSource` registered anywhere in this file —
 * `science.experiments` is a raw array read wholesale, same shape as
 * `TargetPicker`'s `system.vessels` migration.
 */
afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

describe("ScienceBench — genuinely runs off the stream (M3 science/parts batch)", () => {
  it("renders experiment titles/dataAmount from science.experiments' partName-keyed shape", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["science.experiments"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "sb-stream" }}>
          <ScienceBenchComponent id="sb-stream" w={8} h={10} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("science.experiments")).toBe(true);

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

    await waitFor(() =>
      expect(screen.getByText("Seismic Scan from LaunchPad")).toBeTruthy(),
    );
    expect(screen.getByText("50.0 mits")).toBeTruthy();
  });
});
