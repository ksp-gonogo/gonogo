import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { ContributionHost } from "../test/contributionHost";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceCenterStatusComponent } from "./index";

/** SpaceCenterStatus running off the real stream pipeline via `StubTransport`. */
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

describe("SpaceCenterStatus: genuinely runs off the stream", () => {
  it("renders the funds readout off the stream", async () => {
    const fixture = setupStreamFixture({
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
        balances: { funds: 78400.5, reputation: 200, science: 100 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    // The number, its glyph and the spoken word are three elements, so match on visible text.
    await waitFor(() => expect(visibleText()).toContain("· 78,401f"));
  });

  it("renders facility tiers/upgrade costs derived from career.facilities", async () => {
    const fixture = setupStreamFixture({
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
        balances: { funds: 500000, reputation: 0, science: 0 },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    // 0-based tiers on the wire, 1-based display.
    await waitFor(() =>
      expect(screen.getByLabelText("Launch Pad tier 2 of 3")).toBeTruthy(),
    );
    expect(visibleText()).toContain("150.0k");
    expect(screen.getByLabelText("VAB tier 3 of 3")).toBeTruthy();
    expect(screen.getByText("MAX")).toBeTruthy();
  });

  it("renders the pad-vessel title from the streamed spaceCenter.launchSites array, not the legacy fallback", async () => {
    const fixture = setupStreamFixture({
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
        balances: { funds: 100000, reputation: 200, science: 100 },
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
