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
 * `useDataSeries` (sparkline history, `@gonogo/data`) now carries its own M3
 * stream shim (the `useDataSeries` shim task) mirroring `useDataValue`'s —
 * same `mapTopic`/carried-channels gate, reading its window off
 * `TimelineStore.sampleRange` once `vessel.orbit` is carried. The second
 * `it` below is the end-to-end proof: since NO legacy `DataSource` is
 * registered anywhere in this file, a rendered sparkline `<path>` can only
 * have come from the stream.
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

  it("the plotted sparkline itself streams off the ClientTimeline — RED before the useDataSeries shim, GREEN after", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "sma-spark-stream" }}
        >
          <SemiMajorAxisComponent id="sma-spark-stream" w={5} h={6} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // No sparkline can render yet — Sparkline draws nothing for fewer than 2
    // finite values (@gonogo/ui's Sparkline.test.tsx), and nothing has
    // arrived at all.
    expect(
      container.querySelector("svg[aria-label='SMA trend'] path"),
    ).toBeNull();

    // Three points inside the SPARK_WINDOW_SEC=300 window ending at the
    // pinned viewUt=10 ([-290, 10]) — with NO legacy 'data' DataSource
    // registered anywhere in this file, this is the only possible source
    // for a rendered trend line.
    act(() => {
      fixture.emit("vessel.orbit", { sma: 679_400 }, { validAt: -200 });
      fixture.emit("vessel.orbit", { sma: 679_800 }, { validAt: -100 });
      fixture.emit("vessel.orbit", { sma: 680_000 }, { validAt: 10 });
    });

    await waitFor(() => expect(screen.getByText("680.0 km")).toBeTruthy());
    await waitFor(() => {
      // Sparkline renders TWO <path>s (a gradient-filled area, then the
      // stroked trend line itself, `fill="none"` — @gonogo/ui's
      // Sparkline.tsx) — target the stroke path specifically so its
      // point-count isn't padded by the fill path's baseline-closing
      // segments.
      const path = container.querySelector(
        "svg[aria-label='SMA trend'] path[fill='none']",
      );
      expect(path).not.toBeNull();
      const d = path?.getAttribute("d") ?? "";
      // One "M" (moveto) + 2 "L" (lineto) commands — all 3 streamed points
      // made it into the plotted path, not just the latest one.
      expect(d.match(/L/g)?.length).toBe(2);
      // Rising series (679_400 -> 679_800 -> 680_000) draws a
      // monotonically DEscending y (SVG y grows downward) — proves the
      // point ORDER came through correctly too, not just the count.
      expect(d).toBe("M0.00,28.00 L60.00,9.33 L120.00,0.00");
    });
  });
});
