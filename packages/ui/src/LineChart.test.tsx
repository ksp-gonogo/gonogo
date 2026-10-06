import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { unannouncedHeldMarks } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import type { ChartSeries } from "./LineChart";
import { LineChart } from "./LineChart";
import {
  buildPath,
  formatTimeLabel,
  makeScale,
  niceTicks,
} from "./lineChartMath";

describe("makeScale", () => {
  it("maps domain endpoints to range endpoints", () => {
    const s = makeScale(0, 100, 10, 110);
    expect(s(0)).toBe(10);
    expect(s(100)).toBe(110);
    expect(s(50)).toBe(60);
  });

  it("returns midpoint when domain has zero span", () => {
    const s = makeScale(5, 5, 0, 100);
    expect(s(5)).toBe(50);
    expect(s(0)).toBe(50);
  });
});

describe("niceTicks", () => {
  it("returns requested count", () => {
    expect(niceTicks(0, 1000, 5)).toHaveLength(5);
  });

  it("all ticks fall within or at domain bounds", () => {
    const ticks = niceTicks(3, 97, 5);
    expect(ticks[0]).toBeGreaterThanOrEqual(3);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(97);
  });

  it("handles zero span", () => {
    const ticks = niceTicks(42, 42, 5);
    expect(ticks).toHaveLength(5);
    expect(ticks.every((t) => t === 42)).toBe(true);
  });
});

describe("formatTimeLabel", () => {
  it("uses mm:ss for spans under an hour", () => {
    expect(formatTimeLabel(90_000, 300_000)).toBe("1:30");
  });

  it("uses HH:mm:ss for spans at or over an hour", () => {
    expect(formatTimeLabel(3_661_000, 3_600_000)).toBe("1:01:01");
  });
});

describe("buildPath", () => {
  it("returns empty string for no points", () => {
    const s = makeScale(0, 1, 0, 100);
    expect(buildPath([], [], s, s)).toBe("");
  });

  it("draws a single point as a zero-length segment, which the round cap shows", () => {
    const sx = makeScale(0, 100, 0, 100);
    const sy = makeScale(0, 100, 100, 0);
    expect(buildPath([50], [50], sx, sy)).toBe("M50.00,50.00 L50.00,50.00");
  });

  it("returns M+L for two points", () => {
    const sx = makeScale(0, 100, 0, 100);
    const sy = makeScale(0, 100, 100, 0);
    const d = buildPath([0, 100], [0, 100], sx, sy);
    expect(d).toBe("M0.00,100.00 L100.00,0.00");
  });
});

const SERIES: ChartSeries[] = [
  {
    id: "alt",
    label: "Altitude",
    axis: "primary",
    color: "#00ff88",
    data: { x: [0, 1000, 2000], y: [0, 500, 1000] },
  },
];

