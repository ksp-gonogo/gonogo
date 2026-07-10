import type { DataKey, MockDataSource } from "@gonogo/core";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import {
  parseInstruments,
  ScienceOfficerComponent,
  sumExperimentDataAmount,
} from "./index";

const KEYS: DataKey[] = [{ key: "sci.instruments" }];

describe("ScienceOfficerComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  it("shows the awaiting placeholder before any telemetry arrives", () => {
    render(<ScienceOfficerComponent config={{}} id="sci-off" />);
    expect(
      screen.getByText(/Awaiting instrument telemetry/i),
    ).toBeInTheDocument();
  });

  it("renders 'No instruments' for an empty array", () => {
    render(<ScienceOfficerComponent config={{}} id="sci-off" />);
    act(() => {
      source.emit("sci.instruments", []);
    });
    expect(screen.getByText(/No instruments aboard/i)).toBeInTheDocument();
  });

  it("groups instruments by expId and shows badges", () => {
    render(<ScienceOfficerComponent config={{}} id="sci-off" />);
    act(() => {
      source.emit("sci.instruments", [
        {
          partId: 1,
          partTitle: "Mystery Goo",
          expId: "mysteryGoo",
          deployed: true,
          hasData: true,
          rerunnable: false,
          inoperable: false,
        },
        {
          partId: 2,
          partTitle: "Mystery Goo",
          expId: "mysteryGoo",
          deployed: false,
          hasData: false,
          rerunnable: false,
          inoperable: true,
        },
        {
          partId: 3,
          partTitle: "Thermometer",
          expId: "temperatureScan",
          deployed: false,
          hasData: false,
          rerunnable: true,
          inoperable: false,
        },
      ]);
    });

    // Group labels
    expect(screen.getByText("mysteryGoo")).toBeInTheDocument();
    expect(screen.getByText("temperatureScan")).toBeInTheDocument();

    // Badges
    expect(screen.getByText("DATA")).toBeInTheDocument();
    expect(screen.getByText("INOPERABLE")).toBeInTheDocument();

    // Subtitle summary: 1/3 with data, 1 deployed, 1 inoperable
    expect(
      screen.getByText(/1\/3 with data · 1 deployed · 1 inoperable/i),
    ).toBeInTheDocument();
  });

  it("derives the total data readout from sci.experiments (D3, P4a)", () => {
    render(<ScienceOfficerComponent config={{}} id="sci-off" />);
    act(() => {
      source.emit("sci.instruments", [
        {
          partId: 1,
          partTitle: "Mystery Goo",
          expId: "mysteryGoo",
          deployed: true,
          hasData: true,
          rerunnable: false,
          inoperable: false,
        },
      ]);
      source.emit("sci.experiments", [
        { subjectId: "a", dataAmount: 5 },
        { subjectId: "b", dataAmount: 7.5 },
      ]);
    });
    expect(screen.getByText(/12\.5 mits/i)).toBeInTheDocument();
  });

  it("fires sci.deploy when Deploy is clicked on an undeployed instrument", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<ScienceOfficerComponent config={{}} id="sci-off" />);
    act(() => {
      source.emit("sci.instruments", [
        {
          partId: 42,
          partTitle: "Mystery Goo",
          expId: "mysteryGoo",
          deployed: false,
          hasData: false,
          rerunnable: true,
          inoperable: false,
        },
      ]);
    });

    await user.click(screen.getByText("Deploy"));
    expect(onExecute).toHaveBeenCalledWith("sci.deploy[42]");
  });

  it("requires arm-then-confirm before transmitting an instrument's data", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<ScienceOfficerComponent config={{}} id="sci-off" />);
    act(() => {
      source.emit("sci.instruments", [
        {
          partId: 99,
          partTitle: "Thermometer",
          expId: "temperatureScan",
          deployed: true,
          hasData: true,
          rerunnable: true,
          inoperable: false,
        },
      ]);
    });

    await user.click(screen.getByText("Transmit"));
    expect(onExecute).not.toHaveBeenCalled();

    await user.click(screen.getByText(/Confirm transmit/i));
    expect(onExecute).toHaveBeenCalledWith("sci.transmit[99]");
  });

  it("hides controls for an inoperable instrument", () => {
    render(<ScienceOfficerComponent config={{}} id="sci-off" />);
    act(() => {
      source.emit("sci.instruments", [
        {
          partId: 1,
          partTitle: "Burned Sensor",
          expId: "x",
          deployed: false,
          hasData: false,
          rerunnable: false,
          inoperable: true,
        },
      ]);
    });
    expect(screen.queryByText("Deploy")).not.toBeInTheDocument();
    expect(screen.queryByText("Transmit")).not.toBeInTheDocument();
  });
});

describe("parseInstruments", () => {
  it("returns null for non-array input", () => {
    expect(parseInstruments(null)).toBeNull();
    expect(parseInstruments(undefined)).toBeNull();
    expect(parseInstruments({})).toBeNull();
  });

  it("drops malformed entries and coerces booleans", () => {
    const parsed = parseInstruments([
      {
        partId: 1,
        partTitle: "Goo",
        expId: "mysteryGoo",
        deployed: true,
        hasData: false,
        rerunnable: false,
        inoperable: false,
      },
      // missing partId
      { partTitle: "Bad" },
      // missing partTitle (should fall back, not drop)
      {
        partId: 2,
        expId: "temp",
        deployed: false,
        hasData: false,
        rerunnable: true,
        inoperable: false,
      },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed?.[1].partTitle).toBe("Unknown part");
  });
});

describe("sumExperimentDataAmount", () => {
  it("returns 0 for non-array input", () => {
    expect(sumExperimentDataAmount(null)).toBe(0);
    expect(sumExperimentDataAmount(undefined)).toBe(0);
    expect(sumExperimentDataAmount({})).toBe(0);
  });

  it("sums dataAmount across every entry", () => {
    expect(
      sumExperimentDataAmount([
        { subjectId: "a", dataAmount: 5 },
        { subjectId: "b", dataAmount: 8 },
      ]),
    ).toBe(13);
  });

  it("skips entries with a missing/non-numeric dataAmount", () => {
    expect(
      sumExperimentDataAmount([
        { subjectId: "a", dataAmount: 5 },
        { subjectId: "b" },
        { subjectId: "c", dataAmount: "not a number" },
      ]),
    ).toBe(5);
  });
});
