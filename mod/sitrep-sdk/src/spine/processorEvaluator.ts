import {
  type AnyProcessorDefinition,
  type Dep,
  getProcessor,
  type ReadingDep,
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

// Topic-subscription seam (contribution-slots-spec.md §14): a Processor that
// declares raw Topic deps must SUBSCRIBE them, not merely sample them off the
// store. A topic nothing else reads never streams (see use-stream.ts: a topic
// flows only once `client.subscribe` asks the server for it), so sampling an
// unsubscribed dep returns undefined forever. The evaluator cannot reach the
// TelemetryClient (that would cycle sitrep-client -> core), so the provider
// injects `client.subscribe` here, the same seam pattern as
// `setProcessorEvaluationRecorder`. Ref-counted for each active processor's
// lifetime, back-filled on late store/subscriber arrival exactly like the
// frame subscription.
let subscribeInputTopic: (topic: string) => () => void = () => () => {};
let hasTopicSubscriber = false;

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
  // Topic subscriptions resolved against the OLD store's derived-topic graph
  // must be torn down and re-established against the new one.
  teardownAllTopicSubscriptions();
  // A fresh store restarts frame generations from a low number, which can
  // COLLIDE with a `lastFrameGeneration` cached from the previous store and
  // make `evaluate` wrongly skip as "already fresh this frame", serving the old
  // store's stale value. Clear the per-frame freshness marks (NOT the values or
  // refCounts) so every active processor re-evaluates on the new store's frames.
  resetFrameTracking();
  activeStore = store;
  // Back-fill: any processors activated before the store arrived get their
  // frame source connected now.
  ensureFrameSubscription();
  ensureAllTopicSubscriptions();
}

/**
 * Wire the raw-topic subscriber (the provider's `client.subscribe`). Called
 * when the provider mounts or its client changes; pass `undefined` to clear it
 * on unmount. Back-fills every already-active processor, so activation-before-
 * provider (the real child-then-parent effect order) still subscribes.
 */
export function setProcessorTopicSubscriber(
  fn: ((topic: string) => () => void) | undefined,
): void {
  subscribeInputTopic = fn ?? (() => () => {});
  hasTopicSubscriber = fn !== undefined;
  if (hasTopicSubscriber) ensureAllTopicSubscriptions();
  else teardownAllTopicSubscriptions();
}

interface ProcessorRuntimeEntry {
  refCount: number;
  lastFrameGeneration: number | undefined;
  value: unknown;
  listeners: Set<() => void>;
  /** Live `client.subscribe` unsubscribes for this processor's raw Topic deps, while active. */
  topicUnsubs: (() => void)[] | undefined;
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
      topicUnsubs: undefined,
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

/** The transitive raw Topic-id deps of `id` and every Processor it depends on. */
function collectRawTopicDeps(id: string): string[] {
  const topics = new Set<string>();
  for (const procId of topoOrder(id)) {
    const def = getProcessor(procId);
    if (!def) continue;
    for (const dep of def.deps) {
      // A reading dep names the same wire topic a bare id does; only what the
      // processor is HANDED differs. Missing this would add the dep object
      // itself as a topic and silently starve the subscription, which is the
      // failure mode `stub-transport`'s subscribed-only delivery exists to
      // surface.
      if (isReadingDep(dep)) topics.add(dep.reading);
      else if (!isHandle(dep)) topics.add(dep);
    }
  }
  return [...topics];
}

/**
 * Subscribe an active processor's transitive raw Topic deps (resolved to the
 * wire topics the server understands, exactly as use-stream does) so they
 * stream. No-op until BOTH the store (to resolve) and the subscriber (to
 * subscribe) are wired, so the last of the two to arrive back-fills it.
 */
function ensureTopicSubscriptions(id: string): void {
  const entry = entryFor(id);
  if (
    entry.refCount === 0 ||
    entry.topicUnsubs ||
    !activeStore ||
    !hasTopicSubscriber
  ) {
    return;
  }
  const unsubs: (() => void)[] = [];
  for (const depTopic of collectRawTopicDeps(id)) {
    for (const inputTopic of activeStore.resolveSubscriptionTopics(depTopic)) {
      unsubs.push(subscribeInputTopic(inputTopic));
    }
  }
  entry.topicUnsubs = unsubs;
}

function teardownTopicSubscriptions(entry: ProcessorRuntimeEntry): void {
  if (!entry.topicUnsubs) return;
  for (const unsub of entry.topicUnsubs) unsub();
  entry.topicUnsubs = undefined;
}

function ensureAllTopicSubscriptions(): void {
  for (const [id, entry] of runtime) {
    if (entry.refCount > 0) ensureTopicSubscriptions(id);
  }
}

function teardownAllTopicSubscriptions(): void {
  for (const entry of runtime.values()) teardownTopicSubscriptions(entry);
}

/**
 * Clear every entry's per-frame freshness mark, forcing a re-evaluation on the
 * next frame. Deliberately keeps `value` (a swap holds the last-known value
 * until the new store produces one) and `refCount`/`listeners` (the widgets are
 * still mounted). Used on store change to defeat the fresh-store generation
 * collision.
 */
function resetFrameTracking(): void {
  for (const entry of runtime.values()) entry.lastFrameGeneration = undefined;
}

function resolveDep(dep: Dep, token: { generation: number }): unknown {
  if (isHandle(dep)) {
    evaluate(dep.id, token);
    return entryFor(dep.id).value;
  }
  if (isReadingDep(dep)) {
    // The whole `Reading`, so a derivation can tell a current input from a
    // carried one. Without this a processor saw `point.payload` and nothing
    // else, and computed on last-contact values during a blackout while its
    // consumers rendered the result as current.
    if (!activeStore) return { state: "pending" };
    return activeStore.sampleReading(dep.reading, activeStore.currentFrame());
  }
  if (!activeStore) return undefined;
  const point = activeStore.sample(dep, activeStore.currentFrame());
  return point ? point.payload : undefined;
}

function isReadingDep(dep: Dep): dep is ReadingDep {
  return typeof dep === "object" && dep !== null && "reading" in dep;
}

function evaluate(id: string, token: { generation: number }): void {
  const entry = entryFor(id);
  if (entry.lastFrameGeneration === token.generation) return; // already fresh this frame
  const def = getProcessor(id);
  if (!def) return;
  const values = def.deps.map((dep) => resolveDep(dep, token));
  // The frame's own frozen view time, so a processor deriving a remaining
  // duration from an instant on the wire has a clock without reaching for a
  // wall clock. `activeStore` is non-null here: `evaluateAllActive` returns
  // early without one and is the only caller.
  const next = def.compute(values as never, {
    viewUt: activeStore?.currentFrame().viewUt ?? 0,
  });
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
    // Connect the frame source and subscribe this processor's raw Topic deps
    // (both no-ops until the store / subscriber arrive, then back-filled).
    ensureFrameSubscription();
    ensureTopicSubscriptions(id);
  }
  return () => {
    entry.refCount--;
    if (entry.refCount === 0) {
      activeProcessorCount--;
      teardownTopicSubscriptions(entry);
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
  teardownAllTopicSubscriptions();
  runtime.clear();
  activeProcessorCount = 0;
  activeStore = undefined;
  recordEvaluation = () => {};
  subscribeInputTopic = () => () => {};
  hasTopicSubscriber = false;
}
