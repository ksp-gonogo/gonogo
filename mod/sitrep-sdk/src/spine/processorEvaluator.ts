import { hasHost } from "../api/host";
import { logger } from "../api/logger";
import { PerfBudget } from "../perf/PerfBudget";
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

// The fan-out counterpart, and the number a dashboard actually pays: an
// evaluation is one `compute` call however many consumers a processor has, a
// notification is one consumer woken. They are counted SEPARATELY because an
// ungated fan-out makes them indistinguishable, and the evaluation budget then
// cannot see the churn at all: the evaluations are correct and wanted, and only
// their audience is wrong.
let recordNotification: () => void = () => {};

/** Wire the notification-rate PerfBudget recorder (called once per listener told). */
export function setProcessorNotificationRecorder(fn: () => void): void {
  recordNotification = fn;
}

/**
 * The third budget, and the only one that can see the notify guard failing.
 *
 * The other two measure work: evaluations, and the wakeups those evaluations
 * cost. Neither can say whether a wakeup was EARNED, so a guard that has
 * quietly stopped recognising the results it is handed reads off both of them
 * as a busy dashboard and nothing anywhere disagrees. That is not a
 * hypothetical: this guard shipped twice in a state where it could never once
 * fire, and both times it was found by someone reading the code rather than by
 * anything measuring it. See `Comparison`.
 *
 * It is defined HERE rather than core-side through a recorder seam like its two
 * siblings, and the difference matters. Those two predate `PerfBudget` moving
 * into this package, and their core-side home means they are wired in the app's
 * test setup and in NO Uplink's: every Uplink suite calls
 * `PerfBudget.installTestGate()` and would still have run blind to this one,
 * which is exactly the author most likely to write the processor that trips it.
 *
 * The threshold is ZERO, which makes it a gate rather than a soft cap: the test
 * gate fails any test in which a processor returns a result the guard cannot
 * read. That is the intended strictness. A processor result is data (it is
 * rendered, and it crosses PeerJS to a station screen), so a `Map`, a `Date`, a
 * class hiding its state behind methods, or a closure in the payload is a
 * defect in the processor, not a number to raise this to. A test that plants
 * one on purpose resets this budget at the end, the documented pattern for
 * every deliberate breach.
 */
export const PROCESSOR_UNCOMPARABLE_BUDGET = new PerfBudget({
  name: "Processor uncomparable results/sec",
  threshold: 0,
  windowMs: 1000,
  unit: "results",
});

/**
 * One warn per processor per shape. The budget makes it fail in CI; this makes
 * it findable at a glance in a live session, and names the shape so the author
 * has somewhere to start. Not rate-limited by time, because the set of pairs is
 * bounded by the registry and each one is worth saying exactly once.
 */
const REPORTED_UNCOMPARABLE = new Set<string>();

function reportUncomparable(id: string, shape: string): void {
  PROCESSOR_UNCOMPARABLE_BUDGET.record();
  recordUncomparable(id, shape);
  const key = `${id} ${shape}`;
  if (REPORTED_UNCOMPARABLE.has(key)) return;
  REPORTED_UNCOMPARABLE.add(key);
  const message = `[processors] "${id}" returns a result the notify guard cannot compare (${shape}), so every consumer is woken on every frame`;
  // Host-gated for the reason `PerfBudget.record` gives. The logger shim throws
  // when no host is installed, and a diagnostic that takes down the thing it is
  // observing is worse than no diagnostic.
  if (hasHost()) logger.warn(message, { processorId: id, shape });
  else console.warn(message, { processorId: id, shape });
}

// The test seam beside the budget: a case that wants the exact ids and shapes
// (rather than a count) reads them here without going through a rate window.
let recordUncomparable: (id: string, shape: string) => void = () => {};

/**
 * Wire the report for a processor result the notify guard cannot read
 * (`Comparison`'s `uncomparable` arm). Called at most once per evaluation, with
 * the processor's id and a short description of the shape that stopped it, and
 * never with a value. Pass `undefined` to clear it.
 */
