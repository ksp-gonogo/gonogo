import type { Meta } from "@gonogo/sitrep-sdk";
import { Quality, Staleness } from "@gonogo/sitrep-sdk";
import {
  HeartbeatTracker,
  type HeartbeatTrackerOptions,
} from "./heartbeat-tracker";
import type { StreamStatusValue } from "./stream-status";
import { worstStatus } from "./stream-status";
import {
  ClientTimeline,
  type ClientTimelineOptions,
  type TimelinePoint,
} from "./timeline";
import type { ViewClock } from "./view-clock";

/**
 * The frozen view-time token for one frame / read cycle (M2 design §1.2,
 * §7.4's "single-view-time invariant"). There is deliberately no method
 * anywhere in this file that reads "the current time" and hands back a
 * fresh UT per call — every read goes through a `FrameToken`, and a token's
 * `viewUt` never changes after it's minted. That's what makes the
 * invariant structural rather than a convention callers have to remember.
 */
export interface FrameToken {
  readonly viewUt: number;
  /**
   * Internal validity marker, bumped by every `beginFrame()` call. Not
   * meant to be read by callers — it's what lets `sample()` detect a token
   * a caller cached across a frame boundary (M2 fix-report "FrameToken
   * never invalidated") and fall back to the current frame instead of
   * honoring a frozen-in-the-past `viewUt` forever.
   */
  readonly generation: number;
}

export interface TimelineStoreOptions {
  timelineOptions?: ClientTimelineOptions;
  /** Options for the store's `HeartbeatTracker` (M2 design §4.3's keyframe-cadence heartbeat, T4) — per-topic keyframe intervals, staleness-margin tuning. */
  heartbeatOptions?: HeartbeatTrackerOptions;
}

/**
 * What a `derive()` function reads inputs through (M2 design §2.1/§7.4's
 * "single-view-time invariant"). Deliberately NOT `(topic) => value` — it
 * returns the whole `TimelinePoint` (so `derive` can read `meta.quality`/
 * `meta.source` for quality-picking and subject-provenance, per
 * `vessel-state.ts`'s `deriveVesselState`), and it is always bound to one
 * frame's frozen `viewUt` by `TimelineStore.sample`/`sampleDerived` — there
 * is no overload that takes a UT, and no way to ask for "latest" from inside
 * a derivation. That is what makes the invariant structural rather than a
 * convention derive authors have to remember: `get` physically cannot read
 * any UT but the one this derive call was invoked for. `get` also resolves
 * derived-on-derived inputs transparently (it's just another `sample()`
 * call), so a derived channel can list another derived channel as an input.
 */
export type DerivedGet = <T = unknown>(
  topic: string,
) => TimelinePoint<T> | undefined;

