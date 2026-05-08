import type { DataKey, MockDataSource } from "@gonogo/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import {
  parseExperiments,
  parseSensorReadings,
  ScienceBenchComponent,
} from "./index";

const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.body" },
  { key: "v.situationString" },
  { key: "v.landedAt" },
  { key: "s.sensor.temp" },
  { key: "s.sensor.pres" },
  { key: "s.sensor.grav" },
  { key: "s.sensor.acc" },
  { key: "sci.count" },
  { key: "sci.dataAmount" },
  { key: "sci.experiments" },
  { key: "career.mode" },
  { key: "career.science" },
  { key: "career.funds" },
  { key: "career.reputation" },
];

describe("ScienceBenchComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  it("renders the awaiting placeholder before any situation telemetry", () => {
    render(<ScienceBenchComponent config={{}} id="sci" />);
    expect(
      screen.getByText(/Awaiting situation telemetry/i),
    ).toBeInTheDocument();
  });

  it("shows situation + biome on the situation line", () => {
    render(<ScienceBenchComponent config={{}} id="sci" />);
    act(() => {
      source.emit("v.body", "Mun");
      source.emit("v.situationString", "Landed at Mun");
      source.emit("v.landedAt", "Northwest Crater");
    });
    expect(
      screen.getByText(/Landed at Mun — Northwest Crater/i),
    ).toBeInTheDocument();
  });

  it("hides the career strip in sandbox mode", () => {
    render(<ScienceBenchComponent config={{}} id="sci" />);
    act(() => {
      source.emit("career.mode", "SANDBOX");
      source.emit("career.science", 42);
    });
    expect(screen.queryByText("SCI")).not.toBeInTheDocument();
  });

  it("shows the career strip when not sandbox", () => {
    render(<ScienceBenchComponent config={{}} id="sci" />);
    act(() => {
      source.emit("career.mode", "CAREER");
      source.emit("career.science", 1234);
      source.emit("career.funds", 567_890);
      source.emit("career.reputation", 12);
    });
    expect(screen.getByText("SCI")).toBeInTheDocument();
    expect(screen.getByText("FUNDS")).toBeInTheDocument();
    expect(screen.getByText("REP")).toBeInTheDocument();
  });

  it("renders one sensor row per unique part, collapsing duplicates", () => {
    render(<ScienceBenchComponent config={{}} id="sci" />);
    act(() => {
      // Three thermometers stacked on the same booster — collapse to one row
      // with a ×3 count badge. A separate part stays on its own row.
      source.emit("s.sensor.temp", [
        [
          "solidBooster.sm.v2",
          "solidBooster.sm.v2",
          "solidBooster.sm.v2",
          "noseConeBasic",
        ],
        [313.43, 313.43, 313.43, 290.0],
      ]);
    });
    const boosterRows = screen.getAllByText("solidBooster.sm.v2");
    expect(boosterRows).toHaveLength(1);
    expect(screen.getByText(/313\.43 K/)).toBeInTheDocument();
    expect(screen.getByText("×3")).toBeInTheDocument();
    expect(screen.getByText("noseConeBasic")).toBeInTheDocument();
    expect(screen.getByText(/290\.00 K/)).toBeInTheDocument();
  });

  it("shows experiment title and data amount from sci.experiments", () => {
    render(<ScienceBenchComponent config={{}} id="sci" />);
    act(() => {
      source.emit("sci.experiments", [
        {
          part: "Mystery Goo Container",
          title:
            "Mystery Goo Observation while flying low over Kerbin's grasslands",
          dataAmount: 5.5,
          scienceValueBase: 5.0,
          transmitBoost: 0,
          subjectId: "mysteryGoo@KerbinFlyingLowGrasslands",
        },
      ]);
      source.emit("sci.count", 1);
      source.emit("sci.dataAmount", 5.5);
    });
    expect(screen.getByText(/Mystery Goo Observation/i)).toBeInTheDocument();
    expect(screen.getByText("5.5 mits")).toBeInTheDocument();
  });
});

describe("parseSensorReadings", () => {
  it("returns null for nullish input", () => {
    expect(parseSensorReadings(null)).toBeNull();
    expect(parseSensorReadings(undefined)).toBeNull();
  });

  it("treats a single number as a one-row reading", () => {
    expect(parseSensorReadings(312.4)).toEqual([
      { partName: "Sensor", value: 312.4 },
    ]);
  });

  it("parses arrays of {partName, value}", () => {
    expect(
      parseSensorReadings([
        { partName: "A", value: 1 },
        { partName: "B", value: 2 },
      ]),
    ).toEqual([
      { partName: "A", value: 1 },
      { partName: "B", value: 2 },
    ]);
  });

  it("parses object maps", () => {
    expect(parseSensorReadings({ A: 1, B: 2 })).toEqual([
      { partName: "A", value: 1 },
      { partName: "B", value: 2 },
    ]);
  });

  it("returns 'no sensors' for unrecognised shapes", () => {
    expect(parseSensorReadings({ unknown: "shape" })).toBe("no sensors");
  });

  it("parses Telemachus's parallel-arrays shape [names, values]", () => {
    expect(
      parseSensorReadings([
        ["Sensor A", "Sensor B"],
        [12.5, 7.25],
      ]),
    ).toEqual([
      { partName: "Sensor A", value: 12.5 },
      { partName: "Sensor B", value: 7.25 },
    ]);
  });

  it("returns 'no sensors' for the Telemachus empty-state sentinel", () => {
    expect(
      parseSensorReadings([["No Sensors of the Appropriate Type"], [0]]),
    ).toBe("no sensors");
  });
});

describe("parseExperiments", () => {
  it("returns null for nullish input", () => {
    expect(parseExperiments(null)).toBeNull();
    expect(parseExperiments(undefined)).toBeNull();
  });

  it("returns null for non-array input (Telemachus only emits arrays)", () => {
    expect(parseExperiments({ foo: "bar" })).toBeNull();
    expect(parseExperiments(42)).toBeNull();
  });

  it("parses Telemachus's sci.experiments wire format", () => {
    expect(
      parseExperiments([
        {
          part: "Mystery Goo Container",
          title: "Mystery Goo from Kerbin",
          dataAmount: 1.5,
          scienceValueBase: 5.0,
          transmitBoost: 0,
          subjectId: "mysteryGoo@KerbinSrfLandedGrasslands",
        },
      ]),
    ).toEqual([
      {
        part: "Mystery Goo Container",
        title: "Mystery Goo from Kerbin",
        dataAmount: 1.5,
        subjectId: "mysteryGoo@KerbinSrfLandedGrasslands",
      },
    ]);
  });

  it("falls back to (unnamed) when title is missing", () => {
    const result = parseExperiments([{ subjectId: "x", dataAmount: 3 }]);
    expect(result?.[0]?.title).toBe("(unnamed)");
  });

  it("synthesises a stable subjectId when missing", () => {
    const result = parseExperiments([{ title: "A" }, { title: "B" }]);
    expect(result?.[0]?.subjectId).toBe("experiment-0");
    expect(result?.[1]?.subjectId).toBe("experiment-1");
  });
});
