import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

/**
 * CommSignal's fork↔stream parity behavior test. This was originally a
 * dual-run back when `comm.controlState`/`comm.controlStateName`/
 * `comm.signalDelay` were GAPPED — the stream leg had to feed those three
 * through a legacy `"data"` `MockDataSource` because nothing streamed them.
 * All three are now mapped onto clean homes (control state →
 * the SDK-derived `vessel.state.commsControlState*` display maps off
 * `vessel.comms.controlState`; delay → `comms.delay.oneWaySeconds`), so the
 * legacy MockDataSource leg is dropped: every field now feeds off the real
 * stream pipeline (`TelemetryProvider` + `StubTransport`), and this test
 * proves the full readout — strength headline, bars, control label, and the
 * formatted delay — all resolve off the stream for the same signal state the
 * `strong-direct-ksc` fixture depicts.
 */
// Every input `vesselStateChannel` declares (vessel-state.ts) — all must be in
// the allowlist for the derived `vessel.state.commsControlState*` fields to be
// treated as carried; `comms.delay` backs `comm.signalDelay`.
const CARRIED = [
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

describe("CommSignal — full readout off the stream (R6 Wave 1)", () => {
  it("resolves strength, bars, control label, and delay off the stream for a strong direct link", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-dual" }}>
          <CommSignalComponent id="comm-dual" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      // The derived `vessel.state.commsControlState*` fields (control label +
      // level) require `vessel.orbit` present — `deriveVesselState` returns the
      // whole record only once the vessel has an orbit (vessel-state.ts).
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
      // (Full = 4); the SDK collapses it to the widget's level (2) and resolves
      // the "Full" name string.
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.87,
        controlState: 4,
      });
      fixture.emit("comms.delay", { oneWaySeconds: 0.0004 });
    });

    // A real subscription must have happened for StubTransport (subscription-
    // gated) to deliver at all.
    expect(fixture.transport.isSubscribed("vessel.comms")).toBe(true);
    expect(fixture.transport.isSubscribed("comms.delay")).toBe(true);

    // ceil(0.87 * 4) = 4 lit bars; headline reads the percentage.
    await waitFor(() => expect(screen.getByText("87%")).toBeTruthy());
    expect(screen.getByLabelText("Signal 4 of 4")).toBeTruthy();
    // Control label + formatted delay both come off the stream now.
    expect(screen.getByText("Full")).toBeTruthy();
    expect(screen.getByText("0 ms")).toBeTruthy();
    expect(screen.getByText("Signal to KSC")).toBeTruthy();
    // No stray "—" placeholder — every field resolved.
    expect(container.textContent).not.toContain("—");
  });
});
