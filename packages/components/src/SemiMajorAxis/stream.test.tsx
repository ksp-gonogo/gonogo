import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SemiMajorAxisComponent } from "./index";

/**
 * The stream test-adapter proof for SemiMajorAxis (mirrors
 * `ThermalStatus/stream.test.tsx`): genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport` — no legacy `DataSource` is registered anywhere in this
 * file.
 *
 * SemiMajorAxis's keys are both clean-home stream Topics now (no gaps left,
 * `map-topic.ts`):
 * - `o.sma` -> the raw `vessel.orbit.sma` field-subtopic (the headline value).
 * - `o.referenceBody` -> the derived `vessel.state.referenceBodyName`
 *   display-map (the SDK resolves `vessel.orbit.referenceBodyIndex` against
 *   `system.bodies`). The subtitle body suffix therefore streams too, so this
 *   fixture carries all EIGHT `vessel.state` inputs and emits `system.bodies`.
 *
 * `useDataSeries` (sparkline history, `@ksp-gonogo/data`) now carries its own
 * stream shim mirroring `useDataValue`'s —
 * same `mapTopic`/carried-channels gate, reading its window off
 * `TimelineStore.sampleRange` once `vessel.orbit` is carried. The second
 * `it` below is the end-to-end proof: since NO legacy `DataSource` is
 * registered anywhere in this file, a rendered sparkline `<path>` can only
 * have come from the stream.
 */

describe("SemiMajorAxis — genuinely runs off the stream (M3 batch 2)", () => {
  it("reads sma AND the derived reference-body name off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      // `vessel.state.referenceBodyName` is "carried" only once ALL EIGHT of
      // `vessel.state`'s declared inputs are (see `vessel-state.ts`'s
      // `vesselStateChannel` doc comment); the raw `vessel.orbit.sma` needs
      // only `vessel.orbit`.
      carriedChannels: [
        "vessel.orbit",
        "vessel.flight",
        "vessel.identity",
        "system.bodies",
        "vessel.control",
        "vessel.target",
        "vessel.comms",
        "vessel.propulsion",
      ],
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
      // referenceBodyIndex 1 -> resolved to "Kerbin" against system.bodies by
      // deriveVesselState — the same client-side display map the widget reads.
      fixture.emit("vessel.orbit", { sma: 680000, referenceBodyIndex: 1 });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Kerbin",
            index: 1,
            parentIndex: 0,
            radius: 600000,
            orbit: null,
          },
        ],
      });
    });

    await waitFor(() => expect(screen.getByText("680.0 km")).toBeTruthy());
    // Both reads are clean homes now: the subtitle body suffix streams off the
    // derived `vessel.state.referenceBodyName`, with NO legacy source present.
    await waitFor(() =>
      expect(screen.getByText("Semi-major axis · Kerbin")).toBeTruthy(),
    );
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
    // finite values (@ksp-gonogo/ui's Sparkline.test.tsx), and nothing has
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
      // stroked trend line itself, `fill="none"` — @ksp-gonogo/ui's
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
