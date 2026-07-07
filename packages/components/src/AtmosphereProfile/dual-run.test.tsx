import { DashboardItemContext } from "@gonogo/core";
import { Quality } from "@gonogo/sitrep-sdk";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import kerbinSeaLevel from "./__fixtures__/kerbin-sea-level.json";
import { AtmosphereProfileComponent } from "./index";

/**
 * AtmosphereProfile's M3 batch-2 behavior-preservation golden dual-run
 * (mirrors `ThermalStatus/dual-run.test.tsx`, batch 1): the SAME
 * altitude/atmosphere state, rendered once off the legacy `DataSource` and
 * once off the stream, must produce byte-identical DOM at `delay=0`.
 *
 * `kerbin-sea-level` is chosen because it populates every field the widget
 * reads and puts `showLiveChip`'s gate (density finite + body has an
 * atmosphere) in play, so the LIVE CHIP — the one piece of DOM that
 * actually surfaces the two MAPPED values (`v.altitude` -> DERIVED
 * `vessel.state.altitudeAsl`, `v.atmosphericDensity` -> raw `vessel.
 * flight.atmDensity`) — renders on both legs. `v.body` (GAPPED — needs a
 * display-map subtopic) and `v.atmosphericTemperature`/`v.
 * externalTemperature` (GAPPED — not captured on the wire, G-11) read off
 * a legacy AUX source in the stream leg; the pressure curve itself is
 * entirely a function of the legacy-fed body, not any mapped key.
 */
afterEach(() => {
  cleanup();
});

const GAPPED_KEYS = [
  "v.body",
  "v.atmosphericTemperature",
  "v.externalTemperature",
] as const;

describe("AtmosphereProfile — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same atmosphere state", async () => {
    const mode = { name: "default-8x8", w: 8, h: 8 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: AtmosphereProfileComponent,
      fixture: kerbinSeaLevel,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit", "vessel.flight"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: GAPPED_KEYS.map((key) => ({ key })),
      connectSource: true,
    });

    // Both legs render with the SAME no-op-callback ResizeObserver stub
    // (installDomStubs' global default — no explicit stub call here) so the
    // chart's own ResizeObserver-driven size stays consistently absent on
    // both legs; only the LiveChip (independent of chart size) is asserted.
    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "atmo-dual" }}>
          <AtmosphereProfileComponent id="atmo-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of GAPPED_KEYS) {
        legacyAux.source.emit(
          key,
          kerbinSeaLevel[key as keyof typeof kerbinSeaLevel],
        );
      }
      streamFixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      streamFixture.emit("vessel.flight", {
        altitudeAsl: kerbinSeaLevel["v.altitude"],
        atmDensity: kerbinSeaLevel["v.atmosphericDensity"],
      });
    });

    // "289 °C"-style air-temp text alone isn't sufficient — that comes from
    // the legacy AUX source's v.atmosphericTemperature, which can land
    // before the STREAM leg's mapped vessel.flight emission has actually
    // propagated through the store. Wait on the LiveChip's density value —
    // a value the stream leg alone produces — so the race can't produce a
    // false green.
    await waitFor(() => {
      if (!container.textContent?.includes("1.217 kg/m³")) {
        throw new Error("stream leg has not rendered live density yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
