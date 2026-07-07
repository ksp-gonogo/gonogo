import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

/**
 * The M3 batch-2 stream test-adapter proof for CommSignal (mirrors
 * `ThermalStatus/stream.test.tsx`, batch 1): genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport` — no legacy `DataSource` is registered anywhere in this
 * file.
 *
 * CommSignal's keys split MAPPED / GAPPED (`map-topic.ts`):
 * - MAPPED: `comm.connected` -> `vessel.comms.connected`, `comm.
 *   signalStrength` -> `vessel.comms.signalStrength`.
 * - GAPPED (stay legacy forever until a gap lands — not exercised here
 *   since no legacy source exists in this file): `comm.controlState` /
 *   `comm.controlStateName` (both collapse onto the single STRING enum
 *   `vessel.comms.controlState` — a shape mismatch with what this widget
 *   reads) and `comm.signalDelay` (no home yet).
 */
afterEach(() => {
  cleanup();
});

describe("CommSignal — genuinely runs off the stream (M3 batch 2)", () => {
  it("reads connected/signalStrength off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.comms"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-stream" }}>
          <CommSignalComponent id="comm-stream" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet — hasData is false (connected/strength/
    // controlState all undefined), so the empty state renders.
    expect(screen.getByText("No signal data")).toBeTruthy();

    // A real subscription must have happened for this to deliver at all —
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.comms")).toBe(true);

    act(() => {
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.87,
      });
    });

    // ceil(0.87 * 4) = 4 lit bars; headline reads the percentage.
    await waitFor(() => expect(screen.getByText("87%")).toBeTruthy());
    expect(screen.getByLabelText("Signal 4 of 4")).toBeTruthy();
    // comm.controlState/comm.controlStateName are declared gaps — with no
    // legacy source here they stay undefined, so `describeControl` falls
    // through to its "—" default rather than fabricating a control label,
    // and comm.signalDelay (also gapped) renders formatDelay's "—"
    // placeholder in the Delay row — two independent "—" cells.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Signal to KSC")).toBeTruthy();
  });
});
