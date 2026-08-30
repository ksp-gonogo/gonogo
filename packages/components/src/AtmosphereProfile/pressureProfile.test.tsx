import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AtmosphereProfileComponent } from "./index";

/**
 * The pressure curve has to come from the game, not from a table of stock
 * bodies plus an exponential.
 *
 * <p>Two separate faults meet in this widget, and neither is visible from
 * inside `pressureAtAltitude`, which takes the body as an ARGUMENT and so
 * cannot see where it came from. The first is RESOLUTION: the body was looked
 * up by NAME in the bundled stock registry, and a planet pack renames every
 * body, so under RSS (the configuration RP-1 is played in) the lookup missed
 * and the widget drew nothing at all. The second is the MODEL: `P0·exp(-h/H)`
 * is not what KSP evaluates. A body with `atmosphereUsePressureCurve` set
 * follows a tabulated curve, which is what stock's own atmospheres and every
 * RealAtmospheres-style pack use, and the exponential is out by three orders
 * of magnitude against the real RSS Earth curve at altitude.</p>
 *
 * <p>Both are tested here at COMPONENT level for that reason: the resolution
 * fault only exists at the seam between the widget and the registry.</p>
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
  beforeEach(() => {
    clearBodies();
    registerStockBodies();
    vi.stubGlobal(
      "ResizeObserver",
      class FakeResizeObserver {
        private cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;
        }
        observe(_el: Element) {
          this.cb(
            [
              {
                contentRect: { width: 400, height: 300 },
              } as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    clearBodies();
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

    /*
     * Kerbin IS in the bundled table, so the name resolves either way and only
     * the MODEL is under test. The bundled exponential reads
     * 101.325·exp(-5000/5600) = 41.5 kPa at this altitude; the reported
     * profile says 54.0.
     */
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
