import { act, render } from "@ksp-gonogo/test-utils";
import { CommandDelay } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCommand } from "./auto-command";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { CENTRE_DELAY_TOPIC, DelayAuthority } from "./delay-authority";
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

const FORWARD = "mun-relay";
const UNROUTED = "minmus-outpost";

function setup() {
  const wall = createFakeWallClock(0);
  const transport = new StubTransport();
  // A handler so the dispatched command's promise resolves; assertions read
  // `transport.sentCommands` (recorded SYNCHRONOUSLY in send()), not the
  // handler (which answers on a later microtask).
  transport.setCommandHandler((c, a) => ({ c, a }));
  const client = new TelemetryClient(transport);
  // Wired the way `TelemetryProvider` wires an auto-built store, so the lead
  // comes from the same delay the view clock is offset by.
  const authority = new DelayAuthority();
  authority.attach(client);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: authority.delaySeconds,
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

  it("dispatches once when utNow crosses targetUt - delay, not before", async () => {
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

    // The dispatch above is still in flight: the stub answers on a later
    // microtask, and without an act scope held open across it the response
    // would update the tree after this body has returned.
    await act(async () => {});
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
  it("leads by the issuing centre's own row, not home's light-time", async () => {
    // Home is 10 s out, the forward centre this session stands at is 2 s out:
    // target 100 dispatches at 98, not 90.
    const { wall, transport, clock, staged, Provider } = setup();
    render(
      <Provider>
        <Harness targetUt={100} />
      </Provider>,
    );
    act(() => {
      transport.emit(
        "comms.delay",
        { oneWaySeconds: 10 },
        { vantage: FORWARD },
      );
      transport.emit(
        CENTRE_DELAY_TOPIC,
        { centres: [{ id: FORWARD, oneWaySeconds: 2 }] },
        { vantage: FORWARD },
      );
      raf.flush();
    });
    act(() => {
      clock.observeSample(95, 95);
      raf.flush();
    });
    expect(staged()).toHaveLength(0);

    act(() => {
      wall.advanceBy(3); // utNow -> 98
      raf.flush();
    });
    expect(staged()).toHaveLength(1);

    await act(async () => {});
  });

  it("an issuing centre with no row leads by the whole-network delay, never zero", async () => {
    // The unrouted centre is left off the list, so its commands ride
    // `comms.delay`: target 100 dispatches at 90, the same as home.
    const { wall, transport, clock, staged, Provider } = setup();
    render(
      <Provider>
        <Harness targetUt={100} />
      </Provider>,
    );
    act(() => {
      transport.emit(
        "comms.delay",
        { oneWaySeconds: 10 },
        { vantage: UNROUTED },
      );
      transport.emit(
        CENTRE_DELAY_TOPIC,
        { centres: [{ id: FORWARD, oneWaySeconds: 2 }] },
        { vantage: UNROUTED },
      );
      raf.flush();
    });
    act(() => {
      clock.observeSample(85, 85);
      raf.flush();
    });
    expect(staged()).toHaveLength(0);

    act(() => {
      wall.advanceBy(5); // utNow -> 90
      raf.flush();
    });
    expect(staged()).toHaveLength(1);

    await act(async () => {});
  });

  it("holds the last lead through a no-path reading rather than dropping to zero", async () => {
    // A null one-way is "no path home", not "the craft is here": the lead the
    // clock runs on stays at 10, so target 100 still dispatches at 90.
    const { wall, transport, clock, staged, Provider } = setup();
    render(
      <Provider>
        <Harness targetUt={100} />
      </Provider>,
    );
    act(() => {
      transport.emit("comms.delay", { oneWaySeconds: 10 });
      transport.emit("comms.delay", { oneWaySeconds: null });
      raf.flush();
    });
    act(() => {
      clock.observeSample(85, 85);
      raf.flush();
    });
    expect(staged()).toHaveLength(0);

    act(() => {
      wall.advanceBy(5); // utNow -> 90
      raf.flush();
    });
    expect(staged()).toHaveLength(1);

    await act(async () => {});
  });
});
