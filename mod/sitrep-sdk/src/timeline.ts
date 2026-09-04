import type { Meta } from "./__generated__/contract";
import type { StreamStatusValue } from "./api/types";
import type { ModelledField, ReckoningBasis } from "./reading";

/**
 * The derived-channel authoring contract.
 *
 * An Uplink contributes derived channels: it declares a topic, the inputs it reads,
 * and a pure `derive` that answers for one view time. Writing one means naming a
 * `TimelinePoint`, a `StreamStatusValue` and a `DerivedGet`, so all three belong on
 * the surface a third-party author actually has.
 *
 * They lived in `@ksp-gonogo/sitrep-client` until the Uplink isolation rule made the
 * consequence visible: a bundled Uplink contributes a resource-projection channel
 * and could only do it by importing app-internal types, which is precisely the thing
 * an outside author cannot do. Nothing here needs the store; it is the
 * vocabulary for talking to it, and the store itself stays app-side.
 */

/**
 * One point on a topic's `ClientTimeline`.
 *
 * `payload: null` is a tombstone (absence-as-data), a
 * confirmed "there is no value", distinct from `undefined` (never received).
 * `meta` is kept whole (not just the payload) because quality-picking,
 * subject-provenance guarding (`sameSubject`, later task), and staleness all
 * need fields beyond the value itself.
 *
 * `epoch` is the client-side timeline-reset generation this point was
 * ingested under (mirrors `meta.timelineEpoch`, copied in verbatim by
 * whoever constructs the point: `ClientTimeline.append` trusts it, it does
 * not re-derive it from `meta`).
 */
export interface TimelinePoint<T = unknown> {
  validAt: number;
  payload: T | null;
  meta: Meta;
  epoch: number;
}

/**
 * What a `derive()` function reads inputs through, enforces the
 * "single-view-time invariant". Deliberately NOT `(topic) => value`, it
 * returns the whole `TimelinePoint` (so `derive` can read `meta.quality`/
 * `meta.source` for quality-picking and subject-provenance, per
 * `vessel-state.ts`'s `deriveVesselState`), and it is always bound to one
 * frame's frozen `viewUt` by `TimelineStore.sample`/`sampleDerived`: there
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
   * to `TelemetryClient`'s subscribe machinery, not yet done); recorded
   * here as the channel's own documentation of its dependencies, and
   * reserved for that wiring.
   */
  inputs: string[];
  /**
   * Pure function: same `(get, viewUt)` inputs must produce the same output,
   * always (the replay/scrub contract). Two distinct
   * "nothing" results: never conflate them:
   * - Return `undefined` when an input has no point at-or-before `viewUt`
   *   yet in the current epoch: "not whole yet" (cold start, or
   *   resynchronizing after an epoch reset until the first post-reset
   *   keyframe lands per input). `sample()`/`sampleDerived` propagate
   *   this as "no point at all", never a fabricated tombstone.
   * - Return `null` for a confirmed absence (a tombstoned input, or the
   *   channel's own subject genuinely gone): never a fabricated
   *   zero-valued record.
   *
   * `getInterpolated` is `get`'s sibling for MEASURED
   * raw inputs: it lerps between the two buffered points straddling
   * `viewUt` instead of holding the latest one (`ClientTimeline.straddle`'s
   * seam, per that method's own doc comment: "interpolation lands in a
   * later task"). Use `get` for a CAUSE valid until superseded (orbit
   * elements: interpolating between two elements samples straddling a
   * maneuver would blend through physically nonsensical intermediate
   * orbits) and `getInterpolated` for a measurement where the straight line
   * between two samples is an honest estimate in between (`vessel.flight`'s
   * Loaded-basis fields: see `vessel-state.ts`). Falls back to hold-last
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
   * one memoized record: e.g. `vessel.state.altitudeAsl`.
   * Field names are resolved dynamically off whatever `derive` returns, so
   * no static field list is needed here.
   */
  fields?: boolean;
  /**
   * Optional override for this channel's own `StreamStatusValue` (derived
   * channels propagate the worst input staleness into their own status
   * by default). `getStatus(topic)` resolves an input topic's own
   * status: recursively, through the same `sampleStatus` machinery, for a
   * derived-on-derived input. `get`/`viewUt` are the SAME arguments
   * `derive` receives, for channels (like `vessel.state`) whose
   * quality-picking means not every declared `input` is actually consulted
   * for a given record: only override this when the default would be
   * wrong (e.g. penalizing a channel for an input it never even read).
   *
   * When omitted, the default is `worstStatus(inputs.map(getStatus))`, the
   * worst status across every declared input, unconditionally.
   */
  deriveStatus?: (
    getStatus: (topic: string) => StreamStatusValue,
    get: DerivedGet,
    viewUt: number,
  ) => StreamStatusValue;
  /**
   * Whether this record is FORWARD-MODELLED for `viewUt` rather than merely
   * carried from the last observation, and on what basis. Returning a basis
   * promotes a missed-update reading from `stale` to `reckonable`; returning
   * `undefined` leaves it `stale`.
   *
   * A derived channel is where class-A propagation actually lives, and it got
   * there before `Reading` existed: `deriveVesselState` calls
   * `trySolve(elements, viewUt)` with no staleness gate, so `vessel.state`
   * under `Quality.OnRails` has always served a position solved for the
   * frame's view time. `Reading` then labelled it `stale`, whose own doc says
   * its value is "the last REAL observation, never a modelled value". This is
   * the label that was missing, not a second model.
   *
   * Note what a class-A reckoning does NOT do: arithmetic. Kepler elements are
   * constant under two-body motion, `epoch` is epoch-referenced, and the
   * contract carries elements rather than position for exactly that reason. So
   * propagating them is the identity, the position derivation already ran
   * inside `derive`, and all that was ever missing was the statement that it
   * had. The horizon is real all the same: a conic holds until a burn or an
   * unmodelled SOI change, and declining is how a channel says so.
   *
   * ## A basis answers for the record; a LIST answers per field
   *
   * A bare `ReckoningBasis` is the record-wide claim, and it is what every
   * channel written before this returned. It stays exactly as strong as it was:
   * every field of the record borrows it.
   *
   * A `ModelledField[]` names the PATHS the model actually moves, in
   * `Reckoning.modelled`'s own vocabulary, and it exists because a payload is
   * not one reckoning class. `vessel.state` under a conic solves position,
   * velocity and both apsis countdowns from the elements at `viewUt`, and
   * carries `twr` verbatim off a `vessel.propulsion` sample nothing propagated.
   * A whole-record claim covers both, which is right for a readout showing one
   * number beside its age and wrong for a CHART: a line is a claim about every
   * instant it passes through, so `sampleReckonedTail` asks for a path named
   * explicitly and draws nothing for a field the model merely carried.
   *
   * Include a root entry (`path: ""`) where the record as a whole is
   * forward-modelled: that is what a whole-topic read needs to reach the
   * `reckonable` arm at all, and a field read still borrows it exactly as it
   * borrows a bare basis.
   */
  deriveReckoning?: (
    get: DerivedGet,
    viewUt: number,
    getStatus: (topic: string) => StreamStatusValue,
  ) => ReckoningBasis | readonly ModelledField[] | undefined;
}
