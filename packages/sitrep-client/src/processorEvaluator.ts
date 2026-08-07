import {
  type AnyProcessorDefinition,
  type Dep,
  getProcessor,
} from "./processors";
import type { TimelineStore } from "./timeline-store";

// ---------------------------------------------------------------------------
// Hand-rolled, frame-batched Processor evaluator (contribution-slots-spec.md
// 14): deps are DECLARED (static), not auto-tracked, so the dependency graph
// is knowable at registration time. Deliberately not a signals library: those
// solve dynamic fine-grained tracking (a harder problem this does not have)
// and push on every write, which fights the frame model. A Sitrep frame
// (TimelineStore.beginFrame/subscribeFrame) is the natural batch boundary, so
// evaluation happens once per frame, lazily, only for ACTIVATED processors
// (ref-counted by useProcessor or a direct contribution call), never eagerly
// for the whole registry.
// ---------------------------------------------------------------------------

// Perf-budget seam, the same pattern WebSocketTransport.onStreamFrame uses: a
// core-side PerfBudget cannot be imported here (sitrep-client -> core would
// cycle with core -> sitrep-client), so the real PerfBudget lives in the app /
// core layer and records through this injected recorder. The core-side
// registerProcessor adapter (Task 3.4) wires it to an actual PerfBudget;
// default is a no-op so the spine stays standalone and testable.
let recordEvaluation: () => void = () => {};

/** Wire the evaluation-rate PerfBudget recorder (called once per compute run). */
export function setProcessorEvaluationRecorder(fn: () => void): void {
  recordEvaluation = fn;
}

let activeStore: TimelineStore | undefined;

// One shared frame subscription for the whole evaluator (evaluateAllActive
// walks every active processor per frame), plus a count of currently-active
// processors. A single subscription rather than one per processor is both
// cheaper and, crucially, back-fillable: `useProcessor`'s activation (a CHILD
// effect) runs BEFORE `TelemetryProvider`'s `setActiveTimelineStore` (a PARENT
// effect), so at activation time `activeStore` is often still undefined. The
// subscription is (re)wired by `ensureFrameSubscription`, which BOTH activation
// and store-arrival call, so whichever happens last connects the frame source.
let frameUnsubscribe: (() => void) | undefined;
let activeProcessorCount = 0;

function ensureFrameSubscription(): void {
  if (activeProcessorCount > 0 && activeStore && !frameUnsubscribe) {
    frameUnsubscribe = activeStore.subscribeFrame(evaluateAllActive);
  }
}

function teardownFrameSubscription(): void {
  frameUnsubscribe?.();
  frameUnsubscribe = undefined;
}

/** Test/app-wiring seam: the ONE TimelineStore the evaluator reads frames from. */
export function setActiveTimelineStore(store: TimelineStore | undefined): void {
  if (store === activeStore) return;
  teardownFrameSubscription();
  activeStore = store;
  // Back-fill: any processors activated before the store arrived get their
  // frame source connected now.
  ensureFrameSubscription();
}

interface ProcessorRuntimeEntry {
  refCount: number;
  lastFrameGeneration: number | undefined;
  value: unknown;
  listeners: Set<() => void>;
}

const runtime = new Map<string, ProcessorRuntimeEntry>();

function entryFor(id: string): ProcessorRuntimeEntry {
  let entry = runtime.get(id);
  if (!entry) {
    entry = {
      refCount: 0,
      lastFrameGeneration: undefined,
      value: undefined,
      listeners: new Set(),
    };
    runtime.set(id, entry);
  }
  return entry;
}

/** True for a ProcessorHandle dep (has an `id`), false for a raw TopicId string. */
function isHandle(dep: Dep): dep is { id: string } {
  return typeof dep === "object" && dep !== null && "id" in dep;
}

/** DFS collects `id` + every transitive Processor dep, id-deduped, deps-before-dependents. */
function topoOrder(
  id: string,
  seen = new Set<string>(),
  out: string[] = [],
): string[] {
  if (seen.has(id)) return out;
  seen.add(id);
  const def: AnyProcessorDefinition | undefined = getProcessor(id);
  if (!def) return out;
  for (const dep of def.deps) {
    if (isHandle(dep)) topoOrder(dep.id, seen, out);
  }
  out.push(id);
  return out;
}

function resolveDep(dep: Dep, token: { generation: number }): unknown {
  if (isHandle(dep)) {
    evaluate(dep.id, token);
    return entryFor(dep.id).value;
  }
  if (!activeStore) return undefined;
  const point = activeStore.sample(dep, activeStore.currentFrame());
  return point ? point.payload : undefined;
}

function evaluate(id: string, token: { generation: number }): void {
  const entry = entryFor(id);
  if (entry.lastFrameGeneration === token.generation) return; // already fresh this frame
  const def = getProcessor(id);
  if (!def) return;
  const values = def.deps.map((dep) => resolveDep(dep, token));
  const next = def.compute(values as never);
  recordEvaluation();
  entry.lastFrameGeneration = token.generation;
  if (!Object.is(entry.value, next)) {
    entry.value = next;
    for (const cb of entry.listeners) cb();
  }
}

function evaluateAllActive(): void {
  if (!activeStore) return;
  const token = activeStore.currentFrame();
  for (const [id, entry] of runtime) {
    if (entry.refCount > 0) {
      for (const depId of topoOrder(id)) evaluate(depId, token);
    }
  }
}

/**
 * Activate a processor for the life of the caller: subscribes it (and every
 * transitive Processor dep, via evaluateAllActive's topo walk) to the frame
 * boundary, lazily, on first activation. Ref-counted so N activators share one
 * evaluation. Returns the deactivate function.
 */
export function activateProcessor(id: string): () => void {
  const entry = entryFor(id);
  entry.refCount++;
  if (entry.refCount === 1) {
    activeProcessorCount++;
    // Connect the frame source (a no-op if the store hasn't arrived yet, in
    // which case setActiveTimelineStore back-fills it).
    ensureFrameSubscription();
  }
  return () => {
    entry.refCount--;
    if (entry.refCount === 0) {
      activeProcessorCount--;
      if (activeProcessorCount === 0) teardownFrameSubscription();
    }
  };
}

export function getProcessorValue<R>(id: string): R | undefined {
  return entryFor(id).value as R | undefined;
}

/**
 * Evaluate every active processor for the current frame, now, on demand. The
 * same work the shared frame subscription does, exposed so a consumer whose own
 * `subscribeFrame` listener can fire BEFORE the evaluator's (a child's frame
 * subscription registers before the parent provider wires the store, so the
 * evaluator connects second) can force freshness before it reads. Idempotent
 * within a frame: `evaluate` skips any processor already fresh for the token, so
 * a redundant call after the shared subscription already ran is a no-op.
 */
export function evaluateActiveProcessors(): void {
  evaluateAllActive();
}

export function subscribeProcessor(id: string, cb: () => void): () => void {
  const entry = entryFor(id);
  entry.listeners.add(cb);
  return () => {
    entry.listeners.delete(cb);
  };
}

/** Test-only: tear down the frame subscription and reset the runtime. */
export function clearProcessorRuntime(): void {
  teardownFrameSubscription();
  runtime.clear();
  activeProcessorCount = 0;
  activeStore = undefined;
  recordEvaluation = () => {};
}
