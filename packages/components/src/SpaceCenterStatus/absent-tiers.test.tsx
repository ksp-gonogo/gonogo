import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { registerAugment } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { ContributionHost } from "../test/contributionHost";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceCenterStatusComponent } from "./index";

/**
 * What the facility grid does with a facility that said nothing. The producer
 * writes all nine keys either way, so "absent" arrives as an entry whose tiers
 * are both null; a tier of 0 is a different reading.
 */
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: [
      "career.status",
      "career.facilities",
      "spaceCenter.scene",
    ],
    pinnedUt: 10,
    suspendFrames: true,
  });
  const { container, unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "scs-absent" }}>
        {/* Without the identity `space-center-status.sections` resolves to nothing; without the store the grid has no tiers. */}
        <ContributionHost
          componentId="space-center-status"
          contributionSlots={["space-center-status.facilities"]}
        >
          <SpaceCenterStatusComponent id="scs-absent" w={9} h={10} />
        </ContributionHost>
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return { ...fixture, container };
}

function emitFacilities(
  fixture: ReturnType<typeof mount>,
  facilities: Record<string, unknown>,
) {
  act(() => {
    fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
    fixture.emit("career.facilities", { facilities });
    fixture.emit("career.status", {
      economy: { funds: 100_000, reputation: 0, science: 0 },
      contracts: null,
      strategies: null,
      tech: null,
    });
  });
}

/** All nine keys, the way the producer writes them, with nothing to say. */
const NINE_SILENT = Object.fromEntries(
  [
    "LaunchPad",
    "Runway",
    "VehicleAssemblyBuilding",
    "SpaceplaneHangar",
    "MissionControl",
    "TrackingStation",
    "Administration",
    "ResearchAndDevelopment",
    "AstronautComplex",
  ].map((name) => [
    name,
    { currentTier: null, maxTier: null, upgradeCost: null },
  ]),
);

describe("SpaceCenterStatus: facilities that reported no tier", () => {
  it("gives no cell to a facility that reported no tier", async () => {
    const fixture = mount();

    emitFacilities(fixture, {
      ...NINE_SILENT,
      LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 112_500 },
      VehicleAssemblyBuilding: {
        currentTier: 0,
        maxTier: 2,
        upgradeCost: 40_000,
      },
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Launch Pad tier 2 of 3")).toBeTruthy(),
    );
    expect(screen.getByLabelText("VAB tier 1 of 3")).toBeTruthy();
    for (const label of [
      "Runway",
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
  });

  /** Tier 0 is where every building starts, and is still an answer. */
  it("keeps the cell of a facility sitting at tier 0", async () => {
    const fixture = mount();

    emitFacilities(fixture, {
      ...NINE_SILENT,
      Runway: { currentTier: 0, maxTier: 2, upgradeCost: 9_000 },
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Runway tier 1 of 3")).toBeTruthy(),
    );
  });

  /** A building at its ceiling answered; it just has nowhere left to go. */
  it("keeps the cell of a facility already at its top tier", async () => {
    const fixture = mount();

    emitFacilities(fixture, {
      ...NINE_SILENT,
      TrackingStation: { currentTier: 2, maxTier: 2, upgradeCost: null },
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Tracking tier 3 of 3")).toBeTruthy(),
    );
    expect(screen.getByText("MAX")).toBeTruthy();
  });

  /** The whole-grid silence is stated once, as a short absence marker. */
  it("drops the grid and names the silence when no facility reported a tier", async () => {
    const fixture = mount();

    emitFacilities(fixture, NINE_SILENT);

    await waitFor(() =>
      expect(visibleText(fixture.container)).toContain("No facility tiers"),
    );
    expect(visibleText(fixture.container)).not.toContain("this telemetry");
    expect(screen.queryByText("Launch Pad")).toBeNull();
    expect(screen.queryByLabelText("Launch Pad tier unknown")).toBeNull();
  });

  /** Descriptions of tiers that never arrived are not a second missing thing. */
  it("does not also report missing tier descriptions when no tier arrived", async () => {
    const fixture = mount();

    emitFacilities(fixture, NINE_SILENT);

    await waitFor(() =>
      expect(visibleText(fixture.container)).toContain("No facility tiers"),
    );
    expect(visibleText(fixture.container)).not.toContain("No tier detail");
  });

  /** The marker is keyed on whether the facilities area drew anything, so an Uplink section that answered takes it off screen. */
  it("takes the marker off screen when an Uplink section draws tiers instead", async () => {
    registerAugment({
      id: "test-facility-tiers",
      augments: "space-center-status.sections",
      component: () => <div>Launch Pad · TIER 2</div>,
    });
    const fixture = mount();

    emitFacilities(fixture, NINE_SILENT);

    await waitFor(() =>
      expect(screen.getByText("Launch Pad · TIER 2")).toBeVisible(),
    );
    expect(screen.getByText("No facility tiers")).not.toBeVisible();
  });
});
