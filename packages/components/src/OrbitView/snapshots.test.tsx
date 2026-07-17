import { waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { stripVolatile } from "../test/widgetDomSnapshot";
import { type OrbitScenario, renderOrbitViewStream } from "./streamHarness";

/**
 * OrbitView DOM snapshots. The widget reads exclusively off
 * the SDK stream now, so these render through a real `TelemetryProvider` via
 * `renderOrbitViewStream` — the shared legacy `MockDataSource`
 * `snapshotWidgetMode` harness no longer feeds a stream-only widget. Scenarios
 * mirror the former Telemachus fixtures as `vessel.orbit` element sets (the
 * apsis radii / true anomaly / body name are derived off the stream, not
 * hand-authored). The view clock is pinned at UT 0 for deterministic
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
  },
  // NOTE: a hyperbolic escape trajectory (ecc≥1) is deliberately NOT covered
  // here. The shared `useIsOrbiting` hook reads `o.PeA`/`o.ApA`
  // (→ `vessel.state.periapsisAlt`/`apoapsisAlt`) through the still-unguarded
  // `useDataValue` shim, and `deriveVesselState`'s OnRails branch throws on
  // the elliptical-only Kepler solver for ecc≥1 — crashing any widget that
  // reads a `vessel.state` field for a hyperbolic vessel. That's a SharedLib
  // gap (deriveVesselState should null-out rather than throw) that still
  // needs closing; OrbitView's OWN derived read is already guarded.
  "sub-orbital-kerbin": {
    bodyName: "Kerbin",
    sma: 820000,
    ecc: 0.27,
    argPe: 0,
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
            if (container.textContent?.includes("No orbital data")) {
              throw new Error("orbit has not settled yet");
            }
          });
        }
        expect(stripVolatile(container.innerHTML)).toMatchSnapshot();
      });
    }
  }
});
