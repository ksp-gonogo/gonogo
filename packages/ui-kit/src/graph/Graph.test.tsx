import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expectNoA11yViolations,
  installFixedSizeResizeObserver,
} from "../testing";
import { Graph } from "./Graph";
import type { ChartSeries } from "./LineChart";

const LINE: ChartSeries = {
  id: "alt",
  label: "Altitude",
  axis: "primary",
  color: "var(--color-go-text)",
  data: { x: [0, 1, 2, 3], y: [0, 1, 4, 9] },
};

describe("Graph", () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installFixedSizeResizeObserver({ width: 400, height: 200 });
  });
  afterEach(() => uninstall());

  it("draws the chart at the size of the region it measures", () => {
    const { container } = render(
      <Graph chrome="bare" series={[LINE]} xKind="value" xDomain={[0, 3]} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("400");
    expect(svg?.getAttribute("height")).toBe("200");
  });

  it("takes a fixed height when given one", () => {
    const { container } = render(
      <Graph
        chrome="bare"
        height={96}
        series={[LINE]}
        xKind="value"
        xDomain={[0, 3]}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.height).toBe("96px");
  });

  it("writes the ticks of an axis in the unit it is given", () => {
    const { container } = render(
      <Graph
        chrome="bare"
        series={[LINE]}
        xKind="value"
        xDomain={[0, 3]}
        yDomainPrimary={[0, 1500]}
        yUnit="m"
      />,
    );
    const labels = [...container.querySelectorAll("text")].map(
      (t) => t.textContent,
    );
    expect(labels.some((l) => l?.endsWith("km"))).toBe(true);
  });

  it("names a threshold with the figure it stands at", () => {
    const { container } = render(
      <Graph
        chrome="bare"
        series={[LINE]}
        xKind="value"
        xDomain={[0, 3]}
        yDomainPrimary={[0, 40]}
        thresholds={[
          {
            id: "ceiling",
            kind: "limit",
            bad: "above",
            value: value("m", 30),
            label: "Ceiling",
          },
        ]}
      />,
    );
    expect(container.textContent).toContain("Ceiling: 30.0 m");
  });

  it("says so when there is nothing to draw", () => {
    render(
      <Graph
        chrome="bare"
        series={[]}
        xKind="value"
        xDomain={[0, 1]}
        emptyState="Configure series to begin graphing"
      />,
    );
    expect(screen.getByText("Configure series to begin graphing")).toBeTruthy();
  });

  it("wraps the plot in a titled panel unless it is bare", () => {
    render(
      <Graph title="ALTITUDE" series={[LINE]} xKind="value" xDomain={[0, 3]} />,
    );
    expect(screen.getByText("ALTITUDE")).toBeTruthy();
  });

  it("keeps a subscription it is given inside the frame, drawing nothing", () => {
    const { container } = render(
      <Graph chrome="bare" series={[LINE]} xKind="value" xDomain={[0, 3]}>
        <span data-testid="fetcher" />
      </Graph>,
    );
    const frame = container.querySelector(
      '[data-testid="fetcher"]',
    )?.parentElement;
    expect(frame?.querySelector("svg")).not.toBeNull();
  });

  it("has no accessibility violations with a notice and a readout", async () => {
    const { container } = render(
      <Graph
        chrome="bare"
        series={[LINE]}
        xKind="value"
        xDomain={[0, 3]}
        aria-label="Altitude against time"
        notice="Plotting trace only"
        plotReadout={<span>Now 9 m</span>}
      />,
    );
    await expectNoA11yViolations(container);
  });

  describe("compact density", () => {
    const BROKEN: ChartSeries = {
      id: "dose",
      label: "Dose",
      axis: "primary",
      color: "var(--color-info-mark)",
      data: { x: [0, 1, 2, 5, 6, 7], y: [1, 2, 3, 2, 1, 2], breaks: [3] },
    };

    function compact(extra: Partial<Parameters<typeof Graph>[0]> = {}) {
      return render(
        <Graph
          chrome="bare"
          density="compact"
          height={96}
          hideXAxis
          series={[BROKEN]}
          xDomain={[0, 7]}
          yDomainPrimary={[0, 4]}
          {...extra}
        />,
      ).container;
    }

    it("draws no tick labels, gridlines, legend or crosshair", () => {
      const full = render(
        <Graph
          chrome="bare"
          height={96}
          series={[BROKEN]}
          xDomain={[0, 7]}
          xKind="value"
          crosshair
        />,
      ).container;
      expect(full.querySelectorAll("text").length).toBeGreaterThan(0);
      expect(full.querySelector('svg[role="group"]')).not.toBeNull();
      const container = compact({ crosshair: true });
      expect(container.querySelectorAll("text")).toHaveLength(0);
      expect(container.querySelector('svg[role="group"]')).toBeNull();
    });

    it("shades each run under its trace and leaves the break unshaded", () => {
      const container = compact();
      const shaded = [...container.querySelectorAll("path")].filter(
        (p) => p.getAttribute("fill-opacity") === "0.12",
      );
      expect(shaded).toHaveLength(1);
      const runs = (shaded[0].getAttribute("d") ?? "").match(/Z/g) ?? [];
      expect(runs).toHaveLength(2);
    });

    it("draws a marker threshold as a short tick with its label", () => {
      const container = compact({
        thresholds: [
          {
            id: "safe",
            kind: "marker",
            label: "Safe threshold",
            value: value("m", 2),
          },
        ],
      });
      const tick = container.querySelector('[data-threshold-kind="marker"]');
      const x1 = Number(tick?.getAttribute("x1"));
      const x2 = Number(tick?.getAttribute("x2"));
      expect(x2 - x1).toBe(24);
      expect(container.textContent).toContain("Safe threshold: 2.00 m");
    });

    it("keeps a limit threshold as a rule across the plot", () => {
      const container = compact({
        thresholds: [
          {
            id: "ceiling",
            kind: "limit",
            bad: "above",
            value: value("m", 3),
            label: "Ceiling",
          },
        ],
      });
      const rule = container.querySelector('[data-threshold-kind="limit"]');
      expect(
        Number(rule?.getAttribute("x2")) - Number(rule?.getAttribute("x1")),
      ).toBeGreaterThan(100);
    });

    it("lays the notice over a compact plot with nothing to draw", () => {
      render(
        <Graph
          chrome="bare"
          density="compact"
          height={96}
          series={[]}
          xDomain={[0, 1]}
          notice="Collecting history..."
        />,
      );
      expect(screen.getByText("Collecting history...")).toBeTruthy();
    });

    it("draws the plot without the frame's styled box", () => {
      const frameOf = (container: HTMLElement) =>
        container.querySelector("svg")?.parentElement?.parentElement;
      const full = render(
        <Graph
          chrome="bare"
          height={96}
          series={[BROKEN]}
          xDomain={[0, 7]}
          xKind="value"
        />,
      ).container;
      expect(frameOf(full)?.className).not.toBe("");
      expect(frameOf(compact())?.className).toBe("");
    });

    it("has no accessibility violations", async () => {
      const container = compact({ "aria-label": "Dose rate trend" });
      await expectNoA11yViolations(container);
    });
  });
});
