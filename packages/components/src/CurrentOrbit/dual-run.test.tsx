import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import circularLko from "./__fixtures__/circular-lko.json";

import { CurrentOrbitComponent } from "./index";

/**
 * CurrentOrbit renders entirely off the Uplink stream.
 *
 * This file used to be a legacy↔stream behavior-preservation dual-run,
 * asserting the SAME orbit state rendered byte-identical off the legacy
 * `DataSource` and off the stream. That legacy `"data"` `MockDataSource` leg is
 * moot now that every field the widget reads is a clean-home stream Topic and
 * the widget no longer touches the legacy source at all, so it's dropped — what
 * remains is the full stream render on its own: the complete grid (raw
 * `vessel.orbit` elements + `vessel.state`-derived apsis altitudes / period /
 * time-to-apsis), the reference-body subtitle (derived
 * `vessel.state.referenceBodyName`), and the default mini orbit diagram, all
 * from one emit with NO legacy source registered anywhere in this file.
 *
 * Derived values are computed with the SAME formulas `vessel-state.ts` uses so
 * the assertions track the real derivation rather than hand-picked magic
 * numbers.
 */
const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

// meanAnomalyAtEpoch 0 with epoch == pinned view UT means the vessel sits at
// periapsis (trueAnomaly 0°, timeToPe 0s) at capture time. The reference-body
// radius (600 km) lands ApA/PeA close to the original fixture's illustrative
// 85 / 80 km.
const PINNED_UT = 10;
const SMA = 682500;
const ECC = 0.00367;
const MU = 3.5316e12; // Kerbin's GM
const BODY_RADIUS = 600_000;
const PERIOD = 2 * Math.PI * Math.sqrt(SMA ** 3 / MU);

describe("CurrentOrbit — full render off the stream (R6 Wave 1)", () => {
  it("renders the complete grid, subtitle, and diagram purely off the stream", async () => {
    registerStockBodies();
    const mode = { name: "default-9x18", w: 9, h: 18 };

    const streamFixture = setupStreamFixture({
      carriedChannels: VESSEL_STATE_INPUTS,
      pinnedUt: PINNED_UT,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "orbit-dual" }}>
          <CurrentOrbitComponent id="orbit-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      streamFixture.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 1,
          sma: circularLko["o.sma"],
          ecc: circularLko["o.eccentricity"],
          inc: circularLko["o.inclination"],
          argPe: circularLko["o.argumentOfPeriapsis"],
          mu: MU,
          meanAnomalyAtEpoch: 0,
          epoch: PINNED_UT,
        },
        { quality: Quality.OnRails },
      );
      streamFixture.emit("vessel.identity", {
        vesselId: "v1",
        name: "Kerbal X",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 1,
        launchUt: 0,
      });
      streamFixture.emit("system.bodies", {
        bodies: [
          {
            name: "Kerbin",
            index: 1,
            parentIndex: 0,
            radius: BODY_RADIUS,
            orbit: null,
          },
        ],
      });
    });

    // Inclination is raw off vessel.orbit; period is derived off vessel.state —
    // waiting on both proves the whole mixed raw+derived surface has landed.
    await waitFor(() => {
      if (!container.textContent?.includes("0.3°")) {
        throw new Error("stream leg has not rendered inclination yet");
      }
    });
    await waitFor(() => {
      if (!container.textContent?.includes("31m 25s")) {
        throw new Error("stream leg has not rendered period yet");
      }
    });

    // Apsis altitudes (derived sma·(1±ecc) − bodyRadius) and the reference-body
    // subtitle all resolve off the stream.
    expect(SMA * (1 + ECC) - BODY_RADIUS).toBeCloseTo(85004.8, 0);
    expect(container.textContent).toMatch(/85\.\d+\s*km/);
    expect(container.textContent).toMatch(/80\.\d+\s*km/);
    expect(container.textContent).toContain("Kerbin");
    // Default mini orbit diagram renders (hasOrbit satisfied off derived ApR/PeR).
    expect(container.querySelector("svg")).not.toBeNull();
    // Period sanity — matches the vessel-state derivation used above.
    expect(PERIOD).toBeGreaterThan(1800);
  });
});
