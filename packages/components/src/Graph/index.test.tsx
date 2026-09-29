import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { installFixedSizeResizeObserver } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { GraphComponent } from "./index";

const ALTITUDE = "vessel.flight.altitudeAsl";
const VERTICAL_SPEED = "vessel.flight.verticalSpeed";

/** Chart variants, axes and sizing; `stream.test.tsx` covers what the stream itself hands the chart. */
describe("GraphComponent", () => {
  let restoreResizeObserver: () => void = () => {};
  let fixture: StreamFixture;

  beforeEach(() => {
    restoreResizeObserver = installFixedSizeResizeObserver({
      width: 400,
      height: 300,
    });
    fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    restoreResizeObserver();
    vi.unstubAllGlobals();
  });

  function renderOnStream(ui: ReactElement) {
    return render(<fixture.Provider>{ui}</fixture.Provider>);
  }

  function flight(
    validAt: number,
    fields: { altitudeAsl?: number; verticalSpeed?: number },
  ) {
    fixture.emit("vessel.flight", fields, { validAt });
  }

  it("renders a <path> with data when a series receives numeric values", async () => {
    const config = {
      series: [{ id: "s1", key: ALTITUDE, axis: "auto" as const }],
      windowSec: 300,
    };

    renderOnStream(<GraphComponent config={config} id="graph-test" />);

    act(() => {
      flight(10, { altitudeAsl: 12_345 });
    });

    await waitFor(() => {
      const paths = document.querySelectorAll("path[d]");
      const withData = Array.from(paths).filter(
        (p) => (p.getAttribute("d") ?? "").length > 0,
      );
      expect(withData.length).toBeGreaterThan(0);
    });
  });

  it("shows empty state when no series are configured", () => {
    const config = {
      series: [],
      windowSec: 300,
    };

    const { getByText } = renderOnStream(
      <GraphComponent config={config} id="graph-test" />,
    );
    expect(getByText("Configure series to begin graphing")).toBeInTheDocument();
  });

  it("plots series with no axis field inside the chart bounds (defaults to auto)", async () => {
    const config = {
      series: [
        { id: "alt", key: ALTITUDE },
        { id: "vs", key: VERTICAL_SPEED },
      ],
      windowSec: 300,
    };

    const { container } = renderOnStream(
      <GraphComponent config={config} id="graph-test" />,
    );

    act(() => {
      flight(10, { altitudeAsl: 12_345, verticalSpeed: 42 });
    });

    await waitFor(() => {
      const paths = Array.from(
        container.querySelectorAll(
          'svg[aria-label="Telemetry line chart"] path[d]',
        ),
      ).filter((p) => (p.getAttribute("d") ?? "").length > 0);
      expect(paths.length).toBe(2);
      for (const p of paths) {
        const ys = (p.getAttribute("d") ?? "")
          .split(/[ML]\s*/)
          .filter(Boolean)
          .map((pt) => Number(pt.split(",")[1]));
        for (const y of ys) {
          expect(Number.isFinite(y)).toBe(true);
          // Chart height is 300 in this harness; anything wildly outside means the series was scaled against the [0,1] fallback domain.
          expect(Math.abs(y)).toBeLessThan(1_000);
        }
      }
    });
  });

  it("renders a path when X axis is a data key instead of time", async () => {
    const config = {
      series: [{ id: "vs", key: VERTICAL_SPEED, axis: "auto" as const }],
      windowSec: 300,
      xKey: ALTITUDE,
    };

    renderOnStream(<GraphComponent config={config} id="graph-test" />);

    act(() => {
      flight(5, { altitudeAsl: 100, verticalSpeed: 5 });
    });
    act(() => {
      flight(10, { altitudeAsl: 200, verticalSpeed: 8 });
    });

    await waitFor(() => {
      const paths = Array.from(document.querySelectorAll("path[d]")).filter(
        (p) => (p.getAttribute("d") ?? "").length > 0,
      );
      expect(paths.length).toBeGreaterThan(0);
    });
  });

  it("honours pinned primary Y domain in tick labels", async () => {
    const config = {
      series: [{ id: "alt", key: ALTITUDE, axis: "primary" as const }],
      windowSec: 300,
      yDomainPrimary: [0, 1000] as [number, number],
    };

    const { container } = renderOnStream(
      <GraphComponent config={config} id="graph-test" />,
    );

    act(() => {
      flight(10, { altitudeAsl: 500_000 });
    });

    await waitFor(() => {
      // The 500_000 sample really reached the plot: without this the pin is "respected" by a chart that was handed nothing to scale against.
      expect(
        container.querySelector(
          'svg[aria-label="Telemetry line chart"] path[d][fill="none"]',
        ),
      ).not.toBeNull();
      const texts = Array.from(container.querySelectorAll("text")).map(
        (t) => t.textContent ?? "",
      );
      // niceTicks over [0, 1000] with 5 ticks produces 0, 250, 500, 750, 1000; formatYTick renders 1000 as "1.0k".
      expect(texts).toContain("1.0k");
      expect(texts.some((t) => t === "500.0k")).toBe(false);
    });
  });

  it("renders the readout variant with the latest value when explicitly selected and a single series is configured", async () => {
    const config = {
      variant: "readout" as const,
      series: [{ id: "alt", key: ALTITUDE, axis: "auto" as const }],
      windowSec: 300,
    };

    const { container } = renderOnStream(
      <GraphComponent config={config} id="graph-test" w={10} h={8} />,
    );

    act(() => {
      flight(10, { altitudeAsl: 12_345 });
    });

    await waitFor(() => {
      expect(container.textContent ?? "").toMatch(/12\.3k/);
      const axisTicks = container.querySelectorAll('text[text-anchor="end"]');
      expect(axisTicks.length).toBe(0);
    });
  });

  it("auto variant downgrades to readout when widget is tiny and one series is configured", async () => {
    const config = {
      series: [{ id: "alt", key: ALTITUDE, axis: "auto" as const }],
      windowSec: 300,
    };

    const { container } = renderOnStream(
      <GraphComponent config={config} id="graph-test" w={3} h={3} />,
    );

    act(() => {
      flight(10, { altitudeAsl: 250 });
    });

    await waitFor(() => {
      expect(container.textContent ?? "").toMatch(/250/);
      const axisTicks = container.querySelectorAll('text[text-anchor="end"]');
      expect(axisTicks.length).toBe(0);
    });
  });

  it("auto variant also downgrades to readout at the small size bucket", async () => {
    const config = {
      series: [{ id: "alt", key: ALTITUDE, axis: "auto" as const }],
      windowSec: 300,
    };

    const { container } = renderOnStream(
      <GraphComponent config={config} id="graph-test" w={6} h={6} />,
    );

    act(() => {
      flight(10, { altitudeAsl: 250 });
    });

    await waitFor(() => {
      expect(container.textContent ?? "").toMatch(/250/);
      const axisTicks = container.querySelectorAll('text[text-anchor="end"]');
      expect(axisTicks.length).toBe(0);
    });
  });

  it("auto variant stays as chart at the normal size bucket", async () => {
    const config = {
      series: [{ id: "alt", key: ALTITUDE, axis: "auto" as const }],
      windowSec: 300,
    };

    const { container } = renderOnStream(
      <GraphComponent config={config} id="graph-test" w={10} h={8} />,
    );

    act(() => {
      flight(10, { altitudeAsl: 1234 });
    });

    await waitFor(() => {
      const axisTicks = Array.from(
        container.querySelectorAll('text[text-anchor="end"]'),
      ).map((t) => t.textContent ?? "");
      expect(axisTicks.length).toBeGreaterThan(0);
      // Axis ticks render on an empty chart too, so a drawn curve is what proves the data arrived.
      expect(
        container.querySelector(
          'svg[aria-label="Telemetry line chart"] path[d][fill="none"]',
        ),
      ).not.toBeNull();
    });
  });

  it("readout variant falls back to chart when more than one series is configured", async () => {
    const config = {
      variant: "readout" as const,
      series: [
        { id: "alt", key: ALTITUDE, axis: "auto" as const },
        { id: "vs", key: VERTICAL_SPEED, axis: "auto" as const },
      ],
      windowSec: 300,
    };

    const { container } = renderOnStream(
      <GraphComponent config={config} id="graph-test" w={3} h={3} />,
    );

    act(() => {
      flight(10, { altitudeAsl: 12_345, verticalSpeed: 42 });
    });

    await waitFor(() => {
      // A bare `text` count is satisfied by the readout too, so assert the chart's own curves.
      expect(
        container.querySelectorAll(
          'svg[aria-label="Telemetry line chart"] path[d][fill="none"]',
        ).length,
      ).toBe(2);
      expect(
        container.querySelectorAll('text[text-anchor="end"]').length,
      ).toBeGreaterThan(0);
    });
  });
});
