/**
 * Centralised kOS compute fanout. The kOS data source owns one of these;
 * widgets subscribe to `kos.compute.<scriptId>.<field>` data keys via the
 * standard `useDataValue` hook and the manager runs each registered script
 * exactly once on the active CPU, fanning the parsed payload out to every
 * subscriber.
 *
 * Lifecycle:
 *   - 0 → 1 subscribers on a topic: open the loop on that topic.
 *   - 1 → 0 subscribers: schedule teardown after `TEARDOWN_GRACE_MS`. Within
 *     the grace window a new subscription cancels the teardown so React
 *     StrictMode remount churn doesn't tear and rebuild the loop inside
 *     the same frame.
 *   - Active CPU change: stop every loop, then restart any topic that
 *     still has subscribers.
 *   - Loop hits N consecutive `KosScriptError`s: trip the breaker, stop
 *     dispatching. Cleared via the `kos.compute.<id>.reEnable` action.
 *
 * See local_docs/centralised_kos_compute.md for the full design.
 */

import type { DataKey } from "@ksp-gonogo/core";
import { PerfBudget } from "@ksp-gonogo/core";
import {
  getKosScript,
  getKosScripts,
  hashKosScript,
  isKosScriptError,
  type KosData,
  type KosManagedScript,
  type KosScriptArg,
  type KosScriptDefinition,
} from "@ksp-gonogo/kos";
import { logger } from "@ksp-gonogo/logger";

/**
 * Soft cap on samples emitted from the centralised fanout. One sample per
 * (topic × field × cycle); a regression that fans out hundreds per cycle
 * (tight loop, runaway re-subscription) trips this. Threshold is generous
 * because a Ship Map alone emits 1 sample/cycle at a 0.5Hz cadence.
 */
const KOS_COMPUTE_SAMPLE_BUDGET = new PerfBudget({
  name: "KosDataSource.compute samples emitted/sec",
  threshold: 500,
  windowMs: 1000,
  unit: "samples",
});

/**
 * Consecutive `KosScriptError`s before the topic loop trips its breaker.
 * Mirrors the per-widget breaker that used to live in `useKosWidget`. Three
 * at the typical interval gives the user a few seconds of obvious failure
 * before we pull the brake.
 */
const BREAKER_THRESHOLD = 3;

/**
 * How long to keep a topic's loop alive after the last subscriber leaves.
 * Bridges the React StrictMode unmount→remount gap so we don't burn an
 * extra dispatch per remount.
 */
const TEARDOWN_GRACE_MS = 5_000;

/** Pattern for `kos.compute.<topicId>.<field>` subscription keys. */
const KEY_RE = /^kos\.compute\.([\w-]+)\.([\w-]+)$/;

/** Pattern for `kos.compute.<topicId>.<action>` action ids. */
const ACTION_RE = /^kos\.compute\.([\w-]+)\.(dispatchNow|reEnable)$/;

/** Convention: each registered script lives at this path on the kOS Archive. */
function defaultScriptPath(id: string): string {
  return `0:/widget_scripts/${id}.ks`;
}

export interface KosTopicStatus {
  /** Most recent successful run (Date.now() ms), or null. */
  lastGoodAt: number | null;
  /** Most recent error from the dispatch (rejection, timeout, kOS error). */
  scriptError: Error | null;
  /** Most recent JSON-parse error on a registered field. */
  parseError: Error | null;
  /** Whether the breaker is currently open; loop is paused. */
  paused: boolean;
  /** Whether a dispatch is currently in flight. */
  running: boolean;
}

