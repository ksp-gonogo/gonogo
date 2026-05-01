import type { DataKey } from "@gonogo/core";
import { DashboardItemContext, type MockDataSource } from "@gonogo/core";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { CurrentOrbitComponent } from "./index";

/**
 * CurrentOrbit integration test — exercises the component against a real
 * BufferedDataSource layered over a minimal in-memory source. The only mock is
 * the upstream source (no WS); everything downstream (BufferedDataSource,
 * FlightDetector gating, useDataValue, useIsOrbiting, useActionInput) is real.
 */

const ORBIT_KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.body" },
  { key: "comm.connected" },
  { key: "o.ApA" },
  { key: "o.PeA" },
  { key: "o.ApR" },
  { key: "o.PeR" },
  { key: "o.sma" },
  { key: "o.eccentricity" },
  { key: "o.trueAnomaly" },
  { key: "o.argumentOfPeriapsis" },
  { key: "o.inclination" },
  { key: "o.period" },
  { key: "o.timeToAp" },
  { key: "o.timeToPe" },
  { key: "o.referenceBody" },
];

describe("CurrentOrbitComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({
      keys: ORBIT_KEYS,
      affectedBySignalLoss: true,
    });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  function renderOrbit(
    config: Parameters<typeof CurrentOrbitComponent>[0]["config"] = {},
  ) {
    return render(
      <DashboardItemContext.Provider value={{ instanceId: "orbit-test" }}>
        <CurrentOrbitComponent config={config} id="orbit-test" />
      </DashboardItemContext.Provider>,
    );
  }

  function primeFlight(): void {
    source.emit("comm.connected", true);
    source.emit("v.name", "Kerbal X");
    source.emit("v.missionTime", 0);
  }

  it("shows em-dashes for every field before any telemetry arrives", () => {
    const { container } = renderOrbit();
    // Seven "—" slots (Ap, Pe, Ecc, Inc, T, t-Ap, t-Pe)
    const dashes = container.textContent?.match(/—/g) ?? [];
    expect(dashes.length).toBeGreaterThanOrEqual(7);
  });

  it("renders full orbital parameters once telemetry lands", () => {
    const { container } = renderOrbit();

    act(() => {
      primeFlight();
      source.emit("o.referenceBody", "Kerbin");
      source.emit("v.body", "Kerbin");
      source.emit("o.ApA", 85000);
      source.emit("o.PeA", 78000);
      source.emit("o.ApR", 685000);
      source.emit("o.PeR", 678000);
      source.emit("o.sma", 681500);
      source.emit("o.eccentricity", 0.00514);
      source.emit("o.trueAnomaly", 0);
      source.emit("o.argumentOfPeriapsis", 0);
      source.emit("o.inclination", 0);
      source.emit("o.period", 1800);
      source.emit("o.timeToAp", 450);
      source.emit("o.timeToPe", 1350);
    });

    // Apoapsis/periapsis shown as distance
    expect(container.textContent).toMatch(/85\.\d+\s*km/);
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

  it("omits the mini diagram when showDiagram=false", () => {
    const { container } = renderOrbit({ showDiagram: false });

    act(() => {
      primeFlight();
      source.emit("v.body", "Kerbin");
      source.emit("o.sma", 681500);
      source.emit("o.eccentricity", 0.005);
      source.emit("o.ApR", 685000);
      source.emit("o.PeR", 678000);
    });

    expect(container.querySelector("svg")).toBeNull();
  });
});
