import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import type { PropagationHorizonLike } from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render } from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { ANALYTIC_UNBOUNDED_HORIZON } from "./orbitHorizon";
import { type StreamFixture, setupStreamFixture } from "./setupStreamFixture";

/**
 * One `vessel.orbit` sample emitted onto a real stream fixture, shared by
 * every widget that draws a trajectory, so a horizon that makes OrbitView
 * refuse makes CurrentOrbit refuse identically.
 */

/** The channels a scenario emits, carried by every orbit-stream fixture. */
export const ORBIT_SCENARIO_CHANNELS = [
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
] as const;

/** Kerbin's standard gravitational parameter, for finite propagation. */
const KERBIN_MU = 3.5316e12;

export interface OrbitScenario {
  /** Parent body name (drives `getBody` color/radius/atmosphere + subtitle). Omit for a body-less render. */
  bodyName?: string;
  /** `system.bodies` index of the parent body. Default 0. */
  bodyIndex?: number;
  /** Body mean radius, metres. Default Kerbin's 600 000. */
  bodyRadius?: number;
  sma: number;
  ecc: number;
  argPe?: number;
  /**
   * Mean anomaly at epoch (radians). Default 0: periapsis at viewUt 0. State
   * one whenever periapsis is below the surface, or the craft is underground
   * and the conic refuses to advance.
   */
  meanAnomalyAtEpoch?: number;
  /** `vessel.orbit`'s sample quality. `Quality.Loaded` makes the conic decline as `"under-physics"`. Default `Quality.OnRails`. */
  quality?: Quality;
  /**
   * The propagation horizon the sample carries. Defaults to the stock analytic
   * producer's (`AnalyticHorizon()` in `VesselViewProvider.cs`), a conic; state
   * it to render a sample from an integrating provider.
   */
  horizon?: PropagationHorizonLike;
}

registerStockBodies();

/** Emit a scenario's Topic payloads onto the fixture (inside `act`). */
export function emitScenario(fixture: StreamFixture, s: OrbitScenario): void {
  const bodyIndex = s.bodyIndex ?? 0;
  act(() => {
    fixture.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: bodyIndex,
        sma: s.sma,
        ecc: s.ecc,
        inc: 0,
        lan: 0,
        argPe: s.argPe ?? 0,
        meanAnomalyAtEpoch: s.meanAnomalyAtEpoch ?? 0,
        epoch: 0,
        mu: KERBIN_MU,
        horizon: s.horizon ?? ANALYTIC_UNBOUNDED_HORIZON,
      },
      { quality: s.quality ?? Quality.OnRails },
    );
    if (s.bodyName !== undefined) {
      fixture.emit("vessel.identity", {
        vesselId: "v1",
        name: "Test Vessel",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: bodyIndex,
        launchUt: 0,
      });
    }
    /* Always emitted, empty when no body is named: the conic declares `system.bodies` as an input, and an empty roster solves the orbit while leaving the apsis altitudes unresolvable. */
    fixture.emit("system.bodies", {
      bodies:
        s.bodyName === undefined
          ? []
          : [
              {
                index: bodyIndex,
                name: s.bodyName,
                radius: s.bodyRadius ?? 600000,
              },
            ],
    });
  });
}

export interface RenderStreamResult {
  container: HTMLElement;
  fixture: StreamFixture;
  /** Synchronously unmount, for a state-mutating teardown that must run against an unmounted tree. */
  unmount: () => void;
}

/**
 * Mount `node` under a stream fixture that carries every channel a scenario emits,
 * inside a `DashboardItemContext` so per-instance config and augment slots
 * resolve, then (optionally) emit a scenario. Pins the view clock at UT 0 for
 * deterministic propagation.
 */
export function renderOrbitStream(
  node: ReactElement,
  scenario?: OrbitScenario,
  instanceId = "orbit-stream",
): RenderStreamResult {
  const fixture = setupStreamFixture({
    carriedChannels: [...ORBIT_SCENARIO_CHANNELS],
    pinnedUt: 0,
    suspendFrames: true,
  });
  const { container, unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        {node}
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  if (scenario) emitScenario(fixture, scenario);
  return { container, fixture, unmount };
}
