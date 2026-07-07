import { DashboardItemContext, registerStockBodies } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import kerbinLko from "./__fixtures__/kerbin-lko.json";
import { KeplerPeriodComponent } from "./index";

/**
 * KeplerPeriod's M3 batch-3 behavior-preservation golden dual-run — a
 * degenerate case, unlike every prior widget's dual-run: since NOTHING is
 * migratable (see `stream.test.tsx`'s doc comment — both `useDataValue`
 * calls are GAPPED, and the graph series/xKey route through
 * `useDataSeries`, which the shim never touches), all 4 fixture keys stay
 * on a legacy AUX source in the "stream" leg. This test still earns its
 * keep: it proves mounting the widget inside a `TelemetryProvider`
 * (harness-present but functionally inert for this widget) produces
 * byte-identical DOM to a bare legacy mount — the migration wave didn't
 * regress a widget it left untouched.
 */
afterEach(() => {
  cleanup();
});

const GAPPED_KEYS = ["v.body", "o.referenceBody", "o.sma", "o.period"] as const;

describe("KeplerPeriod — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup wrapped in a TelemetryProvider as bare legacy, for the same orbit state", async () => {
    const mode = { name: "default-10x8", w: 10, h: 8 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: KeplerPeriodComponent,
      fixture: kerbinLko,
      mode,
      connectSource: true,
    });

    // Nothing is carried — no topic this widget reads has a stream home.
    const streamFixture = setupStreamFixture({ carriedChannels: [] });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: GAPPED_KEYS.map((key) => ({ key })),
      connectSource: true,
    });
    registerStockBodies();

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "kepler-dual" }}>
          <KeplerPeriodComponent id="kepler-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of GAPPED_KEYS) {
        legacyAux.source.emit(key, kerbinLko[key as keyof typeof kerbinLko]);
      }
    });

    await waitFor(() => {
      if (!container.textContent?.includes("KEPLER PERIOD")) {
        throw new Error("widget has not rendered yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
