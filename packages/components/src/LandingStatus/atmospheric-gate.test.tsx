import {
  DashboardItemContext,
  PerfBudget,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  flushResizeObservers,
  installSizedResizeObserver,
  WidgetContributions,
} from "../test/widgetDomSnapshot";
import { LandingStatusComponent } from "./index";

/** An atmospheric descent's site readouts appear exactly when its terrain plots do, and its held figures are marked. */
const CARRIED = [
  "system.bodies",
  "vessel.identity",
  "vessel.orbit",
  "vessel.flight",
  "vessel.surface",
  "vessel.propulsion",
  "vessel.landing",
  "comms.delay",
];

const PATCH_SIZE = 5;

describe("LandingStatus atmospheric site gate", () => {
  let stream: ReturnType<typeof setupStreamFixture>;
  let restoreResizeObserver: () => void;

  beforeEach(() => {
    for (const b of PerfBudget.getAll()) b.reset();
    registerStockBodies();
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
    restoreResizeObserver = installSizedResizeObserver({ w: 720, h: 640 });
  });

  afterEach(() => {
    restoreResizeObserver();
  });

  function renderWidget() {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "land-gate" }}>
          <WidgetContributions Widget={LandingStatusComponent}>
            <LandingStatusComponent config={{}} id="land-gate" w={8} h={12} />
          </WidgetContributions>
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  /** A Kerbin descent at `agl` metres over a predicted site `drift` degrees of longitude east of the first. */
  function emitDescent(
    agl: number,
    drift = 0,
    terminalVelocity: number | null = 120,
  ) {
    stream.emit("system.bodies", {
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
      vesselId: "gate",
      name: "Gate Capsule",
      vesselType: 0,
      situation: 6,
      parentBodyIndex: 1,
      launchUt: null,
    });
    stream.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: 690_000,
        ecc: 0.14,
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
      latitude: -0.05,
      longitude: -74.6,
      altitudeAsl: agl,
      altitudeTerrain: agl,
      verticalSpeed: -120,
      surfaceSpeed: 150,
      orbitalSpeed: 150,
      atmDensity: 0.5,
    });
    stream.emit("vessel.surface", {
      biome: "Shores",
      landedAt: null,
      heightFromTerrain: agl,
    });
    stream.emit("vessel.propulsion", {
      totalMass: 5,
      dryMass: 3,
      currentThrust: 0,
      availableThrust: 18,
    });
    stream.emit("comms.delay", { source: 0, oneWaySeconds: 0 });
    stream.emit("vessel.landing", {
      outcome: "atmosphere-modelled",
      sampleSource: "predicted",
      predictedLatitude: -0.06,
      predictedLongitude: -74.55 + drift,
      predictedSlopeAngle: 3.2,
      predictedBiome: "Shores",
      terrainPatch: Array.from({ length: PATCH_SIZE * PATCH_SIZE }, () => 70),
      terrainPatchSize: PATCH_SIZE,
      terrainPatchExtentMeters: 400,
      terminalVelocity,
      projectedTouchdownSpeed: 7.5,
      atmosphericTimeToImpact: 90,
      descentRegime: "at-terminal",
      parachuteState: "stowed",
    });
  }

  /** Two frames whose predicted site moves about 10 m, so the prediction reads as settled. */
  async function settleAt(agl: number) {
    renderWidget();
    await flushResizeObservers();
    act(() => emitDescent(agl));
    await waitFor(() =>
      expect(visibleText()).toContain("Atmospheric descent (estimate)"),
    );
    act(() => emitDescent(agl, 0.001));
    await flushResizeObservers();
  }

  it("describes the site once the vessel is low enough for its plots", async () => {
    await settleAt(4_000);
    await waitFor(() =>
      expect(screen.getByText("Touchdown site")).toBeInTheDocument(),
    );
    expect(visibleText()).toContain("slope");
  });

  /** The held-marked figure whose visible text contains `text`, or null. */
  function heldFigure(text: string): Element | null {
    return (
      [...document.querySelectorAll("[data-not-current]")].find((el) =>
        el.textContent?.includes(text),
      ) ?? null
    );
  }

  function dropLink() {
    act(() => {
      stream.store.setTransportConnected(false);
      stream.store.beginFrame();
    });
  }

  it("marks the held slope and time to impact once the link drops", async () => {
    await settleAt(4_000);
    await waitFor(() => expect(visibleText()).toContain("slope"));
    expect(heldFigure("3.2")).toBeNull();

    dropLink();

    await waitFor(() => {
      expect(heldFigure("3.2")).not.toBeNull();
      expect(heldFigure("1min 30s")).not.toBeNull();
    });
  });

  it("marks the held air density once the link drops", async () => {
    renderWidget();
    await flushResizeObservers();
    act(() => emitDescent(15_000, 0, null));
    await waitFor(() => expect(visibleText()).toContain("Air density"));
    expect(heldFigure("500.000")).toBeNull();

    dropLink();

    await waitFor(() => expect(heldFigure("500.000")).not.toBeNull());
  });

  it("describes no site above the plots' gate, however settled the prediction", async () => {
    await settleAt(15_000);
    expect(screen.queryByText("Touchdown site")).toBeNull();
    expect(visibleText()).not.toContain("slope");
  });
});
