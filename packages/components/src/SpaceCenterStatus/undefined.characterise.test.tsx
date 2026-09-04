import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceCenterStatusComponent } from "./index";

/**
 * Characterisation, not specification: what this widget DOES today when its
 * telemetry reads come back `undefined`.
 *
 * Every read here is a canonical whole-topic read (`career.status`,
 * `spaceCenter.scene`) or a derived-channel read (`spaceCenter.state`, off
 * `spaceCenter.launchSites`). All three are carried by
 * the fixture, so an un-emitted topic reaches the widget as `undefined` through
 * exactly the production route rather than through a missing legacy source.
 *
 * `undefined` means four different things across this file, and none of them is
 * written down anywhere in the widget:
 *  - facilities absent: every tier reads "unknown", no upgrade affordance
 *  - funds absent: every upgrade reads as AFFORDABLE (`careerFunds === null ||
 *    careerFunds >= f.upgradeFunds`)
 *  - scene absent: upgrades are ENABLED (`scene === undefined || scene ===
 *    "SpaceCenter"`)
 *  - pad occupancy absent: the widget asserts "No vehicle on pad"
 * The last three are fail-open, and they fail open because a `Reading` is always
 * truthy and `undefined` is not.
 */
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

const ALL_READS = [
  "career.status",
  "spaceCenter.scene",
  "spaceCenter.launchSites",
];

