import { CommsDelaySource } from "@gonogo/sitrep-sdk";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./client";
import {
  TelemetryProvider,
  useTelemetryStore,
  useViewClock,
  useViewClockOptional,
  type ViewClockView,
} from "./context";
import { COMMS_DELAY_TOPIC } from "./delay-authority";
import { StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * A fully manual, injected `requestAnimationFrame`/`cancelAnimationFrame`
 * pair — queued callbacks only ever run when the test calls `flush()`
 * itself. Deliberately NOT real rAF (unavailable synchronously anyway) and
 * NOT jsdom's own rAF polyfill (a real `setTimeout(~16ms)` under the hood,
 * which would make "did it coalesce" a real-timing race). This is the
 * "fake/injected scheduler" the coalescing tests below are built on, so
 * "did `beginFrame` fire" is asserted deterministically, never by racing a
 * clock.
 */
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
    /** Run every callback currently queued (a snapshot — callbacks queued DURING flush are not re-flushed). */
    flush(): void {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb();
    },
    pendingCount(): number {
      return pending.size;
    },
  };
}

/**
 * M2 finalization Fix 1: `TelemetryProvider` must coalesce `beginFrame()` to
 * animation-frame cadence, not call it once per `stream-data` message — a
 * burst of N messages arriving in the same tick must only mint ONE
 * `FrameToken`, matching `beginFrame`'s own doc ("call once per animation
 * frame / read cycle... never once per read"). Before the fix, `context.tsx`
 * called `store.beginFrame()` synchronously from `client.subscribeStore`'s
 * callback, so a burst of 5 ingests produced 5 `beginFrame()` calls — 5 Kepler
 * solves under `deriveVesselState` for what should have been a single frame.
 */
