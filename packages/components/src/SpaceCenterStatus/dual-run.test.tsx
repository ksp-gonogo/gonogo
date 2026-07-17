import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import midCareer from "./__fixtures__/mid-career-mixed-no-tier-text.json";
import { SpaceCenterStatusComponent } from "./index";

/**
 * SpaceCenterStatus's reads are ALL canonical now — `career.status`
 * (`?.economy?.funds` + `?.facilities`), `spaceCenter.scene`
 * (`?.scene`/`?.launchSite`), `spaceCenter.partsAvailable` (`?.count`) and
 * the derived `spaceCenter.state` channel (pad occupancy) — none has a legacy
 * fallback. The original version of this test rendered the SAME career state
 * once off a legacy `DataSource` (`snapshotWidgetMode`, which mounts no
 * `TelemetryProvider`) and once off the stream, asserting byte-identical DOM;
 * that comparison is no longer possible — the legacy leg now renders nothing
 * but its empty state, since every one of its reads is stream-only. Same
 * underlying cause (full canonical migration, not a test bug) as
 * `TechTree`/`ScienceBench`/`TargetPicker`'s own `dual-run.test.tsx` files
 * dropping their now-impossible legacy legs.
 *
 * What remains, and is still worth its own file: the mid-career fixture run
 * genuinely through the stream pipeline in the shape the real wire actually
 * sends — `career.status.facilities` (CareerViewProvider.BuildFacilities) is
 * enum-keyed `currentTier`/`maxTier`/`upgradeCost` with no tier text, so this
 * fixture (unlike the tier-text `mid-career-mixed.json`) already omits it,
 * matching what `parseFacilityLevels` produces for a real enum-keyed entry.
 */
describe("SpaceCenterStatus — real mid-career fixture render off the stream (delay=0)", () => {
  it("renders funds, facility tiers and pad state off the stream, no legacy leg", async () => {
    const streamFixture = setupStreamFixture({
      carriedChannels: [
        "career.status",
        "spaceCenter.scene",
        "spaceCenter.partsAvailable",
        "spaceCenter.launchSites",
      ],
      pinnedUt: 10,
    });

    render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "scs-stream" }}>
          <SpaceCenterStatusComponent id="scs-stream" w={6} h={7} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    const facilities = midCareer["kc.facilityLevels"] as Record<
      string,
      { level: number; max: number; upgradeFunds: number }
    >;

    act(() => {
      streamFixture.emit("spaceCenter.scene", {
        scene: midCareer["kc.scene"],
        launchSite: midCareer["kc.launchSite"],
      });
      streamFixture.emit("spaceCenter.partsAvailable", {
        count: midCareer["kc.partsAvailable"],
      });
      streamFixture.emit("spaceCenter.launchSites", [
        {
          name: "__pad_occupancy__",
          padOccupied: midCareer["kc.padOccupied"],
          padVesselTitle: midCareer["kc.padVesselTitle"],
        },
      ]);
      streamFixture.emit("career.status", {
        economy: {
          funds: midCareer["career.funds"],
          reputation: null,
          science: null,
        },
        // Enum-keyed shape the real wire sends (currentTier/maxTier/
        // upgradeCost) — parseFacilityLevels resolves the enum keys to the
        // widget's short-code display names.
        facilities: {
          LaunchPad: {
            currentTier: facilities.launchPad.level,
            maxTier: facilities.launchPad.max,
            upgradeCost: facilities.launchPad.upgradeFunds || null,
          },
          VehicleAssemblyBuilding: {
            currentTier: facilities.vab.level,
            maxTier: facilities.vab.max,
            upgradeCost: facilities.vab.upgradeFunds || null,
          },
        },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() =>
      expect(
        screen.getByText(`· ${midCareer["career.funds"].toLocaleString()}f`),
      ).toBeTruthy(),
    );
    expect(screen.getByLabelText(/VAB tier \d of \d/)).toBeTruthy();
    expect(
      screen.getByText(String(midCareer["kc.partsAvailable"])),
    ).toBeTruthy();
  });
});
