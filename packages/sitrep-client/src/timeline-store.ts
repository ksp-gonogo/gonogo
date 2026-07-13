import type { Meta } from "@ksp-gonogo/sitrep-sdk";
import { Quality, Staleness } from "@ksp-gonogo/sitrep-sdk";
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
import type { Transport } from "./transport";
import type { Certainty, ViewClock } from "./view-clock";

/**
 * The frozen view-time token for one frame / read cycle — enforces the
 * "single-view-time invariant". There is deliberately no method
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
   * a caller cached across a frame boundary and fall back to the current
   * frame instead of honoring a frozen-in-the-past `viewUt` forever.
   */
  readonly generation: number;
  /**
   * Whether `viewUt` sits at-or-before the `ViewClock`'s certainty horizon
   * as of the moment this token was minted. Computed once
   * here — NOT recomputed against the live clock on each read — for the
   * same frame-coherence reason values are memoized per token: a mid-frame
   * `ingest` that nudges the horizon forward must not flip a read's
   * certainty mid-frame any more than it can flip its value. See
   * `TimelineStore.sampleCertainty`.
   */
  readonly certainty: Certainty;
}

export interface TimelineStoreOptions {
  timelineOptions?: ClientTimelineOptions;
  /** Options for the store's `HeartbeatTracker` (the keyframe-cadence heartbeat) — per-topic keyframe intervals, staleness-margin tuning. */
  heartbeatOptions?: HeartbeatTrackerOptions;
}

/**
 * What a `derive()` function reads inputs through — enforces the
 * "single-view-time invariant". Deliberately NOT `(topic) => value` — it
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
   * to `TelemetryClient`'s subscribe machinery — not yet done) — recorded
   * here as the channel's own documentation of its dependencies, and
   * reserved for that wiring.
   */
  inputs: string[];
  /**
   * Pure function: same `(get, viewUt)` inputs must produce the same output,
   * always (the replay/scrub contract). Two distinct
   * "nothing" results — never conflate them:
   * - Return `undefined` when an input has no point at-or-before `viewUt`
   *   yet in the current epoch — "not whole yet" (cold start, or
   *   resynchronizing after an epoch reset until the first post-reset
   *   keyframe lands per input). `sample()`/`sampleDerived` propagate
   *   this as "no point at all", never a fabricated tombstone.
   * - Return `null` for a confirmed absence (a tombstoned input, or the
   *   channel's own subject genuinely gone) — never a fabricated
   *   zero-valued record.
   *
   * `getInterpolated` is `get`'s sibling for MEASURED
   * raw inputs: it lerps between the two buffered points straddling
   * `viewUt` instead of holding the latest one (`ClientTimeline.straddle`'s
   * seam, per that method's own doc comment: "interpolation lands in a
   * later task"). Use `get` for a CAUSE valid until superseded (orbit
   * elements — interpolating between two elements samples straddling a
   * maneuver would blend through physically nonsensical intermediate
   * orbits) and `getInterpolated` for a measurement where the straight line
   * between two samples is an honest estimate in between (`vessel.flight`'s
   * Loaded-basis fields — see `vessel-state.ts`). Falls back to hold-last
   * itself whenever there's nothing to straddle or the payload shape can't
   * be honestly lerped.
   */
  derive: (
    get: DerivedGet,
    viewUt: number,
    getInterpolated: DerivedGet,
  ) => T | null | undefined;
  /**
   * Expose `"<topic>.<field>"` subtopics that read a single field off the
   * one memoized record — e.g. `vessel.state.altitudeAsl`.
   * Field names are resolved dynamically off whatever `derive` returns, so
   * no static field list is needed here.
   */
  fields?: boolean;
  /**
   * Optional override for this channel's own `StreamStatusValue` (derived
   * channels propagate the worst input staleness into their own status
   * by default). `getStatus(topic)` resolves an input topic's own
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

/** Synthetic envelope `Meta` stamped on a derived-channel read. Real staleness/quality propagation from inputs (derived channels ultimately should propagate the worst input staleness) is not yet implemented — this is intentionally minimal, just enough to satisfy the `Meta` shape every `TimelinePoint` carries. */
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
 * Field names that carry a DEGREE-valued angle where wrapping is physically
 * meaningful — e.g. `longitude` 179 -> -179 is a
 * 2-degree hop across the antimeridian, not a ~358-degree hop the other way
 * around the planet. Interpolated the SHORT way around the wrap in
 * `lerpFieldValue` below, instead of the naive straight-line lerp every
 * other numeric field gets. A small, explicit allowlist rather than a
 * heuristic (no name-sniffing for "looks like an angle") — extend this set
 * deliberately as more angular fields (heading, bearing) actually appear in
 * a payload.
 */
const ANGULAR_DEGREE_FIELD_NAMES: ReadonlySet<string> = new Set([
  "longitude",
  "heading",
  "bearing",
]);

/**
 * Field names that are numeric but not genuinely continuous — an index,
 * enum ordinal, or other discrete quantity where a fractional value is
 * physically meaningless — e.g.
 * `referenceBodyIndex` 1 -> 2 must never become `1.5`. Held at `before`
 * rather than fractionalized, mirroring how a non-numeric field that's
 * identical on both sides already passes through unchanged. Same
 * explicit-allowlist reasoning as `ANGULAR_DEGREE_FIELD_NAMES` — extend
 * deliberately, don't infer from naming conventions.
 */
const DISCRETE_NUMERIC_FIELD_NAMES: ReadonlySet<string> = new Set([
  "referenceBodyIndex",
]);

/** Normalize a degree value into `(-180, 180]`. */
function normalizeDegrees(deg: number): number {
  const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180;
  // The above maps 180 -> -180; prefer the +180 representative for the
  // boundary case so a stationary angle round-trips exactly.
  return wrapped === -180 ? 180 : wrapped;
}