function mount(
  fixture: ReturnType<typeof setupStreamFixture>,
  instanceId: string,
  w: number,
  h: number,
) {
  const { unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <SpaceCenterStatusComponent id={instanceId} w={w} h={h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
}

describe("SpaceCenterStatus: what undefined telemetry renders today", () => {
  it("draws no facility grid at all when nothing has arrived, and says so", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-cold", 6, 7);

    // Nothing is emitted. The widget does not render a loading state: it
    // renders its whole chrome with the data holes filled by placeholders. The
    // grid is the exception, because nine cells of em dash was the same
    // non-answer written out nine times.
    await waitFor(() => expect(screen.getByText("SPACE CENTER")).toBeTruthy());

    expect(screen.getByText("No facility tiers")).toBeTruthy();
    for (const label of [
      "Launch Pad",
      "Runway",
      "VAB",
      "SPH",
      "Mission Control",
      "Tracking",
      "Admin",
      "R&D",
      "Astronaut",
    ]) {
      expect(screen.queryByLabelText(`${label} tier unknown`)).toBeNull();
      expect(screen.queryByText(label)).toBeNull();
    }

    // No upgrade affordance at all: the row is gated on `f && f.upgradeFunds >
    // 0`, so absent facilities hide the button rather than disabling it.
    expect(screen.queryAllByRole("button", { name: "Upgrade" })).toHaveLength(
      0,
    );
    expect(screen.queryByText("MAX")).toBeNull();

    // `careerFunds === null` hides the balance readout entirely, so a widget
    // that spends funds shows no balance while its telemetry is cold.
    expect(screen.queryByTitle("Available funds")).toBeNull();
  });

  /**
   * Recorded prior behaviour: "asserts 'No vehicle on pad' from no pad telemetry
   * at all". Both arms of the padLine ternary fell through to a confident
   * negative claim, and this line is announced through `role="status"
   * aria-live="polite"`, so a screen reader was read a fact nobody established.
   */
  it("says the pad state is unknown, rather than claiming the pad is clear, from no pad telemetry", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-pad-cold", 6, 7);

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Pad state unknown",
      ),
    );
    // A genuinely clear pad still says so, so the two are now distinguishable.
    expect(screen.getByRole("status").textContent).not.toContain(
      "No vehicle on pad",
    );
  });

  /**
   * Recorded prior behaviour: "still asserts 'No vehicle on pad' when the scene
   * record arrived without a launchSite". A missing field inside a present record
   * landed on the same string as a missing record. The scene is not the pad, so
   * arriving without a launchSite still says nothing about pad occupancy.
   */
  it("still says the pad state is unknown when only the scene record arrived", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-partial-scene", 6, 7);

    act(() => {
      // Partial payload: the record IS here, the field within it is not.
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
    });

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Pad state unknown",
      ),
    );
  });

  /**
   * Recorded prior behaviour: "enables the upgrade button because the scene is
   * unknown". `upgradesEnabled = scene === undefined || scene === "SpaceCenter"`
   * was a deliberate, commented decision to show the affordance during telemetry
   * warmup, but it granted permission to spend career funds from not knowing
   * where the player was, and it read identically on a dropped frame mid-session.
   */
  it("withholds the upgrade button while the scene is unknown, and offers it once SpaceCenter arrives", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-scene-gate", 6, 7);

    act(() => {
      fixture.emit("career.status", {
        economy: { funds: 500000, reputation: 0, science: 0 },
        facilities: {
          LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 150000 },
        },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    // No scene: the affordance is visible but inert. The operator cannot arm a
    // facility upgrade before the widget knows which scene KSP is in.
    const button = await waitFor(() =>
      screen.getByRole("button", { name: "Upgrade" }),
    );
    expect((button as HTMLButtonElement).disabled).toBe(true);

    // The scene arriving is what grants permission, and it has to be the right
    // scene: Flight leaves it disabled for the same reason absence does.
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Upgrade" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "Flight" });
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Upgrade" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );
  });

  /**
   * Recorded prior behaviour: "treats an absent funds field as affordable".
   * `careerFunds === null || careerFunds >= f.upgradeFunds` read an unknown
   * balance as a sufficient one, and the balance readout hid at the same moment,
   * so the operator was offered a 150,000f spend with no number beside it.
   */
  it("treats an absent funds field as unaffordable, and says the balance is unknown", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-funds-gate", 6, 7);

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      // Partial payload: facilities present, `economy` null, so
      // `careerStatus?.economy?.funds` is undefined and careerFunds is null.
      fixture.emit("career.status", {
        economy: null,
        facilities: {
          LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 150000 },
        },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    // An unknown balance cannot satisfy a 150,000f cost, so the button is inert.
    const button = await waitFor(() =>
      screen.getByRole("button", { name: "Upgrade" }),
    );
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // And the refusal is explained rather than silent: the readout stays,
    // reporting the balance as the thing that is missing.
    expect(screen.queryByTitle("Available funds")).toBeNull();
    expect(screen.getByTitle("No funds balance has arrived")).toBeTruthy();

    // Contrast: a real balance below the cost reads the same way, which is the
    // point. Absence and a short balance are both "cannot afford this".
    act(() => {
      fixture.emit("career.status", {
        economy: { funds: 100, reputation: 0, science: 0 },
        facilities: {
          LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 150000 },
        },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });
    // Wait on the readout, not on the disabled state: the button is already
    // disabled, so waiting for that would return before the emit landed.
    await waitFor(() =>
      expect(screen.getByTitle("Available funds")).toBeTruthy(),
    );
    expect(
      (screen.getByRole("button", { name: "Upgrade" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByTitle("No funds balance has arrived")).toBeNull();
  });

  it("renders a confirmed career.status tombstone exactly as it renders a never-arrived one", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-tombstone", 6, 7);

    act(() => {
      // A tombstone: the subject says there IS no career status (sandbox, say).
      // `useTelemetry` hands back `null` here, not `undefined`.
      fixture.emit("career.status", null);
    });

    // The widget does not distinguish the two. `careerStatus?.facilities` is
    // undefined either way, `parseFacilityLevels` returns {} either way, and
    // there is nothing on screen that would change if one became the other.
    await waitFor(() =>
      expect(screen.getByText("No facility tiers")).toBeTruthy(),
    );
    expect(screen.queryByTitle("Available funds")).toBeNull();
    expect(screen.queryAllByRole("button", { name: "Upgrade" })).toHaveLength(
      0,
    );
  });

  /**
   * Recorded prior behaviour: "reports the pad CLEAR in the tiny bucket when
   * nothing has arrived". `padOccupied === true` was the tiny bucket's whole
   * test, so undefined read as an affirmative all-clear. Same claim as the pad
   * line, in two words, and the badge is exposed to assistive tech as an image
   * with that label.
   */
  it("reports the pad state as unknown in the tiny bucket when nothing has arrived", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-tiny-cold", 2, 3);

    await waitFor(() =>
      expect(screen.getByLabelText("Pad state unknown").textContent).toBe(
        "PAD UNKNOWN",
      ),
    );
    expect(screen.queryByLabelText("No vehicle on pad")).toBeNull();
    // Funds is the one read the tiny bucket DOES admit ignorance about.
    expect(visibleText()).toContain(NULL_DISPLAY);
    expect(screen.queryByTitle(/funds/)).toBeNull();
  });
});