export function setProcessorUncomparableRecorder(
  fn: ((id: string, shape: string) => void) | undefined,
): void {
  recordUncomparable = fn ?? (() => {});
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

/**
 * Ceiling on the nodes one comparison may visit. Reaching it is an
 * `uncomparable` answer, not a quiet "different": the result still goes out
 * (that is the safe direction), but an oversized result silently degrading to
 * notify-every-frame is the very failure this guard exists to prevent, so it
 * gets reported rather than absorbed.
 */
const EQUALITY_NODE_BUDGET = 2048;

/**
 * What one comparison can answer. THREE arms rather than two, and that is the
 * whole of the fix.
 *
 * ## Why the two-armed shape kept failing
 *
 * This guard has now been written twice and failed twice, the same way both
 * times, and the fault was never the comparison: it was the answer set.
 *
 * A boolean guard is a RECOGNISER. It enumerates the shapes it knows how to
 * compare, and every shape it does not recognise falls through to `false`.
 * `false` is the safe direction (a value delivered when it need not have been
 * costs a render; a value withheld when it moved is a frozen dashboard), so
 * the fallback is correct. It is also INDISTINGUISHABLE from a real change,
 * which means a guard that recognises nothing at all reports as a perfectly
 * healthy, busy dashboard and nothing anywhere can tell the difference.
 *
 * - The first version gated on `Object.is(entry.value, next)`. Every `compute`
 *   allocates, so it answered `false` for every processor ever written: a
 *   guard that could not fire, at all, that nothing could see was not firing
 * - The second replaced it with a structural walk over an ALLOWLIST of
 *   prototypes (`Object.prototype`, arrays). A `Value` is
 *   `Object.create(sharedPrototype)`, so it was off the allowlist, and any
 *   result carrying so much as one wire quantity answered `false` on every
 *   frame. Units on the wire are the house style, so that was most of them
 *
 * Adding `Value` to the allowlist fixes the shape in front of us and leaves
 * the property that produced both failures exactly where it was, ready for
 * the next shape.
 *
 * ## What this does instead
 *
 * The unrecognised case gets its own arm and is REPORTED (see
 * `setProcessorUncomparableRecorder`, and `PROCESSOR_UNCOMPARABLE_BUDGET`
 * core-side, whose threshold is zero). `uncomparable` behaves like
 * `different` (the value is delivered, nothing is withheld), so the safe
 * direction is the same. What it cannot do is fail quietly: a tenth processor
 * returning a shape this cannot read says so, naming itself and the shape,
 * rather than costing a wakeup per consumer per frame forever.
 */
type Comparison = "equal" | "different" | "uncomparable";

/**
 * Per-prototype verdict on whether own-key enumeration sees the whole of an
 * instance's state. Keyed on the PROTOTYPE, not the instance: it is a fact
 * about the shape, and one lookup per node per frame is the hot path.
 */
const STATELESS_PROTOTYPE = new WeakMap<object, boolean>();

/**
 * True when nothing between `proto` and `Object.prototype` contributes state:
 * every link carries only methods (data properties whose value is a function).
 *
 * This is what handles a `Value` without naming one. `Value` is a plain data
 * object over a shared prototype that holds only methods, precisely so the two
 * own properties are all that serialise (unit-system/value.ts), and that
 * PROPERTY is what makes it comparable by its own keys. Any wrapper an Uplink
 * writes in the same style is comparable for the same reason, with nothing to
 * add here.
 *
 * An accessor anywhere on the chain fails it, because a getter is state that
 * own-key enumeration cannot see, and comparing what it can see would answer
 * "equal" for two objects that differ. That direction is the dangerous one, so
 * it is the one the check is built around.
 */
function hasStatelessPrototypeChain(proto: object | null): boolean {
  if (proto === null || proto === Object.prototype) return true;
  const cached = STATELESS_PROTOTYPE.get(proto);
  if (cached !== undefined) return cached;
  let verdict = true;
  for (const key of Reflect.ownKeys(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (!descriptor || typeof descriptor.value !== "function") {
      verdict = false;
      break;
    }
  }
  if (verdict)
    verdict = hasStatelessPrototypeChain(Object.getPrototypeOf(proto));
  STATELESS_PROTOTYPE.set(proto, verdict);
  return verdict;
}

/**
 * Whether `obj`'s own enumerable keys are the whole of what it carries.
 *
 * A plain object (or a null-prototype one) is taken as read, which keeps the
 * overwhelmingly common case at exactly the cost it had before. Anything else
 * has to earn it:
 *
 * - `[object Object]`, because a `Date`, a `Map`, a `Set`, a `Promise` and a
 *   typed array all keep their state in internal slots that no enumeration
 *   reaches, AND their prototypes carry only methods, so the chain check alone
 *   waves every one of them straight through
 * - a stateless prototype chain, per above
 * - at least one own key. A method-bearing prototype whose instances expose no
 *   data of their own is not data: it is an object whose state is reachable
 *   only by calling it (a closure, a private field), and comparing zero keys
 *   against zero keys would call every such pair equal
 */
function readableByOwnKeys(obj: object): boolean {
  const proto = Object.getPrototypeOf(obj) as object | null;
  if (proto === Object.prototype || proto === null) return true;
  if (Object.prototype.toString.call(obj) !== "[object Object]") return false;
  if (!hasStatelessPrototypeChain(proto)) return false;
  return Object.keys(obj).length > 0;
}

/** What an `uncomparable` verdict was about, for the report. Short, and never a value. */
function describeShape(x: unknown): string {
  if (typeof x === "function") return "function";
  if (typeof x !== "object" || x === null) return typeof x;
  const tag = Object.prototype.toString.call(x);
  if (tag !== "[object Object]") return tag;
  const name = (
    Object.getPrototypeOf(x) as { constructor?: { name?: string } } | null
  )?.constructor?.name;
  return name && name !== "Object" ? `${name} instance` : "object";
}

/** Set by `compareResults` alongside an `uncomparable` verdict; read straight after. */
let lastUncomparableShape: string | undefined;

/**
 * Structural comparison over the shapes a `compute` returns: primitives,
 * arrays, and objects whose own enumerable keys are the whole of them,
 * recursively.
 *
 * The comparison is on the RESULT rather than on the inputs, which is where
 * this parts company with `sampleReading`'s input-identity gate one layer over.
 * Two cases in `processorEvaluator.test.ts` force it: a processor with NO deps
 * whose answer is a function of `frame.viewUt` (a countdown) has no input to
 * compare and would freeze forever, and a processor that clamps or buckets a
 * moving upstream has a moving input and a still answer. Comparing the result
 * needs no declaration of which inputs a `compute` really reads.
 *
 * `different` short-circuits, `uncomparable` does not: a node this cannot read
 * says nothing about whether a sibling moved, so the walk finishes and reports
 * `uncomparable` only if it found no outright difference.
 *
 * The residual it does NOT catch: state held in a non-enumerable or
 * symbol-keyed own property is invisible to `Object.keys` and would compare
 * equal. That was true of the previous walk too, it is not a shape any
 * processor returns, and unlike the failures above it errs towards a stuck
 * value rather than churn, which the notification budget cannot see but a
 * widget stuck on a stale number very obviously can.
 */
function compareResults(previous: unknown, next: unknown): Comparison {
  let budget = EQUALITY_NODE_BUDGET;
  let uncomparable: string | undefined;

  function walk(a: unknown, b: unknown): Comparison {
    // Also the NaN case: `Object.is(NaN, NaN)` is true, and a telemetry
    // derivation that yields NaN twice running has not changed its answer.
    if (Object.is(a, b)) return "equal";
    if (budget-- <= 0) {
      uncomparable ??= "node-budget";
      return "uncomparable";
    }

    // Two functions that are not the same function. Nothing decides this: two
    // closures can behave identically and there is no way to find out. Said
    // out loud, because a result carrying a thunk notifies on every frame and
    // the author is the only one who can do anything about it.
    if (typeof a === "function" && typeof b === "function") {
      uncomparable ??= "function";
      return "uncomparable";
    }
    if (
      typeof a !== "object" ||
      typeof b !== "object" ||
      a === null ||
      b === null
    ) {
      return "different";
    }

    const aIsArray = Array.isArray(a);
    if (aIsArray !== Array.isArray(b)) return "different";
    if (aIsArray) {
      const aItems = a as unknown[];
      const bItems = b as unknown[];
      if (aItems.length !== bItems.length) return "different";
      let sawUncomparable = false;
      for (let i = 0; i < aItems.length; i++) {
        const verdict = walk(aItems[i], bItems[i]);
        if (verdict === "different") return "different";
        if (verdict === "uncomparable") sawUncomparable = true;
      }
      return sawUncomparable ? "uncomparable" : "equal";
    }

    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b))
      return "different";
    if (!readableByOwnKeys(a) || !readableByOwnKeys(b)) {
      uncomparable ??= describeShape(a);
      return "uncomparable";
    }

    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return "different";
    let sawUncomparable = false;
    for (const key of aKeys) {
      if (!Object.hasOwn(b, key)) return "different";
      const verdict = walk(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      );
      if (verdict === "different") return "different";
      if (verdict === "uncomparable") sawUncomparable = true;
    }
    return sawUncomparable ? "uncomparable" : "equal";
  }

  const verdict = walk(previous, next);
  lastUncomparableShape = verdict === "uncomparable" ? uncomparable : undefined;
  return verdict;
}

