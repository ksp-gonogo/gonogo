import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import {
  installFixedSizeResizeObserver,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AtmosphereProfileComponent } from "./index";

/**
 * The pressure curve comes from the game. The body resolves off the stream
 * rather than by name in the stock registry (a planet pack renames every
 * body), and a reported tabulated profile wins over `P0·exp(-h/H)`, which is
 * out by three orders of magnitude against the RSS Earth curve at altitude.
 * Tested at component level, since resolution only fails at the seam.
 */

const CARRIED_CHANNELS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
];

/** Altitudes in metres, ascending from sea level, as the host samples them. */
const EARTH_ALTITUDES = [0, 5_000, 10_000, 20_000, 40_000, 80_000];
/** Pressure in kPa at each of those altitudes: the game's own answer. */
const EARTH_PRESSURES = [101.325, 54.0, 26.5, 5.5, 0.28, 0.001];

describe("AtmosphereProfile: the pressure curve is the game's, not a model", () => {
  let restoreResizeObserver: () => void = () => {};
  beforeEach(() => {
    clearBodies();
    registerStockBodies();
    restoreResizeObserver = installFixedSizeResizeObserver({
      width: 400,
      height: 300,
    });
  });

  afterEach(() => {
    clearBodies();
    restoreResizeObserver();
    vi.unstubAllGlobals();
  });

  function renderAtmo() {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    const rendered = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "atmo-profile" }}>
          <AtmosphereProfileComponent config={{}} id="atmo-profile" />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    return { fixture, ...rendered };
  }

  function emitBody(
    fixture: ReturnType<typeof setupStreamFixture>,
    name: string,
    altitudeAsl: number,
    atmosphere: Record<string, unknown>,
  ) {
    fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
    fixture.emit("vessel.flight", { altitudeAsl });
    fixture.emit("vessel.identity", { parentBodyIndex: 1 });
    fixture.emit("system.bodies", {
      bodies: [
        {
          name,
          index: 1,
          parentIndex: 0,
          radius: 6_371_000,
          orbit: null,
          atmosphere,
        },
      ],
    });
  }

  it("draws the profile for a body the bundled stock table has never heard of", async () => {
    const { fixture, container } = renderAtmo();

    act(() => {
      emitBody(fixture, "Earth", 5_000, {
        depth: 140_000,
        hasOxygen: true,
        seaLevelPressure: 101.325,
        pressureAltitudes: EARTH_ALTITUDES,
        pressures: EARTH_PRESSURES,
      });
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
    const text = visibleText(container);
    expect(text).not.toContain("Unknown body");
    expect(text).not.toContain("Waiting for body telemetry");
    expect(text).toContain("Earth");
  });

  it("states the pressure the stream reported, not the one the exponential models", async () => {
    const { fixture, container } = renderAtmo();

    // Kerbin is in the bundled table, so only the model is under test: the exponential reads 41.5 kPa here, the profile 54.0.
    act(() => {
      emitBody(fixture, "Kerbin", 5_000, {
        depth: 70_000,
        hasOxygen: true,
        seaLevelPressure: 101.325,
        pressureAltitudes: EARTH_ALTITUDES,
        pressures: EARTH_PRESSURES,
      });
    });

    await waitFor(() => {
      expect(visibleText(container)).toMatch(/pascals/);
    });
    const text = visibleText(container);
    expect(text).toMatch(/54(\.0+)? kilopascals/);
    expect(text).not.toMatch(/41(\.\d+)? kilopascals/);
  });
});
