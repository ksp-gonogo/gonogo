import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { KeplerPeriodComponent } from "./index";

// Rendered trees, tracked so afterEach can unmount them BEFORE clearBodies()
// notifies the body-registry subscribers. RTL auto-cleanup runs after this
// file's afterEach, so it can't be relied on to unmount first, clearBodies()
// firing on a still-mounted widget is a state update outside act(), the
// documented anti-pattern in CLAUDE.md.
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

function unmountAll() {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
}

/**
 * KeplerPeriod's stream proof. Its two body reads ride the stream:
 * `v.body` -> `vessel.identity.parentBodyIndex`, `o.referenceBody` ->
 * `vessel.orbit.referenceBodyIndex`, each named against `system.bodies`.
 *
 * This test runs the widget OFF THE REAL PIPELINE (`TelemetryProvider` +
 * `TelemetryClient`/`TimelineStore` via `StubTransport`, no legacy
 * `DataSource` registered anywhere) and proves the body-name reads resolve
 * off the stream: emitting a body the stock registry doesn't
 * know surfaces the widget's "Unknown body" degraded notice, which fires
 * ONLY when `bodyName` (the streamed parent body name) is defined but
 * `getBody` can't resolve it, a positive assertion that the value reached
 * the widget off the stream.

 *
 * The graph's `o.sma`/`o.period` series flow through `GraphView` ->
 * `useDataSeries` (its own stream shim), not `useTelemetry`, so they're out
 * of scope for this read-migration proof.
 */
beforeEach(() => {
  clearBodies();
  registerStockBodies();
});

afterEach(() => {
  unmountAll();
  clearBodies();
});

const KEPLER_PERIOD_CHANNELS = [
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
];

describe("KeplerPeriod: reads body names off the stream (R6 Wave 1)", () => {
  it("resolves the parent and reference body names off the stream and surfaces the no-reference-data notice", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: KEPLER_PERIOD_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "kepler-stream" }}>
          <KeplerPeriodComponent id="kepler-stream" w={10} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // GraphView's title always renders regardless of data state.
    expect(screen.getByText("KEPLER PERIOD")).toBeTruthy();
    // Nothing arrived yet: neither degraded notice fires.
    expect(screen.queryByText(/No reference data/)).toBeNull();

    /*
     * Emit the orbit, identity and roster. `referenceBodyIndex` /
     * `parentBodyIndex` both point at a body no bundled table has ever heard
     * of. The roster reports its radius and no gravitational parameter, so the
     * body resolves and Kepler's third law cannot be drawn for it: the "No
     * reference data" notice. It used to be "Unknown body", which was the
     * widget disowning a body the stream had just described.
     */
    act(() => {
      fixture.emit("vessel.orbit", {
        sma: 682500,
        ecc: 0.00367,
        inc: 0.3,
        argPe: 12.5,
        mu: 3.5316e12,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        referenceBodyIndex: 42,
      });
      fixture.emit("vessel.identity", {
        parentBodyIndex: 42,
        launchUt: 0,
      });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Gallium",
            index: 42,
            parentIndex: 0,
            radius: 100000,
            orbit: null,
          },
        ],
      });
    });

    // A real subscription must have happened for StubTransport (which is
    // subscription-gated) to have delivered at all.
    expect(fixture.transport.isSubscribed("vessel.identity")).toBe(true);
    expect(fixture.transport.isSubscribed("system.bodies")).toBe(true);

    // The streamed body name reached the widget: the notice renders with the
    // exact streamed name.
    await waitFor(() =>
      expect(screen.getByText(/No reference data/)).toBeTruthy(),
    );
    expect(screen.getByText(/Gallium/)).toBeTruthy();
  });
});
