import { act, render } from "@ksp-gonogo/test-utils";
import { CommandDelay } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCommand } from "./auto-command";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { createFakeWallClock } from "./fake-wall-clock";
import { StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

// Manual rAF so `useUtNow`'s per-frame recompute only advances when the test
// flushes (same injected-scheduler pattern as context.test.tsx).
function installFakeRaf() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    const handle = nextHandle++;
    pending.set(handle, () => cb(0));
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number): void => {
    pending.delete(handle);
  });
  return {
    flush(): void {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb();
    },
  };
}

function setup() {
  const wall = createFakeWallClock(0);
  const transport = new StubTransport();
  // A handler so the dispatched command's promise resolves; assertions read
  // `transport.sentCommands` (recorded SYNCHRONOUSLY in send()), not the
  // handler (which answers on a later microtask).
  transport.setCommandHandler((c, a) => ({ c, a }));
  const client = new TelemetryClient(transport);
  // The clock's own delaySeconds is irrelevant (utNowEstimate ignores it); the
  // hook reads the one-way delay from the `comms.delay` topic, emitted below.
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  const staged = () =>
    transport.sentCommands.filter((c) => c.command === "stage");
  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider client={client} store={store}>
        {children}
      </TelemetryProvider>
    );
  }
  return { wall, transport, clock, staged, Provider };
}

function Harness(props: {
  targetUt: number;
  enabled?: boolean;
  onSkip?: () => void;
}) {
  const status = useAutoCommand({
    command: "stage",
    args: { n: 1 },
    targetUt: props.targetUt,
    enabled: props.enabled,
    onSkip: props.onSkip,
  });
  // Consume the auto-command's handle: an auto-dispatch is subject to the same
  // must-consume invariant as a click-driven one.
  return <CommandDelay handle={status.command} />;
}

describe("useAutoCommand", () => {
  let raf: ReturnType<typeof installFakeRaf>;
  beforeEach(() => {
    raf = installFakeRaf();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatches once when utNow crosses targetUt - delay, not before", () => {
    // delay 10, target 100 → dispatch at 90.
    const { wall, transport, clock, staged, Provider } = setup();
    render(
      <Provider>
        <Harness targetUt={100} />
      </Provider>,
    );
    // Emit the delay first (a comms.delay sample re-anchors utNowEstimate), THEN
    // anchor utNow at 85 so my anchor wins.
    act(() => {
      transport.emit("comms.delay", { oneWaySeconds: 10 });
      raf.flush();
    });
    act(() => {
      clock.observeSample(85, 85); // utNow = 85 + wall (wall 0)
      raf.flush();
    });
    // 85 < 90: not yet.
    expect(staged()).toHaveLength(0);

    act(() => {
      wall.advanceBy(5); // utNow -> 90
      raf.flush();
    });
    expect(staged()).toHaveLength(1);
    expect(staged()[0].args).toEqual({ n: 1 });

    act(() => {
      wall.advanceBy(5); // utNow -> 95: no second dispatch
      raf.flush();
    });
    expect(staged()).toHaveLength(1);
  });

  it("skips (no dispatch) when the event is already past on arm", () => {
    const onSkip = vi.fn();
    // utNow 110 > target 100: too late to lead-compensate (independent of delay).
    const { clock, staged, Provider } = setup();
    render(
      <Provider>
        <Harness targetUt={100} onSkip={onSkip} />
      </Provider>,
    );
    act(() => {
      clock.observeSample(110, 110);
      raf.flush();
    });
    expect(staged()).toHaveLength(0);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch while disabled, even past the lead point", () => {
    const { wall, transport, clock, staged, Provider } = setup();
    render(
      <Provider>
        <Harness targetUt={100} enabled={false} />
      </Provider>,
    );
    act(() => {
      transport.emit("comms.delay", { oneWaySeconds: 10 });
      raf.flush();
    });
    act(() => {
      clock.observeSample(85, 85);
      wall.advanceBy(20); // utNow -> 105, well past the lead point
      raf.flush();
    });
    expect(staged()).toHaveLength(0);
  });
});
