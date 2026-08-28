import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceCenterStatusComponent } from "./index";

/**
 * What this widget does when career telemetry stops being current.
 *
 * The split it makes, and why the file exists to hold it in place:
 *
 * - The facility tiers STAY. A tier changes when the player pays for an upgrade,
 *   so no tier can have moved down a link that stopped delivering, and blanking
 *   nine cells would erase a KSC that is still standing.
 * - The funds balance GOES, along with every Upgrade button it authorised. The
 *   balance moves on its own and the button spends it. A held number is exactly
 *   the one that arms a 150,000f spend the player can no longer cover.
 * - The scene GOES for the same reason: it is not something this widget reports,
 *   it is the permission to spend, and a held scene means nobody knows whether
 *   the player is still in the Space Center.
 *
 * The assertions that earn the file are the ones about the WORDING. A row of dead
 * Upgrade buttons is what a fully-upgraded KSC also looks like, and a missing
 * balance is what a cold start also looks like, so "held" has to be legible from
 * outside the component or the refusal reads as the widget being broken.
 */

const CARRIED = [
  "career.status",
  "spaceCenter.scene",
  "spaceCenter.launchSites",
];

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

function mount(
  fixture: ReturnType<typeof setupStreamFixture>,
  instanceId: string,
  w: number,
  h: number,
) {
  const { container, unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <SpaceCenterStatusComponent id={instanceId} w={w} h={h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return container;
}

/** A career in the Space Center with one affordable Launch Pad upgrade pending. */
function emitCareer(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.emit("spaceCenter.scene", {
      scene: "SpaceCenter",
      launchSite: "LaunchPad",
    });
    // Occupancy-only launch-site entry feeding the `spaceCenter.state` derived
    // channel, the same trick `snapshots.test.tsx` documents.
    fixture.emit("spaceCenter.launchSites", [
      { name: "__pad_occupancy__", padOccupied: false, padVesselTitle: null },
    ]);
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
}

function goStale(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

describe("SpaceCenterStatus when career telemetry is no longer current", () => {
  it("shows the balance and an armed upgrade while the career record is current", async () => {
    // The control. Without it every assertion below would also pass on a widget
    // that never offers an upgrade at all.
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const container = mount(fixture, "scs-stale-control", 6, 7);
    emitCareer(fixture);

    await waitFor(() =>
      expect(screen.getByTitle("Available funds")).toBeTruthy(),
    );
    expect(
      (screen.getByRole("button", { name: "Upgrade" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(visibleText(container)).not.toContain("Upgrades held");
  });

  it("withholds the balance and disarms the upgrade, and says the balance is no longer current", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const container = mount(fixture, "scs-stale-funds", 6, 7);
    emitCareer(fixture);
    await waitFor(() =>
      expect(screen.getByTitle("Available funds")).toBeTruthy(),
    );

    goStale(fixture);

    await waitFor(() =>
      expect(screen.getByTitle("Funds balance no longer current")).toBeTruthy(),
    );
    // Not the cold-start sentence. One reports a warmup, the other accuses the
    // link, and the operator needs to know which.
    expect(screen.queryByTitle("No funds balance has arrived")).toBeNull();
    expect(screen.queryByTitle("Available funds")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Upgrade" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(visibleText(container)).toContain("funds no longer current");
  });

  it("names both withheld inputs, so dead buttons do not read as a KSC with nothing to upgrade", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const container = mount(fixture, "scs-stale-hold-line", 6, 7);
    emitCareer(fixture);
    await waitFor(() =>
      expect(screen.getByTitle("Available funds")).toBeTruthy(),
    );

    goStale(fixture);

    await waitFor(() =>
      expect(visibleText(container)).toContain("Upgrades held"),
    );
    const text = visibleText(container);
    // The scene half is invisible on its own: withholding a permission removes an
    // affordance and leaves nothing behind, so it has to be said out loud.
    expect(text).toContain("scene");
    expect(text).toContain("funds balance");
    expect(text).toContain("no longer current");
    // MAX is the other reason a facility offers no upgrade, and it is a claim
    // about the facility rather than about the link.
    expect(screen.queryByText("MAX")).toBeNull();
  });

  it("keeps the facility tiers, which cannot have changed while the link was down", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const container = mount(fixture, "scs-stale-facts", 6, 7);
    emitCareer(fixture);
    await waitFor(() =>
      expect(screen.getByLabelText("Launch Pad tier 2 of 3")).toBeTruthy(),
    );

    goStale(fixture);
    await waitFor(() =>
      expect(visibleText(container)).toContain("Upgrades held"),
    );

    // The tier, the upgrade cost and the parts count all survive: each moves only
    // when the player does something, and the player cannot have done it down a
    // link that is not delivering.
    expect(screen.getByLabelText("Launch Pad tier 2 of 3")).toBeTruthy();
    expect(screen.queryByLabelText("Launch Pad tier unknown")).toBeNull();
    expect(visibleText(container)).toContain("150.0k");
    // Last site is a claim about a launch that already happened.
    expect(screen.getByRole("status").textContent).toContain(
      "Last site: LaunchPad",
    );
  });

  it("says nothing about held upgrades before anything has ever arrived", async () => {
    // A cold start is not a withholding. Conflating them would accuse the link of
    // dropping on first paint, every paint.
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const container = mount(fixture, "scs-stale-cold", 6, 7);

    await waitFor(() => expect(screen.getByText("SPACE CENTER")).toBeTruthy());
    expect(visibleText(container)).not.toContain("Upgrades held");
    expect(visibleText(container)).toContain("funds unknown");
    expect(screen.queryByTitle("Funds balance no longer current")).toBeNull();
  });

  it("titles the tiny bucket's withheld balance, the only room it has to give a reason", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const container = mount(fixture, "scs-stale-tiny", 2, 3);
    emitCareer(fixture);
    await waitFor(() =>
      expect(visibleText(container)).not.toContain(NULL_DISPLAY),
    );

    goStale(fixture);

    await waitFor(() =>
      expect(screen.getByTitle("Funds balance no longer current")).toBeTruthy(),
    );
    expect(visibleText(container)).toContain(NULL_DISPLAY);
  });

  it("leaves a cold tiny bucket untitled, so a held balance is distinguishable there too", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const container = mount(fixture, "scs-stale-tiny-cold", 2, 3);

    await waitFor(() => expect(visibleText(container)).toContain(NULL_DISPLAY));
    expect(screen.queryByTitle("Funds balance no longer current")).toBeNull();
  });
});