interface ComputeTopic {
  def: KosScriptDefinition;
  /** Per-field subscriber callbacks. */
  subs: Map<string, Set<(value: unknown) => void>>;
  /** Last delivered value per field — replayed to late subscribers. */
  lastValue: Map<string, unknown>;
  status: KosTopicStatus;
  consecutiveScriptErrors: number;
  /** Loop control. */
  loopRunning: boolean;
  loopCancelled: boolean;
  /**
   * If set, calling this resolves the current sleep early. Used by
   * dispatchNow / cancellation / activeCpu-changed restart.
   */
  wakeUp: (() => void) | null;
  /** Pending teardown timer; nulled when cancelled or fired. */
  teardownTimer: ReturnType<typeof setTimeout> | null;
  statusListeners: Set<() => void>;
}

export interface KosComputeManagerDeps {
  /** Run a script on a CPU and return parsed `[KOSDATA]` body. */
  executeScript: (
    cpu: string,
    script: string,
    args: KosScriptArg[],
    managed?: KosManagedScript,
  ) => Promise<KosData>;
  /** Live read of the configured CPU. Empty string = none selected. */
  getActiveCpu: () => string;
}

/**
 * Sink for every per-field sample emitted by the compute fanout. Used to
 * record kOS samples into the BufferedDataSource flight history so they
 * replay alongside Telemachus telemetry. Set via
 * `KosComputeManager.setSampleSink` (typically called once at app
 * bootstrap).
 */
export type KosSampleSink = (key: string, value: unknown) => void;

export class KosComputeManager {
  private readonly topics = new Map<string, ComputeTopic>();
  private sampleSink: KosSampleSink | null = null;

  constructor(private readonly deps: KosComputeManagerDeps) {}

  /** Replace the sample sink. Pass `null` to detach. */
  setSampleSink(sink: KosSampleSink | null): void {
    this.sampleSink = sink;
  }

  /** Enumerate `kos.compute.*` keys for every registered script. */
  schema(): DataKey[] {
    return getKosScripts().flatMap((def) =>
      def.fields.map((f) => ({
        key: `kos.compute.${def.id}.${f.name}`,
        description: `${def.name} — ${f.name}`,
      })),
    );
  }

  /**
   * Subscribe to a `kos.compute.<id>.<field>` key. Returns a no-op unsubscribe
   * if the key doesn't match a registered script — callers (the data source)
   * will route non-compute keys elsewhere first.
   */
  subscribe(key: string, cb: (value: unknown) => void): () => void {
    const parsed = parseKey(key);
    if (!parsed) return noop;
    const def = getKosScript(parsed.topicId);
    if (!def) return noop;

    const topic = this.getOrCreateTopic(def);
    let bucket = topic.subs.get(parsed.field);
    if (!bucket) {
      bucket = new Set();
      topic.subs.set(parsed.field, bucket);
    }
    bucket.add(cb);

    if (topic.teardownTimer !== null) {
      clearTimeout(topic.teardownTimer);
      topic.teardownTimer = null;
    }

    // Sticky cache: late subscribers get the most recent value immediately
    // so the UI doesn't have to re-wait a full cycle.
    if (topic.lastValue.has(parsed.field)) {
      const value = topic.lastValue.get(parsed.field);
      // Defer to next tick — matches the standard data-source contract that
      // subscribe() doesn't synchronously call back in the same frame.
      queueMicrotask(() => cb(value));
    }

    if (!topic.loopRunning) {
      void this.runLoop(topic);
    }

    return () => {
      const set = topic.subs.get(parsed.field);
      if (!set) return;
      set.delete(cb);
      if (set.size === 0) topic.subs.delete(parsed.field);
      this.maybeScheduleTeardown(topic);
    };
  }

  /** Routes `kos.compute.*` actions; returns true if it handled the action. */
  async execute(action: string): Promise<boolean> {
    const m = ACTION_RE.exec(action);
    if (!m) return false;
    const topicId = m[1];
    const verb = m[2];
    const def = getKosScript(topicId);
    if (!def) return true; // recognised shape but no script — silently no-op
    const topic = this.getOrCreateTopic(def);
    if (verb === "dispatchNow") {
      // If the loop's asleep, wake it; if it's mid-call, the next iteration
      // picks up immediately after.
      topic.wakeUp?.();
      if (!topic.loopRunning) void this.runLoop(topic);
      return true;
    }
    if (verb === "reEnable") {
      if (!topic.status.paused) return true;
      topic.status.paused = false;
      topic.status.scriptError = null;
      topic.consecutiveScriptErrors = 0;
      this.notifyStatus(topic);
      if (!topic.loopRunning) void this.runLoop(topic);
      return true;
    }
    return true;
  }