export interface DerivedChannelDefinition<T> {
  /** The topic this channel registers as, e.g. `"vessel.state"`. */
  topic: string;
  /**
   * Declarative list of input topics this channel reads. Not currently used
   * to drive subscription ref-counting (that requires wiring `TimelineStore`
   * to `TelemetryClient`'s subscribe machinery, per M2 design §2.1 — a later
   * task) — recorded here as the channel's own documentation of its
   * dependencies, and reserved for that wiring.
   */
  inputs: string[];
  /**
   * Pure function: same `(get, viewUt)` inputs must produce the same output,
   * always (the replay/scrub contract, M2 design §7.3). Two distinct
   * "nothing" results, per §2.1/§2.4 — never conflate them:
   * - Return `undefined` when an input has no point at-or-before `viewUt`
   *   yet in the current epoch — "not whole yet" (cold start, or
   *   resynchronizing after an epoch reset until the first post-reset
   *   keyframe lands per input, §3.4). `sample()`/`sampleDerived` propagate
   *   this as "no point at all", never a fabricated tombstone.
   * - Return `null` for a confirmed absence (a tombstoned input, or the
   *   channel's own subject genuinely gone) — never a fabricated
   *   zero-valued record.
   */
  derive: (get: DerivedGet, viewUt: number) => T | null | undefined;
  /**
   * Expose `"<topic>.<field>"` subtopics that read a single field off the
   * one memoized record (M2 design §2.4) — e.g. `vessel.state.altitudeAsl`.
   * Field names are resolved dynamically off whatever `derive` returns, so
   * no static field list is needed here.
   */
  fields?: boolean;
  /**
   * Optional override for this channel's own `StreamStatusValue` (M2 design
   * §4.4: "derived channels propagate the worst input staleness into their
   * own status", T4). `getStatus(topic)` resolves an input topic's own
   * status — recursively, through the same `sampleStatus` machinery, for a
   * derived-on-derived input. `get`/`viewUt` are the SAME arguments
   * `derive` receives, for channels (like `vessel.state`) whose
   * quality-picking means not every declared `input` is actually consulted
   * for a given record — only override this when the default would be
   * wrong (e.g. penalizing a channel for an input it never even read).
   *
   * When omitted, the default is `worstStatus(inputs.map(getStatus))` — the
   * worst status across every declared input, unconditionally.
   */
  deriveStatus?: (
    getStatus: (topic: string) => StreamStatusValue,
    get: DerivedGet,
    viewUt: number,
  ) => StreamStatusValue;
}

/** Synthetic envelope `Meta` stamped on a derived-channel read. Real staleness/quality propagation from inputs (M2 design §4.4: "derived channels propagate the worst input staleness") is deferred to a later task — this is intentionally minimal, just enough to satisfy the `Meta` shape every `TimelinePoint` carries. */
function derivedMeta(viewUt: number, epoch: number): Meta {
  return {
    source: "derived",
    validAt: viewUt,
    seq: 0,
    deliveredAt: viewUt,
    vantage: "derived",
    quality: Quality.OnRails,
    active: true,
    staleness: Staleness.Fresh,
    timelineEpoch: epoch,
  };
}

/**
 * Ties per-topic `ClientTimeline`s to the one shared `ViewClock` and mints
 * the frozen `FrameToken` every read goes through.
 *
 * Two consumption tiers per the design (§2.2):
 * - **Reactive**: `subscribeFrame` + `sample` back a `useSyncExternalStore`
 *   hook (`useTimelineStream`) that reads at whatever `FrameToken`
 *   `currentFrame()` currently holds — it does NOT mint its own token per
 *   render, so two components rendering in the same frame see the same
 *   `viewUt` even if wall time ticks between their renders.
 * - **Imperative**: `sample(topic, token)` for a caller's own rAF loop
 *   (canvas widgets) — pass the token from `currentFrame()` (or one you
 *   minted yourself with `beginFrame()`) explicitly.
 *
 * This is the foundation derived channels (T3) build on, and that staleness
 * consumption (T4) and confirmed-vs-predicted (T5) will build on next.
 * Derived-channel registration (`registerDerivedChannel`) is implemented
 * here — see `sample`/`sampleDerived` for how a derived topic is resolved
 * and memoized through the exact same per-frame cache raw topics use.
 */
export class TimelineStore {
  private readonly timelines = new Map<string, ClientTimeline<unknown>>();
  private readonly derivedChannels = new Map<
    string,
    DerivedChannelDefinition<unknown>
  >();
  private readonly frameListeners = new Set<() => void>();
  private currentToken: FrameToken;
  private generation = 0;

  /**
   * Per-`FrameToken` memoization cache (M2 fix-report Defect 3, frame
   * coherence). Keyed by token object identity via a `WeakMap` so it never
   * needs manual cleanup — once a token is no longer referenced anywhere
   * (including as `currentToken`), its cache entry is collected too. The
   * first `sample(topic, token)` read for a given `(token, topic)` pair is
   * authoritative for that token's whole lifetime; a mid-frame `ingest`
   * cannot flip it. Also the seam derived channels (T3) reuse instead of
   * building their own per-frame cache.
   */
  private readonly frameCache = new WeakMap<FrameToken, Map<string, unknown>>();

