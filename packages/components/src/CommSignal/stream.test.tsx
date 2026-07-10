import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

/**
 * CommSignal genuinely running off the real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport` — no legacy
 * `DataSource` is registered anywhere in this file.
 *
 * R6 Wave-1: all five reads are clean homes now (`map-topic.ts`):
 * - `comm.connected` -> `vessel.comms.connected`, `comm.signalStrength` ->
 *   `vessel.comms.signalStrength` (raw field subtopics of `vessel.comms`).
 * - `comm.controlState` -> `vessel.state.commsControlStateOrdinal`,
 *   `comm.controlStateName` -> `vessel.state.commsControlStateName` (both
 *   SDK-derived off `vessel.comms.controlState`'s rich `ControlState` enum —
 *   so carrying them means carrying every `vesselStateChannel` input).
 * - `comm.signalDelay` -> `comms.delay.oneWaySeconds`.
 *
 * A fixture that carries only `vessel.comms` therefore streams
 * connected/signalStrength but leaves control state + delay unresolved (their
 * derived/other homes aren't carried, and no legacy source exists here) — the
 * widget renders the `describeControl`/`formatDelay` "—" placeholders. The
 * final test carries the full set to prove control state + delay stream too.
 */
afterEach(() => {
  cleanup();
});

// Every input `vesselStateChannel` declares (vessel-state.ts) plus `comms.delay`
// — the full allowlist needed for control state + delay to be carried.
const FULL_CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
  "comms.delay",
];

describe("CommSignal — genuinely runs off the stream (R6 Wave 1)", () => {
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
    // Control state (derived, needs the full vessel.state input set) and delay
    // (comms.delay) aren't carried in THIS fixture, and there's no legacy
    // source, so `describeControl` falls through to "—" and `formatDelay`
    // renders its "—" placeholder — two independent "—" cells.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Signal to KSC")).toBeTruthy();
  });

  it(
    "reflects a signal-loss transition (connected True->False->True) as LOS, " +
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

  it("holds the last-known value when the wire goes silent (no clear-on-disconnect)", async () => {
    // A TelemetryProvider mounted, `vessel.comms` carried. No further wire
    // activity after the initial value — simulating the underlying
    // connection having gone silent. The streamed path does NOT clear to
    // undefined the way the retired legacy `DataSource` did on a status
    // drop; it holds the last-known value (M2 staleness model).
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.comms"],
      pinnedUt: 10,
    });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "comm-stream-hold" }}
        >
          <CommSignalComponent id="comm-stream-hold" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.9,
      });
    });
    await waitFor(() => expect(screen.getByText("90%")).toBeTruthy());
    // No new wire samples, no status event at all — nothing further happens
    // by design. The value must still be showing.
    expect(screen.getByText("90%")).toBeTruthy();
    expect(screen.queryByText("No signal data")).toBeNull();
  });

  it(
    "under delay>0, a newer sample doesn't win until the delay elapses — " +
      "renders the OLDER confirmed value in the meantime, then catches up",
    async () => {
      // `pinnedUt` is deliberately OMITTED: ViewClock.viewUt()'s scrubTo
      // target wins outright over the confirmed-edge/delay computation, so a
      // pinned clock would make `delaySeconds` a no-op (see setupStreamFixture).
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
      // Nothing renders yet — even sample A hasn't crossed the delay window
      // (confirmedEdgeUt = utNowEstimate() - delaySeconds is negative before
      // any wall time has passed).
      expect(screen.getByText("No signal data")).toBeTruthy();

      // Advance the wall by exactly the delay — sample A crosses the confirmed
      // edge. Nothing else drives a frame refresh between ingests, so the test
      // calls `beginFrame()` itself to apply the new wall time.
      act(() => {
        fixture.wall.advanceBy(5);
        fixture.store.beginFrame();
      });
      await waitFor(() => expect(screen.getByText("50%")).toBeTruthy());

      // Sample B: a MUCH more current reading arrives (validAt/deliveredAt =
      // 20), but the delay window means it isn't confirmed yet.
      act(() => {
        fixture.emit(
          "vessel.comms",
          { connected: true, signalStrength: 0.9 },
          { validAt: 20, deliveredAt: 20 },
        );
        fixture.store.beginFrame();
      });
      // The OLDER confirmed value (50%) must still be what's rendered.
      expect(screen.getByText("50%")).toBeTruthy();
      expect(screen.queryByText("90%")).toBeNull();

      // Advance past the delay window relative to sample B's timing too.
      act(() => {
        fixture.wall.advanceBy(5);
        fixture.store.beginFrame();
      });
      await waitFor(() => expect(screen.getByText("90%")).toBeTruthy());
      expect(screen.queryByText("50%")).toBeNull();
    },
  );

  it("streams control state (derived) and signal delay off their clean homes", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: FULL_CARRIED,
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-full" }}>
          <CommSignalComponent id="comm-full" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      // The derived `vessel.state.commsControlState*` fields require
      // `vessel.orbit` present — `deriveVesselState` returns the whole record
      // only once the vessel has an orbit (vessel-state.ts).
      fixture.emit("vessel.orbit", {
        sma: 680000,
        ecc: 0.0,
        inc: 0.0,
        argPe: 0.0,
        mu: 3.5316e12,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        referenceBodyIndex: 1,
      });
      // `controlState` on the wire is the rich `ControlState` enum ordinal
      // (Partial = 3); the SDK collapses it to the widget's level (1) and
      // resolves the "Partial" name string via `vessel.state.commsControlState*`.
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.4,
        controlState: 3,
      });
      fixture.emit("comms.delay", { oneWaySeconds: 1.2 });
    });

    // Derived control state resolves off vessel.comms via the vessel.state
    // channel; delay off comms.delay — both streamed, no legacy source.
    await waitFor(() => expect(screen.getByText("Partial")).toBeTruthy());
    expect(fixture.transport.isSubscribed("comms.delay")).toBe(true);
    // ceil(0.4 * 4) = 2 lit bars.
    expect(screen.getByLabelText("Signal 2 of 4")).toBeTruthy();
    // formatDelay(1.2) -> "1.2 s".
    expect(screen.getByText("1.2 s")).toBeTruthy();
  });
});
