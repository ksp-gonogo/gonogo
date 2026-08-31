import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { renderWidgetMode } from "../test/widgetDomSnapshot";
import allAvailable from "./__fixtures__/crew-all-available.json";
import mixedStandings from "./__fixtures__/crew-mixed-standings.json";
import rosterUnread from "./__fixtures__/crew-roster-unread.json";
import {
  type CrewMember,
  crewReading,
  crewTally,
  LaunchDirectorComponent,
  parseCrew,
} from "./index";

/**
 * The crew half of the pad panel: which kerbals are offered, what is said about
 * the ones that are not, and what the panel does when the roster cannot be read
 * at all.
 *
 * Kept apart from `index.test.tsx` because the three availability states are one
 * subject, and each of them needs its own roster.
 */
const CARRIED = [
  "career.status",
  "spaceCenter.savedShips",
  "spaceCenter.crewRoster",
  "spaceCenter.scene",
  "spaceCenter.launchSites",
];

const PAD = {
  name: "LaunchPad",
  displayName: "KSC Pad",
  editorFacility: "VAB",
  body: "Kerbin",
  isStock: true,
  padOccupied: null,
  padVesselTitle: null,
};

const SHIP = {
  name: "Probe",
  partCount: 4,
  totalMass: 0.5,
  facility: "VAB",
  facilityOrdinal: 1,
  requiresFunds: 500,
  missingParts: [],
};

/** One roster row in the wire's own shape; overrides carry the state under test. */
function kerbal(
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    trait: "Pilot",
    experienceLevel: 3,
    available: true,
    unavailableReason: "",
    standing: 2,
    situation: "Available",
    ...overrides,
  };
}