function evaluate(id: string, token: { generation: number }): void {
  const entry = entryFor(id);
  if (entry.lastFrameGeneration === token.generation) return; // already fresh this frame
  const def = getProcessor(id);
  if (!def) return;
  const values = def.deps.map((dep) => resolveDep(dep, token));
  // The frame's own frozen view time, so a processor deriving a remaining
  // duration from an instant on the wire has a clock without reaching for a
  // wall clock. Here `activeStore` is always non-null: `evaluateAllActive` is
  // the only caller and returns early without one.
  const next = def.compute(values as never, {
    viewUt: activeStore?.currentFrame().viewUt ?? 0,
  });
  recordEvaluation();
  entry.lastFrameGeneration = token.generation;
  // Gated on the RESULT, and on equality rather than identity. Evaluation
  // semantics are untouched (memoised within a frame, re-run across frames);
  // only the fan-out is gated. The previous result's identity is KEPT when the
  // new one is equal, which is the load-bearing half: `useProcessor` hands the
  // value to `useSyncExternalStore`, which re-reads `getSnapshot` outside any
  // notification and compares with `Object.is`, so a silenced listener over a
  // fresh identity is still an infinite render loop.
  const comparison = compareResults(entry.value, next);
  // Reported BEFORE the fan-out, and separately from it. This is the arm where
  // the guard is doing nothing, so it has to be visible as itself rather than
  // as a notification indistinguishable from an earned one.
  if (comparison === "uncomparable") {
    reportUncomparable(id, lastUncomparableShape ?? "unknown");
  }
  if (comparison === "equal") return;
  entry.value = next;
  for (const cb of entry.listeners) {
    recordNotification();
    cb();
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
  recordNotification = () => {};
  // `recordUncomparable` is deliberately NOT reset. The other two count a rate
  // within one test and a leftover counter would corrupt the next one; this one
  // reports a defect, and an instrument a routine reset quietly unplugs is the
  // shape of failure the whole `Comparison` arm exists to stop happening a
  // third time. A test that plants an uncomparable result on purpose resets the
  // BUDGET at the end, which is the documented pattern for a deliberate breach.
  subscribeInputTopic = () => () => {};
  hasTopicSubscriber = false;
}
