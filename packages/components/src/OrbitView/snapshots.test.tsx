import { waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { stripVolatile } from "../test/widgetDomSnapshot";
import { type OrbitScenario, renderOrbitViewStream } from "./streamHarness";

/** DOM snapshots off the stream with the view clock pinned at UT 0; each waits for the widget to leave its empty state. */
const SCENARIOS: Record<string, OrbitScenario | null> = {
  "lko-circular": { bodyName: "Kerbin", sma: 681500, ecc: 0.003, argPe: 12 },
  "eccentric-kerbin": {
    bodyName: "Kerbin",
    sma: 3800000,
    ecc: 0.85,
    argPe: 45,
    // Periapsis is inside Kerbin, so sample a quarter turn along, out at the semi-major axis.
    meanAnomalyAtEpoch: 0.7208,
  },
  "sub-orbital-kerbin": {
    bodyName: "Kerbin",
    sma: 820000,
    ecc: 0.27,
    argPe: 0,
    // Periapsis is 1.4 km inside Kerbin; the craft is sampled 109 km up and falling.
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