  /** Missed-keyframe-heartbeat tracker backing `sampleStatus`'s client-inferred `"held-stale"` (M2 design §4.3, T4). */
  readonly heartbeats: HeartbeatTracker;

  constructor(
    readonly clock: ViewClock,
    private readonly options: TimelineStoreOptions = {},
  ) {
    this.currentToken = { viewUt: clock.viewUt(), generation: this.generation };
    this.heartbeats = new HeartbeatTracker(options.heartbeatOptions);
  }

  /**
   * Append a delivered sample for `topic` and feed its timing into the
   * shared `ViewClock`. Does NOT advance the frame — ingest and frame
   * advance are independent (many samples can arrive within one frame; the
   * frame only advances on `beginFrame()`).
   *
   * Store-level epoch guard (M2 fix-report Defect 1+2, "the client ghost"):
   * the store — not any individual `ClientTimeline` — is the epoch
   * authority. A point tagged with an epoch lower than the shared clock's
   * current epoch is refused outright, even for a topic whose
   * `ClientTimeline` has never been touched (a freshly-created timeline
   * defaults to epoch 0, which would otherwise wrongly admit a pre-rewind
   * straggler as if it were live). If this ingest is the one that bumps the
   * clock's epoch, every other registered timeline is swept forward to the
   * new epoch immediately, so a topic that hasn't re-sampled since the
   * rewind goes cold right away instead of continuing to serve dead-epoch
   * points until it happens to receive its own next sample.
   */
  ingest<T>(topic: string, point: TimelinePoint<T>): void {
    const priorEpoch = this.clock.getEpoch();
    if (point.epoch < priorEpoch) {
      // Stale-epoch straggler by the store's authoritative epoch — refused,
      // not merely masked at read time.
      return;
    }

    if (point.epoch > priorEpoch) {
      // Rewind confirmed by THIS point — clear heartbeat history BEFORE
      // recording its own arrival below, so a pre-reset expectation can
      // never wrongly flag (or wrongly clear) a HeldStale during the
      // resynchronizing period that follows. This point's own arrival still
      // counts as a fresh heartbeat for its topic once the clear has run.
      this.heartbeats.reset();
    }

    this.timelineFor<T>(topic).append(point);
    this.clock.observeSample(
      point.validAt,
      point.meta.deliveredAt,
      point.epoch,
    );
    // Every ingested sample — keyframe or change-emission alike — confirms
    // the link is alive as of this arrival. Deliberately keyed on
    // `meta.deliveredAt`, never `point.validAt` (M2 design §4.3; see
    // `HeartbeatTracker`'s doc comment for why).
    this.heartbeats.noteArrival(topic, point.meta.deliveredAt);

    const newEpoch = this.clock.getEpoch();
    if (newEpoch > priorEpoch) {
      for (const lagging of this.timelines.values()) {
        lagging.adoptEpoch(newEpoch);
      }
    }
  }

  /** The per-topic `ClientTimeline`, created on first access. */
  getTimeline<T>(topic: string): ClientTimeline<T> {
    return this.timelineFor<T>(topic);
  }

  /**
   * Register a derived channel (M2 design §2.1). From this point on,
   * `sample(def.topic, token)` (and `useTimelineStream(store, def.topic)`,
   * which is built on `sample`) transparently returns the memoized derived
   * value instead of reading a raw `ClientTimeline` — callers never need to
   * know whether a topic is raw or derived (M2 design §6: "raw-vs-derived
   * invisible"). If `def.fields` is set, `"<topic>.<field>"` subtopics are
   * resolved too (`resolveDerivedTopic`).
   *
   * Registering the same `topic` twice replaces the previous definition —
   * useful for hot-reload/test setup, not a guarded no-op.
   */
  registerDerivedChannel<T>(def: DerivedChannelDefinition<T>): void {
    this.derivedChannels.set(
      def.topic,
      def as DerivedChannelDefinition<unknown>,
    );
  }

