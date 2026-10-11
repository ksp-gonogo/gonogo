import { registerReckoner } from "@ksp-gonogo/sitrep-client";
import { Quality, Staleness, value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { installFixedSizeResizeObserver } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GraphComponent } from "./index";

/** The Graph plotting canonical Topic paths off the stream; no `DataSource` is registered here, so every rendered curve came from the stream. */
let restoreResizeObserver: () => void = () => {};

/** A `ResizeObserver` that reports one fixed box on observe, so the chart has a plot area in jsdom. */
function stubSizedResizeObserver(): void {
  restoreResizeObserver = installFixedSizeResizeObserver({
    width: 400,
    height: 300,
  });
}

describe("Graph: genuinely runs off the stream", () => {
  beforeEach(stubSizedResizeObserver);

  afterEach(() => {
    restoreResizeObserver();
    vi.unstubAllGlobals();
  });

  it("plots every streamed sample in the window, in order", async () => {
    const fixture = setupStreamFixture({
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

    // With nothing arrived there is no curve, so the later assertion cannot be satisfied by an axis path.
    expect(
      container.querySelector(
        'svg[aria-label="Telemetry line chart"] path[d][fill="none"]',
      ),
    ).toBeNull();

    // The widget genuinely subscribed: `StubTransport.emit` delivers nothing until something has.
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
      // A rising series draws a descending y (SVG y grows downward), so the point ORDER survived, not just the count.
      expect(ys[0]).toBeGreaterThan(ys[1]);
      expect(ys[1]).toBeGreaterThan(ys[2]);
    });
  });

  // Streamed samples are stamped in UT seconds, so a wall-clock domain would put them far off the canvas.
  it("draws the trace inside the plot box, not off the left edge", async () => {
    const fixture = setupStreamFixture({
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
      // The stubbed ResizeObserver reports a 400x300 box, so anything outside it is off screen.
      for (const x of xs) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(400);
      }
      // Spread across the axis, not piled on one edge as a far-too-wide domain would leave it.
      expect(xs[2] - xs[0]).toBeGreaterThan(50);
    });
  });

  // The tick formatter follows `SeriesRange.basis`; read as milliseconds, twenty minutes of UT seconds labels as `0:00 ... 0:01`.
  it("labels the time axis in the basis the samples are stamped in", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 0,
      suspendFrames: true,
    });

    const config = {
      series: [{ id: "sma", key: "vessel.orbit.sma", axis: "auto" as const }],
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
      expect(labels).toContain("20:00");
      expect(labels).toContain("3:20");
      expect(labels).toContain("11:40");
    });
  });

  /**
   * A replayed sample was measured and merely arrived late, so it is drawn exactly as a live one; only the hole before it breaks the trace.
   *
   * The emissions match `Courier.ReplayRecorded`: every sample of a dump is `Staleness.Recorded` and only the first carries `gapSinceUt`.
   */
  it("draws a recorded run exactly as the live trace", async () => {
    const fixture = setupStreamFixture({
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
      // The dump sent on reacquisition; its first sample states the hole.
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
      // The provenance cuts the path in two and is recorded in the DOM, but puts no mark on the trace.
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
      // Nor to a screen reader, which would get a caveat the sighted reader does not.
      const label =
        container
          .querySelector("svg[aria-label]")
          ?.getAttribute("aria-label") ?? "";
      expect(label).not.toMatch(/recorded/i);
    });
  });

  it("splits two series with different units onto separate axes", async () => {
    const fixture = setupStreamFixture({
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

    // Both tick sets also hold an X-axis time label, hence `toContain`.
    expect(tickText("end")).toContain("12.0k");
    expect(tickText("start")).toContain("42");
    expect(tickText("end")).not.toContain("42");
    expect(tickText("start")).not.toContain("12.0k");
    expect(container.textContent ?? "").toContain("GRAPH m x m/s");
  });

  it("shows the streamed latest value in the readout variant", async () => {
    const fixture = setupStreamFixture({
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

  /**
   * The stretch after the last observation, where `vessel.flight`'s model answered instead, is the one provenance a trace marks.
   *
   * Samples stop at UT 200, the link drops and the view is pinned at 600; the tail comes from the registered reckoner across that silence, not from any prop.
   */
  it("carries a modelled trace across the silence, muted and dashed", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 600,
      suspendFrames: true,
    });

    const config = {
      series: [
        {
          id: "speed",
          key: "vessel.flight.orbitalSpeed",
          axis: "auto" as const,
        },
      ],
      windowSec: 900,
    };

    const { container } = render(
      <fixture.Provider>
        <GraphComponent
          config={config}
          id="graph-stream-reckoned"
          w={10}
          h={8}
        />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("system.bodies", { bodies: [AIRLESS_KERBIN] });
      for (const [validAt, orbitalSpeed] of ECCENTRIC_KERBIN_SPEEDS) {
        fixture.emit("vessel.orbit", ECCENTRIC_KERBIN_ORBIT, {
          validAt,
          quality: Quality.OnRails,
        });
        fixture.emit("vessel.flight", { orbitalSpeed }, { validAt });
      }
      fixture.store.setTransportConnected(false);
      fixture.emitFrame();
    });

    await waitFor(() => {
      const paths = Array.from(
        container.querySelectorAll<SVGPathElement>(
          'svg[aria-label^="Telemetry line chart"] path[d][fill="none"]',
        ),
      );
      const reckoned = paths.filter(
        (p) => p.getAttribute("data-reckoning-basis") === "kepler-propagation",
      );
      const measured = paths.filter(
        (p) => p.getAttribute("data-reckoning-basis") === null,
      );
      // Both halves are drawn, told apart by stroke.
      expect(reckoned.length).toBe(1);
      expect(measured.length).toBe(1);
      expect(reckoned[0].getAttribute("stroke-dasharray")).not.toBeNull();
      expect(measured[0].getAttribute("stroke-dasharray")).toBeNull();
      expect(measured[0].getAttribute("stroke-opacity")).toBeNull();
      // And in words, because a dash is not a channel a screen reader has.
      const label =
        container
          .querySelector("svg[aria-label]")
          ?.getAttribute("aria-label") ?? "";
      expect(label).toMatch(/reckoned/i);
      expect(label).toMatch(/two-body motion/i);
    });
  });

  // Inside the atmosphere the reckoner withdraws partway through the gap, and the axis must still run to the view time so the blank stays visible.
  it("leaves the stretch a declining model would not answer for on the axis", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 60,
      suspendFrames: true,
    });

    const config = {
      series: [
        {
          id: "altitude",
          key: "vessel.flight.altitudeAsl",
          axis: "auto" as const,
        },
      ],
      windowSec: 60,
    };

    const { container } = render(
      <fixture.Provider>
        <GraphComponent
          config={config}
          id="graph-stream-declines"
          w={10}
          h={8}
        />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("system.bodies", {
        bodies: [{ ...AIRLESS_KERBIN, atmosphere: { depth: 70_000 } }],
      });
      for (let validAt = 0; validAt <= 10; validAt++) {
        fixture.emit("vessel.orbit", DESCENT_ORBIT, {
          validAt,
          quality: Quality.Loaded,
        });
        fixture.emit(
          "vessel.flight",
          {
            altitudeAsl: 40_000 - 300 * validAt - 2 * validAt ** 2,
            verticalSpeed: -300 - 4 * validAt,
            orbitalSpeed: 2_000,
            gForce: 2,
          },
          { validAt },
        );
      }
      fixture.store.setTransportConnected(false);
      fixture.emitFrame();
    });

    await waitFor(() => {
      const reckoned = container.querySelector<SVGPathElement>(
        'path[data-reckoning-basis="rate-integration"]',
      );
      expect(reckoned).not.toBeNull();
      const plot = container.querySelector<SVGRectElement>("svg");
      expect(plot).not.toBeNull();
      const rightmost = Math.max(
        ...(reckoned?.getAttribute("d") ?? "")
          .split(/[ML]/)
          .filter(Boolean)
          .map((pair) => Number(pair.trim().split(/[ ,]/)[0])),
      );
      const width = Number(plot?.getAttribute("width") ?? 0);
      expect(width).toBeGreaterThan(0);
      expect(rightmost).toBeLessThan(width * 0.95);
    });
  });
});

