import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import approach from "./__fixtures__/approach-closing.json";
import body from "./__fixtures__/celestial-body-tracking.json";
import aligned from "./__fixtures__/docking-aligned.json";
import misaligned from "./__fixtures__/docking-misaligned.json";
import far from "./__fixtures__/far-approach-vessel.json";
import noTarget from "./__fixtures__/no-target.json";
import { DistanceToTargetComponent } from "./index";

/**
 * DOM snapshots off the stream (`TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore`) pipeline: the widget's legacy `MockDataSource` fallback
 * is gone, so the generic `snapshotWidgetMode` harness (which emits fixture
 * keys straight onto a `MockDataSource`) can't drive it any more. Each
 * fixture's legacy `tar.*`/`dock.*`/`o.closestTgtApprUT` keys are mapped
 * here onto the native `vessel.target`/`vessel.dock` shapes the widget
 * reads, same mapping as `index.test.tsx`:
 * `tar.name`→`name`, `tar.type`→`kind` (Vessel=0/CelestialBody=1),
 * `tar.relativePosition`→`relativePosition`,
 * `tar.relativeVelocityVec`→`relativeVelocity`,
 * `dock.relativePosition`→`relativePosition`,
 * `dock.relativeVelocityVec`→`relativeVelocity`,
 * `dock.distanceScalar`→`distance`, `dock.forwardDot`→`forwardDot`.
 *
 * The view-UT clock is pinned at 0, so `o.closestTgtApprUT` (an absolute UT)
 * reads straight through as the TCA duration in `vessel.target.closestApproach.time`,
 * previously this widget had no `TelemetryProvider` at all under the bare
 * snapshot harness, so TCA always degraded to the null-display placeholder;
 * now every render mounts
 * one (the widget's only reads are canonical Topics), so the approach-mode
 * fixture's TCA renders for real.
 */

interface Fixture {
  _meta?: unknown;
  [key: string]: unknown;
}

const FIXTURES: Record<string, Fixture> = {
  "no-target": noTarget,
  "far-approach-vessel": far,
  "celestial-body-tracking": body,
  "approach-closing": approach,
  "docking-aligned": aligned,
  "docking-misaligned": misaligned,
};

/** `tar.type` legacy string -> the `vessel.target.kind` ordinal it now maps to. */
function tarTypeToKind(type: unknown): number | undefined {
  if (type === "Vessel") return 0;
  if (type === "CelestialBody") return 1;
  return undefined;
}

function buildVesselTarget(fixture: Fixture): unknown {
  const name = fixture["tar.name"];
  if (typeof name !== "string" || name.length === 0) return null;
  const closestApprUt = fixture["o.closestTgtApprUT"];
  return {
    name,
    kind: tarTypeToKind(fixture["tar.type"]),
    vesselId: "target-vessel",
    bodyIndex: null,
    relativePosition: fixture["tar.relativePosition"] ?? null,
    relativeVelocity: fixture["tar.relativeVelocityVec"] ?? null,
    closestApproach:
      typeof closestApprUt === "number"
        ? { time: closestApprUt, distance: 0 }
        : null,
  };
}

function buildVesselDock(fixture: Fixture): unknown | undefined {
  if (!("dock.relativePosition" in fixture)) return undefined;
  return {
    relativePosition: fixture["dock.relativePosition"],
    relativeVelocity: fixture["dock.relativeVelocityVec"],
    distance: fixture["dock.distanceScalar"],
    forwardDot: fixture["dock.forwardDot"],
  };
}

const config = getWidget("distance-to-target");
if (!config) throw new Error("distance-to-target missing from widgets.ts");

describe("DistanceToTarget DOM snapshots", () => {
  afterEach(() => {
    cleanup();
  });

  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const hasDock = buildVesselDock(fixture) !== undefined;
        const carriedChannels = hasDock
          ? ["vessel.target", "vessel.dock"]
          : ["vessel.target"];
        const stream = setupStreamFixture({ carriedChannels, pinnedUt: 0 });
        const mergedConfig = { ...(mode.config ?? {}) };

        const { container } = render(
          <stream.Provider>
            <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
              <DistanceToTargetComponent
                config={mergedConfig}
                id="snap"
                w={mode.w}
                h={mode.h}
              />
            </DashboardItemContext.Provider>
          </stream.Provider>,
        );

        act(() => {
          stream.emit("vessel.target", buildVesselTarget(fixture));
          const dock = buildVesselDock(fixture);
          if (dock !== undefined) stream.emit("vessel.dock", dock);
        });

        await waitFor(() => {
          if (container.textContent?.includes("SYNCING")) {
            throw new Error("stream status has not settled to live yet");
          }
        });

        expect(stripVolatile(container.innerHTML)).toMatchSnapshot();
      });
    }
  }
});
