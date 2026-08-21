import {
  activateProcessor,
  defineProcessor,
  setActiveTimelineStore,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
// `subscribeProcessor` is not on sitrep-client's curated barrel; the spine
// subpath it re-exports from is the same module instance either way.
import { subscribeProcessor } from "@ksp-gonogo/sitrep-sdk/spine";
import { describe, expect, it } from "vitest";
import {
  PROCESSOR_EVAL_BUDGET,
  PROCESSOR_NOTIFY_BUDGET,
} from "./processorPerfBudget";

// The budgets are wired to the spine by a module-scope side effect in
// `processorPerfBudget.ts`, and a recorder that is never called reports zero
// while zero reads as healthy. So this asserts the seam is LIVE, not just that
// it compiles: without it, dropping either `setProcessor*Recorder` call would
// leave both numbers flat on the Perf Budgets widget forever and nothing would
// say so.
//
// Deliberately does NOT call `clearProcessorRuntime()`: that resets the
// recorders to no-ops, which is exactly the state under test. Unique processor
// ids keep the cases apart instead.

function makeStore(): TimelineStore {
  return new TimelineStore(
    new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
  );
}

describe("the processor PerfBudgets", () => {
  it("counts one notification PER LISTENER against one evaluation", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    let tick = 0;
    const handle = defineProcessor({
      id: "budget-moving",
      owner: "core",
      deps: [] as const,
      compute: () => ({ n: tick++ }),
    });

    const deactivate = activateProcessor(handle.id);
    const unsubscribeA = subscribeProcessor(handle.id, () => {});
    const unsubscribeB = subscribeProcessor(handle.id, () => {});

    const evalsBefore = PROCESSOR_EVAL_BUDGET.rate();
    const notifiesBefore = PROCESSOR_NOTIFY_BUDGET.rate();
    store.beginFrame();

    // One `compute` call, two consumers woken. That ratio is the whole reason
    // the notification budget exists: the evaluation count alone cannot say
    // what a dashboard pays, because it does not know how many widgets are
    // listening.
    expect(PROCESSOR_EVAL_BUDGET.rate() - evalsBefore).toBe(1);
    expect(PROCESSOR_NOTIFY_BUDGET.rate() - notifiesBefore).toBe(2);

    unsubscribeA();
    unsubscribeB();
    deactivate();
  });

  it("keeps evaluating but stops notifying over an unmoving wire", () => {
    const store = makeStore();
    setActiveTimelineStore(store);

    const handle = defineProcessor({
      id: "budget-still",
      owner: "core",
      deps: [] as const,
      compute: () => ({ steady: true }),
    });

    const deactivate = activateProcessor(handle.id);
    const unsubscribe = subscribeProcessor(handle.id, () => {});

    store.beginFrame(); // the one real derivation
    const evalsBefore = PROCESSOR_EVAL_BUDGET.rate();
    const notifiesBefore = PROCESSOR_NOTIFY_BUDGET.rate();

    for (let i = 0; i < 10; i++) store.beginFrame();

    // The two numbers coming apart IS the fix, stated in the instrument the
    // dashboard reads: ten more evaluations, no more wakeups.
    expect(PROCESSOR_EVAL_BUDGET.rate() - evalsBefore).toBe(10);
    expect(PROCESSOR_NOTIFY_BUDGET.rate() - notifiesBefore).toBe(0);

    unsubscribe();
    deactivate();
  });
});
