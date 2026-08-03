import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import * as controlStreamModel from "./control-stream-model";
import { createFakeWallClock } from "./fake-wall-clock";
import { StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { useControlStream } from "./use-control-stream";
import { ViewClock } from "./view-clock";

/**
 * Local, self-contained stream fixture: same pattern `use-route-commands.
 * test.tsx` and `use-command.test.tsx` use (sitrep-client can't depend on
 * `@ksp-gonogo/components`' `setupStreamFixture`, which sits above it in
 * the dependency graph).
 */
function setupFixture() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);

  function Provider({ children }: { children: React.ReactNode }) {
    return (
      <TelemetryProvider client={client} store={store}>
        {children}
      </TelemetryProvider>
    );
  }

  return { transport, client, store, wall, Provider };
}

// A probe that renders the hook's return as inspectable text.
function Probe({ value }: { value: number }) {
  const s = useControlStream("vessel.control.throttle", value, {
    label: "Throttle",
    range: "unit",
  });
  return (
    <div>
      <span data-testid="delay">{String(s.oneWaySeconds)}</span>
      <span data-testid="label">{s.label}</span>
      <span data-testid="echo-count">{s.echo.length}</span>
      <span data-testid="in-transit-count">{s.inTransit.length}</span>
    </div>
  );
}

function mountProbe(value: number) {
  const fixture = setupFixture();
  render(
    <fixture.Provider>
      <Probe value={value} />
    </fixture.Provider>,
  );
  return fixture;
}

describe("useControlStream", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("surfaces the channel label and the one-way delay from comms.delay", async () => {
    const { transport } = mountProbe(0.5);
    expect(screen.getByTestId("label").textContent).toBe("Throttle");

    act(() => {
      transport.emit("comms.delay", { oneWaySeconds: 1.6 });
    });

    await waitFor(() =>
      expect(screen.getByTestId("delay").textContent).toBe("1.6"),
    );
  });

  it("collects the readback topic field as echo samples", async () => {
    // Fake timers active before mount (see the two tests below for why):
    // the echo lands in the ring via the coalescing interval, and the
    // derived strip only re-samples the ring on the next `nowUt` tick, so
    // both the interval AND the wall clock need to keep moving, not just
    // advance once.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { transport, wall } = mountProbe(0.5);
    act(() => {
      transport.emit("comms.delay", { oneWaySeconds: 1 });
      transport.emit("vessel.control", { throttle: 0.42 });
    });
    for (let i = 0; i < 10; i++) {
      wall.advanceBy(0.1);
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }
    expect(
      Number(screen.getByTestId("echo-count").textContent),
    ).toBeGreaterThan(0);
  });

  it("bounds the ring on every coalesced tick even while the channel sits on a direct/no-delay link", async () => {
    // Regression for the bug: the derived-strip memo early-returns before
    // ever calling `trimBySpan` while `oneWaySeconds` is null/low, so a cap
    // that only lived in that branch let `commandRing` grow forever on a
    // direct link. The real fix is `recordSample`, which caps unconditionally
    // on every push (proven directly, no timers needed, in
    // `control-stream-model.test.ts`); this test proves the WIRING: the
    // interval calls it regardless of delay state, by spying on the shared
    // export the interval and the derived-strip path both go through. Fake
    // timers must be active BEFORE mount, so the effect's `setInterval` is
    // registered against the fake clock (registering it first, then faking
    // timers, would leave it running on real time, unaffected by
    // `advanceTimersByTimeAsync`).
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const recordSpy = vi.spyOn(controlStreamModel, "recordSample");
    mountProbe(0.5); // no comms.delay ever emitted -> oneWaySeconds stays null

    // Far more coalesced ticks (100ms cadence) than MAX_SAMPLES (600) would
    // allow if nothing capped them.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700 * 100);
    });

    // The command push happens on every tick regardless of delay: it was
    // called, capping as it went, not skipped because the widget never
    // looked at the result.
    expect(recordSpy.mock.calls.length).toBeGreaterThanOrEqual(700);
  });

  it("keeps sampling the readback on the same coalesced cadence as the command ring, not only on change", async () => {
    // Regression for the bug: the readback effect used to fire only when
    // `echoRaw` CHANGED, so a steady confirmed value produced exactly one
    // echo sample, which ages out of the [2T,3T] confirmed zone the moment
    // more than 3T of simulated time passes with no further change, leaving
    // the confirmed zone (and `hasDeviation`) permanently empty at a held
    // value. Sampling every tick keeps it populated. Fake timers active
    // before mount, same reason as the test above.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { transport, wall } = mountProbe(0.5);
    const oneWaySeconds = 0.1; // span = 0.3s: short, so the test needn't run long

    act(() => {
      transport.emit("comms.delay", { oneWaySeconds });
      transport.emit("vessel.control", { throttle: 0.42 }); // steady: never changes again
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByTestId("delay").textContent).toBe(String(oneWaySeconds));

    // Advance simulated UT well past the 3T (0.3s) span while the
    // coalescing interval keeps ticking, in lockstep (`wall` + the fake
    // clock), so `nowUt` genuinely moves and old samples really do age out.
    for (let i = 0; i < 10; i++) {
      wall.advanceBy(0.05);
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }

    // 0.5s of simulated time has passed (> the 0.3s confirmed-zone span)
    // since the single change-triggered echo would have arrived: a
    // change-only sampler would have let it age out, leaving the confirmed
    // zone empty.
    expect(
      Number(screen.getByTestId("echo-count").textContent),
    ).toBeGreaterThan(0);
  });
});
