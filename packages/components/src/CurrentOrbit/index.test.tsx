import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CurrentOrbitComponent } from "./index";

/**
 * CurrentOrbit integration test — the widget runs entirely off the SDK stream.
 * `sma`/`eccentricity`/`inclination`/`argPe` are raw `vessel.orbit` elements;
 * `trueAnomaly`/`period`/`referenceBodyName`/`parentBodyName` plus the
 * Ap/Pe/ApR/PeR/timeToAp/timeToPe read through `useOrbitElements` and the
 * `useIsOrbiting` apsis altitudes are SDK-derived `vessel.state.*` fields.
 * `useOrbitElements`/`useIsOrbiting` still ride the `useDataValue` shim, whose
 * carried gate routes to the stream only once ALL EIGHT `vessel.state` inputs
 * are carried — hence the full input list below. No legacy `MockDataSource` is
 * registered anywhere in this file.
 *
 * The apsis ALTITUDES are derived (`sma·(1±ecc) − bodyRadius`), so the orbit
 * elements below are chosen to reproduce the ~85 km / ~78 km apoapsis /
 * periapsis the old hand-emitted fixture asserted: sma 681 500 m, ecc 0.005135,
 * Kerbin radius 600 000 m.
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

const KERBIN_MU = 3.5316e12;

describe("CurrentOrbitComponent", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    registerStockBodies();
    stream = setupStreamFixture({
      carriedChannels: VESSEL_STATE_INPUTS,
      pinnedUt: 0,
    });
  });

  afterEach(() => {
    stream = undefined as unknown as ReturnType<typeof setupStreamFixture>;
  });

  function renderOrbit(
    config: Parameters<typeof CurrentOrbitComponent>[0]["config"] = {},
  ) {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "orbit-test" }}>
          <CurrentOrbitComponent config={config} id="orbit-test" />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  /** Emit a Kerbin LKO orbit whose derived apsis altitudes are ~85/78 km. */
  function emitLko(overrides: Record<string, unknown> = {}): void {
    act(() => {
      stream.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 1,
          sma: 681_500,
          ecc: 0.005135,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 0,
          mu: KERBIN_MU,
          ...overrides,
        },
        { quality: Quality.OnRails },
      );
      stream.emit("vessel.identity", {
        vesselId: "v1",
        name: "Kerbal X",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 1,
        launchUt: 0,
      });
      stream.emit("system.bodies", {
        bodies: [{ index: 1, name: "Kerbin", parentIndex: 0, radius: 600000 }],
      });
    });
  }

  it("shows em-dashes for every field before any telemetry arrives", () => {
    const { container } = renderOrbit();
    // Seven "—" slots (Ap, Pe, Ecc, Inc, T, t-Ap, t-Pe)
    const dashes = container.textContent?.match(/—/g) ?? [];
    expect(dashes.length).toBeGreaterThanOrEqual(7);
  });

  it("renders full orbital parameters once telemetry lands", async () => {
    const { container } = renderOrbit();

    emitLko();

    // Apoapsis/periapsis shown as distance (derived off the orbit elements).
    // Stream values land on the store's next frame, so await the settle.
    await waitFor(() => expect(container.textContent).toMatch(/85\.\d+\s*km/));
    expect(container.textContent).toMatch(/78\.\d+\s*km/);
    // Eccentricity displayed with 4 decimals
    expect(container.textContent).toContain("0.0051");
    // Inclination rounded to 1 decimal with degree suffix
    expect(container.textContent).toContain("0.0°");
    // Reference body shown as subtitle
    expect(container.textContent).toContain("Kerbin");
    // Mini diagram renders by default (showDiagram true)
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("omits the mini diagram when showDiagram=false", async () => {
    const { container } = renderOrbit({ showDiagram: false });

    emitLko();
    await waitFor(() => expect(container.textContent).toMatch(/km/));

    expect(container.querySelector("svg")).toBeNull();
  });
});
