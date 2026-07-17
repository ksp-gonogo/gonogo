/**
 * DOM-snapshot regression tests for the SemiMajorAxis widget.
 *
 * Catches structural drift (rendered text, element order, attribute
 * changes) across every scenario × mode combination registered for the
 * widget. The matching PNG renders live in
 * `local_docs/renders/semi-major-axis-widget/` and cover the visual
 * layer that DOM snapshots can't (styled-components CSS, fonts, etc).
 *
 * SemiMajorAxis reads exclusively off the SDK stream now (`vessel.orbit.sma`
 * for the headline value, the derived `vessel.state.referenceBodyName` for the
 * subtitle), so these render through a real `TelemetryProvider` via
 * `setupStreamFixture` rather than the legacy `MockDataSource`
 * `snapshotWidgetMode` harness. Scenarios mirror the former Telemachus fixtures
 * as `vessel.orbit` element sets + a `system.bodies` entry the reference-body
 * name resolves against; the view clock is pinned so the freshly-emitted sample
 * reads "live" (no status badge), matching the legacy fixtures' connected
 * depiction.
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @ksp-gonogo/components exec vitest run src/SemiMajorAxis/snapshots -u`.
 */
import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import { SemiMajorAxisComponent } from "./index";

interface SmaScenario {
  sma: number;
  ecc: number;
  bodyName: string;
}

const SCENARIOS: Record<string, SmaScenario | null> = {
  "lko-kerbin": { sma: 680_000, ecc: 0.01, bodyName: "Kerbin" },
  "ksync-kerbin": { sma: 2_868_750, ecc: 0.01, bodyName: "Kerbin" },
  // Hyperbolic escape trajectory — SMA is negative; exercises formatDistance
  // with a negative value and the derived body-name read on an escape orbit.
  "escape-kerbin": { sma: -5_000_000, ecc: 1.5, bodyName: "Kerbin" },
  "mun-orbit": { sma: 215_000, ecc: 0.01, bodyName: "Mun" },
  "jool-system": { sma: 26_000_000, ecc: 0.01, bodyName: "Jool" },
  "no-data": null,
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

const config = getWidget("semi-major-axis");
if (!config) throw new Error("semi-major-axis missing from widgets.ts");

registerStockBodies();

function renderSmaSnapshot(
  scenario: SmaScenario | null,
  mode: { w: number; h: number },
): HTMLElement {
  const fixture = setupStreamFixture({
    carriedChannels: VESSEL_STATE_INPUTS,
    pinnedUt: 0,
  });
  const { container } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "sma-snap" }}>
        <SemiMajorAxisComponent id="sma-snap" w={mode.w} h={mode.h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  if (scenario) {
    act(() => {
      fixture.emit("vessel.orbit", {
        sma: scenario.sma,
        ecc: scenario.ecc,
        referenceBodyIndex: 1,
      });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: scenario.bodyName,
            index: 1,
            parentIndex: 0,
            radius: 600000,
            orbit: null,
          },
        ],
      });
    });
  }
  return container;
}

describe("SemiMajorAxis DOM snapshots", () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const container = renderSmaSnapshot(scenario, mode);
        if (scenario) {
          await waitFor(() => {
            if (container.textContent?.includes("No orbit data")) {
              throw new Error("sma has not settled off the stream yet");
            }
          });
        }
        expect(stripVolatile(container.innerHTML)).toMatchSnapshot();
      });
    }
  }
});
