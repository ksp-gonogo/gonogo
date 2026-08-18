import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateProcessor,
  clearProcessorRuntime,
  getProcessorValue,
  setActiveTimelineStore,
  setProcessorTopicSubscriber,
  subscribeProcessor,
} from "./processorEvaluator";
import { clearProcessors, defineProcessor } from "./processors";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function makeStore(): TimelineStore {
  return new TimelineStore(
    new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
  );
}

beforeEach(() => {
  clearProcessors();
  clearProcessorRuntime();
});

describe("processorEvaluator", () => {
  it("evaluates a processor's deps in topological order and caches the result for the frame", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    const order: string[] = [];
    const base = defineProcessor({
      id: "base",
      owner: "core",
      deps: [] as const,
      compute: () => {
        order.push("base");
        return 10;
      },
    });
    const derived = defineProcessor({
      id: "derived",
      owner: "core",
      deps: [base] as const,
      compute: (values) => {
        order.push("derived");
        return values[0] + 1;
      },
    });

    const deactivate = activateProcessor(derived.id);
    store.beginFrame();

    expect(order).toEqual(["base", "derived"]);
    expect(getProcessorValue(derived.id)).toBe(11);

    deactivate();
  });

  it("re-evaluates only on a new frame, not on every getProcessorValue call", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    let calls = 0;
    const handle = defineProcessor({
      id: "counter",
      owner: "core",
      deps: [] as const,
      compute: () => {
        calls++;
        return calls;
      },
    });

    const deactivate = activateProcessor(handle.id);
    store.beginFrame();
    getProcessorValue(handle.id);
    getProcessorValue(handle.id);
    expect(calls).toBe(1);

    store.beginFrame();
    getProcessorValue(handle.id);
    expect(calls).toBe(2);

    deactivate();
  });

  it("notifies subscribeProcessor listeners only when the value actually changes", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    const handle = defineProcessor({
      id: "static",
      owner: "core",
      deps: [] as const,
      compute: () => 7,
    });

    const cb = vi.fn();
    const deactivate = activateProcessor(handle.id);
    const unsubscribe = subscribeProcessor(handle.id, cb);

    store.beginFrame();
    store.beginFrame();

    // Same value both frames: notified once (first evaluation), not twice.
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    deactivate();
  });
});

function pointOf<T>(validAt: number, payload: T): TimelinePoint<T> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch: 0,
  };
}

