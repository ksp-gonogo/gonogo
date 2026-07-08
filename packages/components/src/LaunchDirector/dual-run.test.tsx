import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import preLaunch from "./__fixtures__/pre-launch-mixed.json";
import { LaunchDirectorComponent } from "./index";

/**
 * LaunchDirector's M3 career batch behavior-preservation golden dual-run
 * (mirrors `SpaceCenterStatus/dual-run.test.tsx`): the SAME pre-launch
 * state, rendered once off the legacy `DataSource` and once off the stream,
 * must produce byte-identical DOM at `delay=0`. `career.funds` (42500) is
 * the only migrated field — every other fixture key (`kc.savedShips`/
 * `crewRoster`/`padOccupied`/`padVesselTitle`/`launchSite`/`launchSites`/
 * `scene`) stays legacy on both legs.
 */
afterEach(() => {
  cleanup();
});

describe("LaunchDirector — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same pre-launch state", async () => {
    const mode = { name: "default-7x10", w: 7, h: 10 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: LaunchDirectorComponent,
      fixture: preLaunch,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [
        { key: "kc.savedShips" },
        { key: "kc.crewRoster" },
        { key: "kc.padOccupied" },
        { key: "kc.padVesselTitle" },
        { key: "kc.launchSite" },
        { key: "kc.launchSites" },
        { key: "kc.scene" },
      ],
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ld-dual" }}>
          <LaunchDirectorComponent id="ld-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    // Single batch, mirroring the legacy leg's `snapshotWidgetMode` (which
    // emits every fixture key inside one `act()`) — LaunchDirector's funds
    // readout only renders once `ships !== null` (kc.savedShips has
    // arrived), so unlike SpaceCenterStatus's per-facility UpgradeButton
    // (gated on a bare HTML `disabled` attribute that can get appended
    // out-of-order across two renders) there's no fresh-mount-vs-update
    // hazard here to stagger around — every funds-dependent value renders
    // via `aria-disabled`/styled-component props, always present from the
    // first render regardless of value.
    act(() => {
      legacyAux.source.emit("kc.savedShips", preLaunch["kc.savedShips"]);
      legacyAux.source.emit("kc.crewRoster", preLaunch["kc.crewRoster"]);
      legacyAux.source.emit("kc.padOccupied", preLaunch["kc.padOccupied"]);
      legacyAux.source.emit(
        "kc.padVesselTitle",
        preLaunch["kc.padVesselTitle"],
      );
      legacyAux.source.emit("kc.launchSite", preLaunch["kc.launchSite"]);
      legacyAux.source.emit("kc.launchSites", preLaunch["kc.launchSites"]);
      legacyAux.source.emit("kc.scene", preLaunch["kc.scene"]);
      streamFixture.emit("career.status", {
        economy: {
          funds: preLaunch["career.funds"],
          reputation: null,
          science: null,
        },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("42,500f")) {
        throw new Error("stream leg has not rendered funds yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
