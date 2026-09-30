import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LaunchDirectorComponent } from "./index";

/**
 * What LaunchDirector does when its telemetry stops being current: the pad's
 * paperwork (craft, roster, scene, revert points, vessel roster, crash record)
 * is kept, since only events change it, and the funds balance is withheld
 * from the affordability verdict, since it is spent. The held balance stays on
 * screen, marked by its Unit, and must read differently from a short balance
 * and from a cold start.
 */

/** The funds readout's spoken staleness, which carries the grade and the instant it was read. */
function heldFundsCaption(): string | null {
  const readout = screen.queryByTitle(
    "Affordability is not judged against a held balance",
  );
  return readout?.querySelector("[data-unit-currency]")?.textContent ?? null;
}

const KERBAL_X = {
  name: "Kerbal X",
  partCount: 24,
  totalMass: 18.4,
  facility: "VAB",
  requiresFunds: 15_000,
  missingParts: [],
};

const JEB = {
  name: "Jebediah Kerman",
  trait: "Pilot",
  experienceLevel: 3,
  available: true,
  unavailableReason: "",
};

describe("LaunchDirector when its telemetry is held", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    stream = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  function renderWidget() {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ld-stale" }}>
          <LaunchDirectorComponent id="ld-stale" w={7} h={9} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  /** A career save at the Space Center with one affordable craft on the shelf. */
  function emitPreLaunch(): void {
    act(() => {
      stream.emit("spaceCenter.scene", {
        scene: "SpaceCenter",
        launchSite: "LaunchPad",
      });
      stream.emit("spaceCenter.launchSites", [
        {
          name: "LaunchPad",
          displayName: "KSC Launch Pad",
          editorFacility: "VAB",
          bodyIndex: 1,
          isStock: true,
          padOccupied: false,
          padVesselTitle: null,
        },
      ]);
      stream.emit("spaceCenter.savedShips", [KERBAL_X]);
      stream.emit("spaceCenter.crewRoster", [JEB]);
      stream.emit("career.status", {
        balances: { funds: 289_848, reputation: 0, science: 0 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });
  }

  /** A live flight with both revert points, one other vessel, no crash. */
  function emitInFlight(): void {
    act(() => {
      stream.emit("spaceCenter.scene", {
        scene: "Flight",
        launchSite: "LaunchPad",
      });
      stream.emit("spaceCenter.savedShips", []);
      stream.emit("spaceCenter.crewRoster", []);
      stream.emit("vessel.identity", {
        vesselId: "Mun Hopper I",
        name: "Mun Hopper I",
        vesselType: 0,
        situation: 0,
        parentBodyIndex: 1,
        launchUt: null,
      });
      stream.emit("ksp.revertAvailability", {
        canRevertToLaunch: true,
        canRevertToEditor: true,
      });
      stream.emit("crash.hasRecent", false);
      stream.emit("target.available", {
        entries: [
          {
            kind: 0,
            name: "Relay Sat A",
            vesselId: "vessel-guid-aaa",
            vesselType: 6,
            situation: 3,
            distance: 5000,
            isCurrent: false,
          },
        ],
      });
    });
  }

  function goStale(): void {
    act(() => {
      stream.store.setTransportConnected(false);
      stream.store.beginFrame();
    });
  }

  it("shows the balance and calls the craft launchable while the balance is current", async () => {
    // The control: without it the assertions below would pass on a widget that never affords anything.
    renderWidget();
    emitPreLaunch();

    await waitFor(() =>
      expect(screen.getByTitle("Available funds")).toBeTruthy(),
    );
    // The count belongs to the opened pad: what THIS pad can take.
    expect(screen.getByText(/Craft · 1\/1 ready/)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /Kerbal X/ })
        .getAttribute("aria-disabled"),
    ).toBe("false");
  });

  it("keeps the held balance on screen, marked by its Unit, and says affordability is not judged against it", async () => {
    renderWidget();
    emitPreLaunch();
    await waitFor(() =>
      expect(screen.getByTitle("Available funds")).toBeTruthy(),
    );

    goStale();

    await waitFor(() => expect(heldFundsCaption()).toMatch(/OFFLINE, as of /));
    expect(screen.queryByTitle("Available funds")).toBeNull();
  });

  it("does not present a withheld balance as an empty wallet the operator has never seen", async () => {
    // The held wording is its own sentence, distinct from a cold start's "funds unknown".
    const { container } = renderWidget();
    emitPreLaunch();
    await waitFor(() =>
      expect(screen.getByTitle("Available funds")).toBeTruthy(),
    );

    goStale();

    await waitFor(() => expect(heldFundsCaption()).not.toBeNull());
    expect(visibleText(container)).not.toContain("funds unknown");
    expect(screen.queryByTitle("No funds balance has arrived")).toBeNull();
  });

  it("says the balance is unknown, not out of date, before one has ever arrived", async () => {
    // A cold start is not a dropped link.
    const { container } = renderWidget();
    act(() => {
      stream.emit("spaceCenter.launchSites", [
        {
          name: "LaunchPad",
          displayName: "KSC Launch Pad",
          editorFacility: "VAB",
          bodyIndex: 1,
          isStock: true,
          padOccupied: false,
          padVesselTitle: null,
        },
      ]);
      stream.emit("spaceCenter.savedShips", [KERBAL_X]);
    });

    await waitFor(() => expect(screen.getByText("Kerbal X")).toBeTruthy());
    expect(visibleText(container)).toContain("funds unknown");
    expect(heldFundsCaption()).toBeNull();
  });

  it("suspends the affordability verdict with the balance, rather than spending against a held one", async () => {
    // The withheld balance is a judgement input, so the craft it priced stops being offered.
    renderWidget();
    emitPreLaunch();
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: /Kerbal X/ })
          .getAttribute("aria-disabled"),
      ).toBe("false"),
    );

    goStale();

    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: /Kerbal X/ })
          .getAttribute("aria-disabled"),
      ).toBe("true"),
    );
    expect(screen.getByText(/Craft · 0\/1 ready/)).toBeTruthy();
  });

  it("keeps the craft shelf and the crew roster, rather than falling back to a wait message", async () => {
    // A missing craft list would blank the whole body, so the paperwork is held.
    const { container } = renderWidget();
    emitPreLaunch();
    await waitFor(() => expect(screen.getByText("Kerbal X")).toBeTruthy());

    goStale();

    await waitFor(() => expect(heldFundsCaption()).not.toBeNull());
    expect(screen.getByText("Kerbal X")).toBeTruthy();
    expect(visibleText(container)).not.toContain(
      "Awaiting launch-pad telemetry",
    );
  });

  it("keeps the in-flight panel, its revert points and its vessel roster", async () => {
    // A withheld scene would swap a live flight's controls for the pre-launch picker.
    renderWidget();
    emitInFlight();
    await screen.findByText(/In flight: Mun Hopper I/i);

    goStale();

    expect(await screen.findByText(/In flight: Mun Hopper I/i)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^Revert to launch$/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /n\/a/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Switch to vessel/i }),
    ).not.toBeDisabled();
  });

  it("marks each vessel's range in the switch list as held, off the roster it came from", async () => {
    // The range is a figure on the roster, so a held roster draws it held rather than as a range of now.
    renderWidget();
    emitInFlight();
    await screen.findByText(/In flight: Mun Hopper I/i);
    act(() => {
      screen.getByRole("button", { name: /Switch to vessel/i }).click();
    });
    const range = () =>
      screen
        .getByRole("button", { name: /Relay Sat A/ })
        .querySelector("[data-held]");
    await screen.findByRole("button", { name: /Relay Sat A/ });
    expect(range()).toBeNull();

    goStale();

    await waitFor(() => expect(range()).not.toBeNull());
    expect(range()?.querySelector("[data-unit-currency]")?.textContent).toMatch(
      /OFFLINE, as of /,
    );
  });

  it("keeps recovery available rather than reviving the crash block it was given to fix", async () => {
    // The crash record scopes the session-wide flag to the active vessel, so it is held.
    renderWidget();
    emitInFlight();
    act(() => {
      stream.emit("crash.hasRecent", true);
      stream.emit("crash.lastCrash", {
        ut: 5,
        vesselName: "Some Debris",
        partCount: 1,
      });
    });
    await screen.findByText(/In flight: Mun Hopper I/i);
    const recover = () => screen.getByRole("button", { name: /^Recover$/ });
    await waitFor(() => expect(recover()).not.toBeDisabled());

    goStale();

    expect(recover()).not.toBeDisabled();
    expect(
      screen.queryByText(/Crash in progress: return to Space Center/),
    ).toBeNull();
  });
});