/** Elements for a craft about 50 km up, inside Kerbin's atmosphere. */
const DESCENT_ORBIT = {
  referenceBodyIndex: 1,
  sma: 620_000,
  ecc: 0.05,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 3,
  epoch: 0,
  mu: 3_531_600_000_000,
  horizon: { kind: 1, trajectoryKind: 1 },
};

/** Kerbin with no atmosphere block, which on this wire means airless rather than unknown. */
const AIRLESS_KERBIN = {
  name: "Kerbin",
  index: 1,
  parentIndex: 0,
  radius: 600_000,
  orbit: null,
};

/** A closed conic around Kerbin, eccentric so the propagated orbital speed actually moves. */
const ECCENTRIC_KERBIN_ORBIT = {
  referenceBodyIndex: 1,
  sma: 900_000,
  ecc: 0.4,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3_531_600_000_000,
  // Required on the wire, as the stock producer sends it.
  horizon: { kind: 1, trajectoryKind: 1 },
};

/** `[validAt, orbitalSpeed]` along `ECCENTRIC_KERBIN_ORBIT` by vis-viva. */
const ECCENTRIC_KERBIN_SPEEDS: ReadonlyArray<readonly [number, number]> = [
  [0, 3025.888],
  [100, 2935.193],
  [200, 2719.576],
];

