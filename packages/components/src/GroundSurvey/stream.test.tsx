import { DashboardItemContext } from "@ksp-gonogo/core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GroundSurveyComponent } from "./index";

/**
 * The stream test-adapter proof for GroundSurvey — a NEW class
 * of "zero migratable keys" widget, distinct from `KeplerPeriod`/
 * `OrbitalAscent` (which route their live values through `useDataSeries`,
 * a sibling hook the shim doesn't cover). GroundSurvey's data layer,
 * `useGroundSurveySamples`, doesn't call `useDataValue` AT ALL — it calls
 * `getDataSource(cfg.sourceId)` directly and subscribes to the raw
 * `DataSource`/`BufferedDataSource` interface (`.subscribe`/
 * `.subscribeSamples`) itself, entirely bypassing the read shim (which
 * only wraps `useDataValue`/`useExecuteAction`/`useDataStreamStatus`). A
 * `TelemetryProvider` being mounted above this widget has literally zero
 * effect — `getDataSource` is a plain registry lookup, independent of React
 * context.
 *
 * No `useDataStreamStatus`/`StreamStatusBadge` were added — there is no
 * `useDataValue` call site to attach one to, mapped or not. This test locks
 * in that the widget still renders its normal "no telemetry" state when
 * mounted under a `TelemetryProvider` with no legacy `DataSource`
 * registered, proving the harness doesn't disturb a widget that isn't
 * wired to it at all.
 */
afterEach(() => {
  cleanup();
});

describe("GroundSurvey — zero migratable keys (raw DataSource access), stream-safe no-op (M3 batch 3)", () => {
  it("renders its normal no-telemetry state under a TelemetryProvider with no legacy source, nothing streams", () => {
    const fixture = setupStreamFixture({ carriedChannels: [] });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "survey-stream" }}>
          <GroundSurveyComponent id="survey-stream" w={8} h={8} config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(container.textContent).toContain("GROUND SURVEY");
    expect(container.textContent).toContain("Awaiting telemetry…");
  });
});
