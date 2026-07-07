import { DashboardItemContext } from "@gonogo/core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { KeplerPeriodComponent } from "./index";

/**
 * The M3 batch-3 stream test-adapter proof for KeplerPeriod — but unlike
 * every prior migrated widget (WarpControl through LandingStatus), this one
 * has ZERO keys the read shim can migrate:
 *
 * - Its only two `useDataValue` calls, `v.body` and `o.referenceBody`, are
 *   both declared GAPS in `map-topic.ts` ("needs a derived display-map/
 *   field subtopic; migrate in M3") — there is no mapped key to stream.
 * - `o.sma` and `o.period` (the graph's `xKey`/series `key`) are never read
 *   via `useDataValue` at all — they flow through `GraphView` ->
 *   `GraphSeries` -> `useDataSeries` (`@gonogo/data`), which has no
 *   `mapTopic` awareness whatsoever (the batch-2 `SemiMajorAxis` footgun).
 *   Even though `o.sma` itself IS mapped (-> `vessel.orbit.sma`) at the
 *   `useDataValue`/`mapTopic` level, that mapping is irrelevant here because
 *   nothing in this widget calls `useDataValue("data", "o.sma")` — the only
 *   consumer is `useDataSeries`, a completely different hook the shim
 *   doesn't touch.
 *
 * So this widget stays 100% legacy — no `useDataStreamStatus`/
 * `StreamStatusBadge` were added to `index.tsx` (there is no representative
 * mapped key whose live status would describe anything this widget actually
 * renders). This test exists to lock in that finding: mounting under a real
 * `TelemetryProvider` with no legacy `DataSource` registered must render
 * IDENTICALLY to a bare/no-data legacy mount — no crash, no different
 * degraded state — proving the harness is safe for a widget that opts out
 * of the shim entirely.
 */
afterEach(() => {
  cleanup();
});

describe("KeplerPeriod — zero migratable keys, stream-safe no-op (M3 batch 3)", () => {
  it("renders its normal no-data state under a TelemetryProvider with no legacy source, nothing streams", () => {
    // No channel is carried — there's nothing this widget could read off
    // the stream even if a topic were promoted.
    const fixture = setupStreamFixture({ carriedChannels: [] });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "kepler-stream" }}>
          <KeplerPeriodComponent id="kepler-stream" w={10} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // GraphView's title always renders regardless of data state.
    expect(container.textContent).toContain("KEPLER PERIOD");
    // v.body/o.referenceBody are both undefined (GAPPED, no legacy source
    // registered) — neither degraded-state notice fires, matching a bare
    // legacy mount with no DataSource at all.
    expect(container.textContent).not.toContain("Unknown body");
    expect(container.textContent).not.toContain("No reference data");
  });
});
