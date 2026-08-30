import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LaunchDirectorComponent } from "./index";

/**
 * What LaunchDirector does when its telemetry stops being current.
 *
 * The decision, one field at a time: the pad's paperwork is kept and the funds
 * balance is withheld. Craft files, the crew roster, the scene, the revert
 * points, the vessel roster and the crash record all change on events, and an
 * event cannot reach us down a link that is not delivering, so the last set
 * received is still the answer. The balance is the exception: it is spent, not
 * read. Contracts pay out and facilities bill while nobody is looking, so a held
 * balance is not evidence of what this save can afford, and the affordability
 * verdict rests on it.
 *
 * The assertions that earn this file are the ones separating withheld from
 * broken. A withheld balance blocks every priced craft, which looks exactly like
 * a save that is short of money, and it does so on a cold start too: without a
 * stated reason the operator cannot tell "the link stopped" from "you cannot
 * afford this" from "nothing has arrived yet".
 */

const CARRIED = [
  "career.status",
  "spaceCenter.savedShips",
  "spaceCenter.crewRoster",
  "spaceCenter.scene",
  "spaceCenter.launchSites",
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "ksp.revertAvailability",
  "crash.hasRecent",
  "crash.lastCrash",
  "target.available",
];

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

describe("LaunchDirector when its telemetry is no longer current", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
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
          body: "Kerbin",
          isStock: true,
          padOccupied: false,
          padVesselTitle: null,
        },
      ]);
      stream.emit("spaceCenter.savedShips", [KERBAL_X]);
      stream.emit("spaceCenter.crewRoster", [JEB]);
      stream.emit("career.status", {
        economy: { funds: 289_848, reputation: 0, science: 0 },
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
    // The control. Without it every assertion below would also pass on a widget
    // that never affords anything.
    renderWidget();
    emitPreLaunch();

    await waitFor(() =>
      expect(screen.getByTitle("Available funds")).toBeTruthy(),
    );
    // The count belongs to the pad the operator opened, not to the panel: it is
    // what THIS pad can take.
    expect(screen.getByText(/Craft · 1\/1 ready/)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /Kerbal X/ })
        .getAttribute("aria-disabled"),
    ).toBe("false");
  });

  it("withholds the balance when it stops being current, and says that is why", async () => {
    const { container } = renderWidget();
    emitPreLaunch();
    await waitFor(() =>
      expect(screen.getByTitle("Available funds")).toBeTruthy(),
    );

    goStale();

    // Withheld, not merely gone: the readout that held the number is replaced by
    // a readout that states the number is no longer current.
    await waitFor(() =>
      expect(screen.queryByTitle("Available funds")).toBeNull(),
    );
    expect(visibleText(container)).toContain("funds not current");
    expect(
      screen.getByTitle(
        "The last funds balance is no longer current, so affordability is not being judged",
      ),
    ).toBeTruthy();
  });

  it("does not present a withheld balance as an empty wallet the operator has never seen", async () => {
    // The distinction this file exists for. A blocked craft with no balance on
    // screen is what a broken widget looks like, and "funds unknown" is what a
    // cold start says, so the not-current wording has to be its own sentence.
    const { container } = renderWidget();
    emitPreLaunch();
    await waitFor(() =>
      expect(screen.getByTitle("Available funds")).toBeTruthy(),
    );

    goStale();

    await waitFor(() =>
      expect(visibleText(container)).toContain("funds not current"),
    );
    expect(visibleText(container)).not.toContain("funds unknown");
    expect(screen.queryByTitle("No funds balance has arrived")).toBeNull();
  });

  it("says the balance is unknown, not out of date, before one has ever arrived", async () => {
    // A cold start is not a dropped link, and this widget would otherwise accuse
    // the link of dropping on first paint.
    const { container } = renderWidget();
    act(() => {
      stream.emit("spaceCenter.launchSites", [
        {
          name: "LaunchPad",
          displayName: "KSC Launch Pad",
          editorFacility: "VAB",
          body: "Kerbin",
          isStock: true,
          padOccupied: false,
          padVesselTitle: null,
        },
      ]);
      stream.emit("spaceCenter.savedShips", [KERBAL_X]);
    });

    await waitFor(() => expect(screen.getByText("Kerbal X")).toBeTruthy());
    expect(visibleText(container)).toContain("funds unknown");
    expect(visibleText(container)).not.toContain("funds not current");
  });

  it("suspends the affordability verdict with the balance, rather than spending against a held one", async () => {
    // The withheld balance is a judgement input, so the craft it priced stops
    // being offered. This is the cost of the decision above and is stated here so
    // it cannot be mistaken for a rendering bug in the craft list.
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
    // A .craft file does not leave the disk because the link dropped, and this
    // widget reads a missing craft list as "nothing has arrived" and blanks its
    // whole body. Holding the paperwork is what keeps the funds notice on screen
    // at all.
    const { container } = renderWidget();
    emitPreLaunch();
    await waitFor(() => expect(screen.getByText("Kerbal X")).toBeTruthy());

    goStale();

    await waitFor(() =>
      expect(visibleText(container)).toContain("funds not current"),
    );
    expect(screen.getByText("Kerbal X")).toBeTruthy();
    expect(visibleText(container)).not.toContain(
      "Awaiting launch-pad telemetry",
    );
  });

  it("keeps the in-flight panel, its revert points and its vessel roster", async () => {
    // The scene is the fact this widget can least afford to drop: withheld, it
    // reads as "not in flight" and swaps a live flight's recover / revert
    // controls for the pre-launch craft picker. The revert points and the roster
    // go the same way, and a control greyed out as "(n/a)" would state that the
    // save cannot revert when it demonstrably still can.
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

  it("keeps recovery available rather than reviving the crash block it was given to fix", async () => {
    // `crash.hasRecent` is session-wide; the crash record is what scopes the
    // block to the active vessel. Withholding the record would hand the flag back
    // the false block on a successful landing, so the record is held: a crash is
    // something that already happened.
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
