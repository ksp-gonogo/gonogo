import { type Meta, Quality, Staleness } from "../__generated__/contract";
import type { Transport } from "../api/transport";
import { PerfBudget } from "../perf/PerfBudget";
import type {
  ModelledField,
  ReckoningBasis,
  ReckoningDecline,
  StaleGrade,
  TopicModel,
} from "../reading";
import { reckonableInputSpelling, reckonableValuesOf } from "../reckonability";
import type { DerivedChannelDefinition, DerivedGet } from "../timeline";
import { isValue, value } from "../unit-system/value";
import { type Reading, type ReckonerFor, readingFrom } from "./client-reading";
import {
  ClientTimeline,
  type ClientTimelineOptions,
  type TimelinePoint,
} from "./client-timeline";
/**
 * The derived-channel authoring types moved to `@ksp-gonogo/sitrep-sdk` so an Uplink
 * can write a channel without importing this package. Re-exported here unchanged.
 */
import {
  HeartbeatTracker,
  type HeartbeatTrackerOptions,
} from "./heartbeat-tracker";
import { getProcessorValue } from "./processorEvaluator";
import type { Dep } from "./processors";
import {
  CORE_RECKONER_OWNER,
  getReckoner,
  getReckonerConflicts,
} from "./reckoners";
import type { StreamStatusValue } from "./stream-status";
import { worstStatus } from "./stream-status";
import type { Certainty, ViewClock } from "./view-clock";

export type { DerivedChannelDefinition, DerivedGet } from "../timeline";

/**
 * The frozen view-time token for one frame / read cycle, enforces the
 * "single-view-time invariant". There is deliberately no method
 * anywhere in this file that reads "the current time" and hands back a
 * fresh UT per call: every read goes through a `FrameToken`, and a token's
 * `viewUt` never changes after it's minted. That's what makes the
 * invariant structural rather than a convention callers have to remember.
 */
export interface FrameToken {
  readonly viewUt: number;
  /**
   * Internal validity marker, bumped by every `beginFrame()` call. Not
   * meant to be read by callers, it's what lets `sample()` detect a token
   * a caller cached across a frame boundary and fall back to the current
   * frame instead of honoring a frozen-in-the-past `viewUt` forever.
   */
  readonly generation: number;
  /**
   * Whether `viewUt` sits at-or-before the `ViewClock`'s certainty horizon
   * as of the moment this token was minted. Computed once
   * here: NOT recomputed against the live clock on each read, for the
   * same frame-coherence reason values are memoized per token: a mid-frame
   * `ingest` that nudges the horizon forward must not flip a read's
   * certainty mid-frame any more than it can flip its value. See
   * `TimelineStore.sampleCertainty`.
   */
  readonly certainty: Certainty;
}

export interface TimelineStoreOptions {
  timelineOptions?: ClientTimelineOptions;
  /** Options for the store's `HeartbeatTracker` (the keyframe-cadence heartbeat), per-topic keyframe intervals, staleness-margin tuning. */
  heartbeatOptions?: HeartbeatTrackerOptions;
  /**
   * Dynamic-namespace prefixes (each ending in `.`) whose topics are WHOLE raw
   * wire topics despite having 3+ dot-segments: the prefix counterpart to the
   * static `WHOLE_RAW_TOPICS_WITH_EXTRA_DOTS` exemption. A topic that
   * `startsWith` any of these resolves to its own identity in
   * `resolveRawFieldSubtopic` (and thus `resolveSubscriptionTopics`), instead of
   * being mis-split into a `<domain.channel>.<fieldPath>` parent that no channel
   * publishes. Injected (never hard-coded) so this mod-agnostic store names no
   * mod token: the app passes `DYNAMIC_CARRIED_TOPIC_PREFIXES`
   * (`default-carried-topics.ts`) for the Uplink per-(body,type) namespaces.
   */
  dynamicWholeTopicPrefixes?: readonly string[];
}

/**
 * Whether a model claiming `covered` has answered for a read of `fieldPath`.
 *
 * Segment-wise, never a string prefix: `relativePosition` must not answer for
 * `relativePositionError`, which is a different field that happens to start
 * with the same characters. `""` covers everything, being the payload root.
 */
function coversPath(covered: string, fieldPath: readonly string[]): boolean {
  if (covered === "") return true;
  const segments = covered.split(".");
  if (segments.length > fieldPath.length) return false;
  return segments.every((segment, i) => segment === fieldPath[i]);
}

