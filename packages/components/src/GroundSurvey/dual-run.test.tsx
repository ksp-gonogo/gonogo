import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import kerbinDescent from "./__fixtures__/kerbin-descent-low-pass.json";
import { GroundSurveyComponent } from "./index";

/**
 * GroundSurvey's behavior-preservation golden dual-run — same
 * "nothing is migratable" shape as `KeplerPeriod`/`OrbitalAscent`, but for
 * the structural reason documented in `stream.test.tsx`: the widget's data
 * layer (`useGroundSurveySamples`) bypasses `useDataValue` entirely via a
 * raw `getDataSource().subscribe`/`subscribeSamples` — a `TelemetryProvider`
 * mounted above it changes nothing. Every fixture key (not just the
 * widget's declared `dataRequirements` — `v.name`/`v.missionTime` are also
 * needed to prime `BufferedDataSource`'s flight detector, per
 * `index.test.tsx`'s own `prime()` helper) is replayed onto a legacy AUX
 * source in the "stream" leg, exactly mirroring the legacy leg's
 * `snapshotWidgetMode` (which seeds every non-`_`-prefixed fixture key).
 */
afterEach(() => {
  cleanup();
});

const FIXTURE_KEYS = Object.keys(kerbinDescent).filter(
  (k) => !k.startsWith("_"),
);

describe("GroundSurvey — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup wrapped in a TelemetryProvider as bare legacy, for the same survey state", async () => {
    const mode = { name: "default-8x8", w: 8, h: 8 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: GroundSurveyComponent,
      fixture: kerbinDescent,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({ carriedChannels: [] });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: FIXTURE_KEYS.map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "survey-dual" }}>
          <GroundSurveyComponent
            id="survey-dual"
            config={{}}
            w={mode.w}
            h={mode.h}
          />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of FIXTURE_KEYS) {
        legacyAux.source.emit(
          key,
          kerbinDescent[key as keyof typeof kerbinDescent],
        );
      }
    });

    await waitFor(() => {
      if (!container.textContent?.includes("GROUND SURVEY")) {
        throw new Error("widget has not rendered yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
