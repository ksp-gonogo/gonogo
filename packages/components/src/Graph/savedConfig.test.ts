import { describe, expect, it } from "vitest";
import {
  graphThresholdsOf,
  graphTopicsOf,
  graphViewConfigOf,
  handleOfKey,
} from "./savedConfig";
import { TIME_AXIS } from "./types";

describe("the Graph widget's saved configuration, as the view it asks for", () => {
  it("splits a saved key into its Topic and the field inside it", () => {
    expect(handleOfKey("vessel.flight.altitudeAsl")).toEqual({
      topic: "vessel.flight",
      field: "altitudeAsl",
    });
    expect(handleOfKey("vessel.orbit")).toEqual({ topic: "vessel.orbit" });
  });

  it("names every series, band high and X axis by handle, and reads the time sentinel as no X field", () => {
    const view = graphViewConfigOf({
      windowSec: 60,
      xKey: TIME_AXIS,
      series: [
        {
          id: "band",
          key: "vessel.flight.altitudeAsl",
          keyHigh: "vessel.orbit.apoapsis",
          type: "band",
        },
      ],
    });
    expect(view?.x).toBeUndefined();
    expect(view?.series).toEqual([
      {
        id: "band",
        type: "band",
        source: { topic: "vessel.flight", field: "altitudeAsl" },
        high: { topic: "vessel.orbit", field: "apoapsis" },
      },
    ]);
    expect(
      graphViewConfigOf({
        windowSec: 60,
        series: [],
        xKey: "vessel.orbit.sma",
      })?.x,
    ).toEqual({ topic: "vessel.orbit", field: "sma" });
  });

  it("reads a saved line in the unit of the series on its axis, and as a limit when it names no kind", () => {
    const [line] = graphThresholdsOf(
      {
        windowSec: 60,
        series: [
          { id: "alt", key: "vessel.flight.altitudeAsl", axis: "primary" },
        ],
        thresholds: [{ id: "top", value: 70_000, axis: "primary", label: "" }],
      },
      [{ key: "vessel.flight.altitudeAsl", label: "Altitude", unit: "m" }],
    );
    // A line saved before limits had sides is a ceiling.
    expect(line).toMatchObject({ kind: "limit", bad: "above" });
    expect(line.label).toBeUndefined();
    expect(line.value).toMatchObject({ magnitude: 70_000, unit: "m" });
  });

  it("keeps the side a saved limit declares, and gives a target none", () => {
    const [floor, goal] = graphThresholdsOf(
      {
        windowSec: 60,
        series: [
          { id: "alt", key: "vessel.flight.altitudeAsl", axis: "primary" },
        ],
        thresholds: [
          {
            id: "f",
            value: 1_000,
            axis: "primary",
            kind: "limit",
            bad: "below",
          },
          { id: "g", value: 9_000, axis: "primary", kind: "target" },
        ],
      },
      [{ key: "vessel.flight.altitudeAsl", label: "Altitude", unit: "m" }],
    );
    expect(floor).toMatchObject({ kind: "limit", bad: "below" });
    expect(goal).toMatchObject({ kind: "target" });
    expect(goal).not.toHaveProperty("bad");
  });

  it("reads a line on an axis with no known unit as a plain number", () => {
    const [line] = graphThresholdsOf(
      {
        windowSec: 60,
        series: [],
        thresholds: [{ id: "x", value: 3, axis: "secondary" }],
      },
      [],
    );
    expect(line.value).toMatchObject({ magnitude: 3, unit: "1" });
  });
});

describe("the Topics a saved Graph reads", () => {
  it("names the Topic under every series, band high and non-time X axis, each once", () => {
    expect(
      graphTopicsOf({
        windowSec: 60,
        xKey: "vessel.orbit.ecc",
        series: [
          {
            id: "a",
            key: "vessel.flight.altitudeAsl",
            keyHigh: "vessel.orbit.apoapsis",
            type: "band",
          },
          { id: "b", key: "vessel.flight.speed", type: "line" },
        ],
      }),
    ).toEqual(["vessel.flight", "vessel.orbit"]);
  });

  it("names nothing for a Graph with no series, or one drawn against time", () => {
    expect(graphTopicsOf(undefined)).toEqual([]);
    expect(
      graphTopicsOf({ windowSec: 60, xKey: TIME_AXIS, series: [] }),
    ).toEqual([]);
  });
});
