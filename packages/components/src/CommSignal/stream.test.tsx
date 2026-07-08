import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
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

  it(
    "M3 whole-branch review #4: reflects a signal-loss transition (connected True->False->True) as LOS, " +
      "never a stuck-stale 'connected' readout",
    async () => {
      const fixture = setupStreamFixture({
        carriedChannels: ["vessel.comms"],
        pinnedUt: 10,
      });
      const { container } = render(
        <fixture.Provider>
          <DashboardItemContext.Provider value={{ instanceId: "comm-loss" }}>
            <CommSignalComponent id="comm-loss" w={6} h={5} />
          </DashboardItemContext.Provider>
        </fixture.Provider>,
      );

      act(() => {
        fixture.emit("vessel.comms", { connected: true, signalStrength: 0.87 });
      });
      await waitFor(() => expect(screen.getByText("87%")).toBeTruthy());
      expect(screen.getByLabelText("Signal 4 of 4")).toBeTruthy();

      // Signal lost — the wire actively reports connected:false (not
      // silence/absence). The widget must show LOS, not hold the stale 87%.
      act(() => {
        fixture.emit("vessel.comms", { connected: false, signalStrength: 0 });
      });
      await waitFor(() => {
        if (container.textContent?.includes("SYNCING")) {
          throw new Error("stream status has not settled to live yet");
        }
        expect(screen.getByText("LOS")).toBeTruthy();
      });
      expect(screen.queryByText("87%")).toBeNull();
      expect(screen.getByLabelText("Signal 0 of 4")).toBeTruthy();
      expect(screen.getByText("No signal")).toBeTruthy();
      // The polite live region announces the loss (not a live-regioned
      // percentage — see the component's own a11y doc comment).
      expect(screen.getByText("Signal lost")).toBeTruthy();

      // Signal regained.
      act(() => {
        fixture.emit("vessel.comms", { connected: true, signalStrength: 0.6 });
      });
      await waitFor(() => expect(screen.getByText("60%")).toBeTruthy());
      expect(screen.queryByText("LOS")).toBeNull();
      expect(screen.getByText("Signal connected")).toBeTruthy();
    },
  );

  it(
    "M3 whole-branch review #4: documents the useDataValue.ts:88-92 disconnect delta explicitly — " +
      "legacy clears to undefined, the streamed path holds the last-known value",
    async () => {
      // LEGACY side: no TelemetryProvider in the tree at all (the
      // pre-migration path every screen still runs today) — a DataSource
      // status drop clears the value to undefined (useDataValue's
      // `onStatusChange` handler), degrading the whole widget to the
      // "No signal data" empty state.
      const legacyFixture = await setupMockDataSource({
        id: "data",
        keys: [{ key: "comm.connected" }, { key: "comm.signalStrength" }],
        connectSource: true,
      });
      const legacyRender = render(
        <DashboardItemContext.Provider value={{ instanceId: "comm-legacy" }}>
          <CommSignalComponent id="comm-legacy" w={6} h={5} />
        </DashboardItemContext.Provider>,
      );
      act(() => {
        legacyFixture.source.emit("comm.connected", true);
        legacyFixture.source.emit("comm.signalStrength", 0.9);
      });
      await waitFor(() => expect(legacyRender.getByText("90%")).toBeTruthy());
      act(() => legacyFixture.source.setStatus("disconnected"));
      expect(legacyRender.getByText("No signal data")).toBeTruthy();
      legacyRender.unmount();
      teardownMockDataSource(legacyFixture);

      // STREAM side: a TelemetryProvider mounted, `vessel.comms` carried.
      // No further wire activity after the initial value — simulating the
      // underlying connection having gone silent, the same real-world
      // event the legacy side's disconnect represents. Per the documented
      // delta, this path does NOT clear — it holds the last-known value.
      const streamFixture = setupStreamFixture({
        carriedChannels: ["vessel.comms"],
        pinnedUt: 10,
      });
      render(
        <streamFixture.Provider>
          <DashboardItemContext.Provider
            value={{ instanceId: "comm-stream-hold" }}
          >
            <CommSignalComponent id="comm-stream-hold" w={6} h={5} />
          </DashboardItemContext.Provider>
        </streamFixture.Provider>,
      );
      act(() => {
        streamFixture.emit("vessel.comms", {
          connected: true,
          signalStrength: 0.9,
        });
      });
      await waitFor(() => expect(screen.getByText("90%")).toBeTruthy());
      // No new wire samples, no status event at all — nothing further
      // happens on this side by design. The value must still be showing;
      // this is the intended behavior, asserted explicitly rather than
      // left as an untested gap.
      expect(screen.getByText("90%")).toBeTruthy();
      expect(screen.queryByText("No signal data")).toBeNull();
    },
  );

  it(
    "M3 whole-branch review #4: under delay>0, a newer sample doesn't win until the delay elapses — " +
      "renders the OLDER confirmed value in the meantime, then catches up",
    async () => {
      // Every dual-run/stream fixture up to this point hardcoded
      // delaySeconds:()=>0 — the pipeline's whole reason to exist (delayed
      // delivery) was untested. `pinnedUt` is deliberately OMITTED here:
      // ViewClock.viewUt()'s scrubTo target wins outright over the
      // confirmed-edge/delay computation, so a pinned clock would make
      // `delaySeconds` a no-op (see setupStreamFixture's doc comment).
      const fixture = setupStreamFixture({
        carriedChannels: ["vessel.comms"],
        delaySeconds: 5,
      });

      render(
        <fixture.Provider>
          <DashboardItemContext.Provider value={{ instanceId: "comm-delay" }}>
            <CommSignalComponent id="comm-delay" w={6} h={5} />
          </DashboardItemContext.Provider>
        </fixture.Provider>,
      );

      // Sample A: validAt/deliveredAt = 0 (wall also starts at 0).
      act(() => {
        fixture.emit(
          "vessel.comms",
          { connected: true, signalStrength: 0.5 },
          { validAt: 0, deliveredAt: 0 },
        );
      });
      // Nothing renders yet — even sample A hasn't crossed the delay
      // window (confirmedEdgeUt = utNowEstimate() - delaySeconds is
      // negative before any wall time has passed).
      expect(screen.getByText("No signal data")).toBeTruthy();

      // Advance the wall by exactly the delay — sample A now crosses the
      // confirmed edge. Nothing else drives a frame refresh between
      // ingests (TelemetryProvider only schedules one ON ingest), so the
      // test calls `beginFrame()` itself to apply the new wall time.
      act(() => {
        fixture.wall.advanceBy(5);
        fixture.store.beginFrame();
      });
      await waitFor(() => expect(screen.getByText("50%")).toBeTruthy());

      // Sample B: a MUCH more current reading arrives (validAt/deliveredAt
      // = 20), but the delay window means it isn't confirmed yet.
      act(() => {
        fixture.emit(
          "vessel.comms",
          { connected: true, signalStrength: 0.9 },
          { validAt: 20, deliveredAt: 20 },
        );
        fixture.store.beginFrame();
      });
      // The OLDER confirmed value (50%) must still be what's rendered —
      // sample B must not win early just because it's the latest thing on
      // the wire. This is the concrete behavior the delay pipeline exists
      // to produce and the one no prior dual-run ever exercised.
      expect(screen.getByText("50%")).toBeTruthy();
      expect(screen.queryByText("90%")).toBeNull();

      // Advance past the delay window relative to sample B's timing too —
      // now it should win.
      act(() => {
        fixture.wall.advanceBy(5);
        fixture.store.beginFrame();
      });
      await waitFor(() => expect(screen.getByText("90%")).toBeTruthy());
      expect(screen.queryByText("50%")).toBeNull();
    },
  );
});