describe("processorEvaluator topic-dep subscription", () => {
  it("subscribes a processor's raw Topic deps on activation, so a topic nothing else reads still streams", () => {
    const store = makeStore();

    // Model the server: a topic's data is delivered only once that topic is
    // SUBSCRIBED (use-stream's contract, and the reason sampling alone is the
    // bug). Nothing else reads `env.pressure` and we deliberately do NOT prime
    // a subscription: activating the processor must be what makes it flow.
    const served = new Map<string, TimelinePoint<number>>([
      ["env.pressure", pointOf(0, 101)],
    ]);
    const subscribed: string[] = [];
    setProcessorTopicSubscriber((topic) => {
      subscribed.push(topic);
      const point = served.get(topic);
      if (point) store.ingest(topic, point);
      return () => {};
    });
    setActiveTimelineStore(store);

    const pressure = defineProcessor({
      id: "pressure",
      owner: "test",
      deps: ["env.pressure"] as const,
      compute: (values) => values[0],
    });

    const deactivate = activateProcessor(pressure.id);
    store.beginFrame();

    expect(subscribed).toContain("env.pressure");
    expect(getProcessorValue(pressure.id)).toBe(101);

    deactivate();
  });

  it("unsubscribes the topic deps when the last activator deactivates", () => {
    const store = makeStore();
    const unsub = vi.fn();
    setProcessorTopicSubscriber(() => unsub);
    setActiveTimelineStore(store);

    const p = defineProcessor({
      id: "p",
      owner: "test",
      deps: ["env.pressure"] as const,
      compute: (values) => values[0],
    });
    const deactivate = activateProcessor(p.id);
    expect(unsub).not.toHaveBeenCalled();

    deactivate();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("back-fills subscriptions when the store/subscriber arrive AFTER activation (the real effect order)", () => {
    const store = makeStore();
    const served = new Map<string, TimelinePoint<number>>([
      ["env.pressure", pointOf(0, 202)],
    ]);

    // Activate FIRST, before any store or subscriber is wired, exactly as a
    // child `useProcessor` effect runs before the parent provider's effects.
    const pressure = defineProcessor({
      id: "pressure",
      owner: "test",
      deps: ["env.pressure"] as const,
      compute: (values) => values[0],
    });
    const deactivate = activateProcessor(pressure.id);

    // Provider wiring lands late.
    setProcessorTopicSubscriber((topic) => {
      const point = served.get(topic);
      if (point) store.ingest(topic, point);
      return () => {};
    });
    setActiveTimelineStore(store);
    store.beginFrame();

    expect(getProcessorValue(pressure.id)).toBe(202);
    deactivate();
  });
});

describe("processorEvaluator store swap", () => {
  it("re-evaluates after a store swap even when the new store's frame generation collides with the cached one", () => {
    const storeA = makeStore();
    setActiveTimelineStore(storeA);
    let source = 1;
    const swap = defineProcessor({
      id: "swap",
      owner: "test",
      deps: [] as const,
      compute: () => source,
    });
    const deactivate = activateProcessor(swap.id);
    storeA.beginFrame();
    expect(getProcessorValue(swap.id)).toBe(1);

    // Swap to a fresh store: its generation restarts and collides with the
    // generation cached on the entry. Change the source so a genuine re-eval
    // yields a new value; a stale skip would wrongly keep 1.
    source = 2;
    const storeB = makeStore();
    setActiveTimelineStore(storeB);
    storeB.beginFrame();
    expect(getProcessorValue(swap.id)).toBe(2);

    deactivate();
  });
});

/**
 * A processor can ask for a Topic's `Reading` rather than its bare payload.
 *
 * A Topic dep resolved to `point.payload`, the value channel alone, so a
 * derivation reasoning across topics could not tell a current input from a
 * carried one and computed on last-contact values during a blackout while its
 * consumers rendered the result as current. `ShipSystems` does that today.
 */
describe("a reading-shaped dep", () => {
  function fakeWall(start = 0) {
    let now = start;
    return {
      now: () => now,
      advanceBy: (s: number) => {
        now += s;
      },
    };
  }

  function predictedStore(wall: { now: () => number }): TimelineStore {
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: () => 0,
    });
    clock.setMode("predicted");
    return new TimelineStore(clock);
  }

  function point(validAt: number, payload: number): TimelinePoint<number> {
    return {
      validAt,
      payload,
      meta: makeMeta({ validAt, deliveredAt: validAt }),
      epoch: 0,
    };
  }

  it("hands over the whole Reading, so a derivation can see how current its input is", () => {
    const wall = fakeWall();
    const store = predictedStore(wall);
    setActiveTimelineStore(store);

    const seen: string[] = [];
    const proc = defineProcessor({
      id: "reads-currency",
      owner: "core",
      deps: [{ reading: "temperature" }] as never,
      compute: ([reading]: readonly [{ state: string }]) => {
        seen.push(reading.state);
        return reading.state;
      },
    });
    const deactivate = activateProcessor(proc.id);

    store.ingest("temperature", point(100, 5));
    store.beginFrame();
    expect(getProcessorValue(proc.id)).toBe("observed");

    // The link drops. A payload-only dep would still hand over 5 and the
    // derivation would go on presenting it as current.
    wall.advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();
    expect(getProcessorValue(proc.id)).toBe("stale");

    expect(seen).toContain("observed");
    expect(seen).toContain("stale");
    deactivate();
  });

  it("subscribes the same wire topic a bare id would", () => {
    // Missing this would add the dep OBJECT as a topic and silently starve the
    // subscription, which is the failure `StubTransport`'s subscribed-only
    // delivery exists to surface.
    const store = makeStore();
    setActiveTimelineStore(store);
    const subscribed: string[] = [];
    setProcessorTopicSubscriber((topic) => {
      subscribed.push(topic);
      return () => {};
    });

    const proc = defineProcessor({
      id: "subscribes-its-reading",
      owner: "core",
      deps: [{ reading: "temperature" }] as never,
      compute: () => 1,
    });
    const deactivate = activateProcessor(proc.id);

    expect(subscribed).toContain("temperature");
    deactivate();
    setProcessorTopicSubscriber(undefined);
  });

  it("is pending rather than undefined with no store wired", () => {
    // A processor must never see a bare `undefined` where a Reading is
    // declared: `pending` is the arm that means "nothing has arrived", and a
    // consumer branching on `state` would crash on undefined.
    setActiveTimelineStore(undefined);
    const proc = defineProcessor({
      id: "no-store",
      owner: "core",
      deps: [{ reading: "temperature" }] as never,
      compute: ([reading]: readonly [{ state: string }]) => reading.state,
    });
    const store = makeStore();
    const deactivate = activateProcessor(proc.id);
    setActiveTimelineStore(store);
    store.beginFrame();
    expect(getProcessorValue(proc.id)).toBe("pending");
    deactivate();
  });
});
