import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";

import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import awaiting from "./__fixtures__/awaiting.json";
import inFlightAscent from "./__fixtures__/in-flight-ascent.json";
import inFlightCrash from "./__fixtures__/in-flight-crash.json";
import padOccupied from "./__fixtures__/pad-occupied.json";
import preLaunchInsufficient from "./__fixtures__/pre-launch-insufficient-funds.json";
import preLaunchMixed from "./__fixtures__/pre-launch-mixed.json";
import { LaunchDirectorComponent } from "./index";

const FIXTURES = {
  awaiting,
  "pre-launch-mixed": preLaunchMixed,
  "pre-launch-insufficient-funds": preLaunchInsufficient,
  "pad-occupied": padOccupied,
  "in-flight-ascent": inFlightAscent,
  "in-flight-crash": inFlightCrash,
};

interface LegacyFixture {
  [key: string]: unknown;
}

const CARRIED = [
  "career.status",
  "spaceCenter.savedShips",
  "spaceCenter.crewRoster",
  "spaceCenter.scene",
  "spaceCenter.launchSites",
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
  "ksp.revertAvailability",
  "crash.hasRecent",
  "crash.lastCrash",
];

/**
 * These fixtures were authored against the pre-migration legacy `DataSource`
 * keys — every one of those keys now has a real wire home (see
 * `stream.test.tsx`'s doc comment for the full read list), so this maps each
 * legacy key onto the real topic(s) it now resolves through and emits it on
 * a genuine `TelemetryProvider` pipeline, rather than a `setupMockDataSource`
 * fixture the widget no longer reads.
 *
 * Two deliberate, documented drops from a literal 1:1 replay:
 * - `v.missionTime`/`v.altitude` can't BOTH resolve simultaneously off the
 *   real `vessel.state` derivation — `met` only derives in the OnRails
 *   basis, `altitudeAsl` only in the Loaded basis (`vessel-state.ts`'s own
 *   doc; see `stream.test.tsx`). This always emits the Loaded basis (real
 *   `altitudeAsl`, `met` stays null/"—") since the in-flight fixtures were
 *   authored to show the altitude readout.
 * - `tar.availableVessels` (-> `system.vessels`) ships the OLD bare-array
 *   roster shape; the new `system.vessels` topic is a `{ vessels: [...] }`
 *   object the vessel-switcher hasn't been migrated to normalise yet
 *   (`index.tsx`'s own comment). Emitting the old array onto the new topic
 *   would misrepresent what the real wire actually sends, so it's left
 *   unemitted — the switcher renders its real, current empty state.
 */
function emitLegacyFixture(
  stream: ReturnType<typeof setupStreamFixture>,
  fixture: LegacyFixture,
) {
  stream.emit("spaceCenter.scene", {
    scene: fixture["kc.scene"],
    launchSite: fixture["kc.launchSite"],
  });
  // A synthetic occupancy-only entry (no `unlocked`/`ready`) so it never
  // shows up in the site picker itself — `deriveSpaceCenterState` just scans
  // for ANY entry with a boolean `padOccupied`, same trick
  // `SpaceCenterStatus/stream.test.tsx` documents.
  stream.emit("spaceCenter.launchSites", [
    ...((fixture["kc.launchSites"] as unknown[] | undefined) ?? []),
    {
      name: "__pad_occupancy__",
      padOccupied: fixture["kc.padOccupied"] ?? false,
      padVesselTitle: fixture["kc.padVesselTitle"] ?? null,
    },
  ]);
  if (fixture["career.funds"] !== undefined) {
    stream.emit("career.status", {
      economy: {
        funds: fixture["career.funds"],
        reputation: null,
        science: null,
      },
      facilities: null,
      contracts: null,
      strategies: null,
      tech: null,
    });
  }
  if (fixture["kc.savedShips"] !== undefined) {
    stream.emit("spaceCenter.savedShips", fixture["kc.savedShips"]);
  }
  if (fixture["kc.crewRoster"] !== undefined) {
    stream.emit("spaceCenter.crewRoster", fixture["kc.crewRoster"]);
  }
  if (fixture["v.name"] !== undefined) {
    stream.emit("vessel.identity", {
      vesselId: fixture["v.name"],
      name: fixture["v.name"],
      vesselType: 0,
      situation: 0,
      parentBodyIndex: 1,
      launchUt: null,
    });
  }
  if (fixture["v.altitude"] !== undefined) {
    stream.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: 700000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        mu: 3.5316e12,
      },
      { quality: 1 },
    );
    stream.emit("vessel.flight", {
      latitude: 0,
      longitude: 0,
      altitudeAsl: fixture["v.altitude"],
      altitudeTerrain: fixture["v.altitude"],
      verticalSpeed: 0,
      surfaceSpeed: 0,
      orbitalSpeed: 0,
      gForce: 1,
      dynamicPressureKPa: 0,
      mach: 0,
      atmDensity: 0,
    });
  }
  if (
    fixture["ksp.canRevertToLaunch"] !== undefined ||
    fixture["ksp.canRevertToEditor"] !== undefined
  ) {
    stream.emit("ksp.revertAvailability", {
      canRevertToLaunch: fixture["ksp.canRevertToLaunch"] ?? false,
      canRevertToEditor: fixture["ksp.canRevertToEditor"] ?? false,
    });
  }
  if (fixture["crash.hasRecent"] !== undefined) {
    stream.emit("crash.hasRecent", fixture["crash.hasRecent"]);
  }
  if (fixture["crash.lastCrash"] !== undefined) {
    stream.emit("crash.lastCrash", fixture["crash.lastCrash"]);
  }
}

async function snapshotLaunchDirectorFixture(
  fixture: LegacyFixture,
  mode: { name: string; w: number; h: number },
): Promise<string> {
  registerStockBodies();
  const stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });

  const { container } = render(
    <stream.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
        <LaunchDirectorComponent id="snap" w={mode.w} h={mode.h} />
      </DashboardItemContext.Provider>
    </stream.Provider>,
  );

  act(() => {
    emitLegacyFixture(stream, fixture);
  });

  await waitFor(() => {
    if (
      fixture["kc.savedShips"] !== undefined &&
      container.textContent?.includes("Awaiting launch-pad telemetry")
    ) {
      throw new Error("saved ships have not rendered yet");
    }
  });

  return stripVolatile(container.innerHTML);
}

const config = getWidget("launch-director");
if (!config) throw new Error("launch-director missing from widgets.ts");

describe("LaunchDirector DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotLaunchDirectorFixture(fixture, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
