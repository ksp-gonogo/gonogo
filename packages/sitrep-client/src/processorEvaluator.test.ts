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
