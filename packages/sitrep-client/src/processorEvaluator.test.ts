import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateProcessor,
  clearProcessorRuntime,
  getProcessorValue,
  setActiveTimelineStore,
  subscribeProcessor,
} from "./processorEvaluator";
import { clearProcessors, defineProcessor } from "./processors";
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