describe("TelemetryProvider coalesces beginFrame() to (at most) once per animation-frame tick", () => {
  let raf: ReturnType<typeof installFakeRaf>;

  beforeEach(() => {
    raf = installFakeRaf();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a synchronous burst of 5 stream-data messages mints only 1 FrameToken, after the frame tick", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const store = new TimelineStore(new ViewClock());
    const beginFrameSpy = vi.spyOn(store, "beginFrame");

    render(
      <TelemetryProvider client={client} store={store}>
        <div />
      </TelemetryProvider>,
    );

    // Establish a wire subscription so StubTransport.emit actually delivers.
    const unsubscribe = client.subscribe("v.raw", () => {});
    beginFrameSpy.mockClear();

    act(() => {
      for (let i = 0; i < 5; i++) {
        transport.emit("v.raw", i);
      }
    });

    // Not yet — the frame tick hasn't run. If this were failing (RED, the
    // pre-fix behavior), beginFrameSpy would already read 5 here.
    expect(beginFrameSpy).toHaveBeenCalledTimes(0);
    // And only ONE frame got scheduled for the whole 5-message burst — not 5.
    expect(raf.pendingCount()).toBe(1);

    act(() => raf.flush());

    expect(beginFrameSpy).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("cancels a pending scheduled beginFrame on unmount", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const store = new TimelineStore(new ViewClock());
    const beginFrameSpy = vi.spyOn(store, "beginFrame");

    const { unmount } = render(
      <TelemetryProvider client={client} store={store}>
        <div />
      </TelemetryProvider>,
    );

    const unsubscribe = client.subscribe("v.raw", () => {});
    beginFrameSpy.mockClear();

    act(() => {
      transport.emit("v.raw", 1);
    });
    expect(raf.pendingCount()).toBe(1);

    unmount();
    unsubscribe();

    // Unmount cancelled the scheduled frame — nothing left to flush, and
    // flushing whatever's left must not call beginFrame() on the now-gone
    // provider's store.
    expect(raf.pendingCount()).toBe(0);
    raf.flush();
    expect(beginFrameSpy).not.toHaveBeenCalled();
  });
});

/**
 * M2 finalization Fix 2: an auto-built store (no `store` prop supplied) must
 * rebuild — and re-`attachStore`/detach — when the `client` prop's identity
 * changes. Before the fix, the provider's `useMemo` omitted `client` from its
 * dependency array, so an auto-built store survived a client swap (e.g. a
 * reconnect that hands the provider a fresh `TelemetryClient`), continuing to
 * serve topics from the OLD client forever and never picking up the new one.
 */
describe("TelemetryProvider rebuilds its auto-built store when `client` changes", () => {
  it("builds a new store attached to the new client, and detaches the old client from the old store", () => {
    const transportA = new StubTransport();
    const clientA = new TelemetryClient(transportA);
    const transportB = new StubTransport();
    const clientB = new TelemetryClient(transportB);

    const seenStores: TimelineStore[] = [];
    function StoreProbe() {
      seenStores.push(useTelemetryStore());
      return null;
    }

    function Harness({ client }: { client: TelemetryClient }) {
      return (
        <TelemetryProvider client={client}>
          <StoreProbe />
        </TelemetryProvider>
      );
    }

    const { rerender } = render(<Harness client={clientA} />);
    const storeA = seenStores.at(-1) as TimelineStore;

    const unsubA = clientA.subscribe("v.raw", () => {});
    act(() => transportA.emit("v.raw", 111));
    // Fresh FrameToken before every read below — `sample()` memoizes per
    // (token, topic) for that token's whole lifetime (frame coherence), so
    // reusing a token across ingests would mask a real detach bug behind a
    // stale cached read rather than genuinely proving attach/detach.
    storeA.beginFrame();
    expect(storeA.sample<number>("v.raw")?.payload).toBe(111);

    rerender(<Harness client={clientB} />);
    const storeB = seenStores.at(-1) as TimelineStore;

    // A genuinely new store was built for the new client — not the same
    // instance surviving the swap (the RED behavior).
    expect(storeB).not.toBe(storeA);

    // Old client is detached from the old store: further data on clientA's
    // transport must not reach storeA anymore.
    act(() => transportA.emit("v.raw", 222));
    storeA.beginFrame();
    expect(storeA.sample<number>("v.raw")?.payload).toBe(111);

    // New client is attached to the new store.
    const unsubB = clientB.subscribe("v.raw", () => {});
    act(() => transportB.emit("v.raw", 333));
    storeB.beginFrame();
    expect(storeB.sample<number>("v.raw")?.payload).toBe(333);

    unsubA();
    unsubB();
  });
});

describe("useViewClock exposes the provider's ONE shared ViewClock (single delay authority)", () => {
  it("returns the same clock instance the auto-built store holds", () => {
    const client = new TelemetryClient(new StubTransport());

    let seenClock: ViewClockView | undefined;
    let seenStore: TimelineStore | undefined;
    function Probe() {
      seenStore = useTelemetryStore();
      seenClock = useViewClock();
      return null;
    }

    render(
      <TelemetryProvider client={client}>
        <Probe />
      </TelemetryProvider>,
    );

    expect(seenClock).toBeInstanceOf(ViewClock);
    // The hook must hand back the SAME instance the store reads from — not a
    // second clock. This is the whole single-delay-authority contract.
    expect(seenClock).toBe(seenStore?.clock);
  });

  it("hands back one clock shared by two sibling consumers (media + telemetry read the same instance)", () => {
    const client = new TelemetryClient(new StubTransport());

    const seen: ViewClockView[] = [];
    function Probe() {
      seen.push(useViewClock());
      return null;
    }

    render(
      <TelemetryProvider client={client}>
        <Probe />
        <Probe />
      </TelemetryProvider>,
    );

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it("the shared clock satisfies the media DelayClockLike surface (confirmedEdgeUt + onFrame)", () => {
    const client = new TelemetryClient(new StubTransport());

    let clock: ViewClockView | undefined;
    function Probe() {
      clock = useViewClock();
      return null;
    }
    render(
      <TelemetryProvider client={client}>
        <Probe />
      </TelemetryProvider>,
    );

    // Structural check: the exact two members DelayedPlayoutBuffer depends on.
    expect(typeof clock?.confirmedEdgeUt).toBe("function");
    expect(typeof clock?.onFrame).toBe("function");
    const off = clock?.onFrame(() => {});
    expect(typeof off).toBe("function");
    off?.();
  });

  it("useViewClock throws outside a provider; useViewClockOptional returns undefined", () => {
    // Silence React's error-boundary console noise for the throwing render.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function ThrowProbe() {
      useViewClock();
      return null;
    }
    expect(() => render(<ThrowProbe />)).toThrow(
      /useTelemetryStore must be used within a TelemetryProvider/,
    );
    spy.mockRestore();

    let optional: ViewClockView | undefined = {} as ViewClockView;
    function OptionalProbe() {
      optional = useViewClockOptional();
      return null;
    }
    render(<OptionalProbe />);
    expect(optional).toBeUndefined();
  });
});

describe("TelemetryProvider wires comms.delay into the auto-built ViewClock (spec §7.3 Step 4)", () => {
  it("subscribes comms.delay and the delay value drives the clock's delaySeconds", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    let store: TimelineStore | undefined;
    function Capture() {
      store = useTelemetryStore();
      return null;
    }

    render(
      <TelemetryProvider client={client}>
        <Capture />
      </TelemetryProvider>,
    );

    // The auto-built store's DelayAuthority attached on mount → the transport
    // saw a subscribe for comms.delay (the single wiring point).
    expect(transport.isSubscribed(COMMS_DELAY_TOPIC)).toBe(true);
    expect(store?.clock.delaySeconds()).toBe(0); // no value yet

    act(() => {
      transport.emit(COMMS_DELAY_TOPIC, {
        oneWaySeconds: 4.2,
        source: CommsDelaySource.SignalDelay,
      });
    });
    expect(store?.clock.delaySeconds()).toBe(4.2);

    act(() => {
      transport.emit(COMMS_DELAY_TOPIC, {
        oneWaySeconds: 0,
        source: CommsDelaySource.None,
      });
    });
    expect(store?.clock.delaySeconds()).toBe(0);

    client.dispose();
  });

  it("a caller-supplied viewClockOptions.delaySeconds wins over the authority (advanced override)", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    let store: TimelineStore | undefined;
    function Capture() {
      store = useTelemetryStore();
      return null;
    }

    render(
      <TelemetryProvider
        client={client}
        viewClockOptions={{ delaySeconds: () => 30 }}
      >
        <Capture />
      </TelemetryProvider>,
    );

    // Explicit delay wins; a comms.delay arrival must not override it.
    expect(store?.clock.delaySeconds()).toBe(30);
    act(() => {
      transport.emit(COMMS_DELAY_TOPIC, {
        oneWaySeconds: 4.2,
        source: CommsDelaySource.SignalDelay,
      });
    });
    expect(store?.clock.delaySeconds()).toBe(30);

    client.dispose();
  });
});
