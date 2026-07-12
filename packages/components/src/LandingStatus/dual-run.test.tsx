import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import kerbinReentry from "./__fixtures__/kerbin-reentry-atmospheric.json";
import { LandingStatusComponent } from "./index";

/**
 * LandingStatus's behavior-preservation golden dual-run (mirrors
 * `ThermalStatus/dual-run.test.tsx` and `AtmosphereProfile/
 * dual-run.test.tsx`): the SAME landing state, rendered once off
 * the legacy `DataSource` and once off the stream, must produce
 * byte-identical DOM at `delay=0`.
 *
 * `kerbin-reentry-atmospheric` is chosen because it's the one fixture that
 * populates every field the widget reads AND clears `noPrediction`
 * (`land.timeToImpact` is finite), so the full metric grid — including the
 * atmospheric "ambient" section that's the only DOM surfacing the 3 mapped
 * `vessel.flight.*` values — renders on both legs. `v.body`, every
 * `land.*` key, and `v.atmosphericTemperature`/`v.externalTemperature`
 * (all GAPPED) read off a legacy AUX source in the stream leg.
 */
afterEach(() => {
  cleanup();
});

const GAPPED_KEYS = [
  "v.body",
  "v.atmosphericTemperature",
  "v.externalTemperature",
  "land.timeToImpact",
  "land.speedAtImpact",
  "land.bestSpeedAtImpact",
  "land.suicideBurnCountdown",
  "land.predictedLat",
  "land.predictedLon",
  "land.slopeAngle",
] as const;

describe("LandingStatus — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same landing state", async () => {
    const mode = { name: "default-8x10", w: 8, h: 10 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: LandingStatusComponent,
      fixture: kerbinReentry,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.flight"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: GAPPED_KEYS.map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "landing-dual" }}>
          <LandingStatusComponent id="landing-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of GAPPED_KEYS) {
        legacyAux.source.emit(
          key,
          kerbinReentry[key as keyof typeof kerbinReentry],
        );
      }
      streamFixture.emit("vessel.flight", {
        altitudeTerrain: kerbinReentry["v.heightFromTerrain"],
        verticalSpeed: kerbinReentry["v.verticalSpeed"],
        atmDensity: kerbinReentry["v.atmosphericDensity"],
      });
    });

    // "aerobraking" text alone isn't sufficient — that comes from the
    // legacy AUX source's v.body driving `atmospheric`, which can land
    // before the STREAM leg's mapped vessel.flight emission has actually
    // propagated through the store. Wait on a value the stream leg alone
    // produces (the ambient air-density readout) so the race can't produce
    // a false green.
    await waitFor(() => {
      if (!container.textContent?.includes("87.00 g/m³")) {
        throw new Error("stream leg has not rendered live air density yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
