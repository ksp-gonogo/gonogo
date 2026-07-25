import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import duna from "./__fixtures__/duna-thin-atmosphere.json";
import eve from "./__fixtures__/eve-thick-atmosphere.json";
import reentry from "./__fixtures__/kerbin-reentry.json";
import seaLevel from "./__fixtures__/kerbin-sea-level.json";
import upper from "./__fixtures__/kerbin-upper-atmosphere.json";
import mun from "./__fixtures__/mun-vacuum.json";
import { AtmosphereProfileComponent } from "./index";

/**
 * DOM snapshots off the stream (`TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore`) pipeline — the widget's legacy `MockDataSource` fallback
 * is gone (all five reads are native), so the generic `snapshotWidgetMode`
 * harness (which emits fixture keys straight onto a `MockDataSource`) can't
 * drive it any more. Each fixture's legacy `v.body`/`v.altitude`/
 * `v.atmosphericDensity`/`v.atmosphericTemperature`/`v.externalTemperature`
 * keys are mapped here onto the native `vessel.state`/`vessel.flight` shapes
 * the widget reads: `v.body` -> `vessel.identity.parentBodyIndex` resolved
 * against a single-entry `system.bodies` table; `v.altitude` ->
 * `vessel.flight.altitudeAsl` (the "measured"/Loaded basis, so
 * `vessel.state.altitudeAsl` derives it); the three others -> the matching
 * raw `vessel.flight` fields.
 */

interface Fixture {
  _meta?: unknown;
  [key: string]: unknown;
}

const FIXTURES: Record<string, Fixture> = {
  "kerbin-sea-level": seaLevel,
  "kerbin-upper-atmosphere": upper,
  "kerbin-reentry": reentry,
  "eve-thick-atmosphere": eve,
  "duna-thin-atmosphere": duna,
  "mun-vacuum": mun,
};

const CARRIED_CHANNELS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

function buildVesselFlight(fixture: Fixture): Record<string, unknown> {
  return {
    altitudeAsl: fixture["v.altitude"],
    atmDensity: fixture["v.atmosphericDensity"],
    atmosphericTemperature: fixture["v.atmosphericTemperature"],
    externalTemperature: fixture["v.externalTemperature"],
  };
}

const config = getWidget("atmosphere-profile");
if (!config) throw new Error("atmosphere-profile missing from widgets.ts");

describe("AtmosphereProfile DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        registerStockBodies();
        const stream = setupStreamFixture({
          carriedChannels: CARRIED_CHANNELS,
          pinnedUt: 10,
        });
        const mergedConfig = { ...(mode.config ?? {}) };

        const { container } = render(
          <stream.Provider>
            <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
              <AtmosphereProfileComponent
                config={mergedConfig}
                id="snap"
                w={mode.w}
                h={mode.h}
              />
            </DashboardItemContext.Provider>
          </stream.Provider>,
        );

        act(() => {
          // Loaded quality drives deriveVesselState onto the "measured"
          // basis, which reads altitudeAsl off vessel.flight.
          stream.emit("vessel.orbit", {}, { quality: Quality.Loaded });
          stream.emit("vessel.flight", buildVesselFlight(fixture));
          stream.emit("vessel.identity", { parentBodyIndex: 1 });
          stream.emit("system.bodies", {
            bodies: [
              {
                name: fixture["v.body"],
                index: 1,
                parentIndex: 0,
                radius: 600_000,
                orbit: null,
              },
            ],
          });
        });

        await waitFor(() => {
          if (container.textContent?.includes("SYNCING")) {
            throw new Error("stream status has not settled to live yet");
          }
        });

        expect(stripVolatile(container.innerHTML)).toMatchSnapshot();
      });
    }
  }
});
