import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { ContributionHost } from "../test/contributionHost";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceCenterStatusComponent } from "./index";

/**
 * What this widget does when career telemetry stops being current. The tiers
 * stay, since only a paid upgrade moves one. The funds balance stays on screen
 * marked held, the scene goes, and every Upgrade button they authorised goes
 * with them.
 */

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
        <ContributionHost
          componentId="space-center-status"
          contributionSlots={["space-center-status.facilities"]}
        >
          <SpaceCenterStatusComponent id={instanceId} w={w} h={h} />
        </ContributionHost>
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
    // Occupancy-only launch-site entry feeding the `spaceCenter.state` derived channel.
    fixture.emit("spaceCenter.launchSites", [
      { name: "__pad_occupancy__", padOccupied: false, padVesselTitle: null },
    ]);
    fixture.emit("career.facilities", {
      facilities: {
        LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 150000 },
      },
    });
    fixture.emit("career.status", {
      balances: { funds: 500000, reputation: 0, science: 0 },
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

describe("SpaceCenterStatus when career telemetry is held", () => {
  it("shows the balance and an armed upgrade while the career record is current", async () => {
    // The control: without it every assertion below would pass on a widget that never offers an upgrade.
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
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
    expect(container.querySelector("[data-held]")).toBeNull();
  });

  it("keeps the held balance on screen, marked by Unit, and leaves the upgrade to its gate", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-stale-funds", 6, 7);
    emitCareer(fixture);
    await waitFor(() =>
      expect(screen.getByTitle("Available funds")).toBeTruthy(),
    );
    expect(
      screen.getByTitle("Available funds").querySelector("[data-held]"),
    ).toBeNull();

    goStale(fixture);

    await waitFor(() =>
      expect(
        screen.getByTitle("Available funds").querySelector("[data-held]"),
      ).not.toBeNull(),
    );
    const balance = screen.getByTitle("Available funds");
    expect(balance.querySelector("[data-unit-currency]")).not.toBeNull();
    expect(balance.textContent).toContain("500");
    // Not the cold-start sentence: one reports a warmup, the other accuses the link.
    expect(screen.queryByTitle("No funds balance has arrived")).toBeNull();
    // A held balance is a reason to mark the figure, not to decide the command: the per-facility gate does that.
    expect(
      (screen.getByRole("button", { name: "Upgrade" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("draws no affordability verdict off a held balance", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    const container = mount(fixture, "scs-stale-verdict", 6, 7);
    emitCareer(fixture);
    await waitFor(() =>
      expect(
        container.querySelector("[data-afford]")?.getAttribute("data-afford"),
      ).toBe("yes"),
    );

    goStale(fixture);

    await waitFor(() =>
      expect(
        screen.getByTitle("Available funds").querySelector("[data-held]"),
      ).not.toBeNull(),
    );
    // The last balance covered the cost, but a held figure can say neither yes nor no.
    expect(container.querySelector("[data-afford]")).toBeNull();
  });

  it("writes no held caption beside the upgrades", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-stale-hold-line", 6, 7);
    emitCareer(fixture);
    await waitFor(() =>
      expect(screen.getByTitle("Available funds")).toBeTruthy(),
    );

    goStale(fixture);

    // The held balance carries the mark; nothing else on the panel dates the link.
    await waitFor(() =>
      expect(
        screen.getByTitle("Available funds").querySelector("[data-held]"),
      ).not.toBeNull(),
    );
    // MAX is a claim about the facility, not about the link.
    expect(screen.queryByText("MAX")).toBeNull();
  });

  it("keeps the facility tiers, which cannot have changed while the link was down", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    const container = mount(fixture, "scs-stale-facts", 6, 7);
    emitCareer(fixture);
    await waitFor(() =>
      expect(screen.getByLabelText("Launch Pad tier 2 of 3")).toBeTruthy(),
    );

    goStale(fixture);
    await waitFor(() =>
      expect(
        screen.getByTitle("Available funds").querySelector("[data-held]"),
      ).not.toBeNull(),
    );

    // Each moves only when the player does something, which cannot happen down a dead link.
    expect(screen.getByLabelText(/^Launch Pad tier 2 of 3/)).toBeTruthy();
    expect(screen.queryByLabelText("Launch Pad tier unknown")).toBeNull();
    expect(visibleText(container)).toContain("150.0k");
    // Last site is a claim about a launch that already happened.
    expect(screen.getByRole("status").textContent).toContain(
      "Last site: LaunchPad",
    );
  });

  it("marks nothing held before anything has ever arrived", async () => {
    // A cold start is not a withholding.
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    const container = mount(fixture, "scs-stale-cold", 6, 7);

    await waitFor(() => expect(screen.getByText("SPACE CENTER")).toBeTruthy());
    expect(container.querySelector("[data-held]")).toBeNull();
    expect(visibleText(container)).toContain("funds unknown");
  });
});