  /**
   * Mint a new frozen `FrameToken` from the clock's current `viewUt()` and
   * make it `currentFrame()`'s value. Call once per animation frame / read
   * cycle (e.g. from `clock.onFrame` or a widget's own rAF loop) — never
   * once per read.
   */
  beginFrame(): FrameToken {
    this.generation++;
    this.currentToken = {
      viewUt: this.clock.viewUt(),
      generation: this.generation,
    };
    for (const listener of this.frameListeners) listener();
    return this.currentToken;
  }

  /** The token minted by the most recent `beginFrame()` call. What reactive reads (`useTimelineStream`) use — never recomputed per read. */
  currentFrame(): FrameToken {
    return this.currentToken;
  }

  /**
   * Imperative tier: read `topic` at a frame token's frozen `viewUt`
   * (defaults to `currentFrame()` — there is no per-read "now").
   *
   * Three fixes live here (M2 fix-report):
   * - **Stale-token fallback**: a `token` from a superseded frame (its
   *   `generation` doesn't match the store's current one — e.g. a caller
   *   cached a token across a `beginFrame()` boundary) is not honored;
   *   the read is routed to `currentFrame()` instead.
   * - **Store-level epoch guard (Defect 1+2)**: if `topic`'s timeline is
   *   still sitting on an epoch lower than the shared clock's, it's treated
   *   as cold (`undefined`) rather than serving its dead-epoch data — this
   *   is what actually closes the cross-topic ghost even in the split
   *   second before `ingest`'s proactive sweep has touched it, and for a
   *   timeline that gets lazily created (via `timelineFor`) after a rewind.
   * - **Frame-coherent memoization (Defect 3)**: the first read of a given
   *   `(topic, token)` pair is authoritative for that token's whole
   *   lifetime, so a mid-frame `ingest` can't flip the answer mid-read-cycle
   *   (tearing) — the change only surfaces once a new `beginFrame()` mints a
   *   new token.
   */
  sample<T>(
    topic: string,
    token: FrameToken = this.currentToken,
  ): TimelinePoint<T> | undefined {
    const effectiveToken =
      token.generation === this.generation ? token : this.currentToken;

    const resolved = this.resolveDerivedTopic(topic);
    if (resolved) {
      // Outer memoize keyed by the EXACT requested topic (parent or a field
      // subtopic) — this is what gives a re-read within the same frame back
      // the identical `TimelinePoint` object (referential stability for
      // React bail-out, mirroring the raw-topic path below), on top of the
      // inner memoize inside `sampleDerived` that keeps `derive` itself
      // running only once per frame regardless of how many field subtopics
      // of the same parent are read.
      //
      // The key folds in the CURRENT epoch (M2 design §2.3/§3.4: "memos die
      // by epoch") — unlike the frame-coherent raw-topic path below (which
      // deliberately freezes for the token's whole lifetime, M2 fix-report
      // Defect 3), a derived value must NOT survive a mid-frame epoch bump
      // (quickload rewind) for the rest of the frame. Folding epoch into the
      // key makes a post-bump read a fresh cache miss, so it falls through to
      // `sampleDerived` and recomputes against the new epoch instead of
      // serving pre-reset output.
      const epoch = this.clock.getEpoch();
      return this.memoize(effectiveToken, `${topic}\0epoch\0${epoch}`, () =>
        this.sampleDerived<T>(resolved, effectiveToken, epoch),
      );
    }

    return this.memoize(effectiveToken, topic, () => {
      const timeline = this.timelineFor<T>(topic);
      if (timeline.epoch < this.clock.getEpoch()) return undefined;
      return timeline.at(effectiveToken.viewUt);
    });
  }

