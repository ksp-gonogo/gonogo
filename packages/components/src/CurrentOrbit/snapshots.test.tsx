/**
 * DOM-snapshot regression tests for the CurrentOrbit widget.
 *
 * CurrentOrbit reads exclusively off the SDK stream now — raw `vessel.orbit`
 * elements (sma/ecc/inc/argPe) plus the `vessel.state`-derived apsis altitudes,
 * period, time-to-apsis, true anomaly and reference-body name — so these render
 * through a real `TelemetryProvider` via `setupStreamFixture` rather than the
 * legacy `MockDataSource` `snapshotWidgetMode` harness. Scenarios are authored
 * as raw `vessel.orbit` element sets; the derived rows come off
 * `deriveVesselState` at the pinned view UT (never hand-picked). Each vessel is
 * emitted at periapsis (meanAnomalyAtEpoch 0, epoch == pinned UT) so trueAnomaly
 * is a clean 0° and time-to-periapsis 0s — fully deterministic snapshots.
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @ksp-gonogo/components exec vitest run src/CurrentOrbit/snapshots -u`.
 */
import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import { CurrentOrbitComponent } from "./index";

const KERBIN_MU = 3.5316e12;
const KERBIN_RADIUS = 600_000;

interface OrbitScenario {
  sma: number;
  ecc: number;
  inc: number;
  argPe: number;
}

const SCENARIOS: Record<string, OrbitScenario> = {
  "circular-lko": { sma: 682_500, ecc: 0.00367, inc: 0.3, argPe: 12.5 },
  "eccentric-capture": { sma: 1_890_000, ecc: 0.6402, inc: 5.2, argPe: 270 },
  // Hyperbolic escape trajectory — ecc > 1, negative sma. The widget renders
  // "—" for the apoapsis/period rows; this exercises that path off the stream.
  "escape-trajectory": { sma: -2_400_000, ecc: 1.283, inc: 4.7, argPe: 20 },
  "polar-orbit": { sma: 700_000, ecc: 0.00286, inc: 90, argPe: 45 },
  "retrograde-orbit": { sma: 690_000, ecc: 0.0029, inc: 178, argPe: 0 },
  // Sub-orbital — periapsis below the surface (negative altitude); isOrbiting
  // is false but hasOrbit is satisfied so the diagram still renders.
  "sub-orbital": { sma: 633_500, ecc: 0.0612, inc: 2.1, argPe: 5 },
};

const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

const config = getWidget("current-orbit");
if (!config) throw new Error("current-orbit missing from widgets.ts");

registerStockBodies();

function renderOrbitSnapshot(
  scenario: OrbitScenario,
  mode: { w: number; h: number; config?: Record<string, unknown> },
): HTMLElement {
  const fixture = setupStreamFixture({
    carriedChannels: VESSEL_STATE_INPUTS,
    pinnedUt: 0,
  });
  const { container } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "orbit-snap" }}>
        <CurrentOrbitComponent
          id="orbit-snap"
          w={mode.w}
          h={mode.h}
          config={mode.config}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: scenario.sma,
        ecc: scenario.ecc,
        inc: scenario.inc,
        lan: 0,
        argPe: scenario.argPe,
        meanAnomalyAtEpoch: 0,
        epoch: 0,
        mu: KERBIN_MU,
      },
      { quality: Quality.OnRails },
    );
    fixture.emit("vessel.identity", {
      vesselId: "v1",
      name: "Kerbal X",
      vesselType: 0,
      situation: 1,
      parentBodyIndex: 1,
      launchUt: 0,
    });
    fixture.emit("system.bodies", {
      bodies: [
        { index: 1, name: "Kerbin", parentIndex: 0, radius: KERBIN_RADIUS },
      ],
    });
  });
  return container;
}

describe("CurrentOrbit DOM snapshots", () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const container = renderOrbitSnapshot(scenario, mode);
        // Wait for the stream-derived orbit to land before capturing — every
        // scenario's periapsis altitude formats to a km+/Mm distance, so its
        // presence proves the emit propagated through the store's next frame.
        await waitFor(() => {
          if (!/km|Mm|Gm/.test(container.textContent ?? "")) {
            throw new Error("orbit has not settled off the stream yet");
          }
        });
        expect(stripVolatile(container.innerHTML)).toMatchSnapshot();
      });
    }
  }
});