/** Walk a dotted path into a modelled payload, the read half of `coversPath`. */
function walkFieldPath(value: unknown, fieldPath: readonly string[]): unknown {
  let cursor = value;
  for (const segment of fieldPath) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Synthetic envelope `Meta` stamped on a derived-channel read. Real staleness/quality propagation from inputs (derived channels ultimately should propagate the worst input staleness) is not yet implemented, this is intentionally minimal, just enough to satisfy the `Meta` shape every `TimelinePoint` carries. */
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
 * One instant a model answered for, and what answered. NEVER an observation:
 * see `TimelineStore.sampleReckonedTail`, which is the only thing that mints
 * one and hands it straight to the boundary that draws it.
 *
 * Not a `TimelinePoint`, on purpose. A `TimelinePoint` is what the craft sent,
 * it carries a `Meta` full of the wire's own claims about provenance and
 * staleness, and there is no honest thing to put in those fields for an instant
 * nothing arrived at. Substituting plausible ones is exactly how a projection
 * becomes indistinguishable from a reading.
 */
export interface ReckonedSample<T> {
  /** The UT the model answered FOR. */
  atUt: number;
  value: T;
  basis: ReckoningBasis;
}

/**
 * The most instants one reckoned tail may be sampled at.
 *
 * A RESOLUTION cap, never a horizon: exceeding it widens the stride so the tail
 * still reaches the view time, because shortening it instead would silently
 * draw a shorter horizon than the model actually claimed, which is the one
 * thing this cap must not be able to do.
 *
 * 48 draws a conic smoothly at any chart width this app renders, and bounds the
 * per-frame cost of replaying a channel's `derive` (a Kepler solve, for
 * `vessel.state`) at a few thousand a second across a dashboard's worth of
 * plotted series.
 */
const MAX_RECKONED_TAIL_SAMPLES = 48;

/**
 * How far apart to sample a reckoned tail: the cadence the observations
 * themselves were arriving at, widened if that would overrun the resolution
 * cap.
 *
 * Matching the observed cadence rather than picking a number is what keeps the
 * modelled run drawn at the same fidelity as the measured run beside it, so the
 * eye reads the change in STROKE rather than a change in how blocky the line
 * is. With fewer than two observations in the window there is no cadence to
 * match and the whole tail is one stride.
 */
function reckonedTailStep(
  inWindowUts: readonly number[],
  lastObservedUt: number,
  toUt: number,
): number {
  const span = toUt - lastObservedUt;
  const gaps: number[] = [];
  for (let i = 1; i < inWindowUts.length; i++) {
    gaps.push(inWindowUts[i] - inWindowUts[i - 1]);
  }
  gaps.sort((a, b) => a - b);
  // Median, not mean: one long pause inside the window is exactly the thing a
  // mean would let dominate the cadence of everything after it.
  const cadence = gaps.length > 0 ? gaps[gaps.length >> 1] : span;
  const floor = span / MAX_RECKONED_TAIL_SAMPLES;
  return Math.max(cadence > 0 ? cadence : span, floor);
}

/**
 * Replays of a derived channel's `derive` for a reckoned tail.
 *
 * Every one is provider-supplied compute on the frame path, the same as a
 * derived channel's own per-frame derivation, and there are up to
 * `MAX_RECKONED_TAIL_SAMPLES` of them per plotted series per frame. The cap
 * bounds one tail; this catches the case the cap cannot see, which is a
 * dashboard that has quietly acquired enough modelled traces to spend the frame
 * budget on arithmetic nobody measured. The tail is memoised per frame, so a
 * healthy dashboard of four modelled series sits near 6k/sec at 60fps.
 */
/**
 * What a tail walk needs, whichever registry the model came out of: when the
 * observations stop, the cadence they were arriving at, and one question the
 * walk can ask per instant.
 *
 * The two model registries answer that question completely differently (a
 * derived channel re-derives a record; a registered reckoner pulls a thunk),
 * and neither difference survives past here. Sharing the WALK rather than
 * duplicating it is what makes the horizon rule, the resolution cap and the
 * continuity rule one implementation instead of two that agree today.
 */
/**
 * A channel's reckoning claim as a path list, whichever way it was spelled.
 *
 * A bare basis is the record-wide claim and normalises to a single root entry,
 * which is what it has always meant. `undefined` stays `undefined`: declining is
 * a statement and must not become an empty list, which would read as "modelled,
 * nothing moved".
 */
function normaliseReckoningClaim(
  claim: ReckoningBasis | readonly ModelledField[] | undefined,
): readonly ModelledField[] | undefined {
  if (claim === undefined) return undefined;
  return typeof claim === "string" ? [{ path: "", basis: claim }] : claim;
}

interface ReckonedWalk {
  /** The newest instant an observation behind this topic exists for. */
  lastObservedUt: number;
  /** Every observed instant, unfiltered: the caller windows and sorts them. */
  inWindowUts: number[];
  /** The model's answer for one instant, or nothing where it declines. */
  answerAt(at: number): { value: unknown; basis: ReckoningBasis } | undefined;
}

const RECKONED_TAIL_BUDGET = new PerfBudget({
  name: "Reckoned tail derives/sec",
  threshold: 20_000,
  windowMs: 1000,
  unit: "derives",
});

/**
 * Field names that carry a DEGREE-valued angle where wrapping is physically
 * meaningful: e.g. `longitude` 179 -> -179 is a
 * 2-degree hop across the antimeridian, not a ~358-degree hop the other way
 * around the planet. Interpolated the SHORT way around the wrap in
 * `lerpFieldValue` below, instead of the naive straight-line lerp every
 * other numeric field gets. A small, explicit allowlist rather than a
 * heuristic (no name-sniffing for "looks like an angle"), extend this set
 * deliberately as more angular fields (heading, bearing) actually appear in
 * a payload.
 */
const ANGULAR_DEGREE_FIELD_NAMES: ReadonlySet<string> = new Set([
  "longitude",
  "heading",
  "bearing",
]);

/**
 * Field names that are numeric but not genuinely continuous, an index,
 * enum ordinal, or other discrete quantity where a fractional value is
 * physically meaningless: e.g.
 * `referenceBodyIndex` 1 -> 2 must never become `1.5`. Held at `before`
 * rather than fractionalized, mirroring how a non-numeric field that's
 * identical on both sides already passes through unchanged. Same
 * explicit-allowlist reasoning as `ANGULAR_DEGREE_FIELD_NAMES`: extend
 * deliberately, don't infer from naming conventions.
 */
const DISCRETE_NUMERIC_FIELD_NAMES: ReadonlySet<string> = new Set([
  "referenceBodyIndex",
]);

/**
 * Genuinely-whole raw wire topics that happen to have 3+ dot-segments,
 * the escape hatch for `resolveRawFieldSubtopic`'s "every raw channel is
 * `domain.channel`" assumption, which `system.uplink.pending`
 * (`ChannelEngine.UplinkPendingTopic`) breaks: it's a first-class topic in
 * its own right, not a `.pending` field of some `system.uplink` record (no
 * such record exists). Extend this set deliberately, same reasoning as
 * `ANGULAR_DEGREE_FIELD_NAMES` above: never infer from a topic's shape.
 */
const WHOLE_RAW_TOPICS_WITH_EXTRA_DOTS: ReadonlySet<string> = new Set([
  "system.uplink.pending",
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
  // A declared quantity arrives WRAPPED, so the numeric branch below would
  // never fire for it and every measured field would hold-last instead of
  // interpolating. Lerp the magnitudes and re-declare the unit: both samples
  // are the same field on the same topic, so their units agree by
  // construction.
  if (isValue(before) && isValue(after)) {
    const lerped = lerpFieldValue(key, before.magnitude, after.magnitude, t);
    return lerped === undefined
      ? undefined
      : { value: value(before.unit, lerped.value as number) };
  }
  if (typeof before === "number" && typeof after === "number") {
    if (DISCRETE_NUMERIC_FIELD_NAMES.has(key)) {
      return { value: before }; // hold-last; never fractionalize an index/ordinal
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
 * `[0, 1]`: the confirmed-range interpolation primitive.
 * Numeric payloads lerp directly. A plain (non-array, non-null) object
 * lerps field-by-field via `lerpFieldValue`: a genuinely continuous numeric
 * field lerps straight-line, an ANGULAR field (`ANGULAR_DEGREE_FIELD_NAMES`)
 * wraps the short way instead of blending through the far side of the
 * wrap, a DISCRETE numeric field (`DISCRETE_NUMERIC_FIELD_NAMES`) holds at
 * `before` rather than fractionalizing, a non-numeric field that is
 * IDENTICAL on both sides passes through unchanged (e.g. an unchanged
 * string/enum field), and a non-numeric field that actually DIFFERS makes
 * the whole interpolation refuse (`undefined`): there is no honest halfway
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
 * (never interpolate across an absence transition: the confirmed truth
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
 *   hook that reads at whatever `FrameToken`
 *   `currentFrame()` currently holds, it does NOT mint its own token per
 *   render, so two components rendering in the same frame see the same
 *   `viewUt` even if wall time ticks between their renders.
 * - **Imperative**: `sample(topic, token)` for a caller's own rAF loop
 *   (canvas widgets): pass the token from `currentFrame()` (or one you
 *   minted yourself with `beginFrame()`) explicitly.
 *
 * This is the foundation derived channels build on, along with staleness
 * consumption and confirmed-vs-predicted reads.
 * Derived-channel registration (`registerDerivedChannel`) is implemented
 * here: see `sample`/`sampleDerived` for how a derived topic is resolved
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
   * Per-`FrameToken` memoization cache, gives frame coherence: the same
   * `(token, topic)` read always returns the same result for that token's
   * lifetime. Keyed by token object identity via a `WeakMap` so it never
   * needs manual cleanup, once a token is no longer referenced anywhere
   * (including as `currentToken`), its cache entry is collected too. The
   * first `sample(topic, token)` read for a given `(token, topic)` pair is
   * authoritative for that token's whole lifetime; a mid-frame `ingest`
   * cannot flip it. Also the seam derived channels reuse instead of
   * building their own per-frame cache.
   */
  private readonly frameCache = new WeakMap<FrameToken, Map<string, unknown>>();

  /**
   * Last `Reading` per topic, with the inputs it was built from, so a reading's
   * identity tracks its DATA rather than the frame it was read in. Deliberately
   * NOT the frame cache, which is keyed on a token that changes every ingest
   * tick: see `sampleReading` for why that distinction is load-bearing.
   */
  private readonly readings = new Map<
    string,
    {
      point: TimelinePoint<unknown> | undefined;
      status: StreamStatusValue;
      epoch: number;
      /** The frame view time the reading was built for. Only a reckoning depends on it. */
      viewUt: number;
      /** Whether the topic was known unowned. Flips the arm with no other input changing. */
      unowned: boolean;
      /**
       * The decline that was on the reading, flattened to a comparable string.
       * Its own input, because it is a function of OTHER topics' data.
       */
      declineKey: string | undefined;
      reading: Reading<unknown>;
    }
  >();

  /**
   * Topics the mod answered a subscribe for with nothing, so nothing will ever
   * publish them. Fed by `TelemetryClient`, which owns the ack tracker that
   * decides it; the store only remembers the verdict and folds it into the arm.
   *
   * A `Set` of the exceptional case rather than a status per topic, because the
   * overwhelming majority of topics are owned and saying so costs nothing.
   */
  private readonly unownedTopics = new Set<string>();

  /** Missed-keyframe-heartbeat tracker backing `sampleStatus`'s client-inferred `"held-stale"`. */
  readonly heartbeats: HeartbeatTracker;

  /**
   * Whole-transport connectivity, fed by `setTransportConnected`/
   * `attachTransport` (the "transport-down short-circuit": see
   * `sampleRawStatus`). Defaults to `true` (connected) so a caller that never
   * wires this up sees today's pure per-topic heartbeat inference unchanged,
   * this is opt-in, so `TimelineStore` needs no direct `Transport`
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
   * one independently drift into `"held-stale"` on its own heartbeat margin;
   * see `sampleRawStatus` for the full precedence against server-stamped
   * staleness and a confirmed `"absent"` tombstone, both of which still win
   * outright over this.
   */
  setTransportConnected(connected: boolean): void {
    this.transportConnected = connected;
  }

  /**
   * Convenience wiring of `setTransportConnected` directly off a `Transport`
   * (or anything with the same `status`/`onStatusChange` shape, e.g. the one
   * `TelemetryClient` holds), seeds the current status immediately and
   * keeps it live via `onStatusChange`. Only `"connected"` counts as
   * connected; `"reconnecting"`/`"error"`/`"disconnected"` all collapse to
   * the same disconnected input: this layer only distinguishes "the
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
   * shared `ViewClock`. Does NOT advance the frame, ingest and frame
   * advance are independent (many samples can arrive within one frame; the
   * frame only advances on `beginFrame()`).
   *
   * Store-level epoch guard (avoids "the client ghost", a stale point
   * surviving a reconnect/epoch bump):
   * the store, not any individual `ClientTimeline`, is the epoch
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
      // Stale-epoch straggler by the store's authoritative epoch, refused,
      // not merely masked at read time.
      return;
    }

    if (point.epoch > priorEpoch) {
      // Rewind confirmed by THIS point: clear heartbeat history BEFORE
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
    // Every ingested sample: keyframe or change-emission alike, confirms
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
   * `sample(def.topic, token)`, and every reactive read built on it,
   * transparently returns the memoized derived
   * value instead of reading a raw `ClientTimeline`, callers never need to
   * know whether a topic is raw or derived ("raw-vs-derived
   * invisible" to consumers). If `def.fields` is set, `"<topic>.<field>"` subtopics are
   * resolved too (`resolveDerivedTopic`).
   *
   * Registering the same `topic` twice replaces the previous definition,
   * useful for hot-reload/test setup, not a guarded no-op.
   */
  registerDerivedChannel<T>(def: DerivedChannelDefinition<T>): void {
    this.derivedChannels.set(
      def.topic,
      def as DerivedChannelDefinition<unknown>,
    );
  }

  /**
   * Whether a channel is already registered for `topic`. Lets a caller adding
   * channels after construction leave an existing one alone, so a topic keeps
   * the model it was built with rather than the model whichever import landed
   * last.
   */
  hasDerivedChannel(topic: string): boolean {
    return this.derivedChannels.has(topic);
  }

  /**
   * Mint a new frozen `FrameToken` from the clock's current `viewUt()` and
   * make it `currentFrame()`'s value. Call once per animation frame / read
   * cycle (e.g. from `clock.onFrame` or a widget's own rAF loop); never
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

  /** The token minted by the most recent `beginFrame()` call. What every reactive read uses; never recomputed per read. */
  currentFrame(): FrameToken {
    return this.currentToken;
  }

  /**
   * The frame's certainty: `"confirmed"` when the token's
   * `viewUt` sat at-or-before the certainty horizon at the moment it was
   * minted, `"predicted"` past it. Rides alongside a value/status read for
   * the same topic and frame, never inside either (the `useKosScriptStatus`
   * pattern: `sample()` for the value, `sampleStatus()` for staleness/
   * absence, `sampleCertainty()` for this: three independent channels that
   * compose freely, e.g. a topic can be simultaneously `"predicted"` and
   * `"resyncing"`, or `"confirmed"` and `"held-stale"`). Mirrors `sample()`/
   * `sampleStatus()`'s stale-token fallback.
   */
  sampleCertainty(token: FrameToken = this.currentToken): Certainty {
    const effectiveToken =
      token.generation === this.generation ? token : this.currentToken;
    return effectiveToken.certainty;
  }

  /** Passthrough to the shared clock's certainty horizon, the first-class SDK value (`sdk.view.certaintyHorizonUt()`). */
  certaintyHorizonUt(): number {
    return this.clock.certaintyHorizonUt();
  }

  /**
   * The raw wire topics that must actually be subscribed (via
   * `TelemetryClient.subscribe`) to keep `topic` resolvable, the
   * derived-input ref-counting mechanism. A derived channel's own
   * topic (or one of its `"<topic>.<field>"` subtopics) is NEVER itself a
   * subscribable wire topic; no server channel produces it, so a caller
   * that naively subscribed to the derived topic NAME would never receive
   * any data and the channel would silently stay "not whole yet" forever.
   * This resolves `topic` down to the declared `inputs` it actually needs,
   * recursively (a derived channel's own `inputs` can themselves be derived,
   * per `DerivedGet`'s doc: `derive` can read another derived channel as an
   * input), de-duplicated, and defended against a malformed cyclical
   * declaration (an authoring bug, never expected in practice) via a
   * visited-set guard rather than an infinite loop.
   *
   * Identity (`[topic]`) for a topic that isn't derived at all, a genuinely
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
      // the literal dotted field string (`"time.warp.warpRate"`): nothing
      // publishes to the latter. See `resolveRawFieldSubtopic`/`sample()`'s
      // matching branch.
      const rawField = this.resolveRawFieldSubtopic(topic);
      out.add(rawField ? rawField.rawTopic : topic);
      return;
    }
    const parentTopic = resolved.def.topic;
    if (visiting.has(parentTopic)) return; // cyclical declaration, break, don't loop forever
    visiting.add(parentTopic);
    for (const input of resolved.def.inputs) {
      this.collectSubscriptionTopics(input, out, visiting);
    }
  }

  /**
   * True when `topic` names a `"<parent>.<field>"` subtopic whose PARENT
   * resolved to a whole, non-tombstoned derived record (the derivation
   * genuinely ran) but `field` is not a key on the record it produced, a
   * structurally dead mapping (e.g. a stale migration-table entry pointing
   * at a field a `derive()` function never emits), as opposed to ordinary
   * "not whole yet" loading (parent has no point at all yet) or a confirmed
   * absence (parent tombstoned): both of which return `false` here, same as
   * a healthy field that just hasn't arrived.
   *
   * `sample()` alone can't make this distinction: `sampleDerived`'s field
   * lookup collapses "unknown field name" and "not whole yet" onto the same
   * `undefined` return, deliberately (see its own doc comment). This is a
   * SEPARATE diagnostic read for a caller (the `@ksp-gonogo/core` `useDataValue`
   * compatibility shim: belt-and-suspenders
   * fallback safety) that needs to tell "still loading, keep waiting" apart
   * from "this can never resolve, fall back to another source"; never
   * folded into `sample()`'s own return value.
   *
   * This guard covers both DERIVED
   * channel parents and RAW record field-subtopics (`resolveRawFieldSubtopic`,
   * e.g. `"vessel.resources.resources.<name>.current"`). A raw fieldpath
   * that's wrong or has drifted would otherwise serve a permanent
   * `undefined` with no fallback (the FuelStatus-class
   * bug: `useTelemetry(vesselKey) ?? 0` turning a silent resolution
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
   * `true` when `topic` names a registered DERIVED channel, its own topic
   * or one of its `"<topic>.<field>"` subtopics (`resolveDerivedTopic`).
   * `false` for a raw topic, including a raw record field-subtopic
   * (`resolveRawFieldSubtopic`, e.g. `"vessel.orbit.sma"`), that string
   * LOOKS derived-shaped (it has dots) but resolves to a real wire record's
   * timeline, not a registered `derive()` function. What `sampleRange`
   * consults to decide "there's a stored history to range over" (a raw
   * topic always has one, a derived topic never does, it's a per-frame
   * computed value, see `sampleRange`'s own doc) versus `isUnresolvableField`
   * above, which asks a narrower question (a specific FIELD NAME on an
   * otherwise-whole derived record) for a different caller.
   */
  isDerivedTopic(topic: string): boolean {
    return this.resolveDerivedTopic(topic) !== undefined;
  }

  /**
   * Windowed range read for a raw topic (or raw record field-subtopic): the
   * backfill side of a historical series read, where `sample()` is the live
   * side. Mirrors `sample()`'s raw-topic / raw-field-subtopic resolution
   * (`resolveRawFieldSubtopic`, see `timeline-store-raw-fields.test.ts`) but
   * returns every buffered point in `[fromUt, toUt]` instead of one
   * hold-last read.
   *
   * Returns `undefined`, not an empty array, when `topic` resolves to a
   * registered DERIVED channel (`isDerivedTopic`): a derived value is
   * computed fresh per frame from whatever its inputs currently hold
   * (`sampleDerived`), never stored as its own buffered history, so there is
   * structurally nothing to range over. This is the caller's "give up,
   * permanently, on this topic" signal: distinct from an empty array,
   * which means "genuinely nothing landed in the window yet" and may fill
   * in on a later read as more samples arrive.
   *
   * For a literal raw topic, returns its `ClientTimeline.range` verbatim.
   * For a raw record field-subtopic, reads the PARENT raw topic's range and
   * extracts `fieldPath` from each point's payload: skipping (never
   * fabricating a value for) a tombstoned parent point or one whose payload
   * doesn't have the field, the same two "nothing to serve" cases
   * `sampleRawFieldSubtopic` treats identically for a single read.
   *
   * Bounded to the CURRENT epoch, exactly like `sample()`'s raw path, a
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
      if (point.payload === null) continue; // tombstone, nothing to extract
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
      if (!resolved) continue; // unknown field on this point, nothing to serve
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
   * Windowed series for a DERIVED topic: the counterpart to `sampleRange`
   * (which structurally can't serve one: a derived value is computed fresh
   * per frame, nothing is ever stored). Backs `@ksp-gonogo/data`'s
   * `useDataSeries` shim so a Graph-style widget plotting a `vessel.state.*`
   * (or other registered derived-channel) key gets a REAL series off the
   * stream instead of permanently falling back to the legacy
   * `BufferedDataSource`: see that hook's own doc comment for the "why".
   *
   * Replays `def.derive` at every UT any of its raw `inputs` actually
   * changed at within `[fromUt, toUt]` (a change-gated raw timeline only
   * ever carries a point when something changed, so this is exactly the set
   * of instants the derived value could have changed too), a synthetic
   * `get` built by hold-last lookup over each raw input's own buffered range
   * (queried from `-Infinity` through `toUt`, so an input that last changed
   * BEFORE `fromUt` still resolves correctly at the first in-window
   * instant; `ClientTimeline`'s own retention window bounds this, not an
   * unbounded scan). `getInterpolated` is passed the SAME hold-last `get`,
   * every currently-registered channel's `derive` defaults its own
   * `getInterpolated` parameter to `get` when omitted
   * (`deriveVesselState`'s own doc comment), so this matches live-frame
   * behavior for every channel that doesn't explicitly need lerp precision;
   * a channel that starts requiring true interpolation for a historical
   * replay would need this widened, not silently mismatch (tracked, not hit
   * by anything registered today).
   *
   * Declared `inputs` are assumed RAW (not another derived topic), true of
   * every channel in `PRODUCTION_DERIVED_CHANNELS` today, even though `get`
   * itself resolves derived-on-derived inputs transparently at the live-frame
   * layer (`sample()`'s own doc comment). A derived-on-derived input here
   * degrades to "no point at that instant" (`sampleRange` already returns
   * `undefined` for a derived topic, folded into an empty array below)
   * rather than recursing: safe, just sparser, and nothing registered
   * exercises it today.
   *
   * Returns `undefined` when `topic` doesn't resolve to a registered derived
   * channel at all (mirrors `sampleRange`'s contract): callers are expected
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
   * The part of a series NOBODY MEASURED: what the topic's own forward model
   * says the quantity did between the last observation and `toUt`.
   *
   * `sampleDerivedRange` above emits a point only where a declared INPUT
   * changed, which is exactly right for history and is why a chart of a
   * modelled quantity simply stopped at the last thing that arrived. During a
   * blackout no input changes, so the trace ended and said nothing about
   * whether the value was knowable. This is the other half: it asks the topic's
   * model for instants that had no observation behind them, and stamps each one
   * with the basis the model claimed for it.
   *
   * Both model registries are consulted, in the order `sampleReading` walks
   * them: the model registered for the topic, then a field read borrowing its
   * record's model, then a derived channel's `deriveReckoning`. A series
   * producer that knew about only one would be a chart that draws core's models
   * and silently drops an author's, which is the asymmetry an extension point is
   * least able to report.
   *
   * ## Deliberately not a `TimelinePoint`, and deliberately not merged in
   *
   * A reckoned instant is a presentation-time projection, so it must never be
   * reachable as an observation. Keeping it in its own return type and its own
   * method is what makes that structural rather than a convention: nothing
   * stores one, the mission-history replay reaches for `sampleDerivedRange` and
   * never this, and a recording exported later cannot contain one. The one
   * caller that wants both halves joins them at the boundary that draws them,
   * and says which indices came from here.
   *
   * ## The horizon is the MODEL's, and it is asked at every instant
   *
   * There is no cutoff here and no window constant, for the same reason
   * `Reading` carries no horizon field: a model withdraws by declining, and the
   * absence of an answer IS the statement of trust. The difference a series
   * makes is that the question gets asked once per instant instead of once per
   * frame, so a horizon inside the window is expressible at all. The walk stops
   * at the first instant `deriveReckoning` declines: a model gets worse with
   * age and never better, so a decline is the end of the tail rather than a
   * hole in it.
   *
   * `getStatus` answers for the CURRENT frame, and that is the honest answer
   * for every instant here rather than an approximation: the whole tail is the
   * one stretch of silence that follows the last observation, and a stretch of
   * silence has one status.
   *
   * ## Only a continuous number gets a tail
   *
   * A model that moves a flag, a mode name or a vector may be perfectly honest
   * at a point and still have nothing a LINE can say: joining two states of an
   * enum draws a slope through values that do not exist. So a tail is emitted
   * only for a finite `number`, which excludes booleans, strings, vectors and
   * whole records by construction. A numeric enum would pass this test and is
   * the one shape to keep out of a plotted key by hand.
   *
   * Returns an empty array for a topic with no derived channel, no
   * `deriveReckoning`, or nothing yet observed, which are all the same answer
   * to the caller: there is no tail to draw.
   */
  sampleReckonedTail<T>(
    topic: string,
    fromUt: number,
    toUt: number,
  ): ReckonedSample<T>[] {
    const epoch = this.clock.getEpoch();
    return this.memoize(
      this.currentToken,
      `\0reckontail\0${topic}\0${fromUt}\0epoch\0${epoch}`,
      () => this.computeReckonedTail<T>(topic, fromUt, toUt),
    );
  }

  private computeReckonedTail<T>(
    topic: string,
    fromUt: number,
    toUt: number,
  ): ReckonedSample<T>[] {
    /*
     * The registered model first, then the derived channel's, which is
     * `sampleReading`'s order and was not this method's until the two were
     * reconciled. A Topic carrying both used to serve one model to a point read
     * and the other to a plotted tail of the same quantity, in one widget, with
     * nothing anywhere able to report it.
     */
    const walk =
      this.rawReckonedWalk(topic, fromUt, toUt) ??
      this.derivedReckonedWalk(topic, toUt);
    // Nothing observed, or the newest observation IS the view time: either way
    // there is no interval for a model to have carried anything across.
    if (!walk || walk.lastObservedUt >= toUt) return [];

    const inWindow = [...new Set(walk.inWindowUts)]
      .filter((ut) => ut >= fromUt && ut <= toUt)
      .sort((a, b) => a - b);
    const step = reckonedTailStep(inWindow, walk.lastObservedUt, toUt);
    const out: ReckonedSample<T>[] = [];
    for (let ut = walk.lastObservedUt + step; ; ut += step) {
      /*
       * The last stride lands on `toUt` exactly rather than short of it: the
       * right-hand end of the tail is the frame's own view time, and stopping a
       * fraction of a step early would leave a gap between the model and the
       * moment the whole frame is drawn for.
       */
      const at = ut >= toUt - step * 0.5 ? toUt : ut;
      RECKONED_TAIL_BUDGET.record();
      const answer = walk.answerAt(at);
      if (!answer) break; // the model's own horizon
      const raw = answer.value;
      if (typeof raw !== "number" || !Number.isFinite(raw)) break;
      out.push({ atUt: at, value: raw as T, basis: answer.basis });
      if (at >= toUt) break;
    }
    return out;
  }

  /**
   * A derived channel's tail: `derive` replayed at an instant nothing arrived
   * at, labelled by the same `deriveReckoning` the point layer asks.
   *
   * The hold-last `get` is `sampleDerivedRange`'s. The input ranges are read
   * once for the whole walk rather than per instant, because every instant in a
   * tail resolves to the same last input point by construction.
   */
  private derivedReckonedWalk(
    topic: string,
    toUt: number,
  ): ReckonedWalk | undefined {
    const resolved = this.resolveDerivedTopic(topic);
    const deriveReckoning = resolved?.def.deriveReckoning;
    if (!resolved || !deriveReckoning) return undefined;
    const { def, field } = resolved;

    const inputRanges = new Map<string, TimelinePoint<unknown>[]>();
    const inWindowUts: number[] = [];
    let lastObservedUt: number | undefined;
    for (const inputTopic of def.inputs) {
      const points =
        this.sampleRange<unknown>(inputTopic, -Infinity, toUt) ?? [];
      inputRanges.set(inputTopic, points);
      for (const point of points) {
        if (lastObservedUt === undefined || point.validAt > lastObservedUt) {
          lastObservedUt = point.validAt;
        }
        inWindowUts.push(point.validAt);
      }
    }
    if (lastObservedUt === undefined) return undefined;

    const getAt =
      (at: number): DerivedGet =>
      <I>(inputTopic: string): TimelinePoint<I> | undefined => {
        const points = inputRanges.get(inputTopic);
        if (!points || points.length === 0) return undefined;
        let last: TimelinePoint<unknown> | undefined;
        for (const point of points) {
          if (point.validAt <= at) last = point;
          else break;
        }
        return last as TimelinePoint<I> | undefined;
      };

    return {
      lastObservedUt,
      inWindowUts,
      answerAt: (at) => {
        const get = getAt(at);
        const claim = deriveReckoning(get, at, (inputTopic) =>
          this.sampleStatus(inputTopic),
        );
        if (claim === undefined) return undefined;
        /*
         * A bare basis is the record-wide claim and every field borrows it,
         * which is what it has always meant. A LIST has to name the path, and a
         * root entry does not name it: `vessel.state` is the case in hand, its
         * conic moves the position and carries `twr` verbatim off a propulsion
         * sample nothing propagated, and a dashed TWR trace stamped
         * `kepler-propagation` would attribute a number to a model that never
         * touched it.
         */
        const basis =
          typeof claim === "string"
            ? claim
            : claim.find((entry) => entry.path === (field ?? ""))?.basis;
        if (!basis) return undefined;
        const record = def.derive(get, at, get);
        if (record == null) return undefined; // not whole, or confirmed absent
        const value = field
          ? (record as Record<string, unknown>)[field]
          : (record as unknown);
        return { value, basis };
      },
    };
  }

  /**
   * A raw topic's tail, off the model an Uplink registered for it.
   *
   * The same ladder `sampleReading` walks, minus the derived rung the caller
   * has already tried: a whole-topic reckoner, or a field read borrowing its
   * record's model. Wired because a registration seam that reaches the point
   * layer and stops there is a half-built extension point, and an author whose
   * model draws a propagated marker on the map but leaves a plot of the same
   * quantity ending mid-window has nothing to tell them that is by design.
   *
   * The model is re-asked at every instant rather than resolved once and pulled
   * repeatedly, which is the only way its horizon is expressible at all:
   * `TopicModel` has no failure return by design, so a model withdraws by not
   * being OFFERED, and offering is what the reckoner call is.
   *
   * Root coverage is required for the same reason `readingFrom` requires it: a
   * model that moves one field of forty-seven has not answered for the value
   * this read asked about. For a field subtopic `fieldScopedReckoner` has
   * already narrowed, and the root it claims is the narrowed value's.
   */
  private rawReckonedWalk(
    topic: string,
    fromUt: number,
    toUt: number,
  ): ReckonedWalk | undefined {
    const token = this.currentToken;
    const reckoner =
      this.registeredReckonerFn<unknown>(topic, token) ??
      this.fieldScopedReckoner<unknown>(topic, token);
    if (!reckoner) return undefined;
    const point = this.sample<unknown>(topic, token);
    if (!point || point.payload === null) return undefined;
    const status = this.sampleStatus(topic, token);
    /*
     * The three statuses that are not a missed update. A tail FILLS a silence,
     * and there is no silence in any of them, so there is nothing to draw.
     *
     * This deliberately no longer matches `readingFrom`, which does consult a
     * reckoner on a live reading: a POINT reading asks "is this quantity
     * forward-modelled", which a conic answers yes to whether or not the last
     * packet was late, while a tail asks "what happened during the gap", which
     * has no answer when there was no gap. The two questions diverged when
     * reckonability came off the staleness discriminant, and the divergence is
     * the correct outcome rather than an oversight.
     */
    if (status === "live" || status === "resyncing" || status === "absent") {
      return undefined;
    }
    const observed = this.sampleRange<unknown>(topic, fromUt, toUt) ?? [];
    return {
      lastObservedUt: point.validAt,
      inWindowUts: observed.map((p) => p.validAt),
      answerAt: (at) => {
        const model = reckoner(point, status, at);
        const root = model?.modelled.find((entry) => entry.path === "");
        if (!model || !root) return undefined;
        return { value: model.reckon(at), basis: root.basis };
      },
    };
  }

  /**
   * Imperative tier: read `topic` at a frame token's frozen `viewUt`
   * (defaults to `currentFrame()`: there is no per-read "now").
   *
   * Three behaviours combine here:
   * - **Stale-token fallback**: a `token` from a superseded frame (its
   *   `generation` doesn't match the store's current one, e.g. a caller
   *   cached a token across a `beginFrame()` boundary) is not honored;
   *   the read is routed to `currentFrame()` instead.
   * - **Store-level epoch guard**: if `topic`'s timeline is
   *   still sitting on an epoch lower than the shared clock's, it's treated
   *   as cold (`undefined`) rather than serving its dead-epoch data, this
   *   is what actually closes the cross-topic ghost even in the split
   *   second before `ingest`'s proactive sweep has touched it, and for a
   *   timeline that gets lazily created (via `timelineFor`) after a rewind.
   * - **Frame-coherent memoization**: the first read of a given
   *   `(topic, token)` pair is authoritative for that token's whole
   *   lifetime, so a mid-frame `ingest` can't flip the answer mid-read-cycle
   *   (tearing): the change only surfaces once a new `beginFrame()` mints a
   *   new token. **Except across an epoch bump**:
   *   the memo key folds in `clock.getEpoch()`, same as the derived-topic
   *   path below, so a mid-token quickload rewind is a cache miss rather
   *   than a replayed pre-bump ghost: including to a derived channel's
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
      // subtopic): this is what gives a re-read within the same frame back
      // the identical `TimelinePoint` object (referential stability for
      // React bail-out, mirroring the raw-topic path below), on top of the
      // inner memoize inside `sampleDerived` that keeps `derive` itself
      // running only once per frame regardless of how many field subtopics
      // of the same parent are read.
      //
      // The key folds in the CURRENT epoch, memos must die
      // by epoch: unlike the frame-coherent raw-topic path below (which
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

    // Folds in the CURRENT epoch: exactly like the derived-topic key above,
    // guarding against the same class of stale-epoch ghost. Without this, the
    // first read of a given (token, topic) pair is authoritative for the
    // token's whole lifetime (frame-coherence, intentional for an
    // ordinary mid-frame ingest): but a mid-frame EPOCH BUMP is not an
    // ordinary ingest: it's a quickload rewind that the store's cross-topic
    // sweep (`ingest`) already propagates to every `ClientTimeline`
    // immediately. An unkeyed cache would keep replaying the pre-bump
    // `TimelinePoint` object for the rest of the token's life, including to
    // any derived channel's `get()` that reads this same topic through this
    // same token: defeating the epoch guard below and the sweep that just
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

    // Raw record field-subtopic fallback, which is what the retired flat key
    // vocabulary used to depend on and what a dotted read still uses:
    // `topic` is a `"<domain>.<channel>.<field...>"` string with no
    // registered-derived-channel match: e.g. `"time.warp.warpRate"`. No
    // wire message is EVER published to that literal string; the real wire
    // topic is `"time.warp"`, a whole record `{ warpRate, warpRateIndex,
    // warpMode, paused }`. See `resolveRawFieldSubtopic`'s own doc for the
    // "first two segments are the real topic" rule this relies on.
    //
    // Deliberately tried SECOND, only once the literal read above came back
    // `undefined`: never first. A topic string that genuinely IS a raw
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
   * Interpolating raw-topic read, the confirmed view is an
   * interpolation of buffered samples up to the confirmed edge, fills
   * the seam `ClientTimeline.straddle` left open (its own doc comment: "a
   * hold-last read (`at`) is what T2 consumers use; interpolation lands in
   * a later task").
   *
   * Deliberately NOT what `sample()`/`get` use for raw reads: some raw
   * topics (orbit ELEMENTS foremost) are a *cause* valid until superseded,
   * not a measured quantity: interpolating between two elements samples
   * straddling a maneuver would blend through physically nonsensical
   * intermediate orbits. `sample()` stays hold-last for exactly that
   * reason; this method is for MEASURED/discrete raw values where a
   * straight line between two buffered samples is an honest estimate in
   * between (the `vessel.flight` case: see
   * `vessel-state.ts`'s use of `getInterpolated` for the Loaded/measured
   * basis).
   *
   * Falls back to hold-last (`ClientTimeline.at`) whenever there's nothing
   * to straddle (fewer than two points, or `viewUt` is at-or-after the
   * latest point: the normal confirmed-live case, since the confirmed
   * edge is usually sample-clamped right at the newest sample) or the
   * bracketing payloads can't be honestly lerped (`lerpPayload` returns
   * `undefined`: mismatched shape, a non-numeric field that actually
   * differs, or either side is a tombstone); never fabricates a value it
   * can't justify.
   *
   * A derived topic already computed its own record at the frozen
   * `viewUt`: propagation (or the channel's own basis-appropriate
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

    // Same epoch-fold as `sample()`'s raw path above. A mid-token epoch bump
    // must invalidate this cache entry too, rather than replaying a pre-bump
    // interpolation for the rest of the token's life.
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
   * The parent record's model, scoped to one field subtopic.
   *
   * A model is per TOPIC because physics needs siblings (Kepler wants eight
   * elements at once, dead reckoning a position AND a velocity), and its
   * expression is per FIELD because a payload is not one reckoning class:
   * `vessel.target` carries relative geometry that propagates beside identity
   * fields only a command changes beside metadata. Registration is therefore
   * keyed on the record, and a field read borrows the record's model and asks
   * whether it covers that path, which is the same parent-delegation
   * `sample()` and `sampleStatus()` already do for value and status.
   *
   * The model is handed the PARENT's point, not the narrowed field point: a
   * dead-reckoner given `{x, y, z}` alone cannot see the velocity it needs.
   * Only the result is narrowed.
   */
  private fieldScopedReckoner<T>(
    topic: string,
    token: FrameToken,
  ): ReckonerFor<T> | undefined {
    const parsed = this.resolveRawFieldSubtopic(topic);
    if (!parsed) return undefined;
    const parentReckoner = this.registeredReckonerFn<unknown>(
      parsed.rawTopic,
      token,
    );
    if (!parentReckoner) return undefined;
    return (_point, grade, viewUt) => {
      const parentPoint = this.sample<unknown>(parsed.rawTopic, token);
      if (!parentPoint || parentPoint.payload === null) return undefined;
      const model = parentReckoner(
        parentPoint as TimelinePoint<unknown>,
        grade,
        viewUt,
      );
      const covering = model?.modelled.find((entry) =>
        coversPath(entry.path, parsed.fieldPath),
      );
      if (!model || !covering) return undefined;
      return {
        // From this read's point of view the whole (narrowed) value is
        // modelled, so the root is what it claims.
        modelled: [{ path: "", basis: covering.basis }],
        reckon: (at) => walkFieldPath(model.reckon(at), parsed.fieldPath) as T,
      };
    };
  }

  /**
   * A derived channel's `deriveReckoning` as a `ReckonerFor`, so a channel that
   * forward-models its record says so through the same arm a registered
   * reckoner does.
   *
   * The model here is the IDENTITY, and that is the correct answer rather than
   * a shortcut: `derive` already ran for this frame's view time, so the value
   * on the point IS the reckoning. What was missing was never arithmetic, only
   * the statement that arithmetic had happened. Consulted only when no
   * reckoner is registered for the topic, so a channel's own label never
   * silently overrides one an Uplink registered.
   */
  private derivedReckoner<T>(
    topic: string,
    token: FrameToken,
  ): ReckonerFor<T> | undefined {
    const resolved = this.resolveDerivedTopic(topic);
    const deriveReckoning = resolved?.def.deriveReckoning;
    if (!deriveReckoning) return undefined;
    return (point, _grade, viewUt) => {
      // A tombstoned record never carries a model (`readingFrom` ranks `absent`
      // above every staleness grade and above the reckoning question), so this
      // only narrows the payload type. There is no modelled value for a
      // confirmed absence.
      const modelledValue = point.payload;
      if (modelledValue === null) return undefined;
      const get: DerivedGet = (inputTopic) => this.sample(inputTopic, token);
      const claim = deriveReckoning(get, viewUt, (inputTopic) =>
        this.sampleStatus(inputTopic, token),
      );
      // A channel naming paths still answers a whole-topic read through its
      // root entry, and a field read still borrows the record's model exactly
      // as it borrows a bare basis: `readingFrom` only asks whether the ROOT is
      // covered, and from a field read's point of view the narrowed value IS
      // the root. The per-path detail is for a caller that has to know which
      // fields moved, which is the series producer and nothing else yet.
      const modelled = normaliseReckoningClaim(claim);
      if (!modelled) return undefined;
      const root = modelled.find((entry) => entry.path === "");
      if (!root) return undefined;
      return {
        modelled: [{ path: "", basis: root.basis }],
        reckon: () => modelledValue,
      };
    };
  }

  /**
   * One step of a declared input's dotted path, or `undefined` when the payload
   * does not carry it. `null` counts as carried-and-absent, `false` and `0` do
   * not: `frameRotating` is a declared input whose whole job is to be `false`
   * most of the time.
   */
  private static walkPath(payload: unknown, path: string): unknown {
    let current = payload;
    for (const segment of path.split(".")) {
      if (current === null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  /**
   * The decline for a declared input that did not arrive, named the way the
   * CONTRACT names it.
   *
   * A reckoner declares its inputs in `Dep` notation and the contract declares
   * them as `relativeVelocity` / `@vessel.orbit` / `@vessel.orbit#mu`. Where the
   * two name the same Topic the contract's spelling wins, so the string a widget
   * renders and the string the mark carries are the same string; a dep the
   * contract does not name falls back to the same `@topic` shape rather than to
   * a second convention.
   */
  private static absentInput(topic: string, dep: Dep): ReckoningDecline {
    if (typeof dep !== "string") {
      return {
        reason: "input-absent",
        input: "reading" in dep ? `@${dep.reading}` : dep.id,
      };
    }
    const declared = reckonableValuesOf(topic)
      .flatMap((row) => row.inputs)
      .find((input) => input.topic === dep);
    return {
      reason: "input-absent",
      input: declared ? reckonableInputSpelling(declared) : `@${dep}`,
    };
  }

  /**
   * One declared input, resolved for the frame the model is running for.
   *
   * The notation is a Processor's `Dep`, unchanged, because a reckoner's inputs
   * are the same kind of thing and a second spelling would be two vocabularies
   * to keep in step. The RESOLUTION differs in one place and deliberately: a
   * Topic id gives the `TimelinePoint`, not the bare payload a processor gets,
   * because a forward model withdraws on facts that live on the envelope
   * (`meta.quality` is what tells the conic the craft is under physics) and a
   * payload-only resolution would hide them behind an `undefined` the model
   * could not tell from an absent channel.
   */
  private resolveReckonerDep(dep: Dep, token: FrameToken): unknown {
    if (typeof dep === "string") return this.sample<unknown>(dep, token);
    if ("reading" in dep)
      return this.sampleReading<unknown>(dep.reading, token);
    return getProcessorValue(dep.id);
  }

  /**
   * A registered model for `topic` with its inputs already resolved, the reason
   * nothing ran, or `undefined` when nobody has registered one.
   *
   * The three answers are distinct and the caller needs all three: a model to
   * offer, a refusal to render, or nothing at all, which is what lets the
   * remaining ladder rungs (a derived channel's label, a field read borrowing
   * its record's model) still be tried.
   *
   * ## A declared input that did not arrive declines BEFORE the model runs
   *
   * That is the whole point of declaring them. A model that reached for whatever
   * it liked could not be told from one whose inputs never came: both answer
   * nothing, and a caller sees a silent absence on a value the contract promised
   * was carriable. So a `deps` entry resolving to nothing is a decline the store
   * builds, naming the input the way the CONTRACT spells it where the contract
   * names it at all, and the model is never asked a question it cannot answer.
   *
   * A `ReadingDep` never resolves to nothing (`sampleReading` always answers,
   * `pending` included), so declaring one is a way to say "hand me this Topic's
   * currency and let me judge it" rather than "refuse without it".
   */
  private registeredReckoning<T>(
    topic: string,
    token: FrameToken,
    point: TimelinePoint<T> | undefined,
    grade: StaleGrade | undefined,
    viewUt: number,
  ):
    | { readonly owner: string; readonly model: TopicModel<T, unknown> }
    | { readonly declined: ReckoningDecline }
    | undefined {
    const elected = getReckoner(topic);
    if (!elected) return undefined;
    if (!point || point.payload === null) return undefined;
    const resolved: unknown[] = [];
    for (const dep of elected.definition.deps) {
      const value = this.resolveReckonerDep(dep, token);
      if (value === undefined) {
        return { declined: TimelineStore.absentInput(topic, dep) };
      }
      resolved.push(value);
    }
    const answer = elected.definition.reckon(point, resolved, {
      grade,
      viewUt,
    });
    if ("declined" in answer) return { declined: answer.declined };
    return { owner: elected.owner, model: answer };
  }

  /**
   * The elected registration as a plain `ReckonerFor`, for the two paths that
   * want a model and have no use for the reason it was withheld: a field read
   * borrowing its record's model, and a plotted tail re-asking at every instant.
   * `sampleReading` calls {@link registeredReckoning} directly, because the
   * reason and the owner are exactly what a reading carries.
   */
  private registeredReckonerFn<T>(
    topic: string,
    token: FrameToken,
  ): ReckonerFor<T> | undefined {
    if (!getReckoner(topic)) return undefined;
    return (point, grade, viewUt) => {
      const answer = this.registeredReckoning<T>(
        topic,
        token,
        point,
        grade,
        viewUt,
      );
      return answer && "model" in answer
        ? (answer.model as TopicModel<T>)
        : undefined;
    };
  }

  /**
   * The first declared input `topic` is missing this frame, spelled the way the
   * contract spells it, or `undefined` when every one of them is here (and when
   * the contract declares nothing about the topic at all).
   *
   * Walks every marked value's inputs rather than only the one a caller asked
   * about, because a reading is whole-topic: the projection carries every marked
   * field, so a model that cannot produce one of them cannot fill the arm.
   */
  private missingDeclaredInput(
    topic: string,
    token: FrameToken,
  ): ReckoningDecline | undefined {
    const declared = reckonableValuesOf(topic);
    if (declared.length === 0) return undefined;
    const own = this.sample<unknown>(topic, token);
    for (const declaredValue of declared) {
      for (const input of declaredValue.inputs) {
        const payload =
          input.topic === ""
            ? own?.payload
            : this.sample<unknown>(input.topic, token)?.payload;
        const reached =
          payload === undefined || payload === null
            ? undefined
            : input.path === ""
              ? payload
              : TimelineStore.walkPath(payload, input.path);
        if (reached === undefined || reached === null) {
          return {
            reason: "input-absent",
            input: reckonableInputSpelling(input),
          };
        }
      }
    }
    return undefined;
  }

  /**
   * Why the declared model did not answer for `topic` this frame, or `undefined`
   * when the contract declares nothing about it.
   *
   * Only asked when no model was on offer, which for a DECLARED topic is a
   * specific refusal rather than the honest default it is elsewhere: the mark is
   * a promise that the wire carries the model's inputs, so if nothing answered,
   * either an input did not arrive, two owners are contesting the topic, or no
   * model is registered to run at all. Naming which beats a silent absence, and
   * the name is the contract's own spelling of the input so the string a widget
   * renders is the string the contract carries.
   */
  private declineFor(
    topic: string,
    token: FrameToken,
  ): ReckoningDecline | undefined {
    if (reckonableValuesOf(topic).length === 0) return undefined;

    if (getReckonerConflicts().some((conflict) => conflict.topic === topic)) {
      return {
        reason: "contested",
        note: "two owners registered a model for this topic, so neither is served",
      };
    }

    const missing = this.missingDeclaredInput(topic, token);
    if (missing) return missing;

    // Every declared input is here and nothing ran. Core registers a vanilla for
    // every marked Topic, so reaching this means core's reckoner module was
    // never imported: a build that dropped it, or a test that cleared the
    // registry. Saying so beats presenting as a missing input, which would send
    // a reader looking at the wire.
    return {
      reason: "model-inapplicable",
      note: "no model is registered for this topic",
    };
  }

  /**
   * The topic's value AND its currency as one `Reading<T>`, at a frame token's
   * frozen `viewUt`: `sample()` and `sampleStatus()` folded into the union a
   * widget cannot read incuriously. See `Reading`'s own doc for the mechanism.
   *
   * **Identity tracks the DATA, not the frame**, and that is load-bearing
   * rather than an optimisation. `useTelemetry` hands the result straight to
   * `useSyncExternalStore`, which compares snapshots with `Object.is`. The
   * per-frame `memoize` cache alone is not enough here: `beginFrame()` mints a
   * new `FrameToken` on every ingest tick, so a token-keyed entry is a fresh
   * object per frame by construction, and every widget reading telemetry would
   * re-render at frame cadence forever whether or not anything arrived. It
   * would also hand a fresh `reckon` thunk identity to every consumer's
   * dependency arrays on every frame.
   *
   * `sample()` and `sampleStatus()` do not need this because a payload's
   * identity is its own and a status is a string; a union is a WRAPPER, so it
   * has to be told. The last reading per topic is therefore kept and returned
   * again while the sampled point's identity, the status and the epoch are all
   * unchanged. Frame memoization still sits on top, so repeat reads within one
   * frame never re-derive.
   *
   * `reading-identity.test.ts` is the guard.
   */
  sampleReading<T>(
    topic: string,
    token: FrameToken = this.currentToken,
  ): Reading<T> {
    const effectiveToken =
      token.generation === this.generation ? token : this.currentToken;
    // Epoch-folded like every sibling read: a reading memoized before a
    // mid-frame epoch bump (quickload rewind) must not survive it.
    const epoch = this.clock.getEpoch();
    return this.memoize(
      effectiveToken,
      `\0reading\0${topic}\0epoch\0${epoch}`,
      () => {
        const point = this.sample<T>(topic, effectiveToken);
        const status = this.sampleStatus(topic, effectiveToken);
        const viewUt = effectiveToken.viewUt;
        /*
         * The registered model is asked FIRST and its answer is final, decline
         * included. Falling through to a derived channel's label after a
         * registered model declined would serve a second model for one topic
         * and hand two answers to one widget, which is the disagreement keeping
         * the two ladders in the same order exists to prevent.
         */
        const registered =
          // The arms `readingFrom` builds without ever consulting a model:
          // nothing to carry (resyncing), and a confirmed absence, which outranks
          // every staleness grade. Asking anyway would run a solve per frame
          // through a resync and throw the answer away.
          status === "resyncing" || status === "absent"
            ? undefined
            : this.registeredReckoning<T>(
                topic,
                effectiveToken,
                point,
                status === "live" ? undefined : (status as StaleGrade),
                viewUt,
              );
        const reckonedModel =
          registered && "model" in registered ? registered.model : undefined;
        const reckoner: ReckonerFor<T> | undefined = reckonedModel
          ? () => reckonedModel as TopicModel<T>
          : registered
            ? undefined
            : (this.derivedReckoner<T>(topic, effectiveToken) ??
              this.fieldScopedReckoner<T>(topic, effectiveToken));
        const owner =
          registered && "owner" in registered
            ? registered.owner
            : CORE_RECKONER_OWNER;
        const unowned = this.unownedTopics.has(topic);
        // Built only where the CONTRACT declared a value reckonable. An
        // undeclared topic has nothing to explain, and its reading is typed
        // `Reading`, which has no `declined` member on any arm, so a reason
        // attached there is one no caller can reach.
        //
        // The check is on the whole expression rather than on the `declineFor`
        // branch alone. A registered reckoner declines too, and a reckoner is
        // registered by topic STRING with no mark involved, so an Uplink may
        // have one on any topic at all.
        const declined =
          reckonableValuesOf(topic).length === 0
            ? undefined
            : registered && "declined" in registered
              ? registered.declined
              : reckoner
                ? undefined
                : this.declineFor(topic, effectiveToken);
        const declineKey = declined
          ? `${declined.reason}\0${declined.input ?? ""}`
          : undefined;
        const previous = this.readings.get(topic);
        if (
          previous !== undefined &&
          previous.point === point &&
          previous.status === status &&
          previous.epoch === epoch &&
          previous.unowned === unowned &&
          // A decline names a published input that did not arrive, so it moves
          // when a DIFFERENT topic's data does. Folding it into the identity
          // check is what stops a reading freezing on "no orbit yet" through the
          // frame the orbit lands on.
          previous.declineKey === declineKey &&
          // A reading depends on the frame's view time ONLY through a
          // reckoning, so a topic nobody models keeps its identity across a
          // frame exactly as before. Where a model is on offer now, an
          // advancing view time is a real input change: the modelled value is
          // for a different moment. Where one was on offer for the FROZEN
          // reading and is not now, the withdrawal is itself the change, and
          // reusing that reading is what made `Reading`'s "it withdraws by not
          // being offered on the next frame" untrue.
          ((reckoner === undefined && previous.reading.reckoning === "none") ||
            previous.viewUt === viewUt)
        ) {
          return previous.reading as Reading<T>;
        }
        const reading = declined
          ? readingFrom(
              point,
              status,
              viewUt,
              reckoner,
              unowned,
              declined,
              owner,
            )
          : readingFrom(
              point,
              status,
              viewUt,
              reckoner,
              unowned,
              undefined,
              owner,
            );
        this.readings.set(topic, {
          point,
          status,
          epoch,
          viewUt,
          unowned,
          declineKey,
          reading: reading as Reading<unknown>,
        });
        return reading as Reading<T>;
      },
    );
  }

  /**
   * The topic's `StreamStatusValue` at a frame token's frozen `viewUt`,
   * the staleness/absence surface, read alongside
   * `sample()` never inside it. Mirrors `sample()`'s stale-token fallback
   * and frame-coherent memoization exactly (same generation check, the same
   * per-`(token, key)` cache) so a status read and a value read for the
   * same topic in the same frame always agree about which frame they
   * describe. Field subtopics (`"<topic>.<field>"`) share their parent
   * derived channel's status outright: a field is just one slice of the
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
      // sample(). A derived status must NOT survive a mid-frame epoch bump
      // (quickload rewind) for the rest of the frame, or a status read and a
      // value read for the same topic in the same frame could disagree about
      // which epoch they describe.
      const epoch = this.clock.getEpoch();
      return this.memoize(
        effectiveToken,
        `\0status\0${parentTopic}\0epoch\0${epoch}`,
        () => this.sampleDerivedStatus(resolved.def, effectiveToken),
      );
    }

    // Fold epoch into the raw-status key too. A status memoized before a
    // mid-frame epoch bump must not survive it, or it would disagree with the
    // (epoch-folded) value read for the same topic and could report the dead
    // timeline's status for the rest of the frame.
    const epoch = this.clock.getEpoch();
    const literalStatus = this.memoize(
      effectiveToken,
      `\0status\0${topic}\0epoch\0${epoch}`,
      () => this.sampleRawStatus(topic, effectiveToken),
    );
    // `"resyncing"` from the literal read means "no point ever recorded
    // under this exact topic string" (`sampleRawStatus`'s own first check),
    // the same signal `sample()`'s literal-first fallback uses. Only then
    // try the raw record field-subtopic interpretation (mirrors
    // `sample()`'s matching branch): a field subtopic's status IS its real
    // parent raw topic's status outright, delegated by recursing straight
    // into this same method against `rawTopic`, that call hits the ordinary
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
   *    transport status: a topic we've never heard from is "cold", not
   *    "disconnected"; there's no confirmed subject to report link-down
   *    against yet (mirrors `HeartbeatTracker.isOverdue`'s own "no arrival
   *    is not overdue" precedent).
   * 2. A tombstone (`payload: null`) -> `"absent"`, unconditionally, a
   *    confirmed subject-absence is a fact about the SUBJECT, never masked
   *    by transport-down (a fact about the LINK). The two axes are
   *    orthogonal: the client already confirmedly knows there
   *    is no value, and that doesn't stop being true just because the
   *    transport dropped a moment later.
   * 3. Server-stamped `meta.staleness` wins outright when present (a
   *    catch-up/late-joiner mark is authoritative, no client inference
   *    needed for it, and it out-ranks a live transport-down reading too:
   *    it's a stronger, already-settled claim about this specific point).
   * 4. Transport-down short-circuit: when
   *    `setTransportConnected(false)` is in effect, every topic with
   *    confirmed, non-tombstoned, non-server-stamped data reads
   *    `"disconnected"` immediately: not each independently waiting out its
   *    own heartbeat margin to notice the same one dead pipe.
   * 5. Otherwise the `HeartbeatTracker` (missed-keyframe inference, never
   *    `validAt` age) decides live vs. held-stale.
   *
   * `isOverdue` is keyed off `clock.certaintyHorizonUt()`, NOT
   * `token.viewUt`. The overdue
   * check is about a genuine gap in CONFIRMED arrivals, not about how far
   * the predicted-mode viewUt has raced ahead of the horizon on wall time
   * alone: in predicted mode `viewUt` is `utNowEstimate()`, which can run
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
    if (point.meta.staleness === Staleness.Recorded) return "recorded";
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
   * (quality-picked channels like `vessel.state` need this; see
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
   * the REAL raw wire topic (always the first two segments, every raw
   * channel in this contract is `domain.channel`, e.g. `"time.warp"`,
   * `"vessel.flight"`, `"vessel.thermal"`) and the remaining segments as a
   * nested field path into that record's payload (see this file's
   * own doc comment on the `sample()` branch that calls this, and
   * `timeline-store-raw-fields.test.ts`). The shapes were cross-checked
   * against every dotted key the retired flat vocabulary carried: a
   * 3-segment key (`"vessel.orbit.sma"`) yields a 1-element field path; the
   * one 4-segment key (`"vessel.thermal.hottestPart.skinTemp"`) yields a
   * 2-element path, walked in one nested lookup rather than a second round
   * of topic resolution.
   *
   * `undefined` for a topic with fewer than 3 segments, a 2-segment topic
   * (`"vessel.orbit"` itself) IS the real raw topic, not a field subtopic of
   * one; that case is left to the ordinary raw-literal path in `sample()`.
   * Also `undefined` for `WHOLE_RAW_TOPICS_WITH_EXTRA_DOTS`: the "every raw
   * channel is domain.channel" assumption above isn't universal: ChannelEngine
   * declares a handful of genuinely-3-segment TOPICS (not field-subtopics of
   * a 2-segment parent), e.g. `system.uplink.pending`
   * (`ChannelEngine.UplinkPendingTopic`): there is no `system.uplink`
   * record for `.pending` to be a field of. Without this exemption,
   * `collectSubscriptionTopics` would resolve a `useStream` subscription for
   * `"system.uplink.pending"` down to the non-existent `"system.uplink"`,
   * silently starving the subscription on both the stub and a real
   * transport (matches `stub-transport.ts`'s "only delivers once
   * subscribed" gating: the exact symptom that surfaced this).
   * Never consulted for a topic `resolveDerivedTopic` already matched
   * (checked first at every call site): a registered derived channel's own
   * `fields: true` subtopics keep using that mechanism unchanged.
   */
  private resolveRawFieldSubtopic(
    topic: string,
  ): { rawTopic: string; fieldPath: string[] } | undefined {
    if (WHOLE_RAW_TOPICS_WITH_EXTRA_DOTS.has(topic)) return undefined;
    // Dynamic-namespace whole topics (e.g. a per-(body,type) `<ns>.<sub>.<body>.<bit>`):
    // the prefix counterpart to the exact exemption above. A topic under an
    // injected `dynamicWholeTopicPrefixes` entry IS its own raw wire topic, not a
    // `<domain.channel>.<fieldPath>` split: resolving it as a field-subtopic
    // would subscribe/sample a 2-segment parent no channel publishes.
    if (
      this.options.dynamicWholeTopicPrefixes?.some((p) => topic.startsWith(p))
    ) {
      return undefined;
    }
    const segments = topic.split(".");
    if (segments.length < 3) return undefined;
    return {
      rawTopic: `${segments[0]}.${segments[1]}`,
      fieldPath: segments.slice(2),
    };
  }

  /**
   * Reads `parsed.rawTopic` (a real raw topic, recurses through the ordinary
   * `sample()` path, including its own derived-channel/epoch/frame-coherence
   * handling) and walks `parsed.fieldPath` into its payload.
   *
   * Mirrors `sampleDerived`'s two "nothing" cases (never conflated):
   * no point on the parent at all yet -> `undefined` ("not whole
   * yet": the raw topic's own not-arrived-yet case, propagated as-is,
   * intentionally NOT re-classified). A tombstoned parent (`payload: null`)
   * -> a real point with `payload: null` (a confirmed absence, the whole
   * record is gone, so every field of it is too). A field name not present
   * on an otherwise-whole, non-null record -> `undefined` (the phantom-
   * mapping case `TimelineStore.isUnresolvableField`'s doc describes for the
   * derived-channel analog; not extended to this raw path, every raw-field
   * key that vocabulary shipped was checked against the real wire fixture
   * before it was retired, so there is no known-dead mapping this needs to
   * catch yet).
   *
   * Reuses the parent point's own `meta`/`validAt`/`epoch` verbatim, unlike
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
        return undefined; // unknown field: nothing to serve
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
   * Compute (or reuse the frame-memoized) value for a derived channel, the
   * SAME `memoize` seam raw `sample()` reads use, keyed by the channel's own
   * topic so N field-subtopic reads (`vessel.state.altitudeAsl`,
   * `vessel.state.orbitalSpeed`, ...) in one frame still call `derive` exactly
   * once (memoized to once per `(topic, frame)`). `get`
   * (passed to `derive`) is `sample` bound to this SAME `token`, the
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
    // never collide with a real topic string), the OUTER `memoize` call in
    // `sample()` also uses `def.topic` as its key when the parent topic
    // (not a field subtopic) is what's requested, so sharing the same key
    // here would let that outer wrapped `TimelinePoint` clobber this raw
    // derive() value in the shared per-token cache. Also folds in `epoch`
    // (see `sample()`'s matching comment): this is the memo that actually
    // calls `derive`, so it's the one that must recompute on a mid-frame
    // epoch bump; the outer memoize in `sample()` only needs a matching key
    // so it doesn't short-circuit before ever reaching this one.
    const { value, observedAt } = this.memoize(
      token,
      `\0derived\0${def.topic}\0epoch\0${epoch}`,
      () => {
        // The oldest input this record actually CONSUMED, which is how current
        // it really is. Stamping `token.viewUt` made every derived read report
        // an age of zero, so `vessel.state` twenty minutes into a blackout
        // looked exactly as fresh as one reporting now. Tracked here rather
        // than declared per channel because `get`/`getInterpolated` are the
        // only way in and the store owns them: a channel cannot forget to say
        // what it read, and quality-picking channels that consult a subset of
        // their declared `inputs` come out right without special-casing.
        //
        // A hold-last `get` pulls this back to the input's own `validAt`; an
        // interpolated read is genuinely a value FOR the view time and carries
        // `validAt: viewUt`, so it never pulls it back. That is the honest
        // difference between the two, and the min is what expresses it.
        let oldest = Number.POSITIVE_INFINITY;
        const note = <V>(
          point: TimelinePoint<V> | undefined,
        ): TimelinePoint<V> | undefined => {
          if (point) oldest = Math.min(oldest, point.validAt);
          return point;
        };
        const get: DerivedGet = (inputTopic) =>
          note(this.sample(inputTopic, token));
        const getInterpolated: DerivedGet = (inputTopic) =>
          note(this.sampleInterpolated(inputTopic, token));
        return {
          value: def.derive(get, token.viewUt, getInterpolated),
          // Nothing read (a channel deriving from constants) is as current as
          // the frame; nothing can be older than the moment being asked about.
          observedAt: Number.isFinite(oldest)
            ? Math.min(oldest, token.viewUt)
            : token.viewUt,
        };
      },
    );

    if (value === undefined) {
      // Not whole yet: an input has no point at-or-before `viewUt` in the
      // current epoch (cold start, or resynchronizing after an epoch reset).
      // There is no point to serve at all here, NOT a
      // tombstone: propagates through field subtopics too, since there's
      // nothing to extract a field from yet.
      return undefined;
    }

    if (value === null) {
      // Confirmed absence, a required input tombstoned or the channel itself returning null: a real point carrying `payload: null`, per the tombstone model.
      return {
        validAt: observedAt,
        payload: null as T,
        meta: derivedMeta(observedAt, epoch),
        epoch,
      };
    }

    if (field && !(field in (value as object))) return undefined; // unknown field name, nothing to serve

    const payload = field
      ? ((value as Record<string, unknown>)[field] as T)
      : (value as T);

    return {
      validAt: observedAt,
      payload,
      meta: derivedMeta(observedAt, epoch),
      epoch,
    };
  }

  /**
   * Frame-coherent memoized read: the first `compute()` for a given
   * `(token, key)` pair wins for that token's lifetime; subsequent calls
   * return the cached result even if the underlying data changes in
   * between. Private for now, exposed indirectly via `sample()`, but
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

  /**
   * Record that nothing will ever publish `topic`, so its reading is `unowned`
   * rather than a `pending` that will never resolve.
   *
   * Notifies frame listeners directly rather than waiting for the next
   * `beginFrame()`: the verdict arrives on a timer, not on a sample, and a
   * dashboard with no live data has no reason to be minting frames. Without
   * this the widget that most needs telling would be the last to hear.
   */
  markTopicUnowned(topic: string): void {
    if (this.unownedTopics.has(topic)) return;
    this.unownedTopics.add(topic);
    // The reading's other inputs are unchanged, so the identity cache would
    // hand back the `pending` arm it built before the verdict.
    this.readings.delete(topic);
    for (const listener of this.frameListeners) listener();
  }

  /**
   * Forget every ownership verdict. The link dropped, so nothing is decided any
   * more: the next connection is a new mod session and has to answer again.
   */
  clearTopicOwnership(): void {
    if (this.unownedTopics.size === 0) return;
    for (const topic of this.unownedTopics) this.readings.delete(topic);
    this.unownedTopics.clear();
    for (const listener of this.frameListeners) listener();
  }

  /** Whether the mod answered a subscribe for `topic` with nothing. */
  isTopicUnowned(topic: string): boolean {
    return this.unownedTopics.has(topic);
  }

  /** Notified once per `beginFrame()` call: backs the reactive tier's `useSyncExternalStore` subscription. */
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
