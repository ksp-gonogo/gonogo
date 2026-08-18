import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LaunchDirectorComponent } from "./index";

/**
 * Characterisation, not specification: what this widget DOES today when its
 * telemetry reads come back `undefined`.
 *
 * Every topic the widget reads is carried by the fixture, so an un-emitted
 * topic reaches it as `undefined` by the production route rather than by a
 * missing legacy source.
 *
 * `undefined` carries at least five separate meanings inside this one file, and
 * the widget writes none of them down:
 *  - savedShips absent: the ENTIRE widget body is replaced by "Awaiting
 *    launch-pad telemetry", including the funds balance and the crew roster it
 *    already has in hand
 *  - funds absent: `?? Number.POSITIVE_INFINITY`, so every craft in the save is
 *    affordable
 *  - crewRoster absent: no crew section AND no launch control, so the widget
 *    silently offers no way to launch
 *  - crash.hasRecent absent: `=== true` fails, recovery is NOT blocked
 *    (fail-open), while an absent `crash.lastCrash` in the same expression is
 *    read as fail-SAFE
 *  - target.available absent: the switcher reports "No other vessels in this
 *    save"
 */
afterEach(() => {
  clearActionHandlers();
});

const ALL_READS = [
  "spaceCenter.savedShips",
  "spaceCenter.crewRoster",
  "spaceCenter.scene",
  "spaceCenter.launchSites",
  "career.status",
  "vessel.identity",
  "vessel.orbit",
  "vessel.flight",
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
  requiresFunds: 0,
  missingParts: [],
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
      carriedChannels: ALL_READS,
      pinnedUt: 10,
    });
    mount(fixture, "ld-cold");

    // `parseSavedShips(undefined)` is null, and `if (ships === null)` returns
    // early. This is the one absence gate in the file that decides whether the
    // widget exists at all.
    await waitFor(() =>
      expect(screen.getByText("Awaiting launch-pad telemetry")).toBeTruthy(),
    );

    // Named absences rather than an empty container: none of the widget's
    // sections, controls or readouts exist behind that one line.
    expect(screen.queryByText("Saved craft")).toBeNull();
    expect(screen.queryByText("Crew")).toBeNull();
    expect(screen.queryByText("Launch site")).toBeNull();
    expect(screen.queryByTitle("Available funds")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(visibleText()).toBe(
      "LAUNCH & RECOVERYAwaiting launch-pad telemetry",
    );
  });

  it("hides funds and crew that HAVE arrived, because savedShips has not", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
    });
    mount(fixture, "ld-ships-gate");

    act(() => {
      // Everything except the one topic the early-return gate reads.
      fixture.emit("spaceCenter.scene", {
        scene: "SpaceCenter",
        launchSite: "LaunchPad",
      });
      fixture.emit("spaceCenter.launchSites", []);
      fixture.emit("career.status", {
        economy: { funds: 42500, reputation: 200, science: 100 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
      fixture.emit("spaceCenter.crewRoster", [
        {
          name: "Jebediah Kerman",
          trait: "Pilot",
          experienceLevel: 3,
          available: true,
          unavailableReason: "",
        },
      ]);
    });

    // The funds readout and the crew roster both sit AFTER the early return, so
    // one absent topic suppresses data the widget is already holding. The
    // "always show the balance" rule cannot hold through this gate.
    await waitFor(() =>
      expect(screen.getByText("Awaiting launch-pad telemetry")).toBeTruthy(),
    );
    expect(visibleText()).not.toContain("42,500");
    expect(screen.queryByText("Jebediah Kerman")).toBeNull();
  });

  it("renders a confirmed savedShips tombstone exactly as it renders a never-arrived one", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
    });
    mount(fixture, "ld-tombstone");

    act(() => {
      // A tombstone: the subject confirms there is no saved-craft list.
      // `useTelemetry` hands back `null` here, not `undefined`, and
      // `parseSavedShips` collapses both to null on its first line.
      fixture.emit("spaceCenter.savedShips", null);
    });

    // Identical render to the cold case above: nothing in this widget can tell
    // "confirmed no craft" from "nothing has arrived yet".
    await waitFor(() =>
      expect(screen.getByText("Awaiting launch-pad telemetry")).toBeTruthy(),
    );
    expect(visibleText()).toBe(
      "LAUNCH & RECOVERYAwaiting launch-pad telemetry",
    );
  });

  it("crosses the early-return gate on an EMPTY savedShips array, unlike an absent one", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
    });
    mount(fixture, "ld-empty-ships");

    act(() => {
      fixture.emit("spaceCenter.savedShips", []);
    });

    // `[]` parses to `[]`, not null, so the gate passes and the widget renders
    // its real body: an arrived-and-empty list is the ONLY thing today that
    // distinguishes "we know there are no craft" from "we do not know yet".
    await waitFor(() => expect(screen.getByText("Saved craft")).toBeTruthy());
    expect(screen.queryByText("Awaiting launch-pad telemetry")).toBeNull();
    // Site label falls back to the raw state default because launchSites is
    // absent, so no displayName can be looked up.
    expect(screen.getByRole("status").textContent).toContain(
      "0/0 ready · LaunchPad",
    );
  });

  /**
   * Recorded prior behaviour: "treats absent funds as infinite funds, so an
   * unaffordable craft is launchable". `fundsAvailable = careerFunds ??
   * Number.POSITIVE_INFINITY` made an absent balance the most permissive
   * possible one, on a control that spends career funds, and the balance readout
   * hid at the same time so nothing on screen said why the craft was launchable.
   *
   * It now refuses, and says what it does not know.
   */
  it("treats absent funds as insufficient funds, and shows that the balance is unknown", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
    });
    mount(fixture, "ld-funds-gate");

    act(() => {
      fixture.emit("spaceCenter.savedShips", [
        { ...KERBAL_X, requiresFunds: 999_999 },
      ]);
    });

    // No career telemetry: the craft is not launchable, and it is tagged with
    // the same "Insufficient funds" reason a real short balance produces.
    const row = await waitFor(() =>
      screen.getByRole("button", { name: /Kerbal X/ }),
    );
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTitle("Insufficient funds")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("0/1 ready");
    // And the refusal is explained: the readout stays on screen saying the
    // balance is the thing missing, rather than vanishing and leaving a
    // disabled button with no stated cause.
    expect(screen.queryByTitle("Available funds")).toBeNull();
    expect(screen.getByTitle("No funds balance has arrived")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("funds unknown");

    // Contrast: a real balance below the cost reads the same way, which is the
    // point. Absence and a short balance are both "cannot afford this".
    act(() => {
      fixture.emit("career.status", {
        economy: { funds: 100, reputation: 0, science: 0 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });
    // Wait on the readout, not on the disabled state: the row is already
    // disabled, so waiting for that would return before the emit landed.
    await waitFor(() =>
      expect(screen.getByTitle("Available funds")).toBeTruthy(),
    );
    expect(
      screen
        .getByRole("button", { name: /Kerbal X/ })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(screen.getByTitle("Insufficient funds")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("0/1 ready");
    // The unknown-balance notice gives way to the balance itself.
    expect(screen.queryByTitle("No funds balance has arrived")).toBeNull();
  });

  it("offers no launch control at all while the crew roster is absent", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
    });
    const user = userEvent.setup();
    mount(fixture, "ld-crew-gate");

    act(() => {
      fixture.emit("spaceCenter.savedShips", [KERBAL_X]);
    });

    await waitFor(() => expect(screen.getByText("Kerbal X")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: /Kerbal X/ }));

    // `{ship && crew && (...)}`: `parseCrew(undefined)` is null, so selecting a
    // craft produces no Crew section, no Launch site picker and no Launch
    // button. The operator sees a selected craft and no way to fly it, with
    // nothing on screen saying why.
    expect(
      screen
        .getByRole("button", { name: /Kerbal X/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByText("Crew")).toBeNull();
    expect(screen.queryByText("Launch site")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Launch / })).toBeNull();

    // Contrast: an EMPTY roster is enough to unlock the launch control, so the
    // gate is about the read being absent and not about there being crew.
    act(() => {
      fixture.emit("spaceCenter.crewRoster", []);
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Launch Kerbal X unmanned" }),
      ).toBeTruthy(),
    );
    // Still no Launch site picker: `selectableSites` came from
    // `parseLaunchSites(undefined) ?? []`, so absence collapses the picker
    // exactly as a single-site save would.
    expect(screen.queryByText("Launch site")).toBeNull();
  });

  it("does not block recovery when crash.hasRecent is absent, but does block it when only crash.lastCrash is", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
    });
    mount(fixture, "ld-crash-gate");

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

    // `crashHasRecent === true` is false for undefined, so an absent crash
    // channel reads as "no crash" and Recover stays live. Fail-open.
    const recover = await waitFor(() =>
      screen.getByRole("button", { name: /^Recover$/ }),
    );
    expect(recover).not.toBeDisabled();
    expect(screen.queryByText(/Crash in progress/)).toBeNull();

    // The neighbouring absence reads the OTHER way: with hasRecent true and no
    // snapshot to scope it, `lastCrash == null ? true` blocks recovery for the
    // whole session. Two absences, two opposite defaults, one expression.
    act(() => {
      fixture.emit("crash.hasRecent", true);
    });
    await waitFor(() =>
      expect(screen.getByText(/Crash in progress/)).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: /^Recover$/ })).toBeDisabled();
  });

  it("labels both reverts '(n/a)' and disables them when revert availability is absent", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
    });
    mount(fixture, "ld-revert-gate");

    act(() => {
      fixture.emit("spaceCenter.savedShips", []);
      fixture.emit("spaceCenter.scene", { scene: "Flight" });
    });

    // `canRevertToLaunch ?? false` / `canRevertToEditor ?? false`: absence is
    // rendered as a positive claim that reverting is unavailable, which is the
    // same thing KSP saying "you cannot revert" looks like.
    const revertLaunch = await waitFor(() =>
      screen.getByRole("button", { name: "Revert to launch (n/a)" }),
    );
    expect(revertLaunch).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Revert to VAB (n/a)" }),
    ).toBeDisabled();

    // Contrast: the flags arriving flips both labels, so the `?? false` is what
    // produced the (n/a) text.
    act(() => {
      fixture.emit("ksp.revertAvailability", {
        canRevertToLaunch: true,
        canRevertToEditor: true,
      });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Revert to launch" }),
      ).not.toBeDisabled(),
    );
  });

  it("names the in-flight vessel '(unnamed)' and reports no other vessels in the save", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
    });
    mount(fixture, "ld-inflight-cold");

    act(() => {
      fixture.emit("spaceCenter.savedShips", []);
      fixture.emit("spaceCenter.scene", { scene: "Flight" });
    });

    // `vesselName ?? padVesselTitle ?? "(unnamed)"`: both absent, so the
    // widget asserts a flight is in progress and names it as an unnamed craft.
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "In flight: (unnamed)",
      ),
    );

    // `missionTime ?? null` and `altitudeMeters ?? null` both reach the
    // NULL_DISPLAY placeholder, which is the one place in the in-flight panel
    // where absence is drawn as absence.
    expect(visibleText()).toContain(`Mission time${NULL_DISPLAY}`);
    expect(visibleText()).toContain(`Altitude${NULL_DISPLAY}`);

    // `availableVessels?.length ?? 0`: an absent target roster is reported as a
    // save with no other vessels, in the button's own tooltip.
    const switcher = screen.getByRole("button", { name: /Switch to vessel/ });
    expect(switcher).toBeDisabled();
    expect(switcher.getAttribute("title")).toBe(
      "No other vessels in this save",
    );
  });
});
