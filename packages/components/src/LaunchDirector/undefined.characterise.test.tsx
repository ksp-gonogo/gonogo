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
 *  - crewRoster absent: the crew section says the roster has no reading, and the
 *    launch control stands (it used to vanish with the section)
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

/** The one stock pad, in the mod's own shape: this widget's subject. */
const PAD = {
  name: "LaunchPad",
  displayName: "KSC Launch Pad",
  editorFacility: "VAB",
  body: "Kerbin",
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
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "ld-cold");

    // `parseLaunchSites(undefined)` is null, and the pre-flight body returns
    // early. This is the one absence gate in the file that decides whether the
    // widget exists at all, and it reads the PADS, which are the subject.
    await waitFor(() =>
      expect(screen.getByText("Awaiting launch-pad telemetry")).toBeTruthy(),
    );

    // Named absences rather than an empty container: none of the widget's
    // sections, controls or readouts exist behind that one line.
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
      carriedChannels: ALL_READS,
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
        economy: { funds: 42500, reputation: 200, science: 100 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    // The craft list is what ONE pad can take, so its absence narrows the open
    // pad and nothing else: the pads are still listed, the balance is still
    // beside the spend control, and the missing list says it is missing rather
    // than reading as a pad with no craft.
    await waitFor(() =>
      expect(screen.getByText("KSC Launch Pad")).toBeTruthy(),
    );
    expect(visibleText()).toContain("42,500");
    expect(screen.getByText("Awaiting saved-craft telemetry")).toBeTruthy();
    expect(screen.queryByText("Awaiting launch-pad telemetry")).toBeNull();
  });

  it("renders a confirmed savedShips tombstone exactly as it renders a never-arrived one", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "ld-tombstone");

    act(() => {
      // A tombstone: the subject confirms there is no launch-site list.
      // `useTelemetry` hands back `null` here, not `undefined`, and
      // `parseLaunchSites` collapses both to null on its first line.
      fixture.emit("spaceCenter.launchSites", null);
    });

    // Identical render to the cold case above: nothing in this widget can tell
    // "confirmed no launch sites" from "nothing has arrived yet".
    await waitFor(() =>
      expect(screen.getByText("Awaiting launch-pad telemetry")).toBeTruthy(),
    );
    expect(visibleText()).toBe(
      "LAUNCH & RECOVERYAwaiting launch-pad telemetry",
    );
  });

  it("crosses the early-return gate on an EMPTY launchSites array, unlike an absent one", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "ld-empty-sites");

    act(() => {
      fixture.emit("spaceCenter.launchSites", []);
    });

    // `[]` parses to `[]`, not null, so the gate passes and the widget renders
    // its real body: an arrived-and-empty list is the ONLY thing today that
    // distinguishes "we know there are no pads" from "we do not know yet".
    await waitFor(() =>
      expect(screen.getByText("No launch sites reported")).toBeTruthy(),
    );
    expect(screen.queryByText("Awaiting launch-pad telemetry")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("No pads");
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
      suspendFrames: true,
    });
    mount(fixture, "ld-funds-gate");

    act(() => {
      fixture.emit("spaceCenter.launchSites", [PAD]);
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
    expect(screen.getByText(/Craft · 0\/1 ready/)).toBeTruthy();
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
    expect(screen.getByText(/Craft · 0\/1 ready/)).toBeTruthy();
    // The unknown-balance notice gives way to the balance itself.
    expect(screen.queryByTitle("No funds balance has arrived")).toBeNull();
  });

  it("says the roster has no reading, and still offers the launch, while the crew roster is absent", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
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

    // `parseCrew(undefined)` is null, and null is now a state the section
    // reports rather than a reason to remove the section and the launch control
    // with it. An unreadable roster says so and an unmanned launch stands.
    expect(
      screen
        .getByRole("button", { name: /^Kerbal X/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("Crew")).toBeTruthy();
    expect(screen.getByText(`Roster ${NULL_DISPLAY} no reading`)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Launch Kerbal X unmanned" }),
    ).toBeTruthy();

    // Contrast: an EMPTY roster is a roster, so the no-reading line goes and
    // the launch control stays where it was.
    act(() => {
      fixture.emit("spaceCenter.crewRoster", []);
    });
    await waitFor(() =>
      expect(
        screen.queryByText(`Roster ${NULL_DISPLAY} no reading`),
      ).toBeNull(),
    );
    expect(
      screen.getByRole("button", { name: "Launch Kerbal X unmanned" }),
    ).toBeTruthy();
  });

  it("does not block recovery when crash.hasRecent is absent, but does block it when only crash.lastCrash is", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
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
      suspendFrames: true,
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
      suspendFrames: true,
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
