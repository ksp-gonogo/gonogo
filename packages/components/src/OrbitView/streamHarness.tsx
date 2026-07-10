import { DashboardItemContext, registerStockBodies } from "@gonogo/core";
import { Quality } from "@gonogo/sitrep-sdk";
import { act, render } from "@testing-library/react";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { OrbitViewComponent } from "./index";

/**
 * Shared stream-render harness for OrbitView's tests (R6 de-Telemachus).
 * OrbitView now reads exclusively off the SDK stream — `vessel.orbit` (raw
 * elements) and the `vessel.state` derived channel — so every test drives it
 * through a real `TelemetryProvider`/`TimelineStore` via `setupStreamFixture`
 * rather than the retired legacy `MockDataSource` path.
 */

/**
 * All eight `vessel.state` inputs. The widget's OWN reads
 * (`useTelemetry`/`useStreamOptional`) don't consult the carried-channels
 * allowlist, but the shared `useIsOrbiting` hook still reads `o.PeA`/`o.ApA`
 * (→ `vessel.state.periapsisAlt`/`apoapsisAlt`) through the legacy
 * `useDataValue` shim, whose carried gate is parent-channel-scoped: it only
 * routes to the stream once ALL EIGHT `vessel.state` inputs are carried.
 */
export const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
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
  /** Mean anomaly at epoch (radians). Default 0 → vessel sits at periapsis for a viewUt-0 clock. */
  meanAnomalyAtEpoch?: number;
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
      },
      { quality: Quality.OnRails },
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
      fixture.emit("system.bodies", {
        bodies: [
          {
            index: bodyIndex,
            name: s.bodyName,
            radius: s.bodyRadius ?? 600000,
          },
        ],
      });
    }
  });
}

export interface RenderStreamResult {
  container: HTMLElement;
  fixture: StreamFixture;
}

/**
 * Mount OrbitView under a stream fixture that carries every `vessel.state`
 * input, then (optionally) emit a scenario. Pins the view clock at UT 0 for
 * deterministic propagation.
 */
export function renderOrbitViewStream(
  size: { w: number; h: number },
  scenario?: OrbitScenario,
  instanceId = "orbitview-stream",
): RenderStreamResult {
  const fixture = setupStreamFixture({
    carriedChannels: [...VESSEL_STATE_INPUTS],
    pinnedUt: 0,
  });
  const { container } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <OrbitViewComponent id={instanceId} w={size.w} h={size.h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  if (scenario) emitScenario(fixture, scenario);
  return { container, fixture };
}
