import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import kerbinSeaLevel from "./__fixtures__/kerbin-sea-level.json";
import { AtmosphereProfileComponent } from "./index";

/**
 * AtmosphereProfile's behavior-preservation golden dual-run
 * (mirrors `ThermalStatus/dual-run.test.tsx`): the SAME
 * altitude/atmosphere state, rendered once off the legacy `DataSource` and
 * once off the stream, must produce byte-identical DOM at `delay=0`.
 *
 * `kerbin-sea-level` is chosen because it populates every field the widget
 * reads and puts `showLiveChip`'s gate (density finite + body has an
 * atmosphere) in play, so the LIVE CHIP — the one piece of DOM that
 * actually surfaces the MAPPED values (`v.altitude` -> DERIVED
 * `vessel.state.altitudeAsl`, `v.atmosphericDensity` -> raw `vessel.
 * flight.atmDensity`, `v.atmosphericTemperature`/`v.externalTemperature`
 * -> raw `vessel.flight.atmosphericTemperature` /
 * `vessel.flight.externalTemperature`) — renders on both legs. `v.body`
 * (GAPPED — needs a display-map subtopic) reads off a legacy AUX source in
 * the stream leg; the pressure curve itself is entirely a function of the
 * legacy-fed body, not any mapped key.
 */
const GAPPED_KEYS = ["v.body"] as const;

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
      // vessel.identity/system.bodies: vessel.state's carried-channels gate
      // is parent-channel-scoped — see the matching note in stream.test.tsx.
      carriedChannels: [
        "vessel.orbit",
        "vessel.flight",
        "vessel.identity",
        "system.bodies",
      ],
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
        atmosphericTemperature: kerbinSeaLevel["v.atmosphericTemperature"],
        externalTemperature: kerbinSeaLevel["v.externalTemperature"],
      });
    });

    // Wait on the LiveChip's density value — a value the stream leg alone
    // produces — so the race between the stream leg's mapped vessel.flight
    // emission and the legacy AUX leg's v.body emission can't produce a
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
