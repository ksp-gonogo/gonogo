import { waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { stripVolatile } from "../test/widgetDomSnapshot";
import { type OrbitScenario, renderOrbitViewStream } from "./streamHarness";

/**
 * OrbitView DOM snapshots. The widget reads exclusively off
 * the SDK stream now, so these render through a real `TelemetryProvider` via
 * `renderOrbitViewStream`: the shared legacy `MockDataSource`
 * `snapshotWidgetMode` harness no longer feeds a stream-only widget. Scenarios
 * mirror the retired legacy fixtures as `vessel.orbit` element sets (the
 * apsis radii / true anomaly are solved from them and the body name resolved
 * off the stream, not hand-authored). The view clock is pinned at UT 0 for deterministic
 * propagation. Stream reads settle one frame after the emit, so each snapshot
 * waits for the widget to leave its empty state before capturing markup.
 */
const SCENARIOS: Record<string, OrbitScenario | null> = {
  "lko-circular": { bodyName: "Kerbin", sma: 681500, ecc: 0.003, argPe: 12 },
  "eccentric-kerbin": {
    bodyName: "Kerbin",
    sma: 3800000,
    ecc: 0.85,
    argPe: 45,
    // Periapsis is 30 km inside Kerbin, so the default phase would sample the
    // craft underground. A quarter turn along puts it out at the semi-major
    // axis, where an eccentric orbit is actually observed from.
    meanAnomalyAtEpoch: 0.7208,
  },
  "sub-orbital-kerbin": {
    bodyName: "Kerbin",
    sma: 820000,
    ecc: 0.27,
    argPe: 0,
    // Periapsis is 1.4 km inside Kerbin, which is what makes this sub-orbital.
    // The craft is sampled a third of the way round from it, 109 km up and
    // falling towards a surface it will reach rather than pass.
    meanAnomalyAtEpoch: 0.8134,
  },
  "mun-orbit": {
    bodyName: "Mun",
    bodyRadius: 200000,
    sma: 215000,
    ecc: 0.06,
    argPe: 270,
  },
  "no-data": null,
};

const config = getWidget("orbit-view");
if (!config) throw new Error("orbit-view missing from widgets.ts");

describe("OrbitView DOM snapshots", () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const { container } = renderOrbitViewStream(
          { w: mode.w, h: mode.h },
          scenario ?? undefined,
        );
        if (scenario) {
          // Wait for the stream-derived orbit to land (leaves the empty
          // state) before capturing, so the snapshot is the real diagram/pill
          // render rather than the pre-settle frame.
          await waitFor(() => {
            if (visibleText(container).includes("No orbital data")) {
              throw new Error("orbit has not settled yet");
            }
          });
        }
        expect(stripVolatile(container.innerHTML)).toMatchSnapshot();
      });
    }
  }
});
