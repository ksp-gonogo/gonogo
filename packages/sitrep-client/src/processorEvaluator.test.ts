import { value } from "@ksp-gonogo/sitrep-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateProcessor,
  clearProcessorRuntime,
  getProcessorValue,
  setActiveTimelineStore,
  setProcessorTopicSubscriber,
  setProcessorUncomparableRecorder,
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

  // The scalar case above passes on `Object.is` alone and so cannot see the
  // defect: every processor anyone has actually written returns a fresh object
  // or array, which is a new identity every frame whether or not a single
  // number inside it moved. These count NOTIFICATIONS across many frames,
  // because a correct value delivered sixty times a second is exactly the bug.
  it("does not notify when an allocating compute returns an equal object across frames", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    const handle = defineProcessor({
      id: "allocating-object",
      owner: "core",
      deps: [] as const,
      compute: () => ({ rows: [{ name: "Oxygen", stored: 12, rate: -0.5 }] }),
    });

    const cb = vi.fn();
    const deactivate = activateProcessor(handle.id);
    const unsubscribe = subscribeProcessor(handle.id, cb);

    for (let i = 0; i < 10; i++) store.beginFrame();

    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    deactivate();
  });

  it("does not notify when an equal result carries wire Values (10 frames, 1 notification)", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    const handle = defineProcessor({
      id: "allocating-values",
      owner: "core",
      deps: [] as const,
      compute: () => ({
        totalVac: value("m/s", 4502),
        stages: [{ stage: 0, burnTime: value("s", 180) }],
      }),
    });

    const cb = vi.fn();
    const deactivate = activateProcessor(handle.id);
    const unsubscribe = subscribeProcessor(handle.id, cb);

    for (let i = 0; i < 10; i++) store.beginFrame();

    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    deactivate();
  });

  it("still notifies when only the MAGNITUDE inside a carried Value moves", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    let magnitude = 4502;
    const handle = defineProcessor({
      id: "moving-value",
      owner: "core",
      deps: [] as const,
      compute: () => ({ totalVac: value("m/s", magnitude++) }),
    });

    const cb = vi.fn();
    const deactivate = activateProcessor(handle.id);
    const unsubscribe = subscribeProcessor(handle.id, cb);

    for (let i = 0; i < 5; i++) store.beginFrame();

    expect(cb).toHaveBeenCalledTimes(5);

    unsubscribe();
    deactivate();
  });

  it("still notifies when only the UNIT of a carried Value changes", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    let flip = false;
    const handle = defineProcessor({
      id: "unit-swap-value",
      owner: "core",
      deps: [] as const,
      compute: () => {
        flip = !flip;
        return { reading: flip ? value("m/s", 1) : value("m", 1) };
      },
    });

    const cb = vi.fn();
    const deactivate = activateProcessor(handle.id);
    const unsubscribe = subscribeProcessor(handle.id, cb);

    for (let i = 0; i < 4; i++) store.beginFrame();

    expect(cb).toHaveBeenCalledTimes(4);

    unsubscribe();
    deactivate();
  });

  it("keeps the previous result's IDENTITY when the new one is equal, so a useSyncExternalStore snapshot is stable", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    const handle = defineProcessor({
      id: "allocating-identity",
      owner: "core",
      deps: [] as const,
      compute: () => ({ crew: ["Jeb", "Bill"] }),
    });

    const deactivate = activateProcessor(handle.id);
    store.beginFrame();
    const first = getProcessorValue(handle.id);
    store.beginFrame();
    store.beginFrame();

    // Not merely equal: the SAME object. React re-reads `getSnapshot` outside
    // of any notification, and a fresh identity there is an infinite render
    // loop even with the listener silenced.
    expect(getProcessorValue(handle.id)).toBe(first);

    deactivate();
  });

  it("still notifies on every frame where the result genuinely moves", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    let tick = 0;
    const handle = defineProcessor({
      id: "moving-object",
      owner: "core",
      deps: [] as const,
      compute: () => ({ rows: [{ name: "Oxygen", stored: tick++ }] }),
    });

    const cb = vi.fn();
    const deactivate = activateProcessor(handle.id);
    const unsubscribe = subscribeProcessor(handle.id, cb);

    for (let i = 0; i < 10; i++) store.beginFrame();

    // The counterweight to the test above: silencing a processor that is
    // actually changing would be a worse bug than the one being fixed.
    expect(cb).toHaveBeenCalledTimes(10);

    unsubscribe();
    deactivate();
  });

  it("re-runs compute on every frame even while nobody is notified", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    let computes = 0;
    const handle = defineProcessor({
      id: "still-computes",
      owner: "core",
      deps: [] as const,
      compute: () => {
        computes++;
        return { steady: true };
      },
    });

    const cb = vi.fn();
    const deactivate = activateProcessor(handle.id);
    const unsubscribe = subscribeProcessor(handle.id, cb);

    for (let i = 0; i < 10; i++) store.beginFrame();

    // Evaluation semantics are untouched: memoised WITHIN a frame, re-run
    // ACROSS frames, because the deps genuinely can move on any of them. Only
    // the fan-out is gated.
    expect(computes).toBe(10);
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    deactivate();
  });

  it("notifies a processor with NO deps whose result is a function of the frame's view time", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    const handle = defineProcessor({
      id: "countdown",
      owner: "core",
      deps: [] as const,
      compute: (_values, frame) => ({ remaining: 1000 - frame.viewUt }),
    });

    const cb = vi.fn();
    const deactivate = activateProcessor(handle.id);
    const unsubscribe = subscribeProcessor(handle.id, cb);

    for (let ut = 1; ut <= 5; ut++) {
      store.clock.scrubTo(ut);
      store.beginFrame();
    }

    // This is the case that rules out `sampleReading`'s input-identity gate:
    // there are no deps at all, so an input comparison would see nothing move
    // and freeze the countdown at its first value forever. Comparing the RESULT
    // needs no declaration of whether `compute` reads `frame.viewUt`.
    expect(cb).toHaveBeenCalledTimes(5);

    unsubscribe();
    deactivate();
  });

  it("does not notify a DEPENDENT processor whose own result is unchanged by a moving upstream", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    let tick = 0;
    const upstream = defineProcessor({
      id: "upstream-moving",
      owner: "core",
      deps: [] as const,
      compute: () => ({ raw: tick++ }),
    });
    const downstream = defineProcessor({
      id: "downstream-clamped",
      owner: "core",
      deps: [upstream] as const,
      compute: ([up]) => ({ bucket: (up as { raw: number }).raw < 100 }),
    });

    const cb = vi.fn();
    const deactivate = activateProcessor(downstream.id);
    const unsubscribe = subscribeProcessor(downstream.id, cb);

    for (let i = 0; i < 10; i++) store.beginFrame();

    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    deactivate();
  });
});

