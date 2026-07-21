import { useTelemetry } from "@ksp-gonogo/core";
import {
  createFakeWallClock,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { SignalLossIndicator } from "./SignalLossIndicator";

/**
 * Client-side coverage for the comms-delay-model-consistency headline claim
 * ("NO SIGNAL flips at the freeze instant"), added per the adversarial
 * review's Finding #1 (MEDIUM): every prior test either exercised the pure
 * `deriveState` function directly, or drove `CommSignal`'s stream test with
 * `pinnedUt` set — a pinned `ViewClock.scrubTo` target wins outright over the
 * certainty-horizon/delay computation (see `setupStreamFixture`'s own doc
 * comment), so those tests never actually ran the exact mechanism at risk:
 * a Delayed, freeze-EXEMPT `comms.link` sample escaping the certainty gate
 * mid-blackout while ordinary Delayed telemetry (`vessel.comms`) holds its
 * last-known value.
 *
 * This fixture deliberately mirrors `setupStreamFixture` (components
 * package) but is hand-rolled here (matching this package's own
 * `MissionBanner.test.tsx` / `telemetry-components.test.tsx` convention of
 * building the `StubTransport`/`TelemetryClient`/`TimelineStore`/`ViewClock`
 * stack directly) with `pinnedUt` UNSET and a nonzero `delaySeconds` — the
 * live, certainty-gated clock. Time is driven explicitly via
 * `wall.advanceBy` + `store.beginFrame()` (nothing else advances a frame
 * between ingests).
 *
 * `CommsProbe` is a test-only readout of the raw `vessel.comms`/`comms.link`
 * values — `SignalLossIndicator` itself only ever renders a boolean
 * banner/no-banner, so the probe is what lets this test show the "freeze"
 * side of the claim (the struct topic's last-known value holding steady)
 * side-by-side with the banner (the connectivity MetaTopic's edge escaping).
 */
function CommsProbe() {
  const comms = useTelemetry("vessel.comms");
  const link = useTelemetry("comms.link");
  return (
    <div data-testid="probe">
      <span data-testid="probe-strength">
        {comms?.signalStrength ?? "none"}
      </span>
      <span data-testid="probe-comms-connected">
        {String(comms?.connected)}
      </span>
      <span data-testid="probe-link-connected">{String(link?.connected)}</span>
    </div>
  );
}

function setupDelayedStream(delaySeconds: number) {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => delaySeconds,
  });
  const store = new TimelineStore(clock);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={["vessel.comms", "comms.link"]}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return {
    transport,
    wall,
    store,
    Provider,
    emit: (topic: string, payload: unknown, validAt: number) =>
      transport.emit(topic, payload, { validAt, deliveredAt: validAt }),
  };
}

