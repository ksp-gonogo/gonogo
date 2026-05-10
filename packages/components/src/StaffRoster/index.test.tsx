import type { DataKey, MockDataSource } from "@gonogo/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { parseStaff, StaffRosterComponent } from "./index";

const KEYS: DataKey[] = [{ key: "kc.crewRoster" }];

describe("StaffRosterComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  it("shows the awaiting placeholder before any telemetry", () => {
    render(<StaffRosterComponent config={{}} id="sr" />);
    expect(screen.getByText(/Awaiting roster telemetry/i)).toBeInTheDocument();
  });

  it("shows empty-state copy when roster is empty", () => {
    render(<StaffRosterComponent config={{}} id="sr" />);
    act(() => {
      source.emit("kc.crewRoster", []);
    });
    expect(screen.getByText(/Roster empty/i)).toBeInTheDocument();
  });

  it("sorts available kerbals first then by trait + experience", () => {
    render(<StaffRosterComponent config={{}} id="sr" />);
    act(() => {
      source.emit("kc.crewRoster", [
        // Unavailable Pilot — should sort below all available kerbals.
        {
          name: "Bill Kerman",
          trait: "Engineer",
          experienceLevel: 4,
          available: false,
          unavailableReason: "Hospitalized",
        },
        {
          name: "Bob Kerman",
          trait: "Scientist",
          experienceLevel: 3,
          available: true,
          unavailableReason: "",
        },
        {
          name: "Jeb Kerman",
          trait: "Pilot",
          experienceLevel: 5,
          available: true,
          unavailableReason: "",
        },
      ]);
    });

    // Subtitle: 2/3 available
    expect(screen.getByText(/2\/3 available/i)).toBeInTheDocument();

    // Render order: Jeb (Pilot, available) → Bob (Scientist, available) → Bill (Engineer, unavail)
    const names = screen.getAllByText(/Kerman/i).map((n) => n.textContent);
    expect(names).toEqual(["Jeb Kerman", "Bob Kerman", "Bill Kerman"]);
  });

  it("shows the unavailable reason on greyed rows", () => {
    render(<StaffRosterComponent config={{}} id="sr" />);
    act(() => {
      source.emit("kc.crewRoster", [
        {
          name: "Val Kerman",
          trait: "Pilot",
          experienceLevel: 4,
          available: false,
          unavailableReason: "Assigned",
        },
      ]);
    });
    expect(screen.getByText(/Assigned/)).toBeInTheDocument();
  });
});

describe("parseStaff", () => {
  it("returns null for non-array input", () => {
    expect(parseStaff(null)).toBeNull();
    expect(parseStaff({})).toBeNull();
  });

  it("drops entries missing a name", () => {
    const parsed = parseStaff([
      { name: "ok", trait: "Pilot" },
      { trait: "missing name" },
    ]);
    expect(parsed).toHaveLength(1);
  });

  it("preserves availability + reason on each entry", () => {
    const parsed = parseStaff([
      {
        name: "x",
        trait: "Engineer",
        experienceLevel: 2,
        available: false,
        unavailableReason: "Dead",
      },
    ]);
    expect(parsed?.[0]).toEqual({
      name: "x",
      trait: "Engineer",
      experienceLevel: 2,
      available: false,
      unavailableReason: "Dead",
      veteran: false,
      isBadass: false,
      careerFlights: 0,
      courage: 0,
      stupidity: 0,
      currentVesselName: "",
    });
  });

  it("parses expanded fields when present", () => {
    const parsed = parseStaff([
      {
        name: "Jeb",
        trait: "Pilot",
        experienceLevel: 3,
        available: true,
        unavailableReason: "",
        veteran: true,
        isBadass: true,
        careerFlights: 4,
        courage: 0.5,
        stupidity: 0.5,
        currentVesselName: "Mun Lander",
      },
    ]);
    expect(parsed?.[0]).toMatchObject({
      veteran: true,
      isBadass: true,
      careerFlights: 4,
      courage: 0.5,
      stupidity: 0.5,
      currentVesselName: "Mun Lander",
    });
  });

  it("defaults expanded fields when older Telemachus DLL is loaded", () => {
    // Old DLL doesn't emit veteran/isBadass/careerFlights/etc.
    const parsed = parseStaff([
      { name: "Jeb", trait: "Pilot", experienceLevel: 0, available: true },
    ]);
    expect(parsed?.[0]).toMatchObject({
      veteran: false,
      isBadass: false,
      careerFlights: 0,
      courage: 0,
      stupidity: 0,
      currentVesselName: "",
    });
  });
});
