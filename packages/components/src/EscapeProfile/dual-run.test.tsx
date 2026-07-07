import { DashboardItemContext, registerStockBodies } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import kerbinEscape from "./__fixtures__/kerbin-escape-trajectory.json";
import { EscapeProfileComponent } from "./index";

/**
 * EscapeProfile's M3 batch-4 behavior-preservation golden dual-run — same
 * degenerate shape as `OrbitalAscent`'s/`KeplerPeriod`'s (see their
 * `dual-run.test.tsx` doc comments): nothing is migratable, so all 3 keys
 * the widget actually reads (`v.body` directly, `v.altitude`/
 * `v.orbitalVelocity` via `GraphView`'s `useDataSeries` fetchers) stay on a
 * legacy AUX source in the "stream" leg. Re-verified unchanged (both mapped
 * topics are DERIVED `vessel.state.*` field-subtopics, structurally
 * series-ineligible — see `stream.test.tsx`'s doc comment) in the M3
 * mechanical-tail batch now that `useDataSeries` has its own stream shim.
 * Proves the `TelemetryProvider` wrapper is functionally inert for this
 * widget and doesn't regress its (fully legacy) rendered output.
 */
afterEach(() => {
  cleanup();
});

const GAPPED_KEYS = ["v.body", "v.altitude", "v.orbitalVelocity"] as const;

describe("EscapeProfile — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup wrapped in a TelemetryProvider as bare legacy, for the same escape-trajectory state", async () => {
    const mode = { name: "default-10x8", w: 10, h: 8 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: EscapeProfileComponent,
      fixture: kerbinEscape,
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
        <DashboardItemContext.Provider value={{ instanceId: "escape-dual" }}>
          <EscapeProfileComponent id="escape-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of GAPPED_KEYS) {
        legacyAux.source.emit(
          key,
          kerbinEscape[key as keyof typeof kerbinEscape],
        );
      }
    });

    await waitFor(() => {
      if (!container.textContent?.includes("ESCAPE PROFILE")) {
        throw new Error("widget has not rendered yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