describe("LineChart", () => {
  it("renders an svg with a path for the series", () => {
    const { container } = render(
      <LineChart
        series={SERIES}
        xDomain={[0, 2000]}
        width={400}
        height={200}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    const path = svg?.querySelector("path[stroke='#00ff88']");
    expect(path).not.toBeNull();
    expect(path?.getAttribute("d")).toBeTruthy();
  });

  it("renders nothing for a series with no data points", () => {
    const emptySeries: ChartSeries[] = [
      {
        id: "x",
        label: "X",
        axis: "primary",
        color: "#fff",
        data: { x: [], y: [] },
      },
    ];
    const { container } = render(
      <LineChart
        series={emptySeries}
        xDomain={[0, 1000]}
        width={400}
        height={200}
      />,
    );
    const paths = container.querySelectorAll("path[stroke='#fff']");
    expect(paths).toHaveLength(0);
  });

  it("renders empty chart with no series", () => {
    const { container } = render(
      <LineChart series={[]} xDomain={[0, 1000]} width={400} height={200} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders a secondary y-axis when a series uses it", () => {
    const dual: ChartSeries[] = [
      { ...SERIES[0] },
      {
        id: "speed",
        label: "Speed",
        axis: "secondary",
        color: "#4499ff",
        data: { x: [0, 1000, 2000], y: [0, 100, 200] },
      },
    ];
    const { container } = render(
      <LineChart series={dual} xDomain={[0, 2000]} width={400} height={200} />,
    );
    const texts = Array.from(container.querySelectorAll("text"));
    const axisLabels = texts.filter(
      (t) =>
        t.textContent?.includes("Altitude") || t.textContent?.includes("Speed"),
    );
    expect(axisLabels.length).toBeGreaterThan(0);
  });
});

// A replayed sample draws as live data, a break as a hole, and only a reckoned run is muted and dashed.

const chartName = (container: HTMLElement): string =>
  container.querySelector("svg")?.getAttribute("aria-label") ?? "";

const strokedPaths = (
  container: HTMLElement,
  color: string,
): SVGPathElement[] =>
  Array.from(
    container.querySelectorAll<SVGPathElement>(`path[stroke='${color}']`),
  );

/** A chord the model contradicts is replaced by the model's path, reckoned, with the joined samples marked; an agreeing chord stays. */
describe("LineChart bridges", () => {
  const swung = (to: number, lo: number, hi: number) => ({
    to,
    t: [lo + (hi - lo) / 3, lo + (2 * (hi - lo)) / 3],
    v: [300, 300],
    basis: "kepler-propagation" as const,
  });
  const series = (bridges: ChartSeries["data"]["bridges"]): ChartSeries[] => [
    {
      id: "alt",
      label: "Altitude",
      axis: "primary",
      color: "#00ff88",
      data: {
        x: [0, 1000, 2000],
        y: [0, 0, 400],
        bridges,
      },
    },
  ];
  const measured = (container: HTMLElement) =>
    strokedPaths(container, "#00ff88").filter(
      (p) => p.getAttribute("data-reckoning-basis") === null,
    );
  const subpaths = (container: HTMLElement) =>
    measured(container)
      .map((p) => (p.getAttribute("d") ?? "").match(/M/g)?.length ?? 0)
      .reduce((a, b) => a + b, 0);

  it("draws the model's path for a chord it contradicts, and marks what was measured", () => {
    const { container } = render(
      <LineChart
        series={series([swung(1, 0, 1000)])}
        xDomain={[0, 2000]}
        width={400}
        height={200}
      />,
    );
    expect(subpaths(container)).toBe(2);
    const reckoned = strokedPaths(container, "#00ff88").filter(
      (p) => p.getAttribute("data-reckoning-basis") === "kepler-propagation",
    );
    expect(reckoned).toHaveLength(1);
    expect(reckoned[0].getAttribute("stroke-dasharray")).not.toBeNull();
    expect(
      container.querySelectorAll("circle[data-observed-sample]"),
    ).toHaveLength(2);
    expect(chartName(container)).toMatch(
      /Altitude: part of this trace is reckoned/,
    );
  });

  it("keeps a chord its model agrees with", () => {
    const agreeing = {
      to: 2,
      t: [1500],
      v: [200],
      basis: "kepler-propagation" as const,
    };
    const { container } = render(
      <LineChart
        series={series([agreeing])}
        xDomain={[0, 2000]}
        width={400}
        height={200}
      />,
    );
    expect(subpaths(container)).toBe(1);
    expect(
      container.querySelectorAll("circle[data-observed-sample]"),
    ).toHaveLength(0);
  });
});

describe("LineChart provenance", () => {
  const observed: ChartSeries[] = [
    {
      id: "alt",
      label: "Altitude",
      axis: "primary",
      color: "#00ff88",
      data: {
        x: [0, 1000, 2000, 3000, 4000],
        y: [0, 100, 200, 300, 400],
        spans: [{ from: 2, to: 3, status: "recorded" }],
      },
    },
  ];

  it("draws a recorded run exactly as the live trace", () => {
    const { container } = render(
      <LineChart
        series={observed}
        xDomain={[0, 4000]}
        width={400}
        height={200}
      />,
    );
    const paths = strokedPaths(container, "#00ff88");
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(p.getAttribute("stroke-dasharray")).toBeNull();
      expect(p.getAttribute("stroke-opacity")).toBeNull();
    }
  });

  it("says nothing about a recorded run in the accessible name", () => {
    const { container } = render(
      <LineChart
        series={observed}
        xDomain={[0, 4000]}
        width={400}
        height={200}
      />,
    );
    expect(chartName(container)).not.toMatch(/recorded/i);
  });

  it("mutes and dashes a reckoned run, and only that run", () => {
    const series: ChartSeries[] = [
      {
        id: "alt",
        label: "Altitude",
        axis: "primary",
        color: "#00ff88",
        data: {
          x: [0, 1000, 2000, 3000, 4000],
          y: [0, 100, 200, 300, 400],
          reckoned: [{ from: 3, to: 4, basis: "kepler-propagation" }],
        },
      },
    ];
    const { container } = render(
      <LineChart
        series={series}
        xDomain={[0, 4000]}
        width={400}
        height={200}
      />,
    );
    const paths = strokedPaths(container, "#00ff88");
    const reckoned = paths.filter(
      (p) => p.getAttribute("data-reckoning-basis") === "kepler-propagation",
    );
    const measured = paths.filter(
      (p) => p.getAttribute("data-reckoning-basis") === null,
    );
    expect(reckoned).toHaveLength(1);
    expect(measured).toHaveLength(1);
    // A dash survives greyscale; the mute is the second channel.
    expect(reckoned[0].getAttribute("stroke-dasharray")).not.toBeNull();
    expect(Number(reckoned[0].getAttribute("stroke-opacity"))).toBeLessThan(1);
    expect(reckoned[0].getAttribute("stroke")).toBe("#00ff88");
    expect(measured[0].getAttribute("stroke-dasharray")).toBeNull();
    expect(measured[0].getAttribute("stroke-opacity")).toBeNull();
  });

  it("names the reckoned run, and what moved it, in the accessible name", () => {
    const series: ChartSeries[] = [
      {
        id: "alt",
        label: "Altitude",
        axis: "primary",
        color: "#00ff88",
        data: {
          x: [0, 1000, 2000],
          y: [0, 100, 200],
          reckoned: [{ from: 1, to: 2, basis: "rate-integration" }],
        },
      },
    ];
    const { container } = render(
      <LineChart
        series={series}
        xDomain={[0, 2000]}
        width={400}
        height={200}
      />,
    );
    const name = chartName(container);
    expect(name).toMatch(/Altitude/);
    expect(name).toMatch(/reckoned/i);
    expect(name).toMatch(/not measured/i);
    expect(name).toMatch(/last observed rate/i);
  });
});

/** The uncertainty band is an extra mark, not a state, so each case also checks the reckoned stroke is unchanged. */
describe("LineChart uncertainty band", () => {
  const banded = (kind: "bound" | "sigma1"): ChartSeries[] => [
    {
      id: "alt",
      label: "Altitude",
      axis: "primary",
      color: "#00ff88",
      data: {
        x: [0, 1000, 2000, 3000],
        y: [0, 100, 200, 300],
        reckoned: [
          {
            from: 2,
            to: 3,
            basis: "kepler-propagation",
            bandLo: [180, 240],
            bandHi: [230, 400],
            bandKind: kind,
          },
        ],
      },
    },
  ];

  const regions = (container: HTMLElement): SVGPathElement[] =>
    Array.from(
      container.querySelectorAll<SVGPathElement>("path[data-band-kind]"),
    );

  it("fills one region for the banded run, in the series' own colour", () => {
    const { container } = render(
      <LineChart
        series={banded("sigma1")}
        xDomain={[0, 3000]}
        width={400}
        height={200}
      />,
    );
    const drawn = regions(container);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].getAttribute("fill")).toBe("#00ff88");
    expect(Number(drawn[0].getAttribute("fill-opacity"))).toBeLessThan(1);
  });

  it("draws no region for a reckoned run whose model would not say", () => {
    const bandless: ChartSeries[] = [
      {
        id: "alt",
        label: "Altitude",
        axis: "primary",
        color: "#00ff88",
        data: {
          x: [0, 1000, 2000],
          y: [0, 100, 200],
          reckoned: [{ from: 1, to: 2, basis: "kepler-propagation" }],
        },
      },
    ];
    const { container } = render(
      <LineChart
        series={bandless}
        xDomain={[0, 2000]}
        width={400}
        height={200}
      />,
    );
    expect(regions(container)).toHaveLength(0);
  });

  it("edges a hard bound and leaves a one-sigma region unedged", () => {
    const { container: bound } = render(
      <LineChart
        series={banded("bound")}
        xDomain={[0, 3000]}
        width={400}
        height={200}
      />,
    );
    expect(regions(bound)[0].getAttribute("stroke")).toBe("#00ff88");

    const { container: sigma } = render(
      <LineChart
        series={banded("sigma1")}
        xDomain={[0, 3000]}
        width={400}
        height={200}
      />,
    );
    expect(regions(sigma)[0].getAttribute("stroke")).toBe("none");
  });

  it("leaves the reckoned stroke muted and dashed as it always was", () => {
    const { container } = render(
      <LineChart
        series={banded("bound")}
        xDomain={[0, 3000]}
        width={400}
        height={200}
      />,
    );
    const reckoned = strokedPaths(container, "#00ff88").filter(
      (p) => p.getAttribute("data-reckoning-basis") === "kepler-propagation",
    );
    expect(reckoned).toHaveLength(1);
    expect(reckoned[0].getAttribute("stroke-dasharray")).not.toBeNull();
  });

  it("says what a one-sigma region means, since neither fill nor edge is a channel a reader has", () => {
    const { container } = render(
      <LineChart
        series={banded("sigma1")}
        xDomain={[0, 3000]}
        width={400}
        height={200}
      />,
    );
    const name = chartName(container);
    expect(name).toMatch(/the value is inside/i);
  });

  // Chart and meter share one helper so a band is described the same way on both.
  it("names what the region claims without reaching for statistics vocabulary", () => {
    const { container } = render(
      <LineChart
        series={banded("sigma1")}
        xDomain={[0, 3000]}
        width={400}
        height={200}
      />,
    );
    expect(chartName(container)).not.toMatch(
      /sigma|standard deviation|standard error|confidence interval/i,
    );
  });

  it("says a hard bound is a range the value is inside", () => {
    const { container } = render(
      <LineChart
        series={banded("bound")}
        xDomain={[0, 3000]}
        width={400}
        height={200}
      />,
    );
    const name = chartName(container);
    expect(name).toMatch(/the value is inside/i);
    expect(name).not.toMatch(/could be|two thirds|the time/i);
  });

  it("reads a one-sigma region and a hard bound the same way", () => {
    const { container: sigma1 } = render(
      <LineChart
        series={banded("sigma1")}
        xDomain={[0, 3000]}
        width={400}
        height={200}
      />,
    );
    const { container: bound } = render(
      <LineChart
        series={banded("bound")}
        xDomain={[0, 3000]}
        width={400}
        height={200}
      />,
    );
    expect(chartName(sigma1)).toBe(chartName(bound));
  });
});

