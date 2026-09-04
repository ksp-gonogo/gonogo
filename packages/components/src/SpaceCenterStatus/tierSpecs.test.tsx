import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";
import { ContributionHost } from "../test/contributionHost";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceCenterStatusComponent } from "./index";

/**
 * What a facility cell does with KSP's own tier descriptions. They arrive as
 * the stock upgrade dialog's asterisk-bulleted blob, they are game copy rather
 * than a contract, and either tier's half can be missing.
 */
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

/**
 * `settledLabel` is the accessible name of a tier the payload sets, and it is
 * required: the facility NAMES render before any telemetry arrives, so waiting
 * on one of those returns on the first tick with an empty grid behind it.
 */
async function renderWithFacilities(
  facilities: Record<string, unknown>,
  settledLabel: string,
) {
  const fixture = setupStreamFixture({
    carriedChannels: ["career.status", "spaceCenter.scene"],
    pinnedUt: 10,
    suspendFrames: true,
  });
  const { unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "scs-tiers" }}>
        <ContributionHost
          componentId="space-center-status"
          contributionSlots={["space-center-status.facilities"]}
        >
          <SpaceCenterStatusComponent id="scs-tiers" w={9} h={10} />
        </ContributionHost>
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  act(() => {
    fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
    fixture.emit("career.status", {
      economy: { funds: 100000, reputation: 0, science: 0 },
      facilities,
      contracts: null,
      strategies: null,
      tech: null,
    });
  });
  await waitFor(() => expect(screen.getByLabelText(settledLabel)).toBeTruthy());
}

describe("SpaceCenterStatus tier descriptions", () => {
  it("shows a bulleted property as a label and a value, with no asterisk", async () => {
    await renderWithFacilities(
      {
        launchPad: {
          level: 1,
          max: 2,
          upgradeFunds: 150000,
          currentLevelText: "* Max Size: 140t\n* Max Parts: 255",
          nextLevelText: "* Max Size: Unlimited\n* Max Parts: Unlimited",
        },
      },
      "Launch Pad tier 2 of 3",
    );

    const texts = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(texts).toContain("Max Size140t");
    expect(texts).toContain("Max Parts255");
    expect(texts).toContain("Max SizeUnlimited");
    expect(texts.join("")).not.toContain("*");
  });

  it("keeps a line that names no property, rather than dropping it", async () => {
    await renderWithFacilities(
      {
        tracking: {
          level: 0,
          max: 2,
          upgradeFunds: 45000,
          currentLevelText: "* No maneuver nodes",
          nextLevelText: "Patched conics (full)",
        },
      },
      "Tracking tier 1 of 3",
    );

    const texts = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(texts).toContain("No maneuver nodes");
    expect(texts).toContain("Patched conics (full)");
  });

  it("names a missing tier description instead of leaving a gap", async () => {
    await renderWithFacilities(
      {
        launchPad: {
          level: 1,
          max: 2,
          upgradeFunds: 150000,
          currentLevelText: "",
          nextLevelText: "* Max Size: Unlimited",
        },
      },
      "Launch Pad tier 2 of 3",
    );

    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    // One dash, and it is the launch pad's own empty NOW block. The eight
    // facilities the payload never mentions get no cell at all: an absent
    // facility has no description to be missing, and eight dashes for them
    // buried the one that genuinely is.
    expect(screen.getAllByText(NULL_DISPLAY)).toHaveLength(1);
  });

  it("offers no next tier once the facility is at its ceiling", async () => {
    await renderWithFacilities(
      {
        vab: {
          level: 2,
          max: 2,
          upgradeFunds: 0,
          currentLevelText: "* Max Parts: Unlimited",
          nextLevelText: "",
        },
      },
      "VAB tier 3 of 3",
    );

    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
  });

  it("says once that the telemetry carries no tier descriptions at all", async () => {
    await renderWithFacilities(
      {
        launchPad: { level: 1, max: 2, upgradeFunds: 150000 },
        vab: { level: 2, max: 2, upgradeFunds: 0 },
      },
      "Launch Pad tier 2 of 3",
    );

    expect(screen.getByText("No tier detail")).toBeInTheDocument();
    expect(screen.queryByText("Now")).not.toBeInTheDocument();
  });

  it("drops the tier lists where a cell is too narrow to hold them", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status", "spaceCenter.scene"],
      pinnedUt: 10,
      suspendFrames: true,
    });
    const { unmount } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "scs-narrow" }}>
          <ContributionHost
            componentId="space-center-status"
            contributionSlots={["space-center-status.facilities"]}
          >
            <SpaceCenterStatusComponent id="scs-narrow" w={6} h={7} />
          </ContributionHost>
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("career.status", {
        economy: { funds: 100000, reputation: 0, science: 0 },
        facilities: {
          launchPad: {
            level: 1,
            max: 2,
            upgradeFunds: 150000,
            currentLevelText: "* Max Size: 140t",
            nextLevelText: "* Max Size: Unlimited",
          },
        },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Launch Pad tier 2 of 3")).toBeTruthy(),
    );

    expect(screen.queryByText("Now")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
