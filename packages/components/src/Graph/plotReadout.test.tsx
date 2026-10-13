import { act, fireEvent, render, waitFor } from "@ksp-gonogo/test-utils";
import { installFixedSizeResizeObserver } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GraphView } from "./GraphView";

const CURVE = {
  id: "c",
  label: "Pressure",
  xs: [0, 10_000, 20_000, 30_000, 40_000],
  ys: [100_000, 40_000, 10_000, 1_000, 100],
};
const REFERENCE_PLOT = {
  series: [],
  windowSec: 60,
  x: { topic: "vessel.flight", field: "altitudeAsl" },
  xLabel: "Altitude",
  xUnit: "m",
  yLabel: "Pressure",
  yUnit: "Pa",
  yScalePrimary: "log" as const,
};

/** The card and the column are both measured, so their sizes are stood in for here: the readout is 90 by 44 px, and the column 150 by 60. */
function installReadoutSizes(): () => void {
  const sizeOf = (el: HTMLElement, axis: "w" | "h") => {
    if (el.hasAttribute("data-plot-card")) return axis === "w" ? 90 : 44;
    if (el.hasAttribute("data-plot-aside")) return axis === "w" ? 150 : 60;
    return 0;
  };
  const width = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth",
  );
  const height = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return sizeOf(this, "w");
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return sizeOf(this, "h");
    },
  });
  return () => {
    if (width)
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", width);
    if (height)
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
  };
}

describe("GraphView plotReadout", () => {
  let restoreSizes: () => void = () => {};
  let restoreObserver: () => void = () => {};
  beforeEach(() => {
    restoreSizes = installReadoutSizes();
  });
  afterEach(() => {
    restoreObserver();
    restoreSizes();
  });

  function renderAt(size: { width: number; height: number }) {
    restoreObserver = installFixedSizeResizeObserver(size);
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    return render(
      <fixture.Provider>
        <GraphView
          config={REFERENCE_PLOT}
          referenceCurves={[CURVE]}
          plotReadout={<span>air now</span>}
        />
      </fixture.Provider>,
    );
  }

  it("takes a column beside the plot where the plot keeps its width", async () => {
    const { container } = renderAt({ width: 900, height: 500 });
    await waitFor(() =>
      expect(container.querySelector("[data-plot-aside]")).not.toBeNull(),
    );
    expect(container.querySelector("[data-plot-card]")).toBeNull();
  });

  it("stands over the plot, off the curve, where the column would take too much of it", async () => {
    const { container } = renderAt({ width: 400, height: 500 });
    await waitFor(() =>
      expect(container.querySelector("[data-plot-card]")).not.toBeNull(),
    );
    expect(container.querySelector("[data-plot-aside]")).toBeNull();
    const card = container.querySelector("[data-plot-card]") as HTMLElement;
    expect(card.style.visibility).toBe("visible");
    expect(card.textContent).toBe("air now");
  });

  it("is not drawn where the plot cannot hold it", async () => {
    const { container } = renderAt({ width: 110, height: 80 });
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    const card = container.querySelector(
      "[data-plot-card]",
    ) as HTMLElement | null;
    expect(card?.style.visibility ?? "hidden").toBe("hidden");
  });
});

describe("GraphView on an altitude axis", () => {
  let restoreObserver: () => void = () => {};
  afterEach(() => restoreObserver());

  function renderPlot() {
    restoreObserver = installFixedSizeResizeObserver({
      width: 600,
      height: 400,
    });
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    return render(
      <fixture.Provider>
        <GraphView config={REFERENCE_PLOT} referenceCurves={[CURVE]} />
      </fixture.Provider>,
    );
  }

  it("names both axes with their units", async () => {
    const { container } = renderPlot();
    await waitFor(() =>
      expect(container.querySelector('[data-axis-title="x"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-axis-title="x"]')?.textContent).toBe(
      "Altitude (m)",
    );
    expect(container.querySelector('[data-axis-title="y"]')?.textContent).toBe(
      "Pressure (Pa)",
    );
  });

  it("reads the curve at the altitude the keyboard lands on", async () => {
    const { container } = renderPlot();
    await waitFor(() =>
      expect(container.querySelector("svg[tabindex]")).not.toBeNull(),
    );
    const svg = container.querySelector("svg[tabindex]") as SVGSVGElement;
    const status = container.querySelector('[role="status"]') as HTMLElement;
    act(() => svg.focus());
    expect(status.textContent).toMatch(/Pressure/);
    fireEvent.keyDown(svg, { key: "Home" });
    expect(status.textContent).toMatch(/Pressure.*(100|100\.0|100k)/);
    expect(container.querySelector("[data-plot-crosshair]")).not.toBeNull();
  });
});

describe("GraphView readout present point", () => {
  let restoreObserver: () => void = () => {};
  afterEach(() => restoreObserver());

  it("hands a function readout the reference curves read at an x, and none on a time axis", async () => {
    restoreObserver = installFixedSizeResizeObserver({
      width: 900,
      height: 500,
    });
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    const seen: unknown[] = [];
    render(
      <fixture.Provider>
        <GraphView
          config={REFERENCE_PLOT}
          referenceCurves={[CURVE]}
          plotReadout={(room) => {
            seen.push(room.present);
            return <span>figures</span>;
          }}
        />
      </fixture.Provider>,
    );
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    // No series, so there is no newest sample to stand on yet.
    expect(seen.every((present) => present === undefined)).toBe(true);
  });
});