/** A held threshold reading marks its label and the chart name; a current one draws as a bare number. */
describe("LineChart threshold currency", () => {
  const AT = value("ut", 1_000);
  const altitude = value("m", 30_000);
  const live: Reading<Value<"m">> = {
    state: "observed",
    value: altitude,
    atUt: AT,
    reckoning: { status: "none" },
  };
  const held: Reading<Value<"m">> = {
    state: "held",
    value: altitude,
    asOfUt: AT,
    grade: "held",
    reckoning: { status: "none" },
  };

  function chartWith(reading: Reading<Value<"m">> | undefined) {
    return render(
      <LineChart
        series={[]}
        xDomain={[0, 70_000]}
        yDomainPrimary={[1, 100_000]}
        thresholds={[
          {
            id: "current",
            value: 400,
            kind: "marker",
            label: "400 pascals @ 30 km",
            reading,
          },
        ]}
        width={400}
        height={200}
      />,
    ).container;
  }

  it("marks a held reading's label and names it in words", () => {
    const container = chartWith(held);
    expect(container.querySelector("text [data-held-mark]")).not.toBeNull();
    expect(chartName(container)).toMatch(/400 pascals @ 30 km, .+/);
  });

  it("says a held line's grade and its instant, aloud and on hover, with or without a grade", () => {
    for (const reading of [held, { ...held, grade: undefined }]) {
      const container = chartWith(reading);
      expect(container.querySelector("[data-held-mark]")).not.toBeNull();
      expect(unannouncedHeldMarks(container)).toEqual([]);
    }
  });

  it("marks a current reading's label when the line stands at a figure the model carried to SCET", () => {
    const carried: Reading<Value<"m">> = {
      ...live,
      reckoning: {
        status: "available",
        atUt: value("ut", 1_240),
        beyondReceived: true,
        modelled: value("m", 29_000),
        basis: "rate-integration",
      },
    };
    const container = render(
      <LineChart
        series={[]}
        xDomain={[0, 70_000]}
        yDomainPrimary={[1, 100_000]}
        thresholds={[
          {
            id: "current",
            value: 420,
            kind: "marker",
            label: "420 pascals @ 29 km",
            reading: carried,
          },
        ]}
        width={400}
        height={200}
      />,
    ).container;
    expect(container.querySelector("text [data-held-mark]")).not.toBeNull();
    expect(chartName(container)).toMatch(/modelled to SCET/);
  });

  it("draws a current reading, or none, exactly as a bare line", () => {
    for (const reading of [live, undefined]) {
      const container = chartWith(reading);
      expect(container.querySelector("[data-held-mark]")).toBeNull();
      expect(chartName(container)).not.toMatch(/400 pascals/);
    }
  });
});

