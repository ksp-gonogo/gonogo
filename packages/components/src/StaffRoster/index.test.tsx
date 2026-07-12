import type { DataKey, MockDataSource } from "@ksp-gonogo/core";
import { registerAugment } from "@ksp-gonogo/core";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import {
  parseStaff,
  type StaffBadgeContext,
  StaffRosterComponent,
} from "./index";

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

  it("renders the per-kerbal badges slot with no bound augment (empty is fine)", () => {
    // No augment registered → the slot composes nothing and the roster renders
    // exactly as before, one row per kerbal.
    render(<StaffRosterComponent config={{}} id="sr" />);
    act(() => {
      source.emit("kc.crewRoster", [
        {
          name: "Jeb Kerman",
          trait: "Pilot",
          experienceLevel: 5,
          available: true,
          unavailableReason: "",
        },
        {
          name: "Bob Kerman",
          trait: "Scientist",
          experienceLevel: 3,
          available: true,
          unavailableReason: "",
        },
      ]);
    });
    expect(screen.getByText("Jeb Kerman")).toBeInTheDocument();
    expect(screen.getByText("Bob Kerman")).toBeInTheDocument();
    expect(screen.queryByTestId("staff-badge")).not.toBeInTheDocument();
  });

  it("renders a bound augment once per roster row, carrying each kerbal's identity", () => {
    // A test Uplink binds `staff-roster.badges` and echoes the slot props back.
    // Proves (a) the slot is exposed, (b) an augment composes into it, and (c)
    // the per-row props carry the right kerbal so the badge lands on the right
    // one. `requires` is omitted so no Domain presence gate applies.
    registerAugment<"staff-roster.badges">({
      id: "test-staff-badge",
      augments: "staff-roster.badges",
      component: ({ staffName, staffIndex }: StaffBadgeContext) => (
        <span data-testid="staff-badge" data-index={staffIndex}>
          {staffName} ✓
        </span>
      ),
    });

    render(<StaffRosterComponent config={{}} id="sr" />);
    act(() => {
      source.emit("kc.crewRoster", [
        {
          name: "Jeb Kerman",
          trait: "Pilot",
          experienceLevel: 5,
          available: true,
          unavailableReason: "",
        },
        {
          name: "Bob Kerman",
          trait: "Scientist",
          experienceLevel: 3,
          available: true,
          unavailableReason: "",
        },
      ]);
    });

    // Sorted order: Jeb (Pilot) then Bob (Scientist) — one badge per row.
    const badges = screen.getAllByTestId("staff-badge");
    expect(badges).toHaveLength(2);
    expect(badges.map((b) => b.textContent)).toEqual([
      "Jeb Kerman ✓",
      "Bob Kerman ✓",
    ]);
    // Each badge sits inside its own kerbal's row (props identity is correct).
    const jebRow = screen.getByText("Jeb Kerman").closest("li");
    expect(jebRow).not.toBeNull();
    expect(
      within(jebRow as HTMLElement).getByTestId("staff-badge"),
    ).toHaveTextContent("Jeb Kerman ✓");
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