// ---------------------------------------------------------------------------
// The notify guard's answer set.
//
// Every case above asks whether the guard got the right answer. These ask
// whether it was capable of answering at all, which is the question neither of
// the two previous versions could be asked: both shipped permanently unable to
// fire, and both read, from every instrument in the system, as a busy
// dashboard. See `Comparison` in processorEvaluator.ts.
// ---------------------------------------------------------------------------

/**
 * A unit-carrying wrapper in exactly `Value`'s style, and deliberately NOT a
 * `Value`: an `Object.create` over a shared, methods-only prototype, which is
 * the shape any Uplink writing its own quantity type will produce.
 *
 * It exists to be the case a name-based fix fails. The guard's second version
 * was repaired by naming `Value`, so `Value` proves nothing about the third
 * one; this proves the recognition is on the SHAPE. Nested inside an array and
 * an object, because that is where a wrapper actually appears in a result.
 */
const bespokePrototype = {
  toString(this: { amount: number; symbol: string }) {
    return `${this.amount}${this.symbol}`;
  },
  scaled(this: { amount: number; symbol: string }, by: number) {
    return quantity(this.amount * by, this.symbol);
  },
};

function quantity(amount: number, symbol: string): object {
  const q = Object.create(bespokePrototype) as {
    amount: number;
    symbol: string;
  };
  q.amount = amount;
  q.symbol = symbol;
  return q;
}

