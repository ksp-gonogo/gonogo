import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { MapViewComponent } from "./index";

/**
 * The encounter ring and the impact cross are claims about now, so they are
 * drawn from a current `vessel.orbit` (and, for the impact, a current
 * `vessel.flight`) or not at all, while the patch chain behind the track is held
 * across a stale orbit. Read off the prediction layer's published markers,
 * since the canvas itself has nothing a test can inspect.
 */

const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

const UT = 9876543;

/* A Kerbin descent whose single patch runs on past the surface, so the vacuum walk finds a crossing, with an encounter named on the same sample. */
const ORBIT = {
  referenceBodyIndex: 1,
  sma: 487578.402,
  ecc: 0.30503003,
  inc: 6,
  lan: 0,
  argPe: 10.563957,
  meanAnomalyAtEpoch: 3.577845994,
  epoch: UT,
  mu: 3531600000000,
  patches: [
    {
      sma: 487578.402,
      ecc: 0.30503003,
      inc: 6,
      lan: 0,
      argPe: 10.563957,
      meanAnomalyAtEpoch: 3.577845994,
      epoch: UT,
      period: 1138.311,
      startUt: UT,
      endUt: UT + 200,
      patchStartTransition: 0,
      patchEndTransition: 5,
      peA: -261147.652,
      apA: 36304.455,
      semiLatusRectum: 442212.489,
      semiMinorAxis: 464341.748,
      referenceBody: "Kerbin",
      referenceBodyIndex: 1,
      mu: 3531600000000,
    },
  ],
  horizon: { kind: 1, trajectoryKind: 1 },
  encounter: { transitionType: 2, transitionUt: UT + 150, bodyIndex: 2 },
};

const FLIGHT = {
  latitude: -2.5,
  longitude: -45.2,
  altitudeAsl: 28000,
  altitudeTerrain: 28000,
  verticalSpeed: -210,
  surfaceSpeed: 1820,
  orbitalSpeed: 2000.997,
  gForce: 1,
  dynamicPressureKPa: 19.544,
  mach: 6.395,
  atmDensity: 0.011801,
};

const BODIES = {
  bodies: [
    {
      name: "Kerbin",
      index: 1,
      parentIndex: 0,
      radius: 600000,
      orbit: null,
      rotationPeriod: 21549.4251830899,
    },
  ],
};

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: UT,
    suspendFrames: true,
  });
  const rendered = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "mapview-markers" }}>
        <MapViewComponent id="mapview-markers" w={12} h={18} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  const layer = () =>
    rendered.container.querySelector("[data-prediction-segments]");
  return { fixture, layer, ...rendered };
}

function emitDescent(
  fixture: ReturnType<typeof mount>["fixture"],
  quality: Quality = Quality.Loaded,
) {
  act(() => {
    fixture.emit("system.bodies", BODIES);
    fixture.emit(
      "vessel.orbit",
      { ...ORBIT, meta: { source: "vessel:v1", quality } },
      { quality },
    );
    fixture.emit("vessel.flight", FLIGHT, { quality });
  });
}

describe("MapView's current-only markers", () => {
  it("marks the encounter and the impact while the orbit and flight are current", async () => {
    const { fixture, layer } = mount();
    emitDescent(fixture);
    await waitFor(() => {
      expect(layer()?.getAttribute("data-encounter-marker")).toBe("encounter");
      expect(layer()?.hasAttribute("data-impact-marker")).toBe(true);
    });
  });

  it("drops both markers once the orbit stops being current", async () => {
    const { fixture, layer } = mount();
    emitDescent(fixture);
    await waitFor(() =>
      expect(layer()?.hasAttribute("data-impact-marker")).toBe(true),
    );

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() => {
      expect(layer()?.hasAttribute("data-encounter-marker")).toBe(false);
      expect(layer()?.hasAttribute("data-impact-marker")).toBe(false);
    });
  });

  it("marks no impact for a craft on rails, and still marks its encounter", async () => {
    const { fixture, layer } = mount();
    emitDescent(fixture, Quality.OnRails);
    await waitFor(() =>
      expect(layer()?.getAttribute("data-encounter-marker")).toBe("encounter"),
    );
    expect(layer()?.hasAttribute("data-impact-marker")).toBe(false);
  });
});