/** The shaded band behind a modelled trace, end to end off the stream: registered reckoner, field scoping, run building, reindexing and the filled path. */
describe("Graph: the region behind a modelled trace", () => {
  beforeEach(stubSizedResizeObserver);

  afterEach(() => {
    restoreResizeObserver();
    vi.unstubAllGlobals();
  });

  /** A drift model on the semi-major axis that admits it gets vaguer. */
  function registerDriftingSma(banded: boolean): void {
    registerReckoner("vessel.orbit", "test", {
      deps: [],
      reckon: (point) => {
        const sma = Number(
          (point.payload as { sma: number | { magnitude: number } }).sma,
        );
        return {
          modelled: [{ path: "sma", basis: "kepler-propagation" }],
          reckon: (at: number) => ({
            ...(point.payload as object),
            sma: sma + (at - point.validAt),
          }),
          bandAt: banded
            ? (at: number) => {
                const carried = at - point.validAt;
                const v = sma + carried;
                return {
                  sma: {
                    value: value("m", v),
                    lo: value("m", v - carried * 2),
                    hi: value("m", v + carried * 5),
                    kind: "bound" as const,
                  },
                };
              }
            : undefined,
        };
      },
    });
  }

  function renderPlot(fixture: ReturnType<typeof setupStreamFixture>) {
    const config = {
      series: [{ id: "sma", key: "vessel.orbit.sma", axis: "auto" as const }],
      windowSec: 900,
    };
    return render(
      <fixture.Provider>
        <GraphComponent config={config} id="graph-stream-band" w={10} h={8} />
      </fixture.Provider>,
    );
  }

  // A tail fills a silence, so the link must actually drop before the model has a gap to answer for.
  function feedThenGoQuiet(
    fixture: ReturnType<typeof setupStreamFixture>,
  ): void {
    act(() => {
      for (const validAt of [0, 100, 200]) {
        fixture.emit("vessel.orbit", ECCENTRIC_KERBIN_ORBIT, {
          validAt,
          quality: Quality.OnRails,
        });
      }
      fixture.store.setTransportConnected(false);
      fixture.emitFrame();
    });
  }

  it("shades what the model would not pin down, beside the trace it drew", async () => {
    registerDriftingSma(true);
    const fixture = setupStreamFixture({
      pinnedUt: 600,
      suspendFrames: true,
    });
    const { container } = renderPlot(fixture);
    feedThenGoQuiet(fixture);

    await waitFor(() => {
      const regions = Array.from(
        container.querySelectorAll<SVGPathElement>("path[data-band-kind]"),
      );
      expect(regions).toHaveLength(1);
      expect(regions[0].getAttribute("data-band-kind")).toBe("bound");
      expect(regions[0].getAttribute("d")).not.toBe("");
      // The band never replaces the dashed stroke that says nobody measured this.
      const reckonedStroke = container.querySelector(
        'path[data-reckoning-basis="kepler-propagation"]',
      );
      expect(reckonedStroke).not.toBeNull();
    });
  });

  it("draws no region at all where the same model offers no band", async () => {
    registerDriftingSma(false);
    const fixture = setupStreamFixture({
      pinnedUt: 600,
      suspendFrames: true,
    });
    const { container } = renderPlot(fixture);
    feedThenGoQuiet(fixture);

    await waitFor(() => {
      expect(
        container.querySelector(
          'path[data-reckoning-basis="kepler-propagation"]',
        ),
      ).not.toBeNull();
    });
    expect(container.querySelectorAll("path[data-band-kind]")).toHaveLength(0);
  });
});
