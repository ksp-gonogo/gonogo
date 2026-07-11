import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import midCareer from "./__fixtures__/mid-career-mixed-no-tier-text.json";
import { SpaceCenterStatusComponent } from "./index";

/**
 * SpaceCenterStatus's career behavior-preservation golden
 * dual-run (mirrors `DistanceToTarget/dual-run.test.tsx`): the SAME career
 * state, rendered once off the legacy `DataSource`
 * and once off the stream, must produce byte-identical DOM at `delay=0`.
 * `career.funds` (78400) AND `kc.facilityLevels` (-> `career.status.
 * facilities`) are both migrated — the
 * fixture uses `mid-career-mixed-no-tier-text.json`, not
 * `mid-career-mixed.json`: `career.status.facilities`
 * (CareerViewProvider.BuildFacilities) has no `currentLevelText`/
 * `nextLevelText` field at all, so a byte-identical comparison needs a
 * legacy fixture that already renders the same "older DLL, no tier text"
 * shape `parseFacilityLevels` produces for an enum-keyed entry (see that
 * fixture's own `_meta.notes`). `scene` (-> `spaceCenter.scene.scene`) is
 * migrated too — the legacy leg still reads
 * it off the plain `DataSource` (that leg never mounts a
 * `TelemetryProvider`, so the shim's carried-channels gate keeps it on the
 * legacy path there); the stream leg now feeds it through the fixture's
 * `spaceCenter.scene` topic instead of a legacy AUX `DataSource`.
 * `kc.partsAvailable` (-> `spaceCenter.partsAvailable.count`) is migrated
 * too — the stream leg feeds it through `spaceCenter.partsAvailable`
 * instead of the legacy AUX. `launchSite`/`padOccupied`/`padVesselTitle`
 * stay legacy on both legs.
 */
afterEach(() => {
  cleanup();
});

describe("SpaceCenterStatus — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same career state", async () => {
    const mode = { name: "default-6x7", w: 6, h: 7 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: SpaceCenterStatusComponent,
      fixture: midCareer,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: [
        "career.status",
        "spaceCenter.scene",
        "spaceCenter.partsAvailable",
      ],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [
        { key: "kc.launchSite" },
        { key: "kc.padOccupied" },
        { key: "kc.padVesselTitle" },
      ],
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "scs-dual" }}>
          <SpaceCenterStatusComponent id="scs-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    // Emit the STREAM value first (funds AND facilities — both live under
    // career.status now) and let its frame settle before the legacy kc.*
    // pad/parts data arrives. `career.status` lands one microtask late
    // (TelemetryProvider's `scheduleFrame`, no rAF in jsdom) — if the pad
    // data (which gates the padLine subtitle) arrived first instead, some
    // DOM would mount in a different attribute/child order than the
    // legacy leg's single-batched-emit fresh mount. Settling career.status
    // first means every facility cell + the funds readout mount fresh,
    // once, exactly like the legacy leg.
    act(() => {
      streamFixture.emit("spaceCenter.scene", {
        scene: midCareer["kc.scene"],
      });
      streamFixture.emit("spaceCenter.partsAvailable", {
        count: midCareer["kc.partsAvailable"],
      });
      streamFixture.emit("career.status", {
        economy: {
          funds: midCareer["career.funds"],
          reputation: null,
          science: null,
        },
        facilities: {
          LaunchPad: {
            currentTier: midCareer["kc.facilityLevels"].launchPad.level,
            maxTier: midCareer["kc.facilityLevels"].launchPad.max,
            upgradeCost:
              midCareer["kc.facilityLevels"].launchPad.upgradeFunds || null,
          },
          Runway: {
            currentTier: midCareer["kc.facilityLevels"].runway.level,
            maxTier: midCareer["kc.facilityLevels"].runway.max,
            upgradeCost:
              midCareer["kc.facilityLevels"].runway.upgradeFunds || null,
          },
          VehicleAssemblyBuilding: {
            currentTier: midCareer["kc.facilityLevels"].vab.level,
            maxTier: midCareer["kc.facilityLevels"].vab.max,
            upgradeCost:
              midCareer["kc.facilityLevels"].vab.upgradeFunds || null,
          },
          SpaceplaneHangar: {
            currentTier: midCareer["kc.facilityLevels"].sph.level,
            maxTier: midCareer["kc.facilityLevels"].sph.max,
            upgradeCost:
              midCareer["kc.facilityLevels"].sph.upgradeFunds || null,
          },
          MissionControl: {
            currentTier: midCareer["kc.facilityLevels"].mission.level,
            maxTier: midCareer["kc.facilityLevels"].mission.max,
            upgradeCost:
              midCareer["kc.facilityLevels"].mission.upgradeFunds || null,
          },
          TrackingStation: {
            currentTier: midCareer["kc.facilityLevels"].tracking.level,
            maxTier: midCareer["kc.facilityLevels"].tracking.max,
            upgradeCost:
              midCareer["kc.facilityLevels"].tracking.upgradeFunds || null,
          },
          Administration: {
            currentTier: midCareer["kc.facilityLevels"].admin.level,
            maxTier: midCareer["kc.facilityLevels"].admin.max,
            upgradeCost:
              midCareer["kc.facilityLevels"].admin.upgradeFunds || null,
          },
          ResearchAndDevelopment: {
            currentTier: midCareer["kc.facilityLevels"].rd.level,
            maxTier: midCareer["kc.facilityLevels"].rd.max,
            upgradeCost: midCareer["kc.facilityLevels"].rd.upgradeFunds || null,
          },
          AstronautComplex: {
            currentTier: midCareer["kc.facilityLevels"].astronaut.level,
            maxTier: midCareer["kc.facilityLevels"].astronaut.max,
            upgradeCost:
              midCareer["kc.facilityLevels"].astronaut.upgradeFunds || null,
          },
        },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });
    await waitFor(() => {
      if (!container.textContent?.includes("78,400f")) {
        throw new Error("stream leg has not rendered funds yet");
      }
    });

    act(() => {
      legacyAux.source.emit("kc.launchSite", midCareer["kc.launchSite"]);
      legacyAux.source.emit("kc.padOccupied", midCareer["kc.padOccupied"]);
      legacyAux.source.emit(
        "kc.padVesselTitle",
        midCareer["kc.padVesselTitle"],
      );
    });

    await waitFor(() => {
      if (!container.textContent?.includes("On pad:")) {
        throw new Error("stream leg has not rendered facility data yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