describe("the notify guard's answer set", () => {
  it("goes quiet over a wrapper it has never heard of: 10 frames, 1 notification", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    const handle = defineProcessor({
      id: "bespoke-wrapper",
      owner: "core",
      deps: [] as const,
      compute: () => ({
        headline: quantity(4502, "m/s"),
        rows: [{ figure: quantity(180, "s") }, { figure: quantity(9, "t") }],
      }),
    });

    const cb = vi.fn();
    const deactivate = activateProcessor(handle.id);
    const unsubscribe = subscribeProcessor(handle.id, cb);

    for (let i = 0; i < 10; i++) store.beginFrame();

    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    deactivate();
  });

  it("still notifies when one field inside that wrapper moves", () => {
    // The counterweight. Silencing a wrapper whose contents genuinely changed
    // is a frozen dashboard, which is worse than the churn being fixed here.
    const store = makeStore();
    setActiveTimelineStore(store);

    let amount = 4502;
    const handle = defineProcessor({
      id: "bespoke-wrapper-moving",
      owner: "core",
      deps: [] as const,
      compute: () => ({ rows: [{ figure: quantity(amount++, "m/s") }] }),
    });

    const cb = vi.fn();
    const deactivate = activateProcessor(handle.id);
    const unsubscribe = subscribeProcessor(handle.id, cb);

    for (let i = 0; i < 5; i++) store.beginFrame();

    expect(cb).toHaveBeenCalledTimes(5);

    unsubscribe();
    deactivate();
  });

  it("reports a result it cannot read, and still delivers it", () => {
    // The planted violation. A `Map` keeps its entries in an internal slot no
    // enumeration reaches, so the guard genuinely cannot answer, and the whole
    // point of the third version is that it says so instead of quietly
    // answering "changed" ten times a second forever.
    const store = makeStore();
    setActiveTimelineStore(store);

    const reported: Array<[string, string]> = [];
    setProcessorUncomparableRecorder((id, shape) => {
      reported.push([id, shape]);
    });

    const handle = defineProcessor({
      id: "uncomparable-map",
      owner: "core",
      deps: [] as const,
      compute: () => ({ byName: new Map([["Oxygen", 12]]) }),
    });

    const cb = vi.fn();
    const deactivate = activateProcessor(handle.id);
    const unsubscribe = subscribeProcessor(handle.id, cb);

    for (let i = 0; i < 10; i++) store.beginFrame();

    // Frame 1 is a real change (there was no previous value), frames 2-10 are
    // the nine the guard could not read.
    expect(reported).toHaveLength(9);
    expect(reported[0]).toEqual(["core:uncomparable-map", "[object Map]"]);
    // Delivered, every time. `uncomparable` behaves exactly like `different`,
    // so nothing is withheld on a shape this does not understand.
    expect(cb).toHaveBeenCalledTimes(10);

    setProcessorUncomparableRecorder(undefined);
    unsubscribe();
    deactivate();
  });

  it("names a closure in the result, which nothing can compare", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    const reported: string[] = [];
    setProcessorUncomparableRecorder((_id, shape) => {
      reported.push(shape);
    });

    const handle = defineProcessor({
      id: "uncomparable-thunk",
      owner: "core",
      deps: [] as const,
      compute: () => ({ label: "Oxygen", render: () => "Oxygen" }),
    });

    const deactivate = activateProcessor(handle.id);
    for (let i = 0; i < 3; i++) store.beginFrame();

    expect(reported).toEqual(["function", "function"]);

    setProcessorUncomparableRecorder(undefined);
    deactivate();
  });

  it("refuses an object whose state is behind a getter, rather than calling two of them equal", () => {
    // The dangerous direction, and the reason the recogniser is built around a
    // property of the prototype rather than around a list of shapes. A getter
    // is state `Object.keys` cannot see, so comparing what it CAN see would
    // answer "equal" for two objects that differ, and a wrongly-silenced
    // processor is a widget stuck on a number that has moved.
    const store = makeStore();
    setActiveTimelineStore(store);

    const reported: string[] = [];
    setProcessorUncomparableRecorder((_id, shape) => {
      reported.push(shape);
    });

    let hidden = 1;
    class Hiding {
      get level(): number {
        return hidden;
      }
    }

    const handle = defineProcessor({
      id: "uncomparable-getter",
      owner: "core",
      deps: [] as const,
      compute: () => ({ tank: new Hiding() }),
    });

    const cb = vi.fn();
    const deactivate = activateProcessor(handle.id);
    const unsubscribe = subscribeProcessor(handle.id, cb);

    store.beginFrame();
    hidden = 2;
    store.beginFrame();
    hidden = 3;
    store.beginFrame();

    expect(reported).toEqual(["Hiding instance", "Hiding instance"]);
    // Three frames, three deliveries: the moved level reaches the consumer.
    expect(cb).toHaveBeenCalledTimes(3);

    setProcessorUncomparableRecorder(undefined);
    unsubscribe();
    deactivate();
  });

  it("says nothing at all about a result it CAN read, so the report is not a constant", () => {
    // The control for the four cases above. A recorder wired to fire on every
    // evaluation would satisfy every one of them and report a permanently
    // broken guard as working, which is the exact instrument failure this arm
    // was added to end.
    const store = makeStore();
    setActiveTimelineStore(store);

    const reported: string[] = [];
    setProcessorUncomparableRecorder((_id, shape) => {
      reported.push(shape);
    });

    let tick = 0;
    const handle = defineProcessor({
      id: "comparable-control",
      owner: "core",
      deps: [] as const,
      compute: () => ({ tick: tick++, headline: quantity(1, "m/s") }),
    });

    const deactivate = activateProcessor(handle.id);
    for (let i = 0; i < 10; i++) store.beginFrame();

    expect(reported).toEqual([]);

    setProcessorUncomparableRecorder(undefined);
    deactivate();
  });

  it("survives clearProcessorRuntime, because a reset that unplugs the report is the failure", () => {
    // `clearProcessorRuntime` resets the evaluation and notification recorders
    // (a leftover counter would corrupt the next test's rate). This one is a
    // defect report rather than a counter, and every fixture in the tree calls
    // that reset, so resetting it too would leave the instrument off in
    // precisely the places that run the most processors.
    const reported: string[] = [];
    setProcessorUncomparableRecorder((_id, shape) => {
      reported.push(shape);
    });

    clearProcessorRuntime();

    const store = makeStore();
    setActiveTimelineStore(store);
    const handle = defineProcessor({
      id: "uncomparable-after-clear",
      owner: "core",
      deps: [] as const,
      compute: () => ({ when: new Date(0) }),
    });
    const deactivate = activateProcessor(handle.id);
    store.beginFrame();
    store.beginFrame();

    expect(reported).toEqual(["[object Date]"]);

    setProcessorUncomparableRecorder(undefined);
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
    // bug). Nothing else in this file reads `comms.signalStrength` and we
    // deliberately do NOT prime a subscription: activating the processor must
    // be what makes it flow.
    const served = new Map<string, TimelinePoint<number>>([
      ["comms.signalStrength", pointOf(0, 101)],
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
      deps: ["comms.signalStrength"] as const,
      compute: (values) => values[0],
    });

    const deactivate = activateProcessor(pressure.id);
    store.beginFrame();

    expect(subscribed).toContain("comms.signalStrength");
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
      deps: ["comms.signalStrength"] as const,
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
      ["comms.signalStrength", pointOf(0, 202)],
    ]);

    // Activate FIRST, before any store or subscriber is wired, exactly as a
    // child `useProcessor` effect runs before the parent provider's effects.
    const pressure = defineProcessor({
      id: "pressure",
      owner: "test",
      deps: ["comms.signalStrength"] as const,
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
