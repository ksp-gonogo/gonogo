import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { registerAugment, WidgetMetaContext } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceCenterStatusComponent } from "./index";

/**
 * What the facility grid does with a facility that said nothing.
 *
 * KSP puts the space centre's buildings in the scene only at the space centre,
 * so `career.status.facilities` answers a tier for all nine or for none, and a
 * cold first frame inside the scene answers for none too. The producer still
 * writes all nine keys either way, so "absent" arrives as a populated entry
 * whose `currentTier` and `maxTier` are both null.
 *
 * A tier of 0 is not that. It is the tier every career starts at, and the
 * distinction is the whole point of the grid.
 */
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: ["career.status", "spaceCenter.scene"],
    pinnedUt: 10,
    suspendFrames: true,
  });
  const { container, unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "scs-absent" }}>
        {/* The identity the orchestrator mounts, so `space-center-status.sections`
            resolves and an Uplink's section is reachable from here. Without it
            the segment slot renders nothing and the fallback below could never
            be proved to hide. */}
        <WidgetMetaContext.Provider
          value={{
            componentId: "space-center-status",
            contributionSlots: [],
          }}
        >
          <SpaceCenterStatusComponent id="scs-absent" w={9} h={10} />
        </WidgetMetaContext.Provider>
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
    fixture.emit("career.status", {
      economy: { funds: 100_000, reputation: 0, science: 0 },
      facilities,
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
  /**
   * The reported defect: six of nine cells held a bare em-dash, which is the
   * same non-answer written out six times. The grid already makes this
   * argument once, for the tier descriptions.
   */
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

  /**
   * Absent and zero are different readings and the grid has to keep saying
   * which. Tier 0 is where every building starts, and a career standing at the
   * bottom of the ladder is exactly who needs the rung count.
   */
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

  /**
   * The grid going silently would leave the widget looking like it failed to
   * draw, so the whole-grid silence is stated once, the way the tier
   * descriptions' is.
   *
   * <para>An absence MARKER, not an explanation. What replaced the sentence
   * here is the shortest reading that is still a reading: naming the telemetry
   * it did not arrive on told the operator where to look for a fault they
   * cannot fix, which is guidance wearing a reading's clothes.</para>
   */
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

  /**
   * Two absence lines for one absence. The descriptions of tiers that never
   * arrived are not a second missing thing.
   */
  it("does not also report missing tier descriptions when no tier arrived", async () => {
    const fixture = mount();

    emitFacilities(fixture, NINE_SILENT);

    await waitFor(() =>
      expect(visibleText(fixture.container)).toContain("No facility tiers"),
    );
    expect(visibleText(fixture.container)).not.toContain("No tier detail");
  });

  /**
   * The absence is about the FACILITIES AREA, not about this widget's own
   * channel, and an Uplink section is part of that area.
   *
   * <para>`career.status.facilities` reads the live `UpgradeableFacility`
   * objects KSP instantiates at the space centre only, so it is silent through
   * most of a session. RP-1 reads the same tiers out of its own config in every
   * scene. With the marker keyed on this widget's channel alone, an operator
   * flying an RP-1 career saw "no facility tiers" sitting directly above a list
   * of their facility tiers. The marker is keyed on whether the area drew
   * ANYTHING instead, so a section that answered takes it off screen.</para>
   */
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
