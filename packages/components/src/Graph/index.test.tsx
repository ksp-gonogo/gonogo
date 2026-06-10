import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphComponent } from "./index";

describe("GraphComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
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
    source = new MockDataSource({
      keys: [
        { key: "v.name" },
        { key: "v.missionTime" },
        { key: "v.altitude" },
        { key: "v.verticalSpeed" },
      ],
    });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    buffered.disconnect();
    vi.unstubAllGlobals();
  });

  it("renders a <path> with data when a series receives numeric values", async () => {
    const config = {
      style: "time-series" as const,
      series: [{ id: "s1", key: "v.altitude", axis: "auto" as const }],
      windowSec: 300,
    };

    render(<GraphComponent config={config} id="graph-test" />);

    act(() => {
      source.emit("v.name", "Kerbal X");
      source.emit("v.missionTime", 0);
      source.emit("v.altitude", 12_345);
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
      style: "time-series" as const,
      series: [],
      windowSec: 300,
    };

    const { getByText } = render(
      <GraphComponent config={config} id="graph-test" />,
    );
    expect(
      getByText("Configure series to begin graphing."),
    ).toBeInTheDocument();
  });

  it("plots series with no axis field inside the chart bounds (defaults to auto)", async () => {
    // Persisted configs from programmatic writes / older saves omit `axis`
    // entirely — the config form writes "auto" explicitly, so only these
    // configs hit the undefined branch. The regression: resolveAxes passed
    // `undefined` through, the domain computation saw no primary/secondary
    // series (fell back to [0,1]) while the path builder plotted real
    // values against that degenerate scale — curves landed millions of
    // pixels off-canvas and the chart looked empty.
    const config = {
      series: [
        { id: "alt", key: "v.altitude" },
        { id: "vs", key: "v.verticalSpeed" },
      ],
      windowSec: 300,
    };

    const { container } = render(
      <GraphComponent config={config} id="graph-test" />,
    );

    act(() => {
      source.emit("v.name", "Kerbal X");
      source.emit("v.missionTime", 0);
      source.emit("v.altitude", 12_345);
      source.emit("v.verticalSpeed", 42);
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
          // Chart height is 300 in this harness; anything wildly outside
          // means the series was scaled against the [0,1] fallback domain.
          expect(Math.abs(y)).toBeLessThan(1_000);
        }
      }
    });
  });

  it("auto-splits two series with different units onto separate axes", async () => {
    const config = {
      series: [
        { id: "alt", key: "v.altitude", axis: "auto" as const },
        { id: "vs", key: "v.verticalSpeed", axis: "auto" as const },
      ],
      windowSec: 300,
    };

    const { container } = render(
      <GraphComponent config={config} id="graph-test" />,
    );

    act(() => {
      source.emit("v.name", "Kerbal X");
      source.emit("v.missionTime", 0);
      source.emit("v.altitude", 12_345);
      source.emit("v.verticalSpeed", 42);
    });

    await waitFor(() => {
      // Secondary y-axis tick labels sit at x = plotX1 + 4 with textAnchor="start".
      const rightTicks = container.querySelectorAll(
        'text[text-anchor="start"]',
      );
      expect(rightTicks.length).toBeGreaterThan(0);
    });
  });

  it("renders a path when X axis is a data key instead of time", async () => {
    const config = {
      series: [{ id: "vs", key: "v.verticalSpeed", axis: "auto" as const }],
      windowSec: 300,
      xKey: "v.altitude",
    };

    render(<GraphComponent config={config} id="graph-test" />);

    // Emit two ticks so alignment has prior-x pairs on both.
    act(() => {
      source.emit("v.name", "Kerbal X");
      source.emit("v.missionTime", 0);
      source.emit("v.altitude", 100);
      source.emit("v.verticalSpeed", 5);
    });
    act(() => {
      source.emit("v.missionTime", 1);
      source.emit("v.altitude", 200);
      source.emit("v.verticalSpeed", 8);
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
      series: [{ id: "alt", key: "v.altitude", axis: "primary" as const }],
      windowSec: 300,
      yDomainPrimary: [0, 1000] as [number, number],
    };

    const { container } = render(
      <GraphComponent config={config} id="graph-test" />,
    );

    act(() => {
      source.emit("v.name", "Kerbal X");
      source.emit("v.missionTime", 0);
      // Emit a value way outside the pinned domain — ticks should stay anchored
      // to [0, 1000] regardless.
      source.emit("v.altitude", 500_000);
    });

    await waitFor(() => {
      const texts = Array.from(container.querySelectorAll("text")).map(
        (t) => t.textContent ?? "",
      );
      // niceTicks over [0, 1000] with 5 ticks produces 0, 250, 500, 750, 1000;
      // formatYTick renders 1000 as "1.0k".
      expect(texts).toContain("1.0k");
      // And no tick should be near 500_000 ("500.0k") — the pin is respected.
      expect(texts.some((t) => t === "500.0k")).toBe(false);
    });
  });

  it("renders the readout variant with the latest value when explicitly selected and a single series is configured", async () => {
    const config = {
      variant: "readout" as const,
      series: [{ id: "alt", key: "v.altitude", axis: "auto" as const }],
      windowSec: 300,
    };

    const { container } = render(
      <GraphComponent config={config} id="graph-test" w={10} h={8} />,
    );

    act(() => {
      source.emit("v.name", "Kerbal X");
      source.emit("v.missionTime", 0);
      source.emit("v.altitude", 12_345);
    });

    await waitFor(() => {
      // Big readout shows the formatted latest value (12.3k for 12_345).
      expect(container.textContent ?? "").toMatch(/12\.3k/);
      // No <LineChart> rect / axis text — the readout doesn't render the chart.
      const axisTicks = container.querySelectorAll('text[text-anchor="end"]');
      expect(axisTicks.length).toBe(0);
    });
  });

  it("auto variant downgrades to readout when widget is tiny and one series is configured", async () => {
    const config = {
      // variant omitted → defaults to "auto"
      series: [{ id: "alt", key: "v.altitude", axis: "auto" as const }],
      windowSec: 300,
    };

    // tiny size bucket: w < 5 OR h < 4
    const { container } = render(
      <GraphComponent config={config} id="graph-test" w={3} h={3} />,
    );

    act(() => {
      source.emit("v.name", "Kerbal X");
      source.emit("v.missionTime", 0);
      source.emit("v.altitude", 250);
    });

    await waitFor(() => {
      expect(container.textContent ?? "").toMatch(/250/);
      const axisTicks = container.querySelectorAll('text[text-anchor="end"]');
      expect(axisTicks.length).toBe(0);
    });
  });

  it("auto variant also downgrades to readout at the small size bucket", async () => {
    const config = {
      series: [{ id: "alt", key: "v.altitude", axis: "auto" as const }],
      windowSec: 300,
    };

    // small size bucket: 5 <= w < 8 OR 4 <= h < 7 — chart axes get squashed,
    // readout is preferred.
    const { container } = render(
      <GraphComponent config={config} id="graph-test" w={6} h={6} />,
    );

    act(() => {
      source.emit("v.name", "Kerbal X");
      source.emit("v.missionTime", 0);
      source.emit("v.altitude", 250);
    });

    await waitFor(() => {
      expect(container.textContent ?? "").toMatch(/250/);
      const axisTicks = container.querySelectorAll('text[text-anchor="end"]');
      expect(axisTicks.length).toBe(0);
    });
  });

  it("auto variant stays as chart at the normal size bucket", async () => {
    const config = {
      series: [{ id: "alt", key: "v.altitude", axis: "auto" as const }],
      windowSec: 300,
    };

    const { container } = render(
      <GraphComponent config={config} id="graph-test" w={10} h={8} />,
    );

    act(() => {
      source.emit("v.name", "Kerbal X");
      source.emit("v.missionTime", 0);
      source.emit("v.altitude", 1234);
    });

    await waitFor(() => {
      const axisTicks = container.querySelectorAll('text[text-anchor="end"]');
      expect(axisTicks.length).toBeGreaterThan(0);
    });
  });

  it("readout variant falls back to chart when more than one series is configured", async () => {
    const config = {
      variant: "readout" as const,
      series: [
        { id: "alt", key: "v.altitude", axis: "auto" as const },
        { id: "vs", key: "v.verticalSpeed", axis: "auto" as const },
      ],
      windowSec: 300,
    };

    const { container } = render(
      <GraphComponent config={config} id="graph-test" w={3} h={3} />,
    );

    act(() => {
      source.emit("v.name", "Kerbal X");
      source.emit("v.missionTime", 0);
      source.emit("v.altitude", 12_345);
      source.emit("v.verticalSpeed", 42);
    });

    await waitFor(() => {
      // Chart renders axis tick labels.
      const ticks = container.querySelectorAll("text");
      expect(ticks.length).toBeGreaterThan(0);
    });
  });
});