  /**
   * The topic's `StreamStatusValue` at a frame token's frozen `viewUt` (M2
   * design §4.4, T4) — the staleness/absence surface, read alongside
   * `sample()` never inside it. Mirrors `sample()`'s stale-token fallback
   * and frame-coherent memoization exactly (same generation check, the same
   * per-`(token, key)` cache) so a status read and a value read for the
   * same topic in the same frame always agree about which frame they
   * describe. Field subtopics (`"<topic>.<field>"`) share their parent
   * derived channel's status outright — a field is just one slice of the
   * one memoized record, staleness applies to the whole record.
   */
  sampleStatus(
    topic: string,
    token: FrameToken = this.currentToken,
  ): StreamStatusValue {
    const effectiveToken =
      token.generation === this.generation ? token : this.currentToken;

    const resolved = this.resolveDerivedTopic(topic);
    if (resolved) {
      const parentTopic = resolved.def.topic;
      return this.memoize(effectiveToken, `\0status\0${parentTopic}`, () =>
        this.sampleDerivedStatus(resolved.def, effectiveToken),
      );
    }

    return this.memoize(effectiveToken, `\0status\0${topic}`, () =>
      this.sampleRawStatus(topic, effectiveToken),
    );
  }

  /**
   * Server-stamped `meta.staleness` wins outright when present (M2 design
   * §4.3: a catch-up/late-joiner mark is authoritative — no client
   * inference needed for it). Otherwise: a tombstone is `"absent"`, no
   * point at all in the current epoch is `"resyncing"`, and the
   * `HeartbeatTracker` (missed-keyframe inference, never `validAt` age)
   * decides live vs. held-stale.
   */
  private sampleRawStatus(topic: string, token: FrameToken): StreamStatusValue {
    const point = this.sample(topic, token);
    if (!point) return "resyncing";
    if (point.payload === null) return "absent";
    if (point.meta.staleness === Staleness.LastBeforeBlackout) {
      return "last-before-blackout";
    }
    if (point.meta.staleness === Staleness.HeldStale) return "held-stale";
    return this.heartbeats.isOverdue(
      topic,
      token.viewUt,
      this.clock.confidence(),
    )
      ? "held-stale"
      : "live";
  }

  /**
   * A derived channel's own status: `def.deriveStatus` if it declared one
   * (quality-picked channels like `vessel.state` need this — see
   * `vessel-state.ts`), else the generic default of worst-of-every-declared-
   * input (M2 design §4.4's baseline rule).
   */
  private sampleDerivedStatus(
    def: DerivedChannelDefinition<unknown>,
    token: FrameToken,
  ): StreamStatusValue {
    const get: DerivedGet = (inputTopic) => this.sample(inputTopic, token);
    const getStatus = (inputTopic: string) =>
      this.sampleStatus(inputTopic, token);
    if (def.deriveStatus) return def.deriveStatus(getStatus, get, token.viewUt);
    return worstStatus(def.inputs.map(getStatus));
  }

  /**
   * `topic` is either a registered derived channel's own topic, or (when
   * that channel opted into `fields: true`) a `"<topic>.<field>"` subtopic
   * of one. Anything else (including a raw topic that happens to contain a
   * dot, e.g. `"vessel.orbit"` itself) resolves to `undefined` here and
   * falls through to the raw-timeline path in `sample()`.
   */
  private resolveDerivedTopic(
    topic: string,
  ): { def: DerivedChannelDefinition<unknown>; field?: string } | undefined {
    const exact = this.derivedChannels.get(topic);
    if (exact) return { def: exact };

    const dot = topic.lastIndexOf(".");
    if (dot === -1) return undefined;
    const parentTopic = topic.slice(0, dot);
    const field = topic.slice(dot + 1);
    const parent = this.derivedChannels.get(parentTopic);
    if (!parent?.fields) return undefined;
    return { def: parent, field };
  }

