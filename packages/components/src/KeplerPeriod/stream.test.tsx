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
// file's afterEach, so it can't be relied on to unmount first — clearBodies()
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
 * KeplerPeriod's stream proof. When this widget was first authored
 * its two `useDataValue` reads (`v.body`, `o.referenceBody`) were declared
 * GAPS, so it stayed 100% legacy and this test only asserted a stream-safe
 * no-op. Both are now un-gapped onto SDK-derived display maps —
 * `v.body` -> `vessel.state.parentBodyName`, `o.referenceBody` ->
 * `vessel.state.referenceBodyName` (index→name resolution against
 * `system.bodies`, see `vessel-state.ts`) — so the reads are now migrated to
 * `useTelemetry` and genuinely ride the stream.
 *
 * This test runs the widget OFF THE REAL PIPELINE (`TelemetryProvider` +
 * `TelemetryClient`/`TimelineStore` via `StubTransport`, no legacy
 * `DataSource` registered anywhere) and proves the body-name reads resolve
 * through the derived channel: emitting a body the stock registry doesn't
 * know surfaces the widget's "Unknown body" degraded notice, which fires
 * ONLY when `bodyName` (the streamed `parentBodyName`) is defined but
 * `getBody` can't resolve it — a positive assertion that the value reached
 * the widget off the stream.
 *
 * `carriedChannels` lists all EIGHT of `vessel.state`'s declared inputs even
 * though only `vessel.orbit`/`vessel.identity`/`system.bodies` are consulted
 * here — the carried-channels gate is parent-channel-scoped, not per-field
 * (see `vessel-state.ts`'s `vesselStateChannel` doc comment).
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

describe("KeplerPeriod — reads body names off the stream (R6 Wave 1)", () => {
  it("resolves parentBodyName/referenceBodyName from the derived channel and surfaces the unknown-body notice", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: VESSEL_STATE_INPUTS,
      pinnedUt: 10,
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
    // Nothing arrived yet — neither degraded notice fires.
    expect(screen.queryByText(/Unknown body/)).toBeNull();

    // Emit the derived channel's inputs. `referenceBodyIndex` /
    // `parentBodyIndex` both point at a body the stock registry has never
    // heard of, so `getBody` returns undefined and the widget degrades to
    // its "Unknown body" notice.
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

    // The streamed body name reached the widget: it can't resolve "Gallium"
    // in the stock registry, so the unknown-body notice renders with the
    // exact streamed name.
    await waitFor(() => expect(screen.getByText(/Unknown body/)).toBeTruthy());
    expect(screen.getByText(/Gallium/)).toBeTruthy();
  });
});