describe("SignalLossIndicator — genuinely runs off a DELAYED, UNPINNED stream", () => {
  it(
    "freezes vessel.comms at its last-known value through a blackout, but the " +
      "comms.link disconnect edge still surfaces at the delayed instant — and a " +
      "0%-signal decay (no disconnect) reads NO SIGNAL through the same gate",
    async () => {
      const delaySeconds = 5;
      const fixture = setupDelayedStream(delaySeconds);

      render(
        <fixture.Provider>
          <SignalLossIndicator />
          <CommsProbe />
        </fixture.Provider>,
      );

      // --- Baseline: healthy link, both topics land at UT 0. ---
      act(() => {
        fixture.emit(
          "vessel.comms",
          { connected: true, signalStrength: 0.8, controlState: 2 },
          0,
        );
        fixture.emit("comms.link", { connected: true }, 0);
      });
      act(() => {
        fixture.wall.advanceBy(delaySeconds);
        fixture.store.beginFrame();
      });
      await waitFor(() =>
        expect(screen.getByTestId("probe-strength").textContent).toBe("0.8"),
      );
      expect(screen.queryByText("SIGNAL LOSS")).toBeNull();

      // Let more wall time pass with no new samples — the certainty horizon
      // is clamped to the max sample UT actually observed (ViewClock's own
      // invariant), so nothing new is confirmed; both topics keep reading
      // their UT-0 values. Models the quiet period right before a blackout.
      act(() => {
        fixture.wall.advanceBy(5);
        fixture.store.beginFrame();
      });
      expect(screen.getByTestId("probe-comms-connected").textContent).toBe(
        "true",
      );

      // --- Blackout: comms.link reports the disconnect edge at UT 10. NO
      // further vessel.comms sample is ever emitted after this point — the
      // server-side freeze this models simply stops advancing that topic. ---
      act(() => {
        fixture.emit("comms.link", { connected: false }, 10);
      });
      // Not yet within the delay window — must still read connected.
      expect(screen.queryByText("SIGNAL LOSS")).toBeNull();
      expect(screen.getByTestId("probe-link-connected").textContent).toBe(
        "true",
      );

      // Advance exactly one delay window past the disconnect's UT — the edge
      // crosses the certainty horizon and must now surface.
      act(() => {
        fixture.wall.advanceBy(delaySeconds);
        fixture.store.beginFrame();
      });
      await waitFor(() => expect(screen.getByText("SIGNAL LOSS")).toBeTruthy());
      // The struct topic is genuinely frozen: still the pre-blackout reading,
      // not cleared, not advanced — this is the "freeze" half of the claim.
      expect(screen.getByTestId("probe-strength").textContent).toBe("0.8");
      expect(screen.getByTestId("probe-comms-connected").textContent).toBe(
        "true",
      );
      expect(screen.getByTestId("probe-link-connected").textContent).toBe(
        "false",
      );

      // --- Reconnect: comms.link flips back at UT 20. ---
      act(() => {
        fixture.emit("comms.link", { connected: true }, 20);
      });
      expect(screen.getByText("SIGNAL LOSS")).toBeTruthy(); // still gated
      act(() => {
        fixture.wall.advanceBy(delaySeconds);
        fixture.store.beginFrame();
      });
      await waitFor(() => expect(screen.queryByText("SIGNAL LOSS")).toBeNull());

      // --- 0%-signal decay, no disconnect at all: comms.link stays
      // connected, but vessel.comms.signalStrength decays to 0 at UT 30. This
      // proves the epsilon/zero-signal branch also rides the delayed,
      // unpinned certainty gate correctly, independent of the connectivity
      // edge. ---
      act(() => {
        fixture.emit(
          "vessel.comms",
          { connected: true, signalStrength: 0, controlState: 2 },
          30,
        );
      });
      expect(screen.queryByText("SIGNAL LOSS")).toBeNull(); // not yet confirmed
      act(() => {
        fixture.wall.advanceBy(delaySeconds);
        fixture.store.beginFrame();
      });
      await waitFor(() =>
        expect(screen.getByTestId("probe-strength").textContent).toBe("0"),
      );
      expect(screen.getByTestId("probe-link-connected").textContent).toBe(
        "true",
      );
      // connected is still true on both topics — only the strength decayed —
      // yet the banner must read SIGNAL LOSS.
      expect(screen.getByText("SIGNAL LOSS")).toBeTruthy();
    },
  );

  it("does not crash when vessel.comms is null (a disconnected-vessel tombstone), renders SIGNAL LOSS", async () => {
    const delaySeconds = 5;
    const fixture = setupDelayedStream(delaySeconds);

    render(
      <fixture.Provider>
        <SignalLossIndicator />
      </fixture.Provider>,
    );

    // Confirm a healthy link first so the blackout gate (hasConfirmedConnection) opens.
    act(() => {
      fixture.emit(
        "vessel.comms",
        { connected: true, signalStrength: 0.8, controlState: 2 },
        0,
      );
      fixture.emit("comms.link", { connected: true }, 0);
    });
    act(() => {
      fixture.wall.advanceBy(delaySeconds);
      fixture.store.beginFrame();
    });

    // Disconnect: the link drops AND vessel.comms goes to a null tombstone — the
    // real comms-dark case that crashed on `null.controlState` (this test threw
    // during render before the null-guard fix).
    act(() => {
      fixture.emit("comms.link", { connected: false }, 10);
      fixture.emit("vessel.comms", null, 10);
    });
    act(() => {
      fixture.wall.advanceBy(10 + delaySeconds);
      fixture.store.beginFrame();
    });

    await waitFor(() => expect(screen.getByText("SIGNAL LOSS")).toBeTruthy());
  });
});
