import { DashboardItemContext, registerStockBodies } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import kerbinAscent from "./__fixtures__/kerbin-ascent-to-67km.json";
import { OrbitalAscentComponent } from "./index";

/**
 * OrbitalAscent's M3 batch-3 behavior-preservation golden dual-run — same
 * degenerate shape as `KeplerPeriod`'s (see its `dual-run.test.tsx` doc
 * comment): nothing is migratable, so all 3 keys the widget actually reads
 * stay on a legacy AUX source in the "stream" leg. Proves the
 * `TelemetryProvider` wrapper is functionally inert for this widget and
 * doesn't regress its (fully legacy) rendered output.
 */
afterEach(() => {
  cleanup();
});

const GAPPED_KEYS = ["v.body", "v.altitude", "v.horizontalVelocity"] as const;

describe("OrbitalAscent — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup wrapped in a TelemetryProvider as bare legacy, for the same ascent state", async () => {
    const mode = { name: "default-10x8", w: 10, h: 8 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: OrbitalAscentComponent,
      fixture: kerbinAscent,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({ carriedChannels: [] });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: GAPPED_KEYS.map((key) => ({ key })),
      connectSource: true,
    });
    registerStockBodies();

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ascent-dual" }}>
          <OrbitalAscentComponent id="ascent-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of GAPPED_KEYS) {
        legacyAux.source.emit(
          key,
          kerbinAscent[key as keyof typeof kerbinAscent],
        );
      }
    });

    await waitFor(() => {
      if (!container.textContent?.includes("ORBITAL ASCENT")) {
        throw new Error("widget has not rendered yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
