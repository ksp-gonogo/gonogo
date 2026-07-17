import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";
import { act, render, waitFor } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import earlyGame from "./__fixtures__/early-game-t1.json";
import flightScene from "./__fixtures__/flight-scene-upgrades-disabled.json";
import fullyUpgraded from "./__fixtures__/fully-upgraded-t3.json";
import lowFunds from "./__fixtures__/low-funds-expensive-upgrade.json";
import midCareer from "./__fixtures__/mid-career-mixed.json";
import sandbox from "./__fixtures__/sandbox-no-career.json";
import { SpaceCenterStatusComponent } from "./index";

const FIXTURES = {
  "early-game-t1": earlyGame,
  "mid-career-mixed": midCareer,
  "fully-upgraded-t3": fullyUpgraded,
  "sandbox-no-career": sandbox,
  "low-funds-expensive-upgrade": lowFunds,
  "flight-scene-upgrades-disabled": flightScene,
};

interface LegacyFixture {
  [key: string]: unknown;
}

const CARRIED = [
  "career.status",
  "spaceCenter.scene",
  "spaceCenter.partsAvailable",
  "spaceCenter.launchSites",
];

/**
 * These fixtures were authored against the pre-migration legacy `DataSource`
 * keys — every read this widget makes now has a real wire home (see
 * `stream.test.tsx`'s doc comment), so this maps each legacy key onto the
 * topic it now resolves through and emits it on a genuine `TelemetryProvider`
 * pipeline rather than a `setupMockDataSource` fixture the widget no longer
 * reads. `kc.facilityLevels` is emitted VERBATIM under
 * `career.status.facilities` — `parseFacilityLevels` accepts the legacy
 * short-code `level`/`max`/`upgradeFunds` (+ optional tier text) shape
 * alongside the enum-keyed `currentTier`/`maxTier` wire shape, so these
 * fixtures keep exercising the same render (including `mid-career-mixed`'s
 * tier text) they did off the legacy `DataSource`. `kc.padOccupied`/
 * `kc.padVesselTitle` feed a synthetic occupancy-only `spaceCenter.launchSites`
 * entry (no `unlocked`/`ready`, so it never shows in a site picker) that the
 * `spaceCenter.state` derived channel reads — same trick
 * `LaunchDirector/snapshots.test.tsx` documents.
 */
function emitLegacyFixture(
  stream: ReturnType<typeof setupStreamFixture>,
  fixture: LegacyFixture,
) {
  stream.emit("spaceCenter.scene", {
    scene: fixture["kc.scene"],
    launchSite: fixture["kc.launchSite"],
  });
  stream.emit("spaceCenter.partsAvailable", {
    count: fixture["kc.partsAvailable"],
  });
  stream.emit("spaceCenter.launchSites", [
    {
      name: "__pad_occupancy__",
      padOccupied: fixture["kc.padOccupied"] ?? false,
      padVesselTitle: fixture["kc.padVesselTitle"] ?? null,
    },
  ]);
  stream.emit("career.status", {
    economy: {
      funds: fixture["career.funds"],
      reputation: null,
      science: null,
    },
    facilities: fixture["kc.facilityLevels"],
    contracts: null,
    strategies: null,
    tech: null,
  });
}

async function snapshotSpaceCenterFixture(
  fixture: LegacyFixture,
  mode: {
    name: string;
    w: number;
    h: number;
    config?: Record<string, unknown>;
  },
): Promise<string> {
  registerStockBodies();
  const stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });

  const { container } = render(
    <ThemeProvider theme={defaultDarkTheme}>
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
          <SpaceCenterStatusComponent
            config={mode.config}
            id="snap"
            w={mode.w}
            h={mode.h}
          />
        </DashboardItemContext.Provider>
      </stream.Provider>
    </ThemeProvider>,
  );

  act(() => {
    emitLegacyFixture(stream, fixture);
  });

  // The stream frame lands one microtask late (TelemetryProvider's
  // scheduleFrame, no rAF in jsdom); wait for career.status to go live —
  // the OFFLINE/SYNCING stream-status badge disappears once it does — so
  // every facility cell + the funds readout mount once before snapshotting.
  await waitFor(() => {
    if (/OFFLINE|SYNCING/.test(container.textContent ?? "")) {
      throw new Error("stream leg has not gone live yet");
    }
  });

  return stripVolatile(container.innerHTML);
}

const config = getWidget("space-center-status");
if (!config) throw new Error("space-center-status missing from widgets.ts");

describe("SpaceCenterStatus DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotSpaceCenterFixture(fixture, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
