import { Staleness } from "@ksp-gonogo/sitrep-sdk";
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

  /**
   * Every assertion above this one reads the Y half of the path and none of
   * them reads the X half, which is how a trace drawn several hundred million
   * units to the left of the plot box passed as a working chart.
   *
   * `useDataSeries` hands the streamed half back in UT SECONDS and the legacy
   * half in wall-clock MILLISECONDS, and the time domain was
   * `[Date.now() - windowSec * 1000, Date.now()]`: the second basis only.
   * Nothing registers the legacy `"data"` source in production, so every
   * time-axis graph on a running dashboard scaled its samples against wall
   * time and put them off the canvas, while still drawing the axes, the ticks,
   * the legend and the header for them.
   */
  it("draws the trace inside the plot box, not off the left edge", async () => {
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
        <GraphComponent config={config} id="graph-stream-x" w={10} h={8} />
      </fixture.Provider>,
    );

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
      const xs = (path?.getAttribute("d") ?? "")
        .split(/[ML]\s*/)
        .filter(Boolean)
        .map((pt) => Number(pt.split(",")[0]));
      expect(xs.length).toBe(3);
      // The stubbed ResizeObserver reports a 400x300 box, so anything outside
      // it is off screen. A generous ceiling rather than the exact plot inset:
      // the failure this catches is eight orders of magnitude out.
      for (const x of xs) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(400);
      }
      // And spread across the axis rather than piled on one edge, which is what a domain wider than the data by a factor of a thousand would produce.
      expect(xs[2] - xs[0]).toBeGreaterThan(50);
    });
  });

  /**
   * The domain fix put the trace on the canvas; the LABELS under it stayed in
   * the other basis. `LineChart`'s default X formatter reads its domain as unix
   * MILLISECONDS, so a twenty-minute window of UT seconds is a span of 1200 and
   * the ladder under a whole outage reads `0:00 ... 0:01`.
   *
   * A chart whose question is WHEN cannot answer it off a ladder that is wrong
   * by a factor of a thousand, which is why the widget can no longer guess:
   * `SeriesRange.basis` is `useDataSeries` stating which clock it stamped `t`
   * in, and the formatter follows the declaration.
   */
  it("labels the time axis in the basis the samples are stamped in", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 0,
      suspendFrames: true,
    });

    const config = {
      series: [{ id: "sma", key: "vessel.orbit.sma", axis: "auto" as const }],
      // Twenty minutes, the span the blackout scenes are drawn over.
      windowSec: 1200,
    };

    const { container } = render(
      <fixture.Provider>
        <GraphComponent config={config} id="graph-stream-ticks" w={10} h={8} />
      </fixture.Provider>,
    );

    act(() => {
      for (let i = 0; i <= 20; i++) {
        fixture.emit(
          "vessel.orbit",
          { sma: 679_000 + i * 50 },
          { validAt: -1200 + i * 60 },
        );
      }
    });

    await waitFor(() => {
      const labels = Array.from(
        container.querySelectorAll(
          'svg[aria-label="Telemetry line chart"] text',
        ),
      ).map((t) => t.textContent ?? "");
      // The span is twenty minutes and the right-hand end of the ladder says
      // so. Read as milliseconds the same domain labels the whole window
      // "0:00 / 0:00 / 0:01", which is the defect.
      expect(labels).toContain("20:00");
      // And the rungs between climb through it rather than repeating a value.
      expect(labels).toContain("3:20");
      expect(labels).toContain("11:40");
    });
  });

  /**
   * A replayed sample is a sample the craft MEASURED, and it arrived late. The
   * chart therefore draws it exactly as it draws a live one: setting it apart
   * would say "trust this less" about a reading that is exact. `breaks` still
   * draws what is GONE, which is the honest distinction the wire actually
   * carries about this window.
   *
   * The emissions are the shape `Courier.ReplayRecorded` produces, checked
   * against that method rather than against the widget: every sample of a dump
   * is stamped `Staleness.Recorded` and only the FIRST carries `gapSinceUt`.
   */
  it("draws a recorded run exactly as the live trace", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 0,
      suspendFrames: true,
    });

    const config = {
      series: [{ id: "sma", key: "vessel.orbit.sma", axis: "auto" as const }],
      windowSec: 1200,
    };

    const { container } = render(
      <fixture.Provider>
        <GraphComponent
          config={config}
          id="graph-stream-recorded"
          w={10}
          h={8}
        />
      </fixture.Provider>,
    );

    act(() => {
      // Live, up to loss of signal at UT -600.
      for (let i = 0; i < 5; i++) {
        fixture.emit(
          "vessel.orbit",
          { sma: 679_000 + i * 100 },
          { validAt: -1200 + i * 150 },
        );
      }
      // The dump the craft sends on reacquisition. Its oldest span overran the
      // recorder, so the first replayed sample also states the hole.
      for (let i = 0; i < 5; i++) {
        fixture.emit(
          "vessel.orbit",
          { sma: 679_600 + i * 100 },
          {
            validAt: -400 + i * 100,
            staleness: Staleness.Recorded,
            ...(i === 0 ? { gapSinceUt: -600 } : {}),
          },
        );
      }
    });

    await waitFor(() => {
      const paths = Array.from(
        container.querySelectorAll<SVGPathElement>(
          'svg[aria-label^="Telemetry line chart"] path[d][fill="none"]',
        ),
      );
      // The provenance still cuts the path in two, and is still recorded in
      // the DOM, so a later readout can name it. What it must not do is put a
      // mark on the trace.
      expect(paths.length).toBe(2);
      const recorded = paths.filter(
        (p) => p.getAttribute("data-stream-status") === "recorded",
      );
      expect(recorded.length).toBe(1);
      for (const p of paths) {
        expect(p.getAttribute("stroke-dasharray")).toBeNull();
        expect(p.getAttribute("stroke-opacity")).toBeNull();
        expect(p.getAttribute("stroke")).toBe(paths[0].getAttribute("stroke"));
      }
      // Nor say anything about it to a screen reader, which would hand one
      // reader a caveat the chart does not put in front of the other.
      const label =
        container
          .querySelector("svg[aria-label]")
          ?.getAttribute("aria-label") ?? "";
      expect(label).not.toMatch(/recorded/i);
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
