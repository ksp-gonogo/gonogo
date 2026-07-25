import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import eve from "./__fixtures__/eve-orbit-high-gravity.json";
import escapeTraj from "./__fixtures__/kerbin-escape-trajectory.json";
import hko from "./__fixtures__/kerbin-hko-approaching-escape.json";
import lko from "./__fixtures__/kerbin-lko-well-below-escape.json";
import mun from "./__fixtures__/mun-surface-low-orbit.json";
import unknown from "./__fixtures__/unknown-body-no-reference.json";
import { EscapeProfileComponent } from "./index";

/**
 * DOM snapshots off the stream — the widget's one direct read, `v.body`, is
 * now a native `useStream<VesselState>("vessel.state")?.parentBodyName`
 * read with no legacy fallback, so the generic `snapshotWidgetMode` harness
 * (which emits fixture keys straight onto a `MockDataSource`, no
 * `TelemetryProvider` mounted) can't drive it any more — every fixture's
 * `v.body` is mapped here onto `vessel.identity.parentBodyIndex` resolved
 * against a `system.bodies` entry, same as `stream.test.tsx`/the retired
 * `dual-run.test.tsx`. `v.altitude`/`v.orbitalVelocity` (the `GraphView`
 * trace) aren't emitted at all — they render nothing under jsdom regardless
 * (no ResizeObserver stub here, matching this file's pre-migration
 * behavior).
 */
interface Fixture {
  _meta?: unknown;
  [key: string]: unknown;
}

const FIXTURES: Record<string, Fixture> = {
  "kerbin-lko-well-below-escape": lko,
  "kerbin-hko-approaching-escape": hko,
  "kerbin-escape-trajectory": escapeTraj,
  "mun-surface-low-orbit": mun,
  "eve-orbit-high-gravity": eve,
  "unknown-body-no-reference": unknown,
};

// vessel.state's carried-channels gate is parent-channel-scoped — every
// vessel.state.* field needs ALL of vesselStateChannel.inputs carried, even
// the ones (here, all but vessel.identity/system.bodies) parentBodyName
// never consults.
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

const config = getWidget("escape-profile");
if (!config) throw new Error("escape-profile missing from widgets.ts");

describe("EscapeProfile DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        registerStockBodies();
        const stream = setupStreamFixture({
          carriedChannels: VESSEL_STATE_INPUTS,
          pinnedUt: 10,
        });
        const mergedConfig = { ...(mode.config ?? {}) };

        const { container } = render(
          <stream.Provider>
            <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
              <EscapeProfileComponent
                config={mergedConfig}
                id="snap"
                w={mode.w}
                h={mode.h}
              />
            </DashboardItemContext.Provider>
          </stream.Provider>,
        );

        act(() => {
          // vessel.orbit gates the whole derived vessel.state record
          // (deriveVesselState), so it must be present for parentBodyName
          // to resolve at all.
          stream.emit("vessel.orbit", {
            referenceBodyIndex: 1,
            sma: 700_000,
            ecc: 0,
            inc: 0,
            lan: 0,
            argPe: 0,
            mu: 3.5316e12,
            meanAnomalyAtEpoch: 0,
            epoch: 10,
            encounter: null,
          });
          stream.emit("system.bodies", {
            bodies: [
              {
                name: fixture["v.body"],
                index: 1,
                parentIndex: 0,
                radius: 600_000,
                orbit: null,
              },
            ],
          });
          stream.emit("vessel.identity", { parentBodyIndex: 1 });
        });

        await waitFor(() => {
          if (!container.textContent?.includes("ESCAPE PROFILE")) {
            throw new Error("widget has not rendered yet");
          }
          // The title renders on first paint, before vessel.state.parentBodyName
          // has actually resolved through the frame-scheduled TimelineStore —
          // waiting on the title alone raced the body resolution and could
          // snapshot the widget's PRE-body-arrival DOM. Wait on the resolved
          // store value directly instead.
          const point = stream.store.sample<string | null>(
            "vessel.state.parentBodyName",
            stream.store.currentFrame(),
          );
          if (!point || point.payload === undefined) {
            throw new Error("vessel.state.parentBodyName has not resolved yet");
          }
        });

        expect(stripVolatile(container.innerHTML)).toMatchSnapshot();
      });
    }
  }
});