describe("LaunchDirector crew selection", () => {
  let cmdFixture: MockDataSourceFixture;
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(async () => {
    cmdFixture = await setupMockDataSource({ keys: [] });
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    teardownMockDataSource(cmdFixture);
  });

  /**
   * Rendered TALL by default, because the crew grid stands open above
   * `CREW_GRID_MIN_ROWS` and folds behind its tally below it: a test about what
   * the chips say has to be given a tile the chips fit in. The fold itself is
   * the subject of its own tests further down, which pass a short `h`.
   */
  function renderWidget(id = "ld", h = 18) {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: id }}>
          <LaunchDirectorComponent id={id} h={h} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  /** Everything but the roster, so each test owns the availability it asserts. */
  function emitPadAndShip() {
    act(() => {
      stream.emit("career.status", {
        economy: { funds: 100_000, reputation: 0, science: 0 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
      stream.emit("spaceCenter.launchSites", [PAD]);
      stream.emit("spaceCenter.savedShips", [SHIP]);
    });
  }

  it("offers the launch when the roster has not been read", async () => {
    const user = userEvent.setup();
    renderWidget();
    emitPadAndShip();

    await user.click(await screen.findByText("Probe"));

    expect(screen.getByText(/Launch Probe unmanned/i)).toBeInTheDocument();
    expect(screen.getByText("Roster: no reading")).toBeInTheDocument();
  });

  it("lists the whole roster and puts each reason on screen, not in a tooltip", async () => {
    const user = userEvent.setup();
    renderWidget();
    emitPadAndShip();
    act(() => {
      stream.emit("spaceCenter.crewRoster", [
        kerbal("Jeb"),
        kerbal("Val", {
          available: false,
          unavailableReason: "On mission",
          standing: 3,
          situation: "Assigned",
        }),
        kerbal("Bob", {
          available: false,
          unavailableReason: "In training",
          standing: 4,
          situation: "Training",
        }),
      ]);
    });

    await user.click(await screen.findByText("Probe"));

    // Everyone is offered, including the two who cannot fly.
    expect(screen.getByText("Jeb")).toBeInTheDocument();
    expect(screen.getByText("Val")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    // The reason is rendered text, so it survives a device with no hover.
    expect(screen.getByText("On mission")).toBeInTheDocument();
    expect(screen.getByText("In training")).toBeInTheDocument();
    expect(screen.getByText(/Crew \(3\) · 2 unavailable/)).toBeInTheDocument();
  });

  it("says nothing could be read for a kerbal whose standing is Unknown", async () => {
    const user = userEvent.setup();
    renderWidget();
    emitPadAndShip();
    act(() => {
      // Standing Unknown: unavailable, and the reason is EMPTY by contract.
      stream.emit("spaceCenter.crewRoster", [
        kerbal("Dodrey", {
          available: false,
          unavailableReason: "",
          standing: 0,
          situation: "Unknown",
        }),
      ]);
    });

    await user.click(await screen.findByText("Probe"));

    expect(screen.getByText("no reading")).toBeInTheDocument();
    expect(screen.getByText(/Crew \(1\) · 1 no reading/)).toBeInTheDocument();
    // Not selectable, and it does not pass for a kerbal on a mission either.
    await user.click(screen.getByText("Dodrey"));
    expect(screen.getByText(/Launch Probe unmanned/i)).toBeInTheDocument();
    expect(screen.queryByText("On mission")).toBeNull();
  });

  it("counts the roster and nothing else when everyone can fly", async () => {
    const user = userEvent.setup();
    renderWidget();
    emitPadAndShip();
    act(() => {
      stream.emit("spaceCenter.crewRoster", [kerbal("Jeb"), kerbal("Bill")]);
    });

    await user.click(await screen.findByText("Probe"));

    expect(screen.getByText("Crew (2)")).toBeInTheDocument();
    expect(screen.queryByText(/no reading/)).toBeNull();
    expect(screen.queryByText(/unavailable/)).toBeNull();
  });

  it("drops a selected kerbal from the manifest once the roster stops calling them available", async () => {
    const user = userEvent.setup();
    renderWidget();
    emitPadAndShip();
    act(() => {
      stream.emit("spaceCenter.crewRoster", [kerbal("Jeb")]);
    });

    await user.click(await screen.findByText("Probe"));
    await user.click(screen.getByText("Jeb"));
    expect(screen.getByText(/Launch Probe \(1 crew\)/)).toBeInTheDocument();

    // Jeb is assigned to something else while the selection stands. The launch
    // must stop counting him: the mod's own AssignCrew skips a name it cannot
    // seat without refusing, so a stale count would fly one kerbal short.
    act(() => {
      stream.emit("spaceCenter.crewRoster", [
        kerbal("Jeb", {
          available: false,
          unavailableReason: "On mission",
          standing: 3,
          situation: "Assigned",
        }),
      ]);
    });

    expect(screen.getByText(/Launch Probe unmanned/i)).toBeInTheDocument();
  });

  /**
   * A tile too short for the grid folds it behind the tally instead of pushing
   * it, and the launch control with it, past the panel's fold. What the fold
   * must not cost is the two things the section is FOR: knowing the roster's
   * shape, and knowing who is already aboard.
   */
  describe("on a tile too short for the grid", () => {
    it("folds the grid behind the tally and keeps the launch control on screen", async () => {
      const user = userEvent.setup();
      renderWidget("ld", 10);
      emitPadAndShip();
      act(() => {
        stream.emit("spaceCenter.crewRoster", [
          kerbal("Jeb"),
          kerbal("Val", {
            available: false,
            unavailableReason: "On mission",
            standing: 3,
            situation: "Assigned",
          }),
        ]);
      });

      await user.click(await screen.findByText("Probe"));

      // The tally survives, so the roster is still accounted for.
      expect(screen.getByText("Crew (2) · 1 unavailable")).toBeInTheDocument();
      // The grid does not, and the control that launches is what the room goes to.
      expect(screen.queryByText("Jeb")).toBeNull();
      expect(screen.getByText(/Launch Probe unmanned/i)).toBeInTheDocument();

      // Folded is a starting position, not a lock.
      await user.click(screen.getByRole("button", { name: /Crew \(2\)/ }));
      expect(screen.getByText("Jeb")).toBeInTheDocument();
      expect(screen.getByText("On mission")).toBeInTheDocument();
    });

    it("counts a selection in the tally, so folding the grid never hides who is aboard", async () => {
      const user = userEvent.setup();
      renderWidget("ld", 10);
      emitPadAndShip();
      act(() => {
        stream.emit("spaceCenter.crewRoster", [kerbal("Jeb"), kerbal("Bill")]);
      });

      await user.click(await screen.findByText("Probe"));
      await user.click(screen.getByRole("button", { name: /Crew \(2\)/ }));
      await user.click(screen.getByText("Jeb"));
      // Fold it back with the selection standing.
      await user.click(screen.getByRole("button", { name: /Crew \(2\)/ }));

      expect(screen.queryByText("Jeb")).toBeNull();
      expect(screen.getByText("Crew (2) · 1 selected")).toBeInTheDocument();
      expect(screen.getByText(/Launch Probe \(1 crew\)/)).toBeInTheDocument();
    });

    it("offers no expander when the roster itself could not be read", async () => {
      const user = userEvent.setup();
      renderWidget("ld", 10);
      emitPadAndShip();

      await user.click(await screen.findByText("Probe"));

      // Nothing to fold: the absence is stated where the tally would be.
      expect(screen.getByText("Roster: no reading")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Crew/ })).toBeNull();
    });
  });
});

describe("LaunchDirector crew render scenes", () => {
  const MODE = { name: "crew-7x18", w: 7, h: 18 };

  /** Mounts a fixture and opens the craft row, which is what reveals the crew grid. */
  async function openCraft(fixture: Record<string, unknown>) {
    const rendered = await renderWidgetMode({
      Widget: LaunchDirectorComponent,
      fixture,
      mode: MODE,
    });
    const row = rendered.container.querySelector("[data-ship-row]");
    if (!row) throw new Error("fixture rendered no craft row to open");
    await act(async () => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    return rendered;
  }

  it("crew-mixed-standings renders every state the chips can be in", async () => {
    const rendered = await openCraft(mixedStandings);
    const text = rendered.container.textContent ?? "";

    expect(text).toContain("Crew (7) · 4 unavailable · 1 no reading");
    expect(text).toContain("On mission");
    expect(text).toContain("In training");
    expect(text).toContain("Standing down");
    expect(text).toContain("Retired");
    expect(text).toContain("no reading");
    // The chips are the interactive surface here: real buttons carrying
    // aria-pressed for the selection and aria-disabled for the rest.
    await expectNoA11yViolations(rendered.container);
    rendered.teardown();
  });

  it("crew-all-available renders a bare count", async () => {
    const rendered = await openCraft(allAvailable);
    const text = rendered.container.textContent ?? "";

    expect(text).toContain("Crew (2)");
    expect(text).not.toContain("unavailable");
    expect(text).not.toContain("no reading");
    rendered.teardown();
  });

  it("crew-roster-unread renders the absence and keeps the launch", async () => {
    const rendered = await openCraft(rosterUnread);
    const text = rendered.container.textContent ?? "";

    expect(text).toContain("Roster: no reading");
    expect(text).toContain("unmanned");
    rendered.teardown();
  });
});

describe("crewReading", () => {
  function member(overrides: Partial<CrewMember> = {}): CrewMember {
    return {
      name: "Jeb",
      trait: "Pilot",
      experienceLevel: 3,
      available: true,
      unavailableReason: "",
      ...overrides,
    };
  }

  it("carries an absent availability as null rather than folding it to false", () => {
    const parsed = parseCrew([{ name: "Jeb", trait: "Pilot" }]);
    expect(parsed?.[0]?.available).toBeNull();
    expect(crewReading(member({ available: null }))).toBe("unread");
  });

  it("separates unavailable-with-a-reason from unavailable-with-none", () => {
    expect(
      crewReading(
        member({ available: false, unavailableReason: "On mission" }),
      ),
    ).toBe("unavailable");
    expect(
      crewReading(member({ available: false, unavailableReason: "" })),
    ).toBe("unread");
  });

  it("prints only the terms that are not zero", () => {
    expect(crewTally([member(), member({ name: "Bill" })])).toBe(" (2)");
    expect(
      crewTally([
        member(),
        member({
          name: "Val",
          available: false,
          unavailableReason: "On mission",
        }),
        member({ name: "Dodrey", available: false }),
      ]),
    ).toBe(" (3) · 1 unavailable · 1 no reading");
  });
});
