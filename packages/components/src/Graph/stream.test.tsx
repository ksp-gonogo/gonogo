import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GraphComponent } from "./index";

/**
 * The Graph running off the pipeline production actually uses.
 *
 * `index.test.tsx` next door drives the widget through a `BufferedDataSource`,
 * which registers itself under the id `"data"`, on the retired flat keys
 * (`v.altitude`, `v.verticalSpeed`). Nothing registers a `"data"` source in
 * production and nothing translates those keys any more (`map-topic.ts`'s own
 * "retired flat vocabulary" test), so every assertion in that file is about a
 * branch a running dashboard never reaches: `useDataSeries`'s legacy
 * `useDataSourceSubscription` half, which retires with the shim at M4.
 *
 * A real dashboard plots a canonical Topic path off `TimelineStore.sampleRange`
 * through the streamed half of the same hook. No legacy `DataSource` is
 * registered anywhere in this file, so a rendered curve can only have come from
 * the stream.
 */
describe("Graph: genuinely runs off the stream", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class FakeResizeObserver {
        private cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;
        }
        observe(_el: Element) {
          this.cb(
            [
              {
                contentRect: { width: 400, height: 300 },
              } as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plots every streamed sample in the window, in order", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    const config = {
      series: [{ id: "sma", key: "vessel.orbit.sma", axis: "auto" as const }],
      windowSec: 300,
    };

    const { container } = render(
      <fixture.Provider>
        <GraphComponent config={config} id="graph-stream" w={10} h={8} />
      </fixture.Provider>,
    );

    // Nothing has arrived, so there is no curve to draw yet. Without this the
    // assertion below cannot tell a plotted series from an axis path that was
    // always there.
    expect(
      container.querySelector(
        'svg[aria-label="Telemetry line chart"] path[d][fill="none"]',
      ),
    ).toBeNull();

    // The widget genuinely subscribed: `StubTransport.emit` delivers nothing
    // until something has.
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    act(() => {
      fixture.emit("vessel.orbit", { sma: 679_400 }, { validAt: -200 });
      fixture.emit("vessel.orbit", { sma: 679_800 }, { validAt: -100 });
      fixture.emit("vessel.orbit", { sma: 680_000 }, { validAt: 10 });
    });

    await waitFor(() => {
      const path = container.querySelector(
        'svg[aria-label="Telemetry line chart"] path[d][fill="none"]',
      );
      expect(path).not.toBeNull();
      const d = path?.getAttribute("d") ?? "";
      // All three points, not just the latest: one moveto and two linetos.
      expect(d.match(/L/g)?.length).toBe(2);
      const ys = d
        .split(/[ML]\s*/)
        .filter(Boolean)
        .map((pt) => Number(pt.split(",")[1]));
      expect(ys.every((y) => Number.isFinite(y))).toBe(true);
      // A rising series draws a descending y (SVG y grows downward), so the
      // point ORDER survived, not just the count.
      expect(ys[0]).toBeGreaterThan(ys[1]);
      expect(ys[1]).toBeGreaterThan(ys[2]);
    });
  });

  it("splits two series with different units onto separate axes", async () => {
    // On the stream, where the units are. This assertion cannot be made
    // against the legacy `"data"` keys at all: `useDataSchema` answers from the
    // topic-field catalog, `v.altitude`/`v.verticalSpeed` are not in it, so
    // `resolveAxes` sees "raw" for both and puts them on the SAME axis. The
    // legacy version of this test passed on an X-axis time label.
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.flight"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    const config = {
      series: [
        {
          id: "alt",
          key: "vessel.flight.altitudeTerrain",
          axis: "auto" as const,
        },
        {
          id: "vs",
          key: "vessel.flight.verticalSpeed",
          axis: "auto" as const,
        },
      ],
      windowSec: 300,
    };

    const { container } = render(
      <fixture.Provider>
        <GraphComponent config={config} id="graph-stream-axes" w={10} h={8} />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit(
        "vessel.flight",
        { altitudeTerrain: 8_000, verticalSpeed: 30 },
        { validAt: -100 },
      );
      fixture.emit(
        "vessel.flight",
        { altitudeTerrain: 12_345, verticalSpeed: 42 },
        { validAt: 10 },
      );
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll(
          'svg[aria-label="Telemetry line chart"] path[d][fill="none"]',
        ).length,
      ).toBe(2);
    });

    const tickText = (anchor: "end" | "start") =>
      Array.from(
        container.querySelectorAll(`text[text-anchor="${anchor}"]`),
      ).map((t) => t.textContent ?? "");

    // Each axis carries ITS series' domain: metres on the left, m/s on the
    // right. Both tick sets also hold one X-axis time label, hence `toContain`
    // rather than an exact list.
    expect(tickText("end")).toContain("12.0k");
    expect(tickText("start")).toContain("42");
    // And they are genuinely two domains, not one drawn twice.
    expect(tickText("end")).not.toContain("42");
    expect(tickText("start")).not.toContain("12.0k");
    // The header names what the chart measures, which is the same split.
    expect(container.textContent ?? "").toContain("GRAPH m x m/s");
  });

  it("shows the streamed latest value in the readout variant", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    const config = {
      variant: "readout" as const,
      series: [{ id: "sma", key: "vessel.orbit.sma", axis: "auto" as const }],
      windowSec: 300,
    };

    const { container } = render(
      <fixture.Provider>
        <GraphComponent
          config={config}
          id="graph-stream-readout"
          w={10}
          h={8}
        />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.orbit", { sma: 680_000 }, { validAt: 10 });
    });

    await waitFor(() => {
      expect(container.textContent ?? "").toMatch(/680/);
    });
  });
});
