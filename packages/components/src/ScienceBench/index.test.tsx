import type { DataKey, MockDataSource } from "@ksp-gonogo/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import {
  parseExperimentBreakdown,
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
  { key: "science.sensors" },
  { key: "sci.experiments" },
  { key: "sci.experimentBreakdown" },
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
      // A vessel with several thermometers of the same part comes through as
      // multiple science.sensors entries. Collapse entries that share a
      // partName, but leave physically distinct parts on separate rows.
      source.emit("science.sensors", [
        {
          partId: "1",
          partName: "solidBooster.sm.v2",
          type: "TEMP",
          readout: "313.43K",
          active: true,
        },
        {
          partId: "2",
          partName: "solidBooster.sm.v2",
          type: "TEMP",
          readout: "313.43K",
          active: true,
        },
        {
          partId: "3",
          partName: "solidBooster.sm.v2",
          type: "TEMP",
          readout: "313.43K",
          active: true,
        },
        {
          partId: "4",
          partName: "noseConeBasic",
          type: "TEMP",
          readout: "290.0K",
          active: true,
        },
      ]);
    });
    const boosterRows = screen.getAllByText("solidBooster.sm.v2");
    expect(boosterRows).toHaveLength(1);
    expect(screen.getByText(/313\.43 K/)).toBeInTheDocument();
    expect(screen.getByText("noseConeBasic")).toBeInTheDocument();
    expect(screen.getByText(/290\.00 K/)).toBeInTheDocument();
  });

  it("renders per-type sensors filtered out of the whole science.sensors list, dropping disabled readouts", () => {
    render(<ScienceBenchComponent config={{}} id="sci" />);
    act(() => {
      source.emit("science.sensors", [
        {
          partId: "1",
          partName: "2HOT Thermometer",
          type: "TEMP",
          readout: "293.1K",
          active: true,
        },
        {
          partId: "2",
          partName: "PresMat Barometer",
          type: "PRES",
          readout: "101.3kPa",
          active: true,
        },
        {
          partId: "3",
          partName: "Disabled Thermometer",
          type: "TEMP",
          readout: "Off",
          active: false,
        },
      ]);
    });
    expect(screen.getByText("2HOT Thermometer")).toBeInTheDocument();
    expect(screen.getByText(/293\.10 K/)).toBeInTheDocument();
    expect(screen.getByText("PresMat Barometer")).toBeInTheDocument();
    expect(screen.getByText(/101\.30 kPa/)).toBeInTheDocument();
    expect(screen.queryByText("Disabled Thermometer")).not.toBeInTheDocument();
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
    });
    expect(screen.getByText(/Mystery Goo Observation/i)).toBeInTheDocument();
    expect(screen.getByText("5.5 mits")).toBeInTheDocument();
  });

  it("derives the Aboard record count/total mits from sci.experiments (D3, P4a)", () => {
    render(<ScienceBenchComponent config={{}} id="sci" />);
    act(() => {
      source.emit("sci.experiments", [
        { title: "Crew Report", dataAmount: 5, subjectId: "a" },
        { title: "Temperature Scan", dataAmount: 8, subjectId: "b" },
      ]);
    });
    expect(screen.getByText(/2 records/i)).toBeInTheDocument();
    expect(screen.getByText(/13\.0 mits/i)).toBeInTheDocument();
  });

  it("renders the breakdown view when sci.experimentBreakdown is present", () => {
    render(<ScienceBenchComponent config={{}} id="sci" />);
    act(() => {
      source.emit("sci.experimentBreakdown", [
        {
          subjectId: "crewReport@KerbinSrfLandedKSC",
          biome: "KSC",
          situation: "SrfLanded",
          expTitle: "Crew Report from KSC",
          dataMits: 5,
          remainingPotential: 1.5,
        },
        {
          subjectId: "mysteryGoo@KerbinFlyingLowGrasslands",
          biome: "Grasslands",
          situation: "FlyingLow",
          expTitle: "Mystery Goo over Grasslands",
          dataMits: 3,
          remainingPotential: 7.5,
        },
      ]);
    });
    // Sorted by remainingPotential desc — Mystery Goo (7.5) above Crew Report (1.5)
    const subjects = screen.getAllByText(
      /Mystery Goo over Grasslands|Crew Report from KSC/,
    );
    expect(subjects[0].textContent).toMatch(/Mystery Goo/);
    expect(subjects[1].textContent).toMatch(/Crew Report/);
    expect(screen.getByText(/7\.5 left/i)).toBeInTheDocument();
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

  it("parses the leading numeric value out of science.sensors' readout string (D2, P4a)", () => {
    expect(
      parseSensorReadings([
        { partId: "1", partName: "2HOT Thermometer", readout: "293.1K" },
      ]),
    ).toEqual([{ partName: "2HOT Thermometer", value: 293.1 }]);
  });

  it("drops a non-numeric readout (disabled sensor) instead of throwing", () => {
    expect(
      parseSensorReadings([
        { partId: "1", partName: "2HOT Thermometer", readout: "Off" },
      ]),
    ).toBe("no sensors");
  });

  it("prefers a numeric value field over readout when both are present", () => {
    expect(
      parseSensorReadings([{ partName: "A", value: 42, readout: "999K" }]),
    ).toEqual([{ partName: "A", value: 42 }]);
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

describe("parseExperimentBreakdown", () => {
  it("returns null for non-array input", () => {
    expect(parseExperimentBreakdown(null)).toBeNull();
    expect(parseExperimentBreakdown(undefined)).toBeNull();
    expect(parseExperimentBreakdown({})).toBeNull();
  });

  it("sorts entries by remainingPotential desc", () => {
    const parsed = parseExperimentBreakdown([
      {
        subjectId: "a",
        expTitle: "A",
        dataMits: 1,
        remainingPotential: 1,
      },
      {
        subjectId: "b",
        expTitle: "B",
        dataMits: 1,
        remainingPotential: 5,
      },
      {
        subjectId: "c",
        expTitle: "C",
        dataMits: 1,
        remainingPotential: 3,
      },
    ]);
    expect(parsed?.map((p) => p.subjectId)).toEqual(["b", "c", "a"]);
  });

  it("falls back to safe defaults for missing fields", () => {
    const parsed = parseExperimentBreakdown([
      {
        subjectId: "x",
        // missing expTitle, dataMits, remainingPotential, biome, situation
      },
    ]);
    expect(parsed?.[0]).toEqual({
      subjectId: "x",
      biome: "",
      situation: "",
      expTitle: "(unnamed)",
      dataMits: 0,
      remainingPotential: 0,
    });
  });
});
