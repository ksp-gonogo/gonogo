import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { CommandErrorCode, GateOutcome } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LaunchDirectorComponent } from "./index";

/**
 * Characterisation: what this widget does when its telemetry reads come back
 * `undefined`, by the production route. Absent pads empty the widget; an
 * absent balance refuses every priced craft; an absent roster is stated; an
 * absent `crash.hasRecent` fails open while an absent `crash.lastCrash` fails
 * safe; an absent target roster reads as no other vessels.
 */
afterEach(() => {
  clearActionHandlers();
});

const KERBAL_X = {
  name: "Kerbal X",
  partCount: 24,
  totalMass: 18.4,
  facility: "VAB",
  requiresFunds: 0,
  missingParts: [],
};

/** The one stock pad, in the mod's own shape: this widget's subject. */
const PAD = {
  name: "LaunchPad",
  displayName: "KSC Launch Pad",
  editorFacility: "VAB",
  bodyIndex: 1,
  isStock: true,
  padOccupied: false,
  padVesselTitle: null,
};

function mount(
  fixture: ReturnType<typeof setupStreamFixture>,
  instanceId: string,
) {
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <LaunchDirectorComponent id={instanceId} w={7} h={9} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

describe("LaunchDirector: what undefined telemetry renders today", () => {
  it("replaces the whole widget with 'Awaiting launch-pad telemetry' when nothing has arrived", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "ld-cold");

    // The one absence gate that decides whether the widget exists at all, and it reads the PADS.
    await waitFor(() =>
      expect(screen.getByText("Awaiting launch-pad telemetry")).toBeTruthy(),
    );

    // Named absences: none of the sections, controls or readouts exist behind that one line.
    expect(screen.queryByText("Pads")).toBeNull();
    expect(screen.queryByText("Crew")).toBeNull();
    expect(screen.queryByTitle("Available funds")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(visibleText()).toBe(
      "LAUNCH & RECOVERYAwaiting launch-pad telemetry",
    );
  });

  it("keeps the balance and the pads when the saved-craft list has not arrived", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "ld-ships-gate");

    act(() => {
      // Everything except the saved-craft list.
      fixture.emit("spaceCenter.scene", {
        scene: "SpaceCenter",
        launchSite: "LaunchPad",
      });
      fixture.emit("spaceCenter.launchSites", [PAD]);
      fixture.emit("career.status", {
        balances: { funds: 42500, reputation: 200, science: 100 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    // A missing craft list narrows the open pad and says so; the pads and the balance stay.
    await waitFor(() =>
      expect(screen.getByText("KSC Launch Pad")).toBeTruthy(),
    );
    expect(visibleText()).toContain("42,500");
    expect(screen.getByText("Awaiting saved-craft telemetry")).toBeTruthy();
    expect(screen.queryByText("Awaiting launch-pad telemetry")).toBeNull();
  });

  it("renders a confirmed savedShips tombstone exactly as it renders a never-arrived one", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "ld-tombstone");

    act(() => {
      // A tombstone: `useTelemetry` hands back `null`, and `parseLaunchSites` collapses it with `undefined`.
      fixture.emit("spaceCenter.launchSites", null);
    });

    // Identical to the cold case: "confirmed no launch sites" is not distinguished from "nothing yet".
    await waitFor(() =>
      expect(screen.getByText("Awaiting launch-pad telemetry")).toBeTruthy(),
    );
    expect(visibleText()).toBe(
      "LAUNCH & RECOVERYAwaiting launch-pad telemetry",
    );
  });

  it("crosses the early-return gate on an EMPTY launchSites array, unlike an absent one", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "ld-empty-sites");

    act(() => {
      fixture.emit("spaceCenter.launchSites", []);
    });

    // An arrived-and-empty list is the only thing that distinguishes "no pads" from "not known yet".
    await waitFor(() =>
      expect(screen.getByText("No launch sites reported")).toBeTruthy(),
    );
    expect(screen.queryByText("Awaiting launch-pad telemetry")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("No pads");
  });

  /** An absent balance refuses a priced craft, and says what it does not know. */
  it("treats absent funds as insufficient funds, and shows that the balance is unknown", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "ld-funds-gate");

    act(() => {
      fixture.emit("spaceCenter.launchSites", [PAD]);
      fixture.emit("spaceCenter.savedShips", [
        { ...KERBAL_X, requiresFunds: 999_999 },
      ]);
    });

    // Tagged with the same "Insufficient funds" reason a real short balance produces.
    const row = await waitFor(() =>
      screen.getByRole("button", { name: /Kerbal X/ }),
    );
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTitle("Insufficient funds")).toBeTruthy();
    expect(screen.getByText(/Craft · 0\/1 ready/)).toBeTruthy();
    // The readout stays, saying the balance is the thing missing.
    expect(screen.queryByTitle("Available funds")).toBeNull();
    expect(screen.getByTitle("No funds balance has arrived")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("funds unknown");

    // Absence and a short balance are both "cannot afford this".
    act(() => {
      fixture.emit("career.status", {
        balances: { funds: 100, reputation: 0, science: 0 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });
    // Wait on the readout: the row is already disabled before the emit lands.
    await waitFor(() =>
      expect(screen.getByTitle("Available funds")).toBeTruthy(),
    );
    expect(
      screen
        .getByRole("button", { name: /Kerbal X/ })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(screen.getByTitle("Insufficient funds")).toBeTruthy();
    expect(screen.getByText(/Craft · 0\/1 ready/)).toBeTruthy();
    // The unknown-balance notice gives way to the balance itself.
    expect(screen.queryByTitle("No funds balance has arrived")).toBeNull();
  });

  it("says the roster has no reading, and still offers the launch, while the crew roster is absent", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    const user = userEvent.setup();
    mount(fixture, "ld-crew-gate");

    act(() => {
      fixture.emit("spaceCenter.launchSites", [PAD]);
      fixture.emit("spaceCenter.savedShips", [KERBAL_X]);
    });

    await waitFor(() => expect(screen.getByText("Kerbal X")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: /^Kerbal X/ }));

    // An unreadable roster says so, and an unmanned launch stands.
    expect(
      screen
        .getByRole("button", { name: /^Kerbal X/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("Crew")).toBeTruthy();
    expect(screen.getByText("Roster: no reading")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Launch Kerbal X unmanned" }),
    ).toBeTruthy();

    // An EMPTY roster is a roster: the no-reading line goes and the launch control stays.
    act(() => {
      fixture.emit("spaceCenter.crewRoster", []);
    });
    await waitFor(() =>
      expect(screen.queryByText("Roster: no reading")).toBeNull(),
    );
    expect(
      screen.getByRole("button", { name: "Launch Kerbal X unmanned" }),
    ).toBeTruthy();
  });

  it("chips a crash from crash.hasRecent alone, and never decides Recover's availability itself", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "ld-crash-chip");

    act(() => {
      fixture.emit("spaceCenter.savedShips", []);
      fixture.emit("spaceCenter.scene", { scene: "Flight" });
      fixture.emit("vessel.identity", {
        vesselId: "probe-1",
        name: "Probe 1",
        vesselType: 0,
        situation: 0,
        parentBodyIndex: 1,
        launchUt: null,
      });
    });

    // An absent crash channel reads as "no crash".
    const recover = await waitFor(() =>
      screen.getByRole("button", { name: /^Recover$/ }),
    );
    expect(screen.queryByText(/Crash in progress/)).toBeNull();

    // With hasRecent true and no snapshot to scope it, the crash is chipped for the session.
    act(() => {
      fixture.emit("crash.hasRecent", true);
    });
    await waitFor(() =>
      expect(screen.getByText(/Crash in progress/)).toBeTruthy(),
    );
    expect(recover).not.toHaveAttribute("aria-disabled");
  });

  it("labels both reverts plainly and leaves them to the command's gate when revert availability is absent", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "ld-revert-gate");

    act(() => {
      fixture.emit("spaceCenter.savedShips", []);
      fixture.emit("spaceCenter.scene", { scene: "Flight" });
    });

    const revertLaunch = await waitFor(() =>
      screen.getByRole("button", { name: "Revert to launch" }),
    );
    expect(revertLaunch).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(/\(n\/a\)/)).toBeNull();

    // The command's own gate is what darkens it, with the game's reason.
    act(() => {
      fixture.emit("system.uplink.gates", {
        gates: [
          {
            command: "ksp.revertToLaunch",
            verdict: {
              outcome: GateOutcome.Fail,
              errorCode: CommandErrorCode.NotClearToProceed,
              detail: "this flight cannot be reverted to launch",
            },
          },
        ],
      });
    });
    const blocked = await waitFor(() =>
      screen.getByRole("button", {
        name: /Revert to launch unavailable: this flight cannot be reverted to launch/,
      }),
    );
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("button", { name: "Revert to VAB" }),
    ).not.toHaveAttribute("aria-disabled");
  });

  it("names the in-flight vessel '(unnamed)' and reports no other vessels in the save", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "ld-inflight-cold");

    act(() => {
      fixture.emit("spaceCenter.savedShips", []);
      fixture.emit("spaceCenter.scene", { scene: "Flight" });
    });

    // Both names absent, so the flight is named as an unnamed craft.
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "In flight: (unnamed)",
      ),
    );

    // Both reach NULL_DISPLAY, the one place in the in-flight panel where absence is drawn as absence.
    expect(visibleText()).toContain(`Mission time${NULL_DISPLAY}`);
    expect(visibleText()).toContain(`Altitude${NULL_DISPLAY}`);

    // An absent target roster reads as a save with no other vessels, in the tooltip.
    const switcher = screen.getByRole("button", { name: /Switch to vessel/ });
    expect(switcher).toBeDisabled();
    expect(switcher.getAttribute("title")).toBe(
      "No other vessels in this save",
    );
  });
});