/** Interpolate a degree-valued angle the SHORT way around the wrap, at `t` in `[0, 1]`. */
function lerpAngleDegrees(before: number, after: number, t: number): number {
  const diff = normalizeDegrees(after - before);
  return normalizeDegrees(before + diff * t);
}

/**
 * Interpolate one field value at `t`, honoring the angular-wrap and
 * discrete-field policies above. Falls back to
 * the caller's identical-value-passthrough / refuse-on-mismatch handling for
 * anything that isn't a plain number pair.
 */
function lerpFieldValue(
  key: string,
  before: unknown,
  after: unknown,
  t: number,
): { value: unknown } | undefined {
  if (typeof before === "number" && typeof after === "number") {
    if (DISCRETE_NUMERIC_FIELD_NAMES.has(key)) {
      return { value: before }; // hold-last — never fractionalize an index/ordinal
    }
    if (ANGULAR_DEGREE_FIELD_NAMES.has(key)) {
      return { value: lerpAngleDegrees(before, after, t) };
    }
    return { value: before + (after - before) * t };
  }
  if (Object.is(before, after)) return { value: before };
  return undefined;
}

/**
 * Linearly interpolate between two payloads of matching shape at `t` in
 * `[0, 1]` — the confirmed-range interpolation primitive.
 * Numeric payloads lerp directly. A plain (non-array, non-null) object
 * lerps field-by-field via `lerpFieldValue`: a genuinely continuous numeric
 * field lerps straight-line, an ANGULAR field (`ANGULAR_DEGREE_FIELD_NAMES`)
 * wraps the short way instead of blending through the far side of the
 * wrap, a DISCRETE numeric field (`DISCRETE_NUMERIC_FIELD_NAMES`) holds at
 * `before` rather than fractionalizing, a non-numeric field that is
 * IDENTICAL on both sides passes through unchanged (e.g. an unchanged
 * string/enum field), and a non-numeric field that actually DIFFERS makes
 * the whole interpolation refuse (`undefined`) — there is no honest halfway
 * point between two different strings, and a caller asking for a lerp
 * should never get a silently-wrong blended object back. Anything else
 * (arrays, non-number/non-object primitives, mismatched key sets) also
 * returns `undefined`, signalling "fall back to hold-last" to the caller.
 */
export function lerpPayload<T>(before: T, after: T, t: number): T | undefined {
  if (typeof before === "number" && typeof after === "number") {
    return (before + (after - before) * t) as T;
  }

  if (
    before !== null &&
    after !== null &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const beforeObj = before as Record<string, unknown>;
    const afterObj = after as Record<string, unknown>;
    const keys = Object.keys(beforeObj);
    if (keys.length === 0) return undefined;
    if (keys.some((key) => !(key in afterObj))) return undefined;

    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const lerped = lerpFieldValue(key, beforeObj[key], afterObj[key], t);
      if (!lerped) return undefined;
      result[key] = lerped.value;
    }
    return result as T;
  }

  return undefined;
}

/**
 * `TimelineStore.sampleInterpolated`'s core: straddle `viewUt` in `timeline`
 * and lerp, falling back to hold-last (`ClientTimeline.at`) whenever
 * there's nothing to straddle, either bracketing point is a tombstone
 * (never interpolate across an absence transition — the confirmed truth
 * mid-transition is still "whatever was last known", not a fabricated
 * blend toward/away from `null`), or `lerpPayload` can't
 * honestly produce a value.
 */
function interpolatedRead<T>(
  timeline: ClientTimeline<T>,
  viewUt: number,
): TimelinePoint<T> | undefined {
  const straddle = timeline.straddle(viewUt);
  if (!straddle) return timeline.at(viewUt);

  const [before, after] = straddle;
  if (before.payload === null || after.payload === null) return before;

  const span = after.validAt - before.validAt;
  const t = span === 0 ? 0 : (viewUt - before.validAt) / span;
  const payload = lerpPayload(before.payload, after.payload, t);
  if (payload === undefined) return before;

  return {
    validAt: viewUt,
    payload,
    meta: before.meta,
    epoch: before.epoch,
  };
}

