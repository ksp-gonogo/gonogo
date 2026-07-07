import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import reentryWarning from "./__fixtures__/reentry-warning.json";
import { ThermalStatusComponent } from "./index";

/**
 * ThermalStatus's M3 batch-1 behavior-preservation golden dual-run (mirrors
 * `WarpControl/dual-run.test.tsx`, the pilot): the SAME thermal state,
 * rendered once off the legacy `DataSource` and once off the stream, must
 * produce byte-identical DOM at `delay=0`.
 *
 * `reentry-warning` is chosen because it exercises the "warm" band (0.81
 * ratio — yellow tone, distinct from "nominal") on the one MAPPED row
 * (hottest part), while every other row (hottest engine, heat shield) reads
 * entirely GAPPED keys and so stays on a legacy AUX source registered
 * alongside the `TelemetryProvider` — the same MIXED-source coexistence
 * shape the pilot's dual-run proves, here with 3 mapped / 7 gapped instead
 * of WarpControl's all-mapped set.
 */
afterEach(() => {
  cleanup();
});

const GAPPED_KEYS = [
  "therm.hottestPartName",
  "therm.hottestEngineTemp",
  "therm.hottestEngineMaxTemp",
  "therm.hottestEngineTempRatio",
  "therm.anyEnginesOverheating",
  "therm.heatShieldTempCelsius",
  "therm.heatShieldFlux",
] as const;

describe("ThermalStatus — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same thermal state", async () => {
    const mode = { name: "default-8x7", w: 8, h: 7 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: ThermalStatusComponent,
      fixture: reentryWarning,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.thermal"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: GAPPED_KEYS.map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "therm-dual" }}>
          <ThermalStatusComponent id="therm-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of GAPPED_KEYS) {
        legacyAux.source.emit(
          key,
          reentryWarning[key as keyof typeof reentryWarning],
        );
      }
      streamFixture.emit("vessel.thermal", {
        hottestPart: {
          skinTemp: reentryWarning["therm.hottestPartTemp"],
          skinMaxTemp: reentryWarning["therm.hottestPartMaxTemp"],
        },
        maxInternalTempRatio: reentryWarning["therm.hottestPartTempRatio"],
      });
    });

    // "Heat Shield (2.5m)" alone isn't sufficient — that text comes from the
    // legacy AUX source's therm.hottestPartName, which can land before the
    // STREAM leg's mapped vessel.thermal emission has actually propagated
    // through the store. Wait on a value the stream leg alone produces
    // (the hottest-part temp readout) so the race can't produce a false
    // green.
    await waitFor(() => {
      if (!container.textContent?.includes("1671°C")) {
        throw new Error("stream leg has not rendered the thermal state yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