/** A threshold's tone comes from its kind and the trace on its axis, never from the caller. */
describe("LineChart threshold tone", () => {
  type Kind = "target" | "marker" | { limit: "above" | "below" };

  function lineFor(kind: Kind, ys: number[]) {
    const { container } = render(
      <LineChart
        series={[
          {
            id: "s",
            label: "Trace",
            axis: "primary",
            color: "#fff",
            data: { x: ys.map((_, i) => i * 1000), y: ys },
          },
        ]}
        xDomain={[0, 3000]}
        yDomainPrimary={[0, 100]}
        thresholds={[
          typeof kind === "string"
            ? { id: "t", value: 50, kind, label: "Fifty" }
            : {
                id: "t",
                value: 50,
                kind: "limit",
                bad: kind.limit,
                label: "Fifty",
              },
        ]}
        width={400}
        height={200}
      />,
    );
    const line = container.querySelector("[data-threshold-kind]");
    if (!line) throw new Error("no threshold line drawn");
    return {
      line,
      name: chartName(container),
      marks: [...container.querySelectorAll("[data-limit-crossing]")],
      container,
    };
  }

  it("draws a ceiling quietly while the trace is under it, then says it is passed in tone and in words", () => {
    const under = lineFor({ limit: "above" }, [10, 20, 30]);
    expect(under.line.getAttribute("stroke")).toBe("var(--color-text-faint)");
    expect(under.name).not.toMatch(/limit passed/);

    const passed = lineFor({ limit: "above" }, [10, 40, 60]);
    expect(passed.line.getAttribute("stroke")).toBe("var(--color-warn-mark)");
    expect(passed.name).toMatch(/Fifty: limit passed/);
  });

  it("reads a floor the other way up: under it is passed, over it is not", () => {
    expect(
      lineFor({ limit: "below" }, [90, 60, 40]).line.getAttribute("stroke"),
    ).toBe("var(--color-warn-mark)");
    expect(
      lineFor({ limit: "below" }, [10, 40, 60]).line.getAttribute("stroke"),
    ).toBe("var(--color-text-faint)");
  });

  it("counts a figure standing exactly on the limit as past it, on either side", () => {
    for (const bad of ["above", "below"] as const) {
      expect(
        lineFor({ limit: bad }, [20, 80, 50]).line.getAttribute("stroke"),
      ).toBe("var(--color-warn-mark)");
    }
  });

  it("reads a figure that has been past the limit for the whole window as past it", () => {
    const always = lineFor({ limit: "above" }, [60, 70, 80]);
    expect(always.line.getAttribute("stroke")).toBe("var(--color-warn-mark)");
    expect(always.name).toMatch(/Fifty: limit passed/);
  });

  it("goes quiet again once the figure has come back inside the limit", () => {
    const back = lineFor({ limit: "above" }, [10, 60, 30]);
    expect(back.line.getAttribute("stroke")).toBe("var(--color-text-faint)");
    expect(back.name).not.toMatch(/limit passed/);
  });

  it("sets a warning mark where the trace went past a limit, and keeps it once the figure is back inside", () => {
    const { marks, container, line } = lineFor(
      { limit: "above" },
      [10, 60, 30],
    );
    expect(line.getAttribute("stroke")).toBe("var(--color-text-faint)");
    expect(marks).toHaveLength(1);
    // Which trace, which limit, the reading and when, in the mark's own name; and the mark is a tab stop.
    expect(marks[0].getAttribute("aria-label")).toBe(
      "Trace went past Fifty at 0:01, reading 60",
    );
    expect(marks[0].getAttribute("tabindex")).toBe("0");
    // The trace is one stroke in its own colour, end to end.
    expect(
      container.querySelectorAll('svg > path[stroke="#fff"]'),
    ).toHaveLength(1);
    // A chart with parts a reader can reach is a group, not one image.
    expect(container.querySelector("svg")?.getAttribute("role")).toBe("group");
  });

  it("opens the mark's tip on keyboard focus, saying what its name says", async () => {
    const { marks } = lineFor({ limit: "above" }, [10, 60, 30]);
    fireEvent.focus(marks[0]);
    expect(
      await screen.findByText(/Trace went past Fifty at 0:01/),
    ).toBeTruthy();
  });

  it("marks a trace that was past the limit when the window began, and says so", () => {
    const { marks } = lineFor({ limit: "above" }, [60, 70, 80]);
    expect(marks).toHaveLength(1);
    expect(marks[0].getAttribute("aria-label")).toBe(
      "Trace was already past Fifty when this window began at 0:00, reading 60",
    );
  });

  it("sets no mark on a target or a marker, and leaves the chart one image", () => {
    for (const drawn of [
      lineFor("target", [10, 60, 30]),
      lineFor("marker", [10, 60, 30]),
      lineFor({ limit: "above" }, [10, 20, 30]),
    ]) {
      expect(drawn.marks).toHaveLength(0);
      expect(drawn.container.querySelector("svg")?.getAttribute("role")).toBe(
        "img",
      );
    }
  });

  it("draws a target in the go tone once the trace reaches it", () => {
    const short = lineFor("target", [10, 20, 30]);
    expect(short.line.getAttribute("stroke")).toBe("var(--color-text-faint)");

    const reached = lineFor("target", [10, 30, 50]);
    expect(reached.line.getAttribute("stroke")).toBe("var(--color-go-mark)");
    expect(reached.name).toMatch(/Fifty: target reached/);
  });

  it("never changes a marker's tone, and draws it solid", () => {
    const before = lineFor("marker", [10, 20, 30]);
    const after = lineFor("marker", [10, 40, 60]);
    expect(after.line.getAttribute("stroke")).toBe(
      before.line.getAttribute("stroke"),
    );
    expect(after.line.getAttribute("stroke-dasharray")).toBeNull();
    expect(after.name).not.toMatch(/passed|reached/);
  });
});
