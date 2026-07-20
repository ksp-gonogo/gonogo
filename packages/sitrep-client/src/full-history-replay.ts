import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { TelemetryClient } from "./client";
import type { Clock } from "./clock";
import { DYNAMIC_CARRIED_TOPIC_PREFIXES } from "./default-carried-topics";
import type { ReplayFixture } from "./replay-transport";
import { ReplayTransport } from "./replay-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * Rewrites every frame's `meta.timelineEpoch` to `0` before replay.
 *
 * `StreamRecorder` (`replay-recorder.ts`) has zero epoch awareness — it
 * records raw wire frames straight through an in-game revert/quickload, so a
 * fixture spanning a revert routinely carries more than one distinct
 * `timelineEpoch`. Replayed as-is through the shared `TelemetryClient` →
 * `TimelineStore.ingest` path, the epoch bump on the first post-revert frame
 * triggers the SAME cross-topic "ghost data" sweep the live view relies on
 * (`ClientTimeline.adoptEpoch`, `timeline-store.ts` `ingest`) — every topic's
 * buffer is wiped, and `sampleRange` gates any topic still behind the new
 * epoch to `[]` (`timeline-store.ts` `sampleRange`). That's correct for the
 * live view (hide pre-revert ghosts) and wrong for a whole-mission graph
 * (show everything ever recorded).
 *
 * Normalizing every frame to epoch 0 here — a pre-pass over the fixture,
 * not a change to `ClientTimeline`/`TimelineStore` — means `ingest` never
 * observes a bump, so the sweep and the `sampleRange` gate never fire.
 * Losing the ability to tell pre-/post-revert points apart in the resulting
 * store is fine: a full-history graph wants "everything", not a
 * revert-aware split. Live-view epoch behavior (`TelemetryProvider`,
 * `ReplaySessionController`) is untouched — this only runs inside
 * `buildFullHistoryStore`'s own throwaway `TimelineStore`.
 */
function stripEpochs(fixture: ReplayFixture): ReplayFixture {
  return {
    ...fixture,
    frames: fixture.frames.map((raw) => {
      const message = JSON.parse(raw) as ServerMessage;
      if (message.type === "stream-data" || message.type === "event") {
        message.meta = { ...message.meta, timelineEpoch: 0 };
      }
      return JSON.stringify(message);
    }),
  };
}

/**
 * A `Clock` that never waits. Ignores `atUt` entirely and, instead of arming
 * a real or scaled timer, so anything driven by it — here, `ReplayTransport`'s
 * frame-delivery loop — runs straight through with zero `setTimeout`/RAF
 * involvement. `now()` is backed by a monotonically increasing counter (not
 * wall time) so any caller that compares successive `now()` reads for
 * ordering still sees forward progress, even though no real time elapses.
 *
 * `schedule` does NOT fire `fn` immediately — it queues it. This matters:
 * `ReplayTransport`'s constructor arms (calls `clock.schedule` for) its whole
 * frame list synchronously, before the caller has had a chance to construct
 * a `TelemetryClient` around the transport and register its message
 * listener. If `schedule` fired inline, every frame would be "delivered" to
 * zero listeners and lost before `buildFullHistoryStore` below ever attaches
 * the store. Queueing defers the actual delivery until `drain()` is called
 * once the client/store are wired up, while still requiring no real timers
 * and no fake-timer test setup — just an explicit synchronous flush point.
 *
 * This is the "full-speed" half of `buildFullHistoryStore` below — the
 * `TimelineStore`'s unbounded retention is the other half.
 */
export class InstantClock implements Pick<Clock, "now" | "schedule"> {
  private counter = 0;
  private queue: Array<() => void> = [];

  now(): number {
    return this.counter++;
  }

  schedule(_atUt: number, fn: () => void): () => void {
    let cancelled = false;
    this.queue.push(() => {
      if (!cancelled) fn();
    });
    return () => {
      cancelled = true;
    };
  }

  /**
   * Fires every queued callback, in scheduling order, synchronously. Safe to
   * call once all listeners are attached — `ReplayTransport`'s frames were
   * queued (not yet delivered) at construction time, in ascending
   * `deliveredAt` order, so draining replays them in the same order.
   */
  drain(): void {
    const pending = this.queue;
    this.queue = [];
    for (const fn of pending) fn();
  }
}

/**
 * Replays an entire `ReplayFixture` synchronously into a fresh
 * `TimelineStore` with unbounded retention, then hands the populated store
 * back for `sampleRange` reads over the whole mission.
 *
 * Every production `TimelineStore` construction site (`TelemetryProvider`,
 * `ReplaySessionController.launch`) accepts the `ClientTimeline` default
 * retention of 300 seconds — fine for "keep the last 5 minutes of the live
 * stream", wrong for "graph a whole recorded flight". This helper is the
 * third, offline-range-read-only construction site: `retentionSeconds:
 * Number.POSITIVE_INFINITY` so `ClientTimeline.evictBelow` never throws
 * anything away (`latest.validAt - Infinity` clamps the eviction floor to
 * `-Infinity`, so every point stays `>=` it), fed by an `InstantClock` so the
 * whole fixture drains in one synchronous call instead of racing real or
 * scaled timers.
 *
 * Frames travel through the *exact* production ingest path —
 * `ReplayTransport` → `TelemetryClient.handleMessage` → `store.ingest` — so
 * there is zero divergence from how the live store or `ReplaySessionController`
 * populate data; only the clock and retention window differ.
 */
export function buildFullHistoryStore(fixture: ReplayFixture): TimelineStore {
  const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
  const store = new TimelineStore(clock, {
    timelineOptions: { retentionSeconds: Number.POSITIVE_INFINITY },
    // Match the live store: resolve the injected dynamic namespaces as whole
    // topics so a full-history replay subscribes/samples the same wire strings.
    dynamicWholeTopicPrefixes: DYNAMIC_CARRIED_TOPIC_PREFIXES,
  });

  const instantClock = new InstantClock();
  // ReplayTransport arms its whole delivery schedule at construction time —
  // no separate start()/play() call exists (confirmed against
  // ReplaySessionController.launch, which relies on this same constructor-time
  // arming). With InstantClock, "arming" only queues the frames; nothing is
  // actually delivered until drain() runs below, once the client/store chain
  // is fully wired.
  //
  // stripEpochs runs first so a fixture spanning an in-game revert (multiple
  // distinct timelineEpoch values) doesn't trip the live-view ghost-data
  // sweep on ingest — see stripEpochs' doc comment.
  const transport = new ReplayTransport(stripEpochs(fixture), {
    clock: instantClock,
  });
  const client = new TelemetryClient(transport);
  client.attachStore(store);

  instantClock.drain();

  return store;
}
