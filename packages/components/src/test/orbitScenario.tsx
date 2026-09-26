import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import type { PropagationHorizonLike } from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render } from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { ANALYTIC_UNBOUNDED_HORIZON } from "./orbitHorizon";
import { type StreamFixture, setupStreamFixture } from "./setupStreamFixture";

/**
 * One `vessel.orbit` sample, emitted onto a real stream fixture, for any widget
 * that draws a trajectory from it.
 *
 * Shared rather than per-widget because the propagation seam is answered the
 * same way everywhere and the interesting axis is the HORIZON: a scenario that
 * makes OrbitView refuse must make CurrentOrbit refuse identically, and two
 * copies of the emitter would let one drift into emitting a horizon the other
 * does not.
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
   * Mean anomaly at epoch (radians). Default 0 → vessel sits at periapsis for
   * a viewUt-0 clock.
   *
   * State one whenever the periapsis is BELOW the body's surface. The default
   * then puts the craft underground at the sampled instant, which is not a
   * position the game can report, and the conic rightly refuses to advance
   * elements whose current radius is inside the body.
   */
  meanAnomalyAtEpoch?: number;
  /**
   * `vessel.orbit`'s sample quality. `Quality.Loaded` makes the conic decline
   * as `"under-physics"`, the packed case. Default `Quality.OnRails`, every
   * pre-existing scenario/test keeps its prior behaviour unchanged.
   */
  quality?: Quality;
  /**
   * The propagation horizon the sample carries: how far these elements answer
   * for, and what SHAPE of thing they describe. Defaults to what the stock
   * analytic producer sends (`AnalyticHorizon()` in `VesselViewProvider.cs`),
   * so a scenario that does not care about the seam keeps a conic. State it
   * explicitly to render a sample from a provider that integrates.
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
    /*
     * The roster is emitted whatever the scenario says, EMPTY where it names
     * no body: `vessel.orbit`'s conic declares `system.bodies` as an input, so
     * a scene that never emits it has no model, and every quantity solved from
     * those elements is absent for a reason that has nothing to do with the
     * body. A body-less scenario wants the orbit solved and the two apsis
     * ALTITUDES unresolvable, which is what an empty roster gives.
     */
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
  /** Synchronously unmount this tree: used by tests that run a state-mutating teardown (e.g. `clearAugments()`) which must fire against an unmounted tree, before RTL auto-cleanup runs. */
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
