import {
  DashboardItemContext,
  PerfBudget,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality, Situation } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  flushResizeObservers,
  installSizedResizeObserver,
  WidgetContributions,
} from "../test/widgetDomSnapshot";
import { LandingStatusComponent } from "./index";

/** A craft in an orbit that clears the surface and the atmosphere has no descent path, so the widget estimates none. */

describe("LandingStatus in a stable orbit", () => {
  let stream: ReturnType<typeof setupStreamFixture>;
  let restoreResizeObserver: () => void;

  beforeEach(() => {
    for (const b of PerfBudget.getAll()) b.reset();
    registerStockBodies();
    stream = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    restoreResizeObserver = installSizedResizeObserver({ w: 720, h: 640 });
  });

  afterEach(() => {
    restoreResizeObserver();
  });

  function emitOrbit(orbitSma: number, ecc: number, verticalSpeed: number) {
    stream.emit("trackingStation.bodies", {
      bodies: [
        {
          name: "Kerbin",
          index: 1,
          parentIndex: 0,
          radius: 600_000,
          atmosphere: { depth: 70_000 },
          orbit: null,
        },
      ],
    });
    stream.emit("vessel.identity", {
      vesselId: "orbiter",
      name: "Orbiter",
      vesselType: 0,
      situation: Situation.Orbiting,
      parentBodyIndex: 1,
      launchUt: null,
    });
    stream.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: orbitSma,
        ecc,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        mu: 3_531_600_000_000,
      },
      { quality: Quality.Loaded },
    );
    stream.emit("vessel.flight", {
      latitude: 0,
      longitude: 0,
      altitudeAsl: 100_000,
      altitudeTerrain: 100_000,
      verticalSpeed,
      surfaceSpeed: 2_200,
      orbitalSpeed: 2_246,
      atmDensity: 0,
    });
    stream.emit("vessel.surface", {
      biome: "Water",
      landedAt: null,
      heightFromTerrain: 100_000,
    });
    stream.emit("comms.delay", { source: 0, oneWaySeconds: 0 });
  }

  function renderWidget() {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "land-orbit" }}>
          <WidgetContributions Widget={LandingStatusComponent}>
            <LandingStatusComponent config={{}} id="land-orbit" w={8} h={12} />
          </WidgetContributions>
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  it("estimates no descent for a circular 100 km orbit whose vertical speed reads a few centimetres a second down", async () => {
    renderWidget();
    await flushResizeObservers();
    act(() => emitOrbit(700_000, 0, -0.03));
    await flushResizeObservers();
    await waitFor(() => expect(visibleText()).toContain("Kerbin"));
    expect(visibleText()).not.toContain("Atmospheric descent");
    expect(visibleText()).not.toContain("Air density");
  });

  it("still estimates the descent once the orbit dips into the atmosphere", async () => {
    renderWidget();
    await flushResizeObservers();
    act(() => emitOrbit(660_000, 0.1, -0.03));
    await flushResizeObservers();
    await waitFor(() =>
      expect(visibleText()).toContain("Atmospheric descent (estimate)"),
    );
  });
});