/**
 * Ties per-topic `ClientTimeline`s to the one shared `ViewClock` and mints
 * the frozen `FrameToken` every read goes through.
 *
 * Two consumption tiers:
 * - **Reactive**: `subscribeFrame` + `sample` back a `useSyncExternalStore`
 *   hook (`useTimelineStream`) that reads at whatever `FrameToken`
 *   `currentFrame()` currently holds — it does NOT mint its own token per
 *   render, so two components rendering in the same frame see the same
 *   `viewUt` even if wall time ticks between their renders.
 * - **Imperative**: `sample(topic, token)` for a caller's own rAF loop
 *   (canvas widgets) — pass the token from `currentFrame()` (or one you
 *   minted yourself with `beginFrame()`) explicitly.
 *
 * This is the foundation derived channels build on, along with staleness
 * consumption and confirmed-vs-predicted reads.
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
   * Per-`FrameToken` memoization cache — gives frame coherence: the same
   * `(token, topic)` read always returns the same result for that token's
   * lifetime. Keyed by token object identity via a `WeakMap` so it never
   * needs manual cleanup — once a token is no longer referenced anywhere
   * (including as `currentToken`), its cache entry is collected too. The
   * first `sample(topic, token)` read for a given `(token, topic)` pair is
   * authoritative for that token's whole lifetime; a mid-frame `ingest`
   * cannot flip it. Also the seam derived channels reuse instead of
   * building their own per-frame cache.
   */
  private readonly frameCache = new WeakMap<FrameToken, Map<string, unknown>>();

  /** Missed-keyframe-heartbeat tracker backing `sampleStatus`'s client-inferred `"held-stale"`. */
  readonly heartbeats: HeartbeatTracker;

  /**
   * Whole-transport connectivity, fed by `setTransportConnected`/
   * `attachTransport` (the "transport-down short-circuit" — see
   * `sampleRawStatus`). Defaults to `true` (connected) so a caller that never
   * wires this up sees today's pure per-topic heartbeat inference unchanged
   * — this is opt-in, so `TimelineStore` needs no direct `Transport`
   * reference by default.
   */
  private transportConnected = true;

  constructor(
    readonly clock: ViewClock,
    private readonly options: TimelineStoreOptions = {},
  ) {
    const viewUt = clock.viewUt();
    this.currentToken = {
      viewUt,
      generation: this.generation,
      certainty: clock.certaintyFor(viewUt),
    };
    this.heartbeats = new HeartbeatTracker(options.heartbeatOptions);
  }

  /**
   * Set whole-transport connectivity.
   * While `false`, `sampleStatus` short-circuits every topic that has
   * confirmed data to `"disconnected"` immediately, instead of letting each
   * one independently drift into `"held-stale"` on its own heartbeat margin
   * — see `sampleRawStatus` for the full precedence against server-stamped
   * staleness and a confirmed `"absent"` tombstone, both of which still win
   * outright over this.
   */
  setTransportConnected(connected: boolean): void {
    this.transportConnected = connected;
  }

  /**
   * Convenience wiring of `setTransportConnected` directly off a `Transport`
   * (or anything with the same `status`/`onStatusChange` shape, e.g. the one
   * `TelemetryClient` holds) — seeds the current status immediately and
   * keeps it live via `onStatusChange`. Only `"connected"` counts as
   * connected; `"reconnecting"`/`"error"`/`"disconnected"` all collapse to
   * the same disconnected input — this layer only distinguishes "the
   * link is currently reliable" from "it isn't"; the finer `TransportStatus`
   * taxonomy is presentation detail this layer doesn't need. Returns an
   * unsubscribe function.
   */
  attachTransport(
    transport: Pick<Transport, "status" | "onStatusChange">,
  ): () => void {
    this.setTransportConnected(transport.status === "connected");
    return transport.onStatusChange((status) => {
      this.setTransportConnected(status === "connected");
    });
  }

  /**
   * Append a delivered sample for `topic` and feed its timing into the
   * shared `ViewClock`. Does NOT advance the frame — ingest and frame
   * advance are independent (many samples can arrive within one frame; the
   * frame only advances on `beginFrame()`).
   *
   * Store-level epoch guard (avoids "the client ghost" — a stale point
   * surviving a reconnect/epoch bump):
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
    // `meta.deliveredAt`, never `point.validAt` (see
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
   * Register a derived channel. From this point on,
   * `sample(def.topic, token)` (and `useTimelineStream(store, def.topic)`,
   * which is built on `sample`) transparently returns the memoized derived
   * value instead of reading a raw `ClientTimeline` — callers never need to
   * know whether a topic is raw or derived ("raw-vs-derived
   * invisible" to consumers). If `def.fields` is set, `"<topic>.<field>"` subtopics are
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
    const viewUt = this.clock.viewUt();
    this.currentToken = {
      viewUt,
      generation: this.generation,
      certainty: this.clock.certaintyFor(viewUt),
    };
    for (const listener of this.frameListeners) listener();
    return this.currentToken;
  }

  /** The token minted by the most recent `beginFrame()` call. What reactive reads (`useTimelineStream`) use — never recomputed per read. */
  currentFrame(): FrameToken {
    return this.currentToken;
  }

  /**
   * The frame's certainty — `"confirmed"` when the token's
   * `viewUt` sat at-or-before the certainty horizon at the moment it was
   * minted, `"predicted"` past it. Rides alongside a value/status read for
   * the same topic and frame, never inside either (the `useKosScriptStatus`
   * pattern: `sample()` for the value, `sampleStatus()` for staleness/
   * absence, `sampleCertainty()` for this — three independent channels that
   * compose freely, e.g. a topic can be simultaneously `"predicted"` and
   * `"resyncing"`, or `"confirmed"` and `"held-stale"`). Mirrors `sample()`/
   * `sampleStatus()`'s stale-token fallback.
   */
  sampleCertainty(token: FrameToken = this.currentToken): Certainty {
    const effectiveToken =
      token.generation === this.generation ? token : this.currentToken;
    return effectiveToken.certainty;
  }

  /** Passthrough to the shared clock's certainty horizon — the first-class SDK value (`sdk.view.certaintyHorizonUt()`). */
  certaintyHorizonUt(): number {
    return this.clock.certaintyHorizonUt();
  }

  /**
   * The raw wire topics that must actually be subscribed (via
   * `TelemetryClient.subscribe`) to keep `topic` resolvable — the
   * derived-input ref-counting mechanism. A derived channel's own
   * topic (or one of its `"<topic>.<field>"` subtopics) is NEVER itself a
   * subscribable wire topic — no server channel produces it — so a caller
   * that naively subscribed to the derived topic NAME would never receive
   * any data and the channel would silently stay "not whole yet" forever.
   * This resolves `topic` down to the declared `inputs` it actually needs,
   * recursively (a derived channel's own `inputs` can themselves be derived,
   * per `DerivedGet`'s doc — `derive` can read another derived channel as an
   * input), de-duplicated, and defended against a malformed cyclical
   * declaration (an authoring bug, never expected in practice) via a
   * visited-set guard rather than an infinite loop.
   *
   * Identity (`[topic]`) for a topic that isn't derived at all — a genuinely
   * raw topic subscribes to itself, same as before this method existed.
   */
  resolveSubscriptionTopics(topic: string): string[] {
    const out = new Set<string>();
    this.collectSubscriptionTopics(topic, out, new Set());
    return [...out];
  }

  private collectSubscriptionTopics(
    topic: string,
    out: Set<string>,
    visiting: Set<string>,
  ): void {
    const resolved = this.resolveDerivedTopic(topic);
    if (!resolved) {
      // Raw record field-subtopic: the raw wire topic that must
      // actually be subscribed is the record itself (`"time.warp"`), never
      // the literal dotted field string (`"time.warp.warpRate"`) — nothing
      // publishes to the latter. See `resolveRawFieldSubtopic`/`sample()`'s
      // matching branch.
      const rawField = this.resolveRawFieldSubtopic(topic);
      out.add(rawField ? rawField.rawTopic : topic);
      return;
    }
    const parentTopic = resolved.def.topic;
    if (visiting.has(parentTopic)) return; // cyclical declaration — break, don't loop forever
    visiting.add(parentTopic);
    for (const input of resolved.def.inputs) {
      this.collectSubscriptionTopics(input, out, visiting);
    }
  }

  /**
   * True when `topic` names a `"<parent>.<field>"` subtopic whose PARENT
   * resolved to a whole, non-tombstoned derived record (the derivation
   * genuinely ran) but `field` is not a key on the record it produced — a
   * structurally dead mapping (e.g. a stale migration-table entry pointing
   * at a field a `derive()` function never emits), as opposed to ordinary
   * "not whole yet" loading (parent has no point at all yet) or a confirmed
   * absence (parent tombstoned) — both of which return `false` here, same as
   * a healthy field that just hasn't arrived.
   *
   * `sample()` alone can't make this distinction: `sampleDerived`'s field
   * lookup collapses "unknown field name" and "not whole yet" onto the same
   * `undefined` return, deliberately (see its own doc comment). This is a
   * SEPARATE diagnostic read for a caller (the `@ksp-gonogo/core` `useDataValue`
   * compatibility shim — belt-and-suspenders
   * fallback safety) that needs to tell "still loading, keep waiting" apart
   * from "this can never resolve, fall back to another source" — never
   * folded into `sample()`'s own return value.
   *
   * This guard covers both DERIVED
   * channel parents and RAW record field-subtopics (`resolveRawFieldSubtopic`
   * — e.g. `"vessel.resources.resources.<name>.current"`). A raw fieldpath
   * that's wrong or has drifted would otherwise serve a permanent
   * `undefined` with no fallback (the FuelStatus-class
   * bug: `useDataValue("data", vesselKey) ?? 0` turning a silent resolution
   * failure into an empty gauge). The second branch below applies the exact
   * same "whole-but-missing-field = unresolvable" check to a raw parent,
   * walking the FULL fieldpath (which may be 1+ segments, unlike the
   * single-segment derived-channel case above) via the same walk
   * `sampleRawFieldSubtopic`/`sampleRange` use.
   */
  isUnresolvableField(
    topic: string,
    token: FrameToken = this.currentToken,
  ): boolean {
    const dot = topic.lastIndexOf(".");
    if (dot === -1) return false;
    const parentTopic = topic.slice(0, dot);
    const field = topic.slice(dot + 1);

    if (this.derivedChannels.has(parentTopic)) {
      const parentPoint = this.sample<Record<string, unknown>>(
        parentTopic,
        token,
      );
      if (!parentPoint || parentPoint.payload === null) return false;
      return !(field in parentPoint.payload);
    }

    const rawField = this.resolveRawFieldSubtopic(topic);
    if (!rawField) return false;

    const parentPoint = this.sample<Record<string, unknown>>(
      rawField.rawTopic,
      token,
    );
    if (!parentPoint || parentPoint.payload === null) return false;

    let cursor: unknown = parentPoint.payload;
    for (const segment of rawField.fieldPath) {
      if (
        cursor === null ||
        typeof cursor !== "object" ||
        !(segment in (cursor as object))
      ) {
        return true; // whole parent, but this field path doesn't resolve
      }
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    return false;
  }

  /**
   * `true` when `topic` names a registered DERIVED channel — its own topic
   * or one of its `"<topic>.<field>"` subtopics (`resolveDerivedTopic`).
   * `false` for a raw topic, including a raw record field-subtopic
   * (`resolveRawFieldSubtopic`, e.g. `"vessel.orbit.sma"`) — that string
   * LOOKS derived-shaped (it has dots) but resolves to a real wire record's
   * timeline, not a registered `derive()` function. What `sampleRange`
   * consults to decide "there's a stored history to range over" (a raw
   * topic always has one, a derived topic never does — it's a per-frame
   * computed value, see `sampleRange`'s own doc) versus `isUnresolvableField`
   * above, which asks a narrower question (a specific FIELD NAME on an
   * otherwise-whole derived record) for a different caller.
   */
  isDerivedTopic(topic: string): boolean {
    return this.resolveDerivedTopic(topic) !== undefined;
  }

  /**
   * Windowed range read for a raw topic (or raw record field-subtopic) —
   * the read side of `useDataSeries`'s stream shim (`@ksp-gonogo/data`).
   * Mirrors `sample()`'s raw-topic / raw-field-subtopic resolution
   * (`resolveRawFieldSubtopic`, see `timeline-store-raw-fields.test.ts`) but
   * returns every buffered point in `[fromUt, toUt]` instead of one
   * hold-last read.
   *
   * Returns `undefined` — not an empty array — when `topic` resolves to a
   * registered DERIVED channel (`isDerivedTopic`): a derived value is
   * computed fresh per frame from whatever its inputs currently hold
   * (`sampleDerived`), never stored as its own buffered history, so there is
   * structurally nothing to range over. This is the caller's "give up,
   * permanently, on this topic" signal — distinct from an empty array,
   * which means "genuinely nothing landed in the window yet" and may fill
   * in on a later read as more samples arrive.
   *
   * For a literal raw topic, returns its `ClientTimeline.range` verbatim.
   * For a raw record field-subtopic, reads the PARENT raw topic's range and
   * extracts `fieldPath` from each point's payload — skipping (never
   * fabricating a value for) a tombstoned parent point or one whose payload
   * doesn't have the field, the same two "nothing to serve" cases
   * `sampleRawFieldSubtopic` treats identically for a single read.
   *
   * Bounded to the CURRENT epoch, exactly like `sample()`'s raw path — a
   * timeline still sitting on a lower epoch (hasn't re-sampled since a
   * rewind) reads as empty rather than serving dead-epoch history into a
   * live series.
   */
  sampleRange<T>(
    topic: string,
    fromUt: number,
    toUt: number,
  ): TimelinePoint<T>[] | undefined {
    if (this.resolveDerivedTopic(topic)) return undefined;

    const epoch = this.clock.getEpoch();
    const rawField = this.resolveRawFieldSubtopic(topic);
    if (!rawField) {
      const timeline = this.timelineFor<T>(topic);
      if (timeline.epoch < epoch) return [];
      return timeline.range(fromUt, toUt);
    }

    const parentTimeline = this.timelineFor<Record<string, unknown>>(
      rawField.rawTopic,
    );
    if (parentTimeline.epoch < epoch) return [];

    const out: TimelinePoint<T>[] = [];
    for (const point of parentTimeline.range(fromUt, toUt)) {
      if (point.payload === null) continue; // tombstone — nothing to extract
      let cursor: unknown = point.payload;
      let resolved = true;
      for (const segment of rawField.fieldPath) {
        if (
          cursor === null ||
          typeof cursor !== "object" ||
          !(segment in (cursor as object))
        ) {
          resolved = false;
          break;
        }
        cursor = (cursor as Record<string, unknown>)[segment];
      }
      if (!resolved) continue; // unknown field on this point — nothing to serve
      out.push({
        validAt: point.validAt,
        payload: cursor as T,
        meta: point.meta,
        epoch: point.epoch,
      });
    }
    return out;
  }

  /**
   * Windowed series for a DERIVED topic — the counterpart to `sampleRange`
   * (which structurally can't serve one: a derived value is computed fresh
   * per frame, nothing is ever stored). Backs `@ksp-gonogo/data`'s
   * `useDataSeries` shim so a Graph-style widget plotting a `vessel.state.*`
   * (or other registered derived-channel) key gets a REAL series off the
   * stream instead of permanently falling back to the legacy
   * `BufferedDataSource` — see that hook's own doc comment for the "why".
   *
   * Replays `def.derive` at every UT any of its raw `inputs` actually
   * changed at within `[fromUt, toUt]` (a change-gated raw timeline only
   * ever carries a point when something changed, so this is exactly the set
   * of instants the derived value could have changed too) — a synthetic
   * `get` built by hold-last lookup over each raw input's own buffered range
   * (queried from `-Infinity` through `toUt`, so an input that last changed
   * BEFORE `fromUt` still resolves correctly at the first in-window
   * instant; `ClientTimeline`'s own retention window bounds this, not an
   * unbounded scan). `getInterpolated` is passed the SAME hold-last `get` —
   * every currently-registered channel's `derive` defaults its own
   * `getInterpolated` parameter to `get` when omitted
   * (`deriveVesselState`'s own doc comment), so this matches live-frame
   * behavior for every channel that doesn't explicitly need lerp precision;
   * a channel that starts requiring true interpolation for a historical
   * replay would need this widened, not silently mismatch (tracked, not hit
   * by anything registered today).
   *
   * Declared `inputs` are assumed RAW (not another derived topic) — true of
   * every channel in `PRODUCTION_DERIVED_CHANNELS` today, even though `get`
   * itself resolves derived-on-derived inputs transparently at the live-frame
   * layer (`sample()`'s own doc comment). A derived-on-derived input here
   * degrades to "no point at that instant" (`sampleRange` already returns
   * `undefined` for a derived topic, folded into an empty array below)
   * rather than recursing — safe, just sparser, and nothing registered
   * exercises it today.
   *
   * Returns `undefined` when `topic` doesn't resolve to a registered derived
   * channel at all (mirrors `sampleRange`'s contract) — callers are expected
   * to gate on `isDerivedTopic` first, same as `sampleRange`'s own callers
   * gate the other way.
   */
  sampleDerivedRange<T>(
    topic: string,
    fromUt: number,
    toUt: number,
  ): TimelinePoint<T>[] | undefined {
    const resolved = this.resolveDerivedTopic(topic);
    if (!resolved) return undefined;
    const { def, field } = resolved;

    const epoch = this.clock.getEpoch();

    const inputRanges = new Map<string, TimelinePoint<unknown>[]>();
    const changeUts = new Set<number>();
    for (const inputTopic of def.inputs) {
      const points =
        this.sampleRange<unknown>(inputTopic, -Infinity, toUt) ?? [];
      inputRanges.set(inputTopic, points);
      for (const point of points) {
        if (point.validAt >= fromUt && point.validAt <= toUt) {
          changeUts.add(point.validAt);
        }
      }
    }

    const sortedUts = [...changeUts].sort((a, b) => a - b);
    const out: TimelinePoint<T>[] = [];

    for (const ut of sortedUts) {
      const get: DerivedGet = <I>(
        inputTopic: string,
      ): TimelinePoint<I> | undefined => {
        const points = inputRanges.get(inputTopic);
        if (!points || points.length === 0) return undefined;
        let last: TimelinePoint<unknown> | undefined;
        for (const point of points) {
          if (point.validAt <= ut) last = point;
          else break;
        }
        return last as TimelinePoint<I> | undefined;
      };

      const value = def.derive(get, ut, get);
      if (value === undefined) continue; // not whole yet at this instant

      let payload: unknown;
      if (value === null) {
        payload = null; // confirmed absence
      } else if (field) {
        if (!(field in (value as object))) continue; // unknown field name
        payload = (value as Record<string, unknown>)[field];
      } else {
        payload = value;
      }

      out.push({
        validAt: ut,
        payload: payload as T,
        meta: derivedMeta(ut, epoch),
        epoch,
      });
    }

    return out;
  }

  /**
   * Imperative tier: read `topic` at a frame token's frozen `viewUt`
   * (defaults to `currentFrame()` — there is no per-read "now").
   *
   * Three behaviours combine here:
   * - **Stale-token fallback**: a `token` from a superseded frame (its
   *   `generation` doesn't match the store's current one — e.g. a caller
   *   cached a token across a `beginFrame()` boundary) is not honored;
   *   the read is routed to `currentFrame()` instead.
   * - **Store-level epoch guard**: if `topic`'s timeline is
   *   still sitting on an epoch lower than the shared clock's, it's treated
   *   as cold (`undefined`) rather than serving its dead-epoch data — this
   *   is what actually closes the cross-topic ghost even in the split
   *   second before `ingest`'s proactive sweep has touched it, and for a
   *   timeline that gets lazily created (via `timelineFor`) after a rewind.
   * - **Frame-coherent memoization**: the first read of a given
   *   `(topic, token)` pair is authoritative for that token's whole
   *   lifetime, so a mid-frame `ingest` can't flip the answer mid-read-cycle
   *   (tearing) — the change only surfaces once a new `beginFrame()` mints a
   *   new token. **Except across an epoch bump**:
   *   the memo key folds in `clock.getEpoch()`, same as the derived-topic
   *   path below, so a mid-token quickload rewind is a cache miss rather
   *   than a replayed pre-bump ghost — including to a derived channel's
   *   `get()` reading this same topic through this same token.
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
      // The key folds in the CURRENT epoch — memos must die
      // by epoch — unlike the frame-coherent raw-topic path below (which
      // deliberately freezes for the token's whole lifetime), a derived
      // value must NOT survive a mid-frame epoch bump
      // (quickload rewind) for the rest of the frame. Folding epoch into the
      // key makes a post-bump read a fresh cache miss, so it falls through to
      // `sampleDerived` and recomputes against the new epoch instead of
      // serving pre-reset output.
      const epoch = this.clock.getEpoch();
      return this.memoize(effectiveToken, `${topic}\0epoch\0${epoch}`, () =>
        this.sampleDerived<T>(resolved, effectiveToken, epoch),
      );
    }

    // Folds in the CURRENT epoch — exactly like the derived-topic key above,
    // guarding against the same class of stale-epoch ghost. Without this, the
    // first read of a given (token, topic) pair is authoritative for the
    // token's whole lifetime (frame-coherence, intentional for an
    // ordinary mid-frame ingest) — but a mid-frame EPOCH BUMP is not an
    // ordinary ingest: it's a quickload rewind that the store's cross-topic
    // sweep (`ingest`) already propagates to every `ClientTimeline`
    // immediately. An unkeyed cache would keep replaying the pre-bump
    // `TimelinePoint` object for the rest of the token's life — including to
    // any derived channel's `get()` that reads this same topic through this
    // same token — defeating the epoch guard below and the sweep that just
    // ran. Folding epoch into the key makes a post-bump read a fresh cache
    // miss, so it falls through to the guard/`timeline.at` again instead.
    const epoch = this.clock.getEpoch();
    const literal = this.memoize(
      effectiveToken,
      `${topic}\0epoch\0${epoch}`,
      () => {
        const timeline = this.timelineFor<T>(topic);
        if (timeline.epoch < epoch) return undefined;
        return timeline.at(effectiveToken.viewUt);
      },
    );
    if (literal !== undefined) return literal;

    // Raw record field-subtopic fallback — the
    // mechanism `map-topic.ts`'s whole `TELEMACHUS_CLEAN_HOMES` table
    // depends on: `topic` is a `"<domain>.<channel>.<field...>"` string with no
    // registered-derived-channel match — e.g. `"time.warp.warpRate"`. No
    // wire message is EVER published to that literal string; the real wire
    // topic is `"time.warp"`, a whole record `{ warpRate, warpRateIndex,
    // warpMode, paused }`. See `resolveRawFieldSubtopic`'s own doc for the
    // "first two segments are the real topic" rule this relies on.
    //
    // Deliberately tried SECOND, only once the literal read above came back
    // `undefined` — never first. A topic string that genuinely IS a raw
    // topic in its own right, even a 3+-segment one (`use-timeline-stream
    // .test.tsx` ingests straight into `"vessel.state.altitudeAsl"` as a
    // literal topic against a bare store with no derived channel
    // registered), must keep reading its own literal timeline; shadowing it
    // unconditionally with the field-split interpretation would silently
    // stop that from ever resolving.
    const rawField = this.resolveRawFieldSubtopic(topic);
    if (!rawField) return literal;
    return this.memoize(
      effectiveToken,
      `\0rawfield\0${topic}\0epoch\0${epoch}`,
      () => this.sampleRawFieldSubtopic<T>(rawField, effectiveToken),
    );
  }

  /**
   * Interpolating raw-topic read — the confirmed view is an
   * interpolation of buffered samples up to the confirmed edge — fills
   * the seam `ClientTimeline.straddle` left open (its own doc comment: "a
   * hold-last read (`at`) is what T2 consumers use; interpolation lands in
   * a later task").
   *
   * Deliberately NOT what `sample()`/`get` use for raw reads: some raw
   * topics (orbit ELEMENTS foremost) are a *cause* valid until superseded,
   * not a measured quantity — interpolating between two elements samples
   * straddling a maneuver would blend through physically nonsensical
   * intermediate orbits. `sample()` stays hold-last for exactly that
   * reason; this method is for MEASURED/discrete raw values where a
   * straight line between two buffered samples is an honest estimate in
   * between (the `vessel.flight` case — see
   * `vessel-state.ts`'s use of `getInterpolated` for the Loaded/measured
   * basis).
   *
   * Falls back to hold-last (`ClientTimeline.at`) whenever there's nothing
   * to straddle (fewer than two points, or `viewUt` is at-or-after the
   * latest point — the normal confirmed-live case, since the confirmed
   * edge is usually sample-clamped right at the newest sample) or the
   * bracketing payloads can't be honestly lerped (`lerpPayload` returns
   * `undefined` — mismatched shape, a non-numeric field that actually
   * differs, or either side is a tombstone) — never fabricates a value it
   * can't justify.
   *
   * A derived topic already computed its own record at the frozen
   * `viewUt` — propagation (or the channel's own basis-appropriate
   * handling) IS its past-horizon/interpolation story, so this falls
   * through to the ordinary derived read (`sample`) rather than
   * interpolating the OUTPUT record after the fact.
   */
  sampleInterpolated<T>(
    topic: string,
    token: FrameToken = this.currentToken,
  ): TimelinePoint<T> | undefined {
    const effectiveToken =
      token.generation === this.generation ? token : this.currentToken;

    if (this.resolveDerivedTopic(topic)) {
      return this.sample<T>(topic, effectiveToken);
    }

    // Same epoch-fold as `sample()`'s raw path above — a mid-token epoch
    // bump must invalidate this cache entry too,
    // rather than replaying a pre-bump interpolation for the rest of the
    // token's life.
    const epoch = this.clock.getEpoch();
    return this.memoize(
      effectiveToken,
      `\0interp\0${topic}\0epoch\0${epoch}`,
      () => {
        const timeline = this.timelineFor<T>(topic);
        if (timeline.epoch < epoch) return undefined;
        return interpolatedRead(timeline, effectiveToken.viewUt);
      },
    );
  }

  /**
   * The topic's `StreamStatusValue` at a frame token's frozen `viewUt` —
   * the staleness/absence surface, read alongside
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
      // Fold epoch into the key exactly like the derived-VALUE path in
      // sample(): a derived status must NOT survive a
      // mid-frame epoch bump (quickload rewind) for the rest of the frame, or
      // a status read and a value read for the same topic in the same frame
      // could disagree about which epoch they describe.
      const epoch = this.clock.getEpoch();
      return this.memoize(
        effectiveToken,
        `\0status\0${parentTopic}\0epoch\0${epoch}`,
        () => this.sampleDerivedStatus(resolved.def, effectiveToken),
      );
    }

    // Fold epoch into the raw-status key too:
    // a status memoized before a mid-frame epoch bump must not survive it, or
    // it would disagree with the (epoch-folded) value read for the same topic
    // and could report the dead timeline's status for the rest of the frame.
    const epoch = this.clock.getEpoch();
    const literalStatus = this.memoize(
      effectiveToken,
      `\0status\0${topic}\0epoch\0${epoch}`,
      () => this.sampleRawStatus(topic, effectiveToken),
    );
    // `"resyncing"` from the literal read means "no point ever recorded
    // under this exact topic string" (`sampleRawStatus`'s own first check) —
    // the same signal `sample()`'s literal-first fallback uses. Only then
    // try the raw record field-subtopic interpretation (mirrors
    // `sample()`'s matching branch): a field subtopic's status IS its real
    // parent raw topic's status outright, delegated by recursing straight
    // into this same method against `rawTopic` — that call hits the ordinary
    // raw-status branch directly (a 2-segment topic never itself splits
    // further) and memoizes there, so this delegation adds no extra caching
    // layer. A topic that genuinely IS its own literal raw topic (even a
    // 3+-segment one fed directly, same caveat as `sample()`'s doc) keeps
    // its own literal status once it has one.
    if (literalStatus !== "resyncing") return literalStatus;
    const rawField = this.resolveRawFieldSubtopic(topic);
    if (!rawField) return literalStatus;
    return this.sampleStatus(rawField.rawTopic, effectiveToken);
  }

  /**
   * Precedence, most to least authoritative (folding in
   * the transport-down short-circuit):
   *
   * 1. No point at all in the current epoch -> `"resyncing"`. Unaffected by
   *    transport status — a topic we've never heard from is "cold", not
   *    "disconnected"; there's no confirmed subject to report link-down
   *    against yet (mirrors `HeartbeatTracker.isOverdue`'s own "no arrival
   *    is not overdue" precedent).
   * 2. A tombstone (`payload: null`) -> `"absent"`, unconditionally — a
   *    confirmed subject-absence is a fact about the SUBJECT, never masked
   *    by transport-down (a fact about the LINK). The two axes are
   *    orthogonal: the client already confirmedly knows there
   *    is no value, and that doesn't stop being true just because the
   *    transport dropped a moment later.
   * 3. Server-stamped `meta.staleness` wins outright when present (a
   *    catch-up/late-joiner mark is authoritative — no client inference
   *    needed for it, and it out-ranks a live transport-down reading too:
   *    it's a stronger, already-settled claim about this specific point).
   * 4. Transport-down short-circuit: when
   *    `setTransportConnected(false)` is in effect, every topic with
   *    confirmed, non-tombstoned, non-server-stamped data reads
   *    `"disconnected"` immediately — not each independently waiting out its
   *    own heartbeat margin to notice the same one dead pipe.
   * 5. Otherwise the `HeartbeatTracker` (missed-keyframe inference, never
   *    `validAt` age) decides live vs. held-stale.
   *
   * `isOverdue` is keyed off `clock.certaintyHorizonUt()`, NOT
   * `token.viewUt`. The overdue
   * check is about a genuine gap in CONFIRMED arrivals, not about how far
   * the predicted-mode viewUt has raced ahead of the horizon on wall time
   * alone — in predicted mode `viewUt` is `utNowEstimate()`, which can run
   * arbitrarily far ahead of anything actually confirmed, and would falsely
   * flag a perfectly healthy topic as overdue purely because the display is
   * looking further into the future. The horizon only advances when
   * something real confirms elapsed UT (a delivered sample, on any topic),
   * which is exactly what "overdue" should track.
   */
  private sampleRawStatus(topic: string, token: FrameToken): StreamStatusValue {
    const point = this.sample(topic, token);
    if (!point) return "resyncing";
    if (point.payload === null) return "absent";
    if (point.meta.staleness === Staleness.LastBeforeBlackout) {
      return "last-before-blackout";
    }
    if (point.meta.staleness === Staleness.HeldStale) return "held-stale";
    if (!this.transportConnected) return "disconnected";
    return this.heartbeats.isOverdue(
      topic,
      this.clock.certaintyHorizonUt(),
      this.clock.confidence(),
    )
      ? "held-stale"
      : "live";
  }

  /**
   * A derived channel's own status: `def.deriveStatus` if it declared one
   * (quality-picked channels like `vessel.state` need this — see
   * `vessel-state.ts`), else the generic default of worst-of-every-declared-
   * input.
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
   * Splits a `"<domain>.<channel>.<field...>"` topic (3+ dot-segments) into
   * the REAL raw wire topic (always the first two segments — every raw
   * channel in this contract is `domain.channel`, e.g. `"time.warp"`,
   * `"vessel.flight"`, `"vessel.thermal"`) and the remaining segments as a
   * nested field path into that record's payload (see this file's
   * own doc comment on the `sample()` branch that calls this, and
   * `timeline-store-raw-fields.test.ts`). Cross-checked against every dotted
   * value in `map-topic.ts`'s `TELEMACHUS_CLEAN_HOMES`: a flat 3-segment
   * entry (`"vessel.orbit.sma"`) yields a 1-element field path; the one
   * 4-segment entry (`"vessel.thermal.hottestPart.skinTemp"`) yields a
   * 2-element path, walked in one nested lookup rather than a second round
   * of topic resolution.
   *
   * `undefined` for a topic with fewer than 3 segments — a 2-segment topic
   * (`"vessel.orbit"` itself) IS the real raw topic, not a field subtopic of
   * one; that case is left to the ordinary raw-literal path in `sample()`.
   * Never consulted for a topic `resolveDerivedTopic` already matched
   * (checked first at every call site) — a registered derived channel's own
   * `fields: true` subtopics keep using that mechanism unchanged.
   */
  private resolveRawFieldSubtopic(
    topic: string,
  ): { rawTopic: string; fieldPath: string[] } | undefined {
    const segments = topic.split(".");
    if (segments.length < 3) return undefined;
    return {
      rawTopic: `${segments[0]}.${segments[1]}`,
      fieldPath: segments.slice(2),
    };
  }

  /**
   * Reads `parsed.rawTopic` (a real raw topic — recurses through the ordinary
   * `sample()` path, including its own derived-channel/epoch/frame-coherence
   * handling) and walks `parsed.fieldPath` into its payload.
   *
   * Mirrors `sampleDerived`'s two "nothing" cases (never conflated):
   * no point on the parent at all yet -> `undefined` ("not whole
   * yet" — the raw topic's own not-arrived-yet case, propagated as-is,
   * intentionally NOT re-classified). A tombstoned parent (`payload: null`)
   * -> a real point with `payload: null` (a confirmed absence — the whole
   * record is gone, so every field of it is too). A field name not present
   * on an otherwise-whole, non-null record -> `undefined` (the phantom-
   * mapping case `TimelineStore.isUnresolvableField`'s doc describes for the
   * derived-channel analog; not extended to this raw path — every currently
   * shipped `TELEMACHUS_CLEAN_HOMES` raw-field entry has been checked against
   * the real wire fixture, so there is no known-dead mapping this needs to
   * catch yet).
   *
   * Reuses the parent point's own `meta`/`validAt`/`epoch` verbatim — unlike
   * a DERIVED channel (which fabricates its own `derivedMeta`), a raw field
   * subtopic isn't a new computation, it's the same measured/received record
   * narrowed to one field, so its staleness/quality/provenance genuinely ARE
   * the whole record's.
   */
  private sampleRawFieldSubtopic<T>(
    parsed: { rawTopic: string; fieldPath: string[] },
    token: FrameToken,
  ): TimelinePoint<T> | undefined {
    const parentPoint = this.sample<Record<string, unknown>>(
      parsed.rawTopic,
      token,
    );
    if (!parentPoint) return undefined; // not whole yet
    if (parentPoint.payload === null) {
      return {
        validAt: parentPoint.validAt,
        payload: null as T,
        meta: parentPoint.meta,
        epoch: parentPoint.epoch,
      };
    }

    let cursor: unknown = parentPoint.payload;
    for (const segment of parsed.fieldPath) {
      if (
        cursor === null ||
        typeof cursor !== "object" ||
        !(segment in (cursor as object))
      ) {
        return undefined; // unknown field — nothing to serve
      }
      cursor = (cursor as Record<string, unknown>)[segment];
    }

    return {
      validAt: parentPoint.validAt,
      payload: cursor as T,
      meta: parentPoint.meta,
      epoch: parentPoint.epoch,
    };
  }

  /**
   * Compute (or reuse the frame-memoized) value for a derived channel — the
   * SAME `memoize` seam raw `sample()` reads use, keyed by the channel's own
   * topic so N field-subtopic reads (`vessel.state.altitudeAsl`,
   * `vessel.state.orbitalSpeed`, ...) in one frame still call `derive` exactly
   * once (memoized to once per `(topic, frame)`). `get`
   * (passed to `derive`) is `sample` bound to this SAME `token` — the
   * structural single-view-time invariant: there is no other way for
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
        const getInterpolated: DerivedGet = (inputTopic) =>
          this.sampleInterpolated(inputTopic, token);
        return def.derive(get, token.viewUt, getInterpolated);
      },
    );

    if (value === undefined) {
      // Not whole yet — an input has no point at-or-before `viewUt` in the
      // current epoch (cold start, or resynchronizing after an epoch reset).
      // There is no point to serve at all here, NOT a
      // tombstone — propagates through field subtopics too, since there's
      // nothing to extract a field from yet.
      return undefined;
    }

    if (value === null) {
      // Confirmed absence (a required input was tombstoned, or the channel
      // itself returned null) — a real point, per the tombstone model:
      // `payload: null`.
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
   * deliberately generic so derived channels can reuse the same
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
