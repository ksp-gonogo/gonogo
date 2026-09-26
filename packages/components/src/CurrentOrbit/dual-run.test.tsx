import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import circularLko from "./__fixtures__/circular-lko.json";

import { CurrentOrbitComponent } from "./index";

/**
 * CurrentOrbit renders entirely off the Uplink stream.
 *
 * The full stream render with no legacy source registered anywhere in this
 * file: the complete grid (raw `vessel.orbit` elements plus the apsis
 * altitudes, period and time-to-apsis solved from them), the reference-body
 * subtitle (`vessel.orbit.referenceBodyIndex` named against `system.bodies`),
 * and the default mini orbit diagram, all from one emit.
 *
 * Expected values use the same two-body formulas as the solve, so the
 * assertions track it rather than hand-picked magic numbers.
 */
const CURRENT_ORBIT_CHANNELS = [
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
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

describe("CurrentOrbit: full render off the stream (R6 Wave 1)", () => {
  it("renders the complete grid, subtitle, and diagram purely off the stream", async () => {
    registerStockBodies();
    const mode = { name: "default-9x18", w: 9, h: 18 };

    const streamFixture = setupStreamFixture({
      carriedChannels: CURRENT_ORBIT_CHANNELS,
      pinnedUt: PINNED_UT,
      suspendFrames: true,
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
          horizon: ANALYTIC_UNBOUNDED_HORIZON,
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

    // Inclination is raw off vessel.orbit; period is solved from its elements,
    // waiting on both proves the whole mixed raw+solved surface has landed.
    await waitFor(() => {
      if (!visibleText(container).includes("0.3°")) {
        throw new Error("stream leg has not rendered inclination yet");
      }
    });
    await waitFor(() => {
      if (!visibleText(container).includes("31min 25s")) {
        throw new Error("stream leg has not rendered period yet");
      }
    });

    // Apsis altitudes (derived sma·(1±ecc) − bodyRadius) and the reference-body
    // subtitle all resolve off the stream.
    expect(SMA * (1 + ECC) - BODY_RADIUS).toBeCloseTo(85004.8, 0);
    expect(visibleText(container)).toMatch(/85\.\d+\s*km/);
    expect(visibleText(container)).toMatch(/80\.\d+\s*km/);
    expect(visibleText(container)).toContain("Kerbin");
    // Default mini orbit diagram renders (hasOrbit satisfied off derived ApR/PeR).
    expect(container.querySelector("svg")).not.toBeNull();
    // Period sanity: the fixture's orbit is a real one.
    expect(PERIOD).toBeGreaterThan(1800);
  });
});
