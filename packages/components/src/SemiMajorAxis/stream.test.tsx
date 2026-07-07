import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SemiMajorAxisComponent } from "./index";

/**
 * The M3 batch-2 stream test-adapter proof for SemiMajorAxis (mirrors
 * `ThermalStatus/stream.test.tsx`, batch 1): genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport` — no legacy `DataSource` is registered anywhere in this
 * file.
 *
 * SemiMajorAxis's keys split MAPPED / GAPPED (`map-topic.ts`):
 * - MAPPED: `o.sma` -> `vessel.orbit.sma` (the widget's only headline
 *   value — an all-mapped widget, like the WarpControl pilot).
 * - GAPPED: `o.referenceBody` (needs a display-map subtopic; the subtitle
 *   stays legacy-only and simply doesn't render in this stream-only test).
 *
 * Note: the sparkline (`useDataSeries("data", "o.sma", ...)`) is NOT part
 * of the M3 read shim at all — `useDataSeries` lives in `@gonogo/data` and
 * reads the legacy `BufferedDataSource`'s buffered series directly, with no
 * `mapTopic` awareness. So even though the headline `o.sma` value streams,
 * the sparkline trend line always stays on legacy (empty here, since no
 * legacy source is registered in this file).
 */
afterEach(() => {
  cleanup();
});

describe("SemiMajorAxis — genuinely runs off the stream (M3 batch 2)", () => {
  it("reads sma off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "sma-stream" }}>
          <SemiMajorAxisComponent id="sma-stream" w={5} h={6} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet — sma is undefined, so the empty state renders.
    expect(screen.getByText("No orbit data")).toBeTruthy();

    // A real subscription must have happened for this to deliver at all —
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    act(() => {
      fixture.emit("vessel.orbit", { sma: 680000 });
    });

    await waitFor(() => expect(screen.getByText("680.0 km")).toBeTruthy());
    // o.referenceBody is a declared gap — with no legacy source here it
    // never arrives, so the subtitle renders without a body suffix.
    expect(screen.getByText("Semi-major axis")).toBeTruthy();
  });
});