  /** Snapshot of the current topic status, for hook initial state. */
  getTopicStatus(topicId: string): KosTopicStatus | null {
    const topic = this.topics.get(topicId);
    if (!topic) return null;
    return { ...topic.status };
  }

  /**
   * Subscribe to topic-state changes (status, errors, paused). Used by the
   * `useKosScriptStatus` hook to render the bits `useDataValue` can't carry.
   * Listeners may fire even before any subscriber attaches — that's fine,
   * they just see the empty initial state.
   */
  onTopicStatusChange(topicId: string, cb: () => void): () => void {
    const def = getKosScript(topicId);
    if (!def) return noop;
    const topic = this.getOrCreateTopic(def);
    topic.statusListeners.add(cb);
    return () => topic.statusListeners.delete(cb);
  }

  /**
   * Called by the data source when the active CPU changes. Cancels every
   * loop; loops with subscribers restart against the new CPU on the next
   * tick.
   */
  onActiveCpuChanged(): void {
    for (const topic of this.topics.values()) {
      // Wake any sleep so the loop sees the cancellation flag and restarts.
      topic.loopCancelled = true;
      topic.wakeUp?.();
    }
  }

  /** Stop everything — used on data source disconnect. */
  dispose(): void {
    for (const topic of this.topics.values()) {
      topic.loopCancelled = true;
      topic.wakeUp?.();
      if (topic.teardownTimer !== null) {
        clearTimeout(topic.teardownTimer);
        topic.teardownTimer = null;
      }
      topic.subs.clear();
      topic.statusListeners.clear();
    }
    this.topics.clear();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private getOrCreateTopic(def: KosScriptDefinition): ComputeTopic {
    let topic = this.topics.get(def.id);
    if (topic) {
      // Pick up def changes (HMR) without dropping subscribers.
      topic.def = def;
      return topic;
    }
    topic = {
      def,
      subs: new Map(),
      lastValue: new Map(),
      status: {
        lastGoodAt: null,
        scriptError: null,
        parseError: null,
        paused: false,
        running: false,
      },
      consecutiveScriptErrors: 0,
      loopRunning: false,
      loopCancelled: false,
      wakeUp: null,
      teardownTimer: null,
      statusListeners: new Set(),
    };
    this.topics.set(def.id, topic);
    return topic;
  }

  private hasAnySubscribers(topic: ComputeTopic): boolean {
    for (const set of topic.subs.values()) {
      if (set.size > 0) return true;
    }
    return false;
  }

  private maybeScheduleTeardown(topic: ComputeTopic): void {
    if (this.hasAnySubscribers(topic)) return;
    if (topic.teardownTimer !== null) return;
    topic.teardownTimer = setTimeout(() => {
      topic.teardownTimer = null;
      if (this.hasAnySubscribers(topic)) return; // re-subscribed during grace
      topic.loopCancelled = true;
      topic.wakeUp?.();
    }, TEARDOWN_GRACE_MS);
  }

  private async runLoop(topic: ComputeTopic): Promise<void> {
    if (topic.loopRunning) return;
    topic.loopRunning = true;
    topic.loopCancelled = false;
    try {
      while (!topic.loopCancelled && !topic.status.paused) {
        if (!this.hasAnySubscribers(topic)) break;
        const cpu = this.deps.getActiveCpu();
        if (!cpu) {
          this.handleError(
            topic,
            new Error(
              "No active kOS CPU. Pick one in the kOS data source config — " +
                "or, in career mode, unlock Probodobodyne Inc and fit a " +
                "kOS-capable probe core to the active vessel.",
            ),
            { isScriptError: false },
          );
          await this.sleep(topic, topic.def.intervalMs);
          continue;
        }
        await this.runOnce(topic, cpu);
        if (topic.loopCancelled || topic.status.paused) break;
        await this.sleep(topic, topic.def.intervalMs);
      }
    } finally {
      topic.loopRunning = false;
      // If we broke out due to cancellation but a new subscriber arrived in
      // the meantime, restart. Avoids a race where teardown fires, the loop
      // exits, then a subscribe lands before the next event-loop tick.
      if (
        !topic.status.paused &&
        this.hasAnySubscribers(topic) &&
        topic.loopCancelled
      ) {
        topic.loopCancelled = false;
        void this.runLoop(topic);
      }
    }
  }

  private async runOnce(topic: ComputeTopic, cpu: string): Promise<void> {
    topic.status.running = true;
    this.notifyStatus(topic);
    try {
      const data = await this.deps.executeScript(
        cpu,
        defaultScriptPath(topic.def.id),
        [],
        { body: topic.def.script, version: hashKosScript(topic.def.script) },
      );
      this.handleData(topic, data);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.handleError(topic, err, { isScriptError: isKosScriptError(err) });
    } finally {
      topic.status.running = false;
      this.notifyStatus(topic);
    }
  }

  private handleData(topic: ComputeTopic, data: KosData): void {
    topic.status.scriptError = null;
    topic.status.parseError = null;
    topic.status.lastGoodAt = Date.now();
    topic.consecutiveScriptErrors = 0;

    for (const field of topic.def.fields) {
      const raw = data[field.name];
      if (raw === undefined) {
        topic.status.parseError = new Error(
          `Script "${topic.def.id}" did not emit field "${field.name}"`,
        );
        continue;
      }
      let value: unknown;
      if (field.type === "json") {
        if (typeof raw !== "string") {
          topic.status.parseError = new Error(
            `Field "${field.name}" expected JSON string, got ${typeof raw}`,
          );
          continue;
        }
        try {
          value = JSON.parse(raw);
        } catch (e) {
          topic.status.parseError =
            e instanceof Error ? e : new Error(String(e));
          logger.tag("kos-compute").warn("JSON parse failed", {
            topic: topic.def.id,
            field: field.name,
            preview: raw.slice(0, 200),
          });
          continue;
        }
      } else {
        value = raw;
      }
      topic.lastValue.set(field.name, value);
      KOS_COMPUTE_SAMPLE_BUDGET.record();
      const subs = topic.subs.get(field.name);
      if (subs) {
        for (const cb of subs) cb(value);
      }
      // External sink (BufferedDataSource capture for replay). Fires for
      // every field emission whether or not anyone is subscribed — captured
      // samples sit in the store and replay later.
      if (this.sampleSink) {
        this.sampleSink(`kos.compute.${topic.def.id}.${field.name}`, value);
      }
    }
  }

  private handleError(
    topic: ComputeTopic,
    err: Error,
    opts: { isScriptError: boolean },
  ): void {
    topic.status.scriptError = err;
    if (opts.isScriptError) {
      topic.consecutiveScriptErrors += 1;
      if (topic.consecutiveScriptErrors >= BREAKER_THRESHOLD) {
        topic.status.paused = true;
      }
    }
  }

  private sleep(topic: ComputeTopic, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        topic.wakeUp = null;
        resolve();
      }, ms);
      topic.wakeUp = () => {
        clearTimeout(timer);
        topic.wakeUp = null;
        resolve();
      };
    });
  }

  private notifyStatus(topic: ComputeTopic): void {
    for (const cb of topic.statusListeners) cb();
  }
}

function parseKey(key: string): { topicId: string; field: string } | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  return { topicId: m[1], field: m[2] };
}

function noop(): void {}
