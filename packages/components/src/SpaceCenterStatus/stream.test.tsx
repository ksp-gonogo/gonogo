import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { ContributionHost } from "../test/contributionHost";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceCenterStatusComponent } from "./index";

/**
 * SpaceCenterStatus's stream test-adapter proof: genuinely running off the
 * real `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport`. `career.status` carries the funds readout (a funds spender
 * per CLAUDE.md's "always show the balance" rule, so it must stream) and the
 * facility tiers; `spaceCenter.scene` carries the scene and launch site, and
 * pad occupancy comes off the derived `spaceCenter.state` channel, which is
 * built from `spaceCenter.launchSites`.
 *
 * Every one of those reads is stream-only: the widget makes two one-arg
 * `useTelemetry` calls and one `useStream`, and no read of any other kind. An
 * earlier version of this file stood up a `setupMockDataSource` AUX beside each
 * case, on the belief that the pad and launch-site reads fell back to it. They
 * do not, and could not, so the AUX fed nothing and its "not the legacy
 * fallback" decoy could never have won. It is gone.
 */
// Unmount each rendered tree BEFORE clearing the action-handler registry,
// clearActionHandlers() firing on a still-mounted widget is a state update
// outside act(). RTL auto-cleanup runs after this file's afterEach, too late
// to unmount first.
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

describe("SpaceCenterStatus: genuinely runs off the stream", () => {
  it("renders the funds readout off the stream", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "career.status",
        "career.facilities",
        "spaceCenter.scene",
      ],
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { unmount } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "scs-stream" }}>
          <ContributionHost
            componentId="space-center-status"
            contributionSlots={["space-center-status.facilities"]}
          >
            <SpaceCenterStatusComponent id="scs-stream" w={6} h={7} />
          </ContributionHost>
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);

    expect(fixture.transport.isSubscribed("career.status")).toBe(true);

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("career.status", {
        economy: { funds: 78400.5, reputation: 200, science: 100 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    // The whole readout is now <Unit>, so the number, its glyph and the
    // spoken word are three elements and no single node holds "· 78,401f".
    await waitFor(() => expect(visibleText()).toContain("· 78,401f"));
  });

  it("renders the tiny-bucket funds readout from the same stream key", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { unmount } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "scs-tiny" }}>
          <ContributionHost
            componentId="space-center-status"
            contributionSlots={["space-center-status.facilities"]}
          >
            <SpaceCenterStatusComponent id="scs-tiny" w={2} h={3} />
          </ContributionHost>
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);

    act(() => {
      fixture.emit("career.status", {
        economy: { funds: 78400.5, reputation: 200, science: 100 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    // The title is `speakQuantity`: an accessible name spells the unit out as
    // a word rather than as the symbol a sighted reader sees. It carries the
    // separator too, because grouping lives in `formatQuantity` and all three
    // ways of showing a quantity read from it.
    await waitFor(() => expect(screen.getByTitle("78,401 funds")).toBeTruthy());
  });

  it("renders facility tiers/upgrade costs derived from career.facilities", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "career.status",
        "career.facilities",
        "spaceCenter.scene",
      ],
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { unmount } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "scs-facilities" }}>
          <ContributionHost
            componentId="space-center-status"
            contributionSlots={["space-center-status.facilities"]}
          >
            <SpaceCenterStatusComponent id="scs-facilities" w={6} h={7} />
          </ContributionHost>
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("career.facilities", {
        facilities: {
          LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 150000 },
          VehicleAssemblyBuilding: {
            currentTier: 2,
            maxTier: 2,
            upgradeCost: null,
          },
        },
      });
      fixture.emit("career.status", {
        economy: { funds: 500000, reputation: 0, science: 0 },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    // "tier 2 of 3": displayLevel/displayMax are currentTier/maxTier + 1
    // (0-based tiers on the wire, 1-based "Lvl N of M" display).
    await waitFor(() =>
      expect(screen.getByLabelText("Launch Pad tier 2 of 3")).toBeTruthy(),
    );
    expect(visibleText()).toContain("150.0k");
    expect(screen.getByLabelText("VAB tier 3 of 3")).toBeTruthy();
    expect(screen.getByText("MAX")).toBeTruthy();
  });

  it("renders the pad-vessel title from the streamed spaceCenter.launchSites array, not the legacy fallback", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "career.status",
        "spaceCenter.scene",
        "spaceCenter.launchSites",
      ],
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { unmount } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "scs-pad-vessel" }}>
          <ContributionHost
            componentId="space-center-status"
            contributionSlots={["space-center-status.facilities"]}
          >
            <SpaceCenterStatusComponent id="scs-pad-vessel" w={6} h={7} />
          </ContributionHost>
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);

    expect(fixture.transport.isSubscribed("spaceCenter.launchSites")).toBe(
      true,
    );

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("spaceCenter.launchSites", [
        { padOccupied: true, padVesselTitle: "Kerbal X" },
      ]);
      fixture.emit("career.status", {
        economy: { funds: 100000, reputation: 200, science: 100 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("On pad: Kerbal X")).toBeTruthy(),
    );
  });
});
