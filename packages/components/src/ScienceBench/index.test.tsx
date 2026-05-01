import type { DataKey } from "@gonogo/core";
import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    source = new MockDataSource({ keys: KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    cleanup();
    buffered.disconnect();
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

  it("renders sensor readings parsed from an array shape", () => {
    render(<ScienceBenchComponent config={{}} id="sci" />);
    act(() => {
      source.emit("s.sensor.temp", [
        { partName: "Thermometer A", value: 312.4 },
        { partName: "Thermometer B", value: 295.1 },
      ]);
    });
    expect(screen.getByText("Thermometer A")).toBeInTheDocument();
    expect(screen.getByText(/312\.40 K/)).toBeInTheDocument();
    expect(screen.getByText("Thermometer B")).toBeInTheDocument();
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

  it("falls back to a raw string for unrecognised shapes", () => {
    const result = parseSensorReadings({ unknown: "shape" });
    expect(typeof result).toBe("string");
  });
});

describe("parseExperiments", () => {
  it("returns null for nullish input", () => {
    expect(parseExperiments(null)).toBeNull();
    expect(parseExperiments(undefined)).toBeNull();
  });

  it("parses arrays of {subject, data}", () => {
    expect(
      parseExperiments([
        { subject: "Crew Report from Kerbin", data: 1.0 },
        { subject: "Mystery Goo from Mun", data: 4.5 },
      ]),
    ).toEqual([
      { subject: "Crew Report from Kerbin", data: 1.0 },
      { subject: "Mystery Goo from Mun", data: 4.5 },
    ]);
  });

  it("parses object maps keyed by subject", () => {
    expect(parseExperiments({ "Crew Report from Mun": { data: 5 } })).toEqual([
      { subject: "Crew Report from Mun", data: 5 },
    ]);
  });

  it("falls back to (unnamed) when subject is missing", () => {
    const result = parseExperiments([{ data: 3 }]);
    expect(result?.[0]?.subject).toBe("(unnamed)");
  });
});
