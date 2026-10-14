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
});
