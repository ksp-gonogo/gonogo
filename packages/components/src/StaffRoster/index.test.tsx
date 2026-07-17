import { registerAugment } from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import {
  parseStaff,
  type StaffBadgeContext,
  StaffRosterComponent,
} from "./index";

// StaffRoster reads `kc.crewRoster` -> `spaceCenter.crewRoster` (map-topic.ts),
// a whole-topic bare-array read, so these run off the real stream pipeline.
describe("StaffRosterComponent", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({
      carriedChannels: ["spaceCenter.crewRoster"],
      pinnedUt: 10,
    });
  });

  it("shows the awaiting placeholder before any telemetry", () => {
    render(
      <fixture.Provider>
        <StaffRosterComponent config={{}} id="sr" />
      </fixture.Provider>,
    );
    expect(screen.getByText(/Awaiting roster telemetry/i)).toBeInTheDocument();
  });

  it("shows empty-state copy when roster is empty", async () => {
    render(
      <fixture.Provider>
        <StaffRosterComponent config={{}} id="sr" />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("spaceCenter.crewRoster", []);
    });
    await waitFor(() =>
      expect(screen.getByText(/Roster empty/i)).toBeInTheDocument(),
    );
  });

  it("sorts available kerbals first then by trait + experience", async () => {
    render(
      <fixture.Provider>
        <StaffRosterComponent config={{}} id="sr" />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("spaceCenter.crewRoster", [
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
    await waitFor(() =>
      expect(screen.getByText(/2\/3 available/i)).toBeInTheDocument(),
    );

    // Render order: Jeb (Pilot, available) → Bob (Scientist, available) → Bill (Engineer, unavail)
    const names = screen.getAllByText(/Kerman/i).map((n) => n.textContent);
    expect(names).toEqual(["Jeb Kerman", "Bob Kerman", "Bill Kerman"]);
  });

  it("shows the unavailable reason on greyed rows", async () => {
    render(
      <fixture.Provider>
        <StaffRosterComponent config={{}} id="sr" />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("spaceCenter.crewRoster", [
        {
          name: "Val Kerman",
          trait: "Pilot",
          experienceLevel: 4,
          available: false,
          unavailableReason: "Assigned",
        },
      ]);
    });
    await waitFor(() =>
      expect(screen.getByText(/Assigned/)).toBeInTheDocument(),
    );
  });

  it("renders the per-kerbal badges slot with no bound augment (empty is fine)", async () => {
    // No augment registered → the slot composes nothing and the roster renders
    // exactly as before, one row per kerbal.
    render(
      <fixture.Provider>
        <StaffRosterComponent config={{}} id="sr" />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("spaceCenter.crewRoster", [
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
    await waitFor(() =>
      expect(screen.getByText("Jeb Kerman")).toBeInTheDocument(),
    );
    expect(screen.getByText("Bob Kerman")).toBeInTheDocument();
    expect(screen.queryByTestId("staff-badge")).not.toBeInTheDocument();
  });

  it("renders a bound augment once per roster row, carrying each kerbal's identity", async () => {
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

    render(
      <fixture.Provider>
        <StaffRosterComponent config={{}} id="sr" />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("spaceCenter.crewRoster", [
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
    const badges = await screen.findAllByTestId("staff-badge");
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