  /**
   * Compute (or reuse the frame-memoized) value for a derived channel — the
   * SAME `memoize` seam raw `sample()` reads use, keyed by the channel's own
   * topic so N field-subtopic reads (`vessel.state.altitudeAsl`,
   * `vessel.state.orbitalSpeed`, …) in one frame still call `derive` exactly
   * once (M2 design §2.3: "memoized to once per (topic, frame)"). `get`
   * (passed to `derive`) is `sample` bound to this SAME `token` — the
   * structural single-view-time invariant (§7.4): there is no other way for
   * a `derive` implementation to read a UT. `epoch` is threaded in from the
   * caller (rather than re-read via `this.clock.getEpoch()`) so the value
   * used to build the memo key and the value stamped on the resulting point
   * are guaranteed to agree, even though `derive` itself may cause further
   * ingests via side effects it has no business having.
   */
  private sampleDerived<T>(
    resolved: { def: DerivedChannelDefinition<unknown>; field?: string },
    token: FrameToken,
    epoch: number,
  ): TimelinePoint<T> | undefined {
    const { def, field } = resolved;

    // Keyed distinctly from `def.topic` itself (a `\0`-prefixed key can
    // never collide with a real topic string) — the OUTER `memoize` call in
    // `sample()` also uses `def.topic` as its key when the parent topic
    // (not a field subtopic) is what's requested, so sharing the same key
    // here would let that outer wrapped `TimelinePoint` clobber this raw
    // derive() value in the shared per-token cache. Also folds in `epoch`
    // (see `sample()`'s matching comment) — this is the memo that actually
    // calls `derive`, so it's the one that must recompute on a mid-frame
    // epoch bump; the outer memoize in `sample()` only needs a matching key
    // so it doesn't short-circuit before ever reaching this one.
    const value = this.memoize(
      token,
      `\0derived\0${def.topic}\0epoch\0${epoch}`,
      () => {
        const get: DerivedGet = (inputTopic) => this.sample(inputTopic, token);
        return def.derive(get, token.viewUt);
      },
    );

    if (value === undefined) {
      // Not whole yet — an input has no point at-or-before `viewUt` in the
      // current epoch (cold start, or resynchronizing after an epoch reset,
      // M2 design §2.1/§3.4). There is no point to serve at all here, NOT a
      // tombstone — propagates through field subtopics too, since there's
      // nothing to extract a field from yet.
      return undefined;
    }

    if (value === null) {
      // Confirmed absence (a required input was tombstoned, or the channel
      // itself returned null) — a real point, per the tombstone model (M2
      // design §4): `payload: null`.
      return {
        validAt: token.viewUt,
        payload: null as T,
        meta: derivedMeta(token.viewUt, epoch),
        epoch,
      };
    }

    if (field && !(field in (value as object))) return undefined; // unknown field name — nothing to serve

    const payload = field
      ? ((value as Record<string, unknown>)[field] as T)
      : (value as T);

    return {
      validAt: token.viewUt,
      payload,
      meta: derivedMeta(token.viewUt, epoch),
      epoch,
    };
  }

  /**
   * Frame-coherent memoized read: the first `compute()` for a given
   * `(token, key)` pair wins for that token's lifetime; subsequent calls
   * return the cached result even if the underlying data changes in
   * between. Private for now — exposed indirectly via `sample()` — but
   * deliberately generic so derived channels (T3) can reuse the same
   * per-frame cache instead of building their own.
   */
  private memoize<T>(token: FrameToken, key: string, compute: () => T): T {
    let cache = this.frameCache.get(token);
    if (!cache) {
      cache = new Map();
      this.frameCache.set(token, cache);
    }
    if (cache.has(key)) {
      return cache.get(key) as T;
    }
    const value = compute();
    cache.set(key, value);
    return value;
  }

  /** Notified once per `beginFrame()` call — backs the reactive tier's `useSyncExternalStore` subscription. */
  subscribeFrame(cb: () => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  private timelineFor<T>(topic: string): ClientTimeline<T> {
    let timeline = this.timelines.get(topic);
    if (!timeline) {
      timeline = new ClientTimeline<T>(this.options.timelineOptions);
      this.timelines.set(topic, timeline as ClientTimeline<unknown>);
    }
    return timeline as ClientTimeline<T>;
  }
}
