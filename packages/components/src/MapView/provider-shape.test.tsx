import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import type { PropagationHorizonLike } from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  ANALYTIC_UNBOUNDED_HORIZON,
  integratedHorizon,
  UNBOUNDED_HORIZON,
} from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { MapViewComponent } from "./index";

/**
 * The predicted ground track samples `vessel.state.orbitPatches` as CONICS, one
 * Kepler solve per step. Those patches are the provider's own chain, reshaped
 * off `vessel.orbit.patches`, so drawing them is projection rather than
 * invention, and the sampler already refuses to run past each patch's stated
 * `endUT`.
 *
 * What was never asked is whether a conic is the right thing to solve them AS.
 * The shape statement for that sample is the `trajectoryKind` on the horizon
 * riding the very same `vessel.orbit` reading the patches came off, and the
 * patch shape on the wire carries none of its own. So an integrating provider
 * got a ground track laid out by two-body maths it does not use, drawn with the
 * same confidence as the real thing and with nothing on screen to say so.
 *
 * The MANEUVER overlay is not gated here. Those patches arrive on
 * `vessel.maneuver`, which names its own planner, and `vessel.orbit`'s horizon
 * says nothing about them.
 */

const KERBIN_MU = 3.5316e12;
const PINNED_UT = 100;

/**
 * Unmount before clearing the body registry. `getBody` is read through
 * `useSyncExternalStore`, so clearing it while a tree is still mounted notifies
 * that tree from teardown, outside `act`. Sibling files here do the same.
 */
const trees: Array<() => void> = [];
afterEach(() => {
  for (const unmount of trees.splice(0)) unmount();
  clearBodies();
});

async function mountMap(horizon: PropagationHorizonLike) {
  registerStockBodies();
  const fixture = setupStreamFixture({
    carriedChannels: [
      "vessel.orbit",
      "vessel.flight",
      "vessel.identity",
      "system.bodies",
      "vessel.control",
      "vessel.target",
      "vessel.comms",
      "vessel.propulsion",
    ],
    pinnedUt: PINNED_UT,
  });
  const { container, unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "map-shape" }}>
        <MapViewComponent id="map-shape" w={14} h={14} config={{}} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  trees.push(unmount);
  act(() => {
    fixture.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: 700_000,
        ecc: 0.01,
        inc: 20,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: PINNED_UT,
        mu: KERBIN_MU,
        horizon,
        patches: [
          {
            sma: 700_000,
            ecc: 0.01,
            inc: 20,
            lan: 0,
            argPe: 0,
            meanAnomalyAtEpoch: 0,
            epoch: PINNED_UT,
            period: 2_000,
            startUt: PINNED_UT,
            endUt: PINNED_UT + 2_000,
            patchStartTransition: 4,
            patchEndTransition: 1,
            peA: 93_000,
            apA: 107_000,
            semiLatusRectum: 699_930,
            semiMinorAxis: 699_965,
            referenceBody: "Kerbin",
            referenceBodyIndex: 1,
            mu: KERBIN_MU,
          },
        ],
      },
      { quality: Quality.OnRails },
    );
    fixture.emit("vessel.flight", {
      latitude: 12,
      longitude: -30,
      altitudeAsl: 100_000,
      altitudeTerrain: 100_000,
      verticalSpeed: 0,
      surfaceSpeed: 2200,
      orbitalSpeed: 2200,
      gForce: 0,
      dynamicPressureKPa: 0,
      mach: 0,
      atmDensity: 0,
    });
    fixture.emit("vessel.identity", {
      vesselId: "v1",
      name: "Test Vessel",
      vesselType: 0,
      situation: 1,
      parentBodyIndex: 1,
      launchUt: 0,
    });
    fixture.emit("system.bodies", {
      bodies: [
        {
          index: 1,
          name: "Kerbin",
          parentIndex: 0,
          radius: 600_000,
          gravParameter: KERBIN_MU,
          rotationPeriod: 21_549.425,
        },
      ],
    });
  });
  await flushFrames();
  return container;
}

/** How many polyline segments the predicted-track layer was handed. */
function segments(container: HTMLElement): number {
  const el = container.querySelector("[data-prediction-segments]");
  return Number(el?.getAttribute("data-prediction-segments") ?? "-1");
}

/**
 * Flush the provider's `beginFrame` rAF ticks so the stream-driven re-render
 * commits inside `act` rather than landing on a later frame. A `waitFor` alone
 * polls on timers and lets the rAF commit fall outside the scope, which reads as
 * a missing `act` in the body and is not; the widget's other test files use the
 * same helper for the same reason.
 */
async function flushFrames(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

describe("MapView predicts the ground track only in the shape the provider states", () => {
  it("draws the track when the provider says its trajectories are analytic", async () => {
    const container = await mountMap(ANALYTIC_UNBOUNDED_HORIZON);
    expect(segments(container)).toBeGreaterThan(0);
  });

  it("draws no track, and says why, when the producer states reach but not shape", async () => {
    const container = await mountMap(UNBOUNDED_HORIZON);
    expect(segments(container)).toBe(0);
    expect(visibleText(container)).toContain("SHAPE NOT STATED");
  });

  it("draws no track when the provider integrates, rather than a two-body one", async () => {
    // The patches are exact at their own start instant and are not the path. A
    // ground track solved from them as conics is a route the craft will not fly,
    // laid over real terrain, which is the whole defect.
    const container = await mountMap(integratedHorizon(PINNED_UT + 2_000));
    expect(segments(container)).toBe(0);
  });

  it("keeps the vessel marker and the position readouts when the track is refused", async () => {
    // Where the craft IS is measured, not extrapolated. Only the forward track
    // is in question, and blanking the position would report an outage that has
    // not happened.
    const container = await mountMap(UNBOUNDED_HORIZON);
    // Five canvases still mount: the map is drawn, only one layer is empty.
    expect(container.querySelectorAll("canvas").length).toBe(5);
    expect(visibleText(container)).not.toContain("No position data");
    expect(visibleText(container)).not.toContain("Waiting for telemetry");
  });
});
