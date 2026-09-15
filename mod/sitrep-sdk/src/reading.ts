import type { Dep, ProcessorHandle, ReadingDep } from "./spine/processors";
import type { TimelinePoint } from "./timeline";
import type { TopicId, TopicPayload } from "./topics";
import { isUnit } from "./unit-system/guards";
import type { Value } from "./unit-system/value";

/**
 * What a telemetry read answers with, and how a widget may use it.
 *
 * This lives in the SDK rather than app-side because the Uplink devkit's
 * `useTelemetry` answers with a `Reading`, and the SDK sits below
 * `@ksp-gonogo/sitrep-client` in the dependency graph: the client depends on the
 * SDK, never the reverse. Exactly one bundled Uplink imports only through the
 * surface a third party actually has (this SDK plus ui-kit), and it is the one that
 * broke when this file's signature lied: an Uplink that also reaches app-internal
 * packages cannot feel a lie in this layer. That client is the canary for the devkit
 * contract.
 *
 * Everything here is consumer-side and total over the union: the type, its
 * reckoning types, the accessors, declining a reckoning, and measuring an age. A
 * third-party author needs all of it to USE a reading. What stays in the client is
 * the producer half, which needs the timeline and the store: minting a reading from
 * a stored point, and the reckoner registry.
 */

/**
 * Which model produced a reckoning.
 *
 * A closed union rather than a string, so adding a basis is a DECLARATION
 * rather than a spelling. An operator calibrates their trust in a propagated
 * number against what produced it, and a free-form string lets two providers
 * describe the same model differently (or misdescribe it) with nothing to
 * notice. Add a member here, with a line saying what it assumes and therefore
 * where it stops being true.
 *
 * - `kepler-propagation`: a two-body propagation of an orbital state. Honest
 *   for as long as the conic holds, which is until a burn, an SOI change or a
 *   perturbation the propagator does not model
 * - `linear-dead-reckoning`: position advanced by its last observed velocity.
 *   First-order only, so it is honest for seconds where the true motion is
 *   curved (any orbiting pair) and longer where it is not
 * - `rate-integration`: a quantity advanced by its last observed rate of
 *   change. Honest while the rate holds, which for a consumable means until
 *   something switches a converter, a light or a crew member
 * - `combination`: arithmetic over several readings resolved against ONE view
 *   time. The odd member, and it is worth saying why rather than leaving a
 *   reader to assume it propagates anything: it carries nothing forward. The
 *   other three answer "how did this number get from its observation to now";
 *   this one answers "how did this number come to exist at all", and the
 *   forward step, where there was one, happened inside each input under its
 *   own basis. So it is honest exactly as far as its inputs are, and no
 *   further: read {@link combineReadings} for the currency rule, and the
 *   inputs themselves for what actually propagated
 */
export type ReckoningBasis =
  | "combination"
  | "kepler-propagation"
  | "linear-dead-reckoning"
  | "rate-integration";

/**
 * A forward-modelled value: what a provider's model says the quantity is NOW,
 * given the last real observation and however long ago it was.
 *
 * `atUt` is the UT the reckoning is FOR, not the UT the observation behind it
 * was made at (`Reading`'s `asOfUt` carries that). Both are needed: an operator
 * reads a modelled figure against how far it has been carried.
 */
export interface TopicReckoningAvailable<T> {
  /**
   * The discriminant, spelled the same way {@link Reckoning}'s is so a caller
   * asks one question of a topic and of a field.
   */
  readonly status: "available";
  value: T;
  atUt: Value<"ut">;
  basis: ReckoningBasis;
  /**
   * Which paths inside `value` the model actually MOVED, dotted from the
   * payload root. Everything not named here is a verbatim copy of the last
   * observation, carried along because `value` is the whole payload.
   *
   * It exists because a payload is not one reckoning class. `vessel.target`
   * flattens to forty-seven field paths: relative geometry that propagates,
   * identity fields only a command changes, two absolute UTs, and metadata.
   * A model that dead-reckons the relative position and copies the rest would
   * otherwise stamp `basis: "linear-dead-reckoning"` on the vessel's NAME,
   * which is a modelled label over a stale observation: the failure this type
   * exists to prevent, committed by the mechanism meant to prevent it.
   *
   * `basis` above stays, and is the basis of the entry covering the root. A
   * whole-topic read only reaches `reckoning: "available"` when the model covers
   * the root (see `TopicModel`), so it is always well defined on a reckoning a
   * caller can hold.
   */
  modelled: readonly ModelledField[];
  /**
   * Which registered owner's model produced this. `"core"` for the vanilla
   * every installed client ships.
   *
   * Reckonability is STATIC (the contract declares it), so the question a
   * runtime answer has to settle is not whether a value can be carried forward
   * but WHICH model carried it. That is the same question
   * `vessel.maneuver.planner` already answers by naming its winner, and naming
   * it is what lets an operator tell core's conic from an Uplink's without
   * reading the numbers and guessing.
   */
  owner: string;
  /**
   * How well the model knows what it just said, per path, where it is prepared
   * to say. Absent from most reckonings and that is the honest majority.
   *
   * Keyed the same way `modelled` names paths, so the two line up without a
   * join: `modelled` says a path moved and by which model, `bands` says how
   * far that model would defend the number. See {@link ReckonedBands}.
   */
  readonly bands?: ReckonedBands;
}

/**
 * What a whole-topic read can say about a model: it ran, nothing offered one,
 * or one was declared and refused to answer for this frame.
 *
 * Per PATH rather than per value, because a topic genuinely has many fields and
 * one model rarely moves all of them: `modelled` names the paths it moved and
 * `bands` says how far it would defend each. That is the ONE difference from
 * {@link Reckoning}, which answers for a single value and therefore needs
 * neither map. The discriminant is the same word on both, so a caller asks
 * `status` of a topic exactly as they ask it of a field.
 *
 * `"declined"` is only reachable on a topic whose contract DECLARES a value
 * reckonable: see {@link ReckoningDecline} for why a refusal there has to say
 * which input failed it, where an undeclared topic's `"none"` explains nothing
 * because nothing promised it a model.
 */
export type TopicReckoning<T> =
  | TopicReckoningAvailable<T>
  | { readonly status: "none" }
  | { readonly status: "declined"; readonly declined: ReckoningDecline };

/**
 * The arms a DECLARED value's topic reading may carry: it answered, or it said
 * why it could not. Never the silent `"none"`.
 *
 * The declaration is a promise that the wire carries the model's inputs, so on
 * a value-bearing arm there is no such thing as nothing-to-say. Dropping
 * `"none"` here is what makes that promise a compile-time fact rather than a
 * convention.
 */
export type DeclaredTopicReckoning<T> = Exclude<
  TopicReckoning<T>,
  { readonly status: "none" }
>;

/** One path a model moved, and what moved it. See {@link TopicReckoningAvailable.modelled}. */
export interface ModelledField {
  /** Dotted from the payload root. `""` is the whole payload. */
  readonly path: string;
  readonly basis: ReckoningBasis;
}

/**
 * What an {@link UncertaintyBand}'s two ends CLAIM.
 *
 * A hard bound and a one-sigma estimate are different statements about the
 * same two numbers, and without this field two producers would mean different
 * things by an identical interval with nothing able to notice. A consumer
 * comparing a band against a threshold is entitled to a different answer for
 * each: crossing a hard bound is impossible, crossing one sigma happens about
 * a third of the time.
 *
 * - `bound`: the model asserts the true value is INSIDE `[lo, hi]`. Only
 *   honest where the model's error is genuinely capped (a quantisation, an
 *   interval arithmetic, an integrator with a proven residual)
 * - `sigma1`: one standard deviation either side of `value`. The true value is
 *   outside it roughly a third of the time, and a widget must not draw or
 *   phrase it as a limit
 */
export type BandKind = "bound" | "sigma1";

/**
 * How well a model knows the number it just produced: an ASYMMETRIC interval
 * in the value's own unit.
 *
 * ## In the unit, never a percentage
 *
 * A percentage dies at a zero crossing, and reckoned quantities cross zero
 * constantly: vertical speed at apoapsis, relative position at closest
 * approach, a rendezvous drift rate as it nulls. "±5%" of zero is zero, so the
 * band would collapse to nothing at exactly the instant an operator most needs
 * it. Absolute bounds also compose with the unit algebra, so `hi.minus(lo)` is
 * a width in the same unit, and a band over a derived unit divides and
 * multiplies exactly as the value it describes does.
 *
 * ## Asymmetric, because the real error is
 *
 * `lo` and `hi` are given separately rather than as one `±`. A Kepler altitude
 * near periapsis is wrong in one direction far more than the other, and a burn
 * being late is not as recoverable as it being early. A single half-width
 * would have to take the worse side and would then overstate the better one,
 * which for a decision-shaped consumer is the difference between "cannot yet
 * say" and a usable verdict.
 *
 * ## `value` is here as well as on the reckoning, deliberately
 *
 * It duplicates {@link Reckoning.value} at the same path. Asymmetry is why:
 * `lo` and `hi` alone do not say where the estimate sits between them, so
 * every consumer needs all three at once and a band without its own value is
 * never usable alone. Carrying it makes a band the single argument to a
 * threshold comparison, a marker sizer or a chart, with no path walk at the
 * call site. A producer must keep it equal to the value it reckoned for that
 * path; `bandIsWellFormed` is the check, and the store's own suite asserts it.
 */
export interface UncertaintyBand<U extends string = string> {
  /** The model's point estimate: the same number `reckon` produced here. */
  readonly value: Value<U>;
  /** The low end. Never above `value`. */
  readonly lo: Value<U>;
  /** The high end. Never below `value`. */
  readonly hi: Value<U>;
  readonly kind: BandKind;
}

/**
 * The bands a model offers for one frame, keyed by the same dotted paths
 * {@link ModelledField.path} uses. `""` is the payload root.
 *
 * Sparse on purpose, and a model that bands nothing returns `undefined` rather
 * than an empty map. Most models cannot produce a band honestly, and a
 * fabricated one is worse than none: it is a claim about how well a number is
 * known, made by something that does not know.
 *
 * A path here that no {@link ModelledField} names is a producer bug rather
 * than a second way to claim coverage. Nothing rejects it, because the
 * consumer reads bands BY path and never enumerates them, so an orphan is
 * simply never asked for.
 */
export type ReckonedBands = {
  readonly [path: string]: UncertaintyBand | undefined;
};

/**
 * What a reckoner offers: the coverage it claims, and the pull that produces
 * the modelled payload.
 *
 * Coverage sits OUTSIDE the thunk because the store has to know what a model
 * answers for before deciding which arm to build, and running the model to
 * find out would defeat the pull. A model that does not cover the payload root
 * cannot answer for a whole-topic read, so that read stays `stale`.
 *
 * `R` is what the pull ANSWERS WITH, and it defaults to the whole payload
 * because that is what a whole-topic model produces. A model declared per VALUE
 * answers with the projection of the fields it moves instead, so `R` is
 * `Pick<T, K>` there. Two parameters rather than one because the coverage claim
 * is still about paths on `T` whichever shape the answer takes.
 */
export interface TopicModel<T, R = T> {
  /** Paths this model moves. Empty claims nothing and is never offered. */
  readonly modelled: readonly ModelledField[];
  /** Run the model for `viewUt`. Pure: same inputs, same answer. */
  reckon(viewUt: number): R;
  /**
   * How well the model knows its answer for `viewUt`, per path. Optional, and
   * `undefined` is the honest answer for a model that cannot bound its own
   * error: see {@link ReckonedBands}.
   *
   * ## Why this is a second PULL and not a field on `modelled`
   *
   * `{ path, basis, band? }` on {@link ModelledField} reads better and cannot
   * work. Coverage sits outside the thunk precisely so the store can choose an
   * arm without running the model, and a band is a function of how far the
   * value has been carried, so it is not knowable until `viewUt` is. Putting
   * one on the coverage claim would either force the model to run before the
   * arm was chosen, or freeze one frame's interval and report it forever.
   *
   * Called at the same `viewUt` as `reckon`, immediately after it and only
   * when the model was actually used, so a model that shares work between the
   * two can cache on the argument. Pure on the same terms `reckon` is.
   */
  bandAt?(viewUt: number): ReckonedBands | undefined;
}

/**
 * Why a model could not answer for this frame, on a topic whose contract
 * DECLARES a value reckonable.
 *
 * On a plain {@link Reading}, `reckoning: { status: "none" }` is the honest majority answer
 * and needs no explanation: most topics have no model and never will. On a
 * declared value it is a specific refusal, because the declaration is a promise
 * that the wire carries the model's inputs, so the only ways to reach `"none"`
 * are that an input did not arrive, that the model was asked past where it holds,
 * or that the model does not apply to this frame at all. A refusal a widget can
 * render ("no conic past the SOI transition") beats a silent absence, which is
 * why it is REQUIRED on the value-bearing `"none"` arms rather than optional.
 *
 * It sits on the arm and NOT inside `reckoned`, which is the rule
 * {@link Reading}'s own doc states under "No horizon field": a caller holding a
 * reckoning must never discover at call time that the capability has gone bad.
 * A model still withdraws by not being offered on the next frame. All that has
 * changed is that a declared value says WHY it withdrew.
 *
 * `input` names the declared input that was missing or that ruled the model out,
 * spelled exactly as the contract declares it (`relativeVelocity`,
 * `@vessel.orbit`, `@vessel.orbit#mu`), so the string a widget shows and the
 * string the contract carries are the same string.
 *
 * `"insufficient-history"` is the one the STORE raises on the reckoner's behalf
 * without consulting it, and the only rejection {@link ReckonerWindow} has: the
 * declared window held fewer than `minSamples` points of the reckoner's own
 * topic, so a model that needs a trend has nothing to take one from. It carries
 * no `input`, because the topic being read is not one of its own declared
 * inputs; the `note` says how many samples were found and whether a gap is what
 * cut them down.
 */
export interface ReckoningDecline {
  readonly reason:
    | "input-absent"
    | "beyond-horizon"
    | "model-inapplicable"
    | "contested"
    | "insufficient-history";
  /** The declared input responsible, where the reason has one. */
  readonly input?: string;
  /** One sentence for an operator. Never a stack, never a code. */
  readonly note?: string;
}

/**
 * What a reckoner answers: a model, or a refusal that says which input failed
 * it.
 *
 * `undefined` used to be the whole of "no", and it could not distinguish an
 * input that never arrived from a horizon that had been passed. A caller cannot
 * tell those apart from the outside, and they are the two things an operator
 * most wants said.
 *
 * `R` is the projection the model produces, which for a declared value is
 * `Pick<T, K>` rather than the whole payload. See {@link ReckonableReading}.
 */
export type ReckonerAnswer<T, R = T> =
  | TopicModel<T, R>
  | { readonly declined: ReckoningDecline };

/**
 * One topic's value AND its currency, as a single thing the compiler will not
 * let a widget read incuriously.
 *
 * A widget that renders stale data as though it were live is this project's
 * most consequential failure mode. The weaker version of this fix already
 * exists and did not work: `StreamStatusValue` rides its own channel beside the
 * value, ui-kit renders it (`StreamStatusBadge`), and the dashboard even
 * derives a per-widget summary from `dataRequirements` and badges the panel
 * header with it. It was adopted by
 * zero of the thirty-nine widgets that read telemetry, because a badge beside a
 * body is chrome, and nothing forces the body to consult it.
 *
 * So there is no arm you can read a value off without first writing the
 * discriminant, and every distinction that changes what you DRAW is an arm
 * rather than a field. Reaching a value means branching, and the branch is
 * where the caveat gets rendered. Same spirit as `Value<"s">` making
 * unit-blindness unrepresentable.
 *
 * ## Delay is not staleness
 *
 * Under a light-time delay every value is old. If that counted as stale the
 * discriminant would read `stale` everywhere and carry no information at all.
 * A value 4 s old under a 4 s light-time is as current as physics permits, and
 * that is `observed`. Stale means we have MISSED updates we should have had,
 * which is what `HeartbeatTracker` infers from keyframe cadence and never from
 * `validAt` age (see its own doc). Reckoning is therefore only needed for
 * genuine loss of contact, not for the delay case.
 *
 * ## The arms
 *
 * - `pending`: nothing at-or-before the frame's view time yet, a cold topic or
 *   a resync after a rewind. Names the never-arrived case that `undefined`
 *   currently conflates with went-stale
 * - `unowned`: nothing will EVER publish this topic. No installed Uplink
 *   declares it and it falls under no dynamic namespace, so waiting is futile.
 *   See "Why `unowned` is not `pending`" below for the whole point of it
 * - `absent`: a confirmed tombstone, the subject says there is no value.
 *   Carries `atUt` because "confirmed nothing, as of when" is the honest
 *   statement: a tombstone can itself go old, and nothing before this could say
 *   so. It is what lets a widget report "no target set, confirmed 3 s ago"
 *   instead of asserting it for the rest of the mission
 * - `observed`: the newest sample that could have reached us
 * - `stale`: we have missed updates. `value` is the last REAL observation,
 *   always reachable, and `asOfUt` says when it was made
 *
 * ## The second discriminant: `reckoning`
 *
 * Whether a forward model is on offer is a SEPARATE axis, carried on its own
 * required field rather than folded into `state`:
 *
 * - `reckoning: { status: "none" }`: no model is on offer this frame. The honest majority
 * - `reckoning: "available"`: a model is on offer, and `reckoned` carries what
 *   it says the quantity is at the frame's view time
 *
 * Every arm carries the field, `pending`, `unowned` and `absent` included, where
 * it is permanently `"none"`: nothing has been observed (or the subject has said
 * there is nothing), so there is nothing to carry forward. Carrying it on every
 * arm is what makes the axes independent, because a caller can ask
 * `reading.reckoning.status === "available"` without first narrowing `state`.
 *
 * ## Why `unowned` is not `pending`
 *
 * A widget subscribing to a topic nothing will ever publish sat on
 * `{state: "pending"}` for the rest of the session, which reads identically to
 * "the mod has not sent this yet". An author whose widget rendered blank had
 * nothing to go on: no log line, no banner, no health row, and the two cases
 * want opposite next moves. Waiting is right for one and futile for the other.
 *
 * The distinction is decided by the mod, not inferred client-side.
 * `ProcessSubscribe` answers a subscribe for a declared channel (or one under a
 * registered dynamic namespace) with an `EventMsg { name: "subscribed" }`, and
 * answers a subscribe for anything else with a bare return: no error, no ack,
 * nothing. So "we sent a subscribe and no ack came back inside a bounded
 * window" is the authority's own answer rather than a reconstruction of it, and
 * it gets a fail-softed Uplink right for free, where a rule built on the
 * roster's owned-prefix lists would have called four engine built-ins unowned.
 *
 * ## `unowned` is a POSITIVE finding, and silence is not one
 *
 * The rule that keeps this arm honest: reach it only on evidence that the
 * subscribe was answered with nothing, never on the mere absence of data.
 * "Cannot decide" is a third answer and it spells `pending`.
 *
 * Undecided, and therefore `pending`:
 *
 * - the bounded window has not elapsed yet
 * - the transport is not connected, so no subscribe has been answered either way
 * - the read is happening on a STATION. A station's subscribe reaches the mod
 *   only when the host's own refcount makes a 0 -> 1 transition, so a topic the
 *   host already holds is never re-acked and a station would see silence for a
 *   perfectly well owned topic. A station therefore does not decide this arm
 * - the mod predates the ack, so no topic would ever be acked
 *
 * A false `unowned` tells an author their correct code is broken, which is
 * worse than the silence this arm removes. Every widening of what may reach
 * this arm has to be argued against that sentence.
 *
 * ## It carries nothing, and that is deliberate
 *
 * There is no value (there never was one and there never will be), and no
 * instant (nothing was observed, so `observedAt` answers `undefined` exactly as
 * it does for `pending`). The topic id a diagnostic wants is the argument the
 * caller already passed to `useTelemetry`, so putting it on the arm would
 * duplicate a fact the call site holds and admit the possibility of the two
 * disagreeing.
 *
 * ## Why `reckoning` is a discriminant and `grade` is a plain field
 *
 * One rule, applied twice: compiler pressure is worth paying where it forces a
 * DIFFERENT branch, and worth trading away where it would force several
 * identical ones.
 *
 * `grade` does not change what you draw, it labels the same render, so four
 * arms would be four copy-pasted bodies drifting apart across thirty-nine
 * widgets. Plain field.
 *
 * A reckoning DOES change what you draw: a propagated position is a different
 * marker in a different place from a last-known position. An OPTIONAL `reckoned`
 * field was the first shape tried here and it was wrong, because an optional
 * field is one a destructuring consumer ignores by default and ignoring it
 * compiles: `reading.reckoning` typechecks everywhere and answers `undefined`, so
 * a reckoning that EXISTS could be silently dropped while the widget still
 * looked right. That is precisely the failure this type is built to prevent, and
 * it is still not the shape here.
 *
 * `reckoned` is a REQUIRED field of a union member selected by a REQUIRED
 * discriminant. `reading.reckoning` does not compile until `reading.reckoning ===
 * "available"` has been written, because on the other member the property does
 * not exist at all. That is the same compiler pressure the old `reckonable` arm
 * applied, and it is what "forces a branch" means here: reaching a reckoning
 * costs a written test, exactly as reaching a value costs one.
 *
 * ## Why it is a SECOND discriminant rather than an arm of the first
 *
 * `reckonable` used to be an arm of `state`, which made reckonability a SUBTYPE
 * OF STALE and left live-and-reckonable unrepresentable. It is not: the two are
 * orthogonal. A model is a medium for expressing prediction, and a quantity
 * whose cause is known (a conic, a rate) is forward-modellable whether or not
 * the last packet arrived on time. The only real connection is behavioural: a
 * widget is most likely to REACH for a modelled figure once its live one has
 * gone stale.
 *
 * Riding the staleness discriminant made two readings of one fact disagree in
 * one frame. `vessel.state` is derived from `vessel.orbit` and forward-solves
 * from the same elements; it read `reckonable` while `vessel.orbit` read `stale`,
 * because the only way to say "a model exists" was to also say "we have missed
 * updates". Splitting the axis lets both say what is true of them.
 *
 * A widget may still legitimately decline to propagate (a scalar readout may
 * only want a number and a staleness caption). That has to be a WRITTEN choice:
 * see `withoutReckoning`.
 *
 * ## Trust is two questions, and only one of them is a boolean
 *
 * WHETHER a model still stands is boolean, and it is answered structurally.
 * The reading is rebuilt every frame, so once the provider's horizon is
 * exceeded it stops offering a model and the topic reads `reckoning: { status: "none" }`
 * from that frame on, keeping whatever `state` it honestly has. There is no
 * horizon field for a caller to compare against, because there is nothing for
 * one to do: `reckoning: "available"` IS the statement that a model stands
 * right now, and it cannot be held past the moment it stopped being true.
 *
 * **That much is unchanged, and the rule it implies still holds. Do not make
 * `reckoned` able to answer "unavailable".** `reckoning: { status: "none" }` already says
 * it, at the only moment it can be said honestly. A failure return would mean
 * a caller could hold a capability that has since gone bad and discover it at
 * call time, which puts an error path in thirty-nine widgets to represent
 * something the discriminant already carries. If a model needs to withdraw, it
 * withdraws by not being offered on the next frame.
 *
 * HOW WELL it knows the number is a QUANTITY, and the discriminant cannot
 * carry it. This file used to argue that it did not need to: a model that no
 * longer held simply withdrew, so a reckoning that was offered was one to be
 * trusted, full stop. That argument settles the withdrawal question and
 * quietly answers a different one it was never entitled to. A conic thirty
 * seconds past the last contact and the same conic six minutes past it are
 * both standing, both `"available"`, and are not the same claim; an operator
 * reading a single number off either cannot tell which one they have. The
 * boolean was doing the work of a scalar because there was no scalar.
 *
 * {@link Reckoning.bands} is that scalar, per path, in the value's own unit
 * (see {@link UncertaintyBand}). It is OPTIONAL and stays optional: most
 * models cannot bound their own error honestly, and a made-up interval is a
 * confident-looking lie about precision, which is worse than the silence it
 * replaced. So the two axes read together as: `"available"` says a model
 * stands, and a band, where there is one, says how far it would defend itself.
 * Neither substitutes for the other, and an absent band is never evidence that
 * a value is well known.
 *
 * ## The three-channel rule, and why this is its exception
 *
 * `stream-status.ts` and `use-certainty.ts` both state the repo rule: value,
 * staleness/absence, and certainty are three independent channels a widget
 * composes, never nested inside one another. This nests value inside
 * staleness, on the evidence above.
 *
 * The exception is for the value/staleness pair ONLY. `Certainty` stays on its
 * own channel and must not be folded in: it is a property of the FRAME's
 * `viewUt`, not of any one topic, so every topic read in one frame shares it.
 * Nesting it here would duplicate one fact across every read in a frame and
 * admit the possibility of two of them disagreeing, which is exactly what the
 * single-view-time invariant and `FrameToken` exist to prevent.
 */
export type TopicReading<P> = TopicCurrency<P, TopicReckoning<P>> &
  TopicFields<P>;

/**
 * The currency half of a topic reading: the observation, when it was made, and
 * what the model said, with no per-field properties.
 *
 * Written as the arms rather than as one object with everything optional,
 * because reaching a value still has to cost a WRITTEN BRANCH. `pending`,
 * `unowned` and `absent` carry no value at all, and a model is impossible on
 * each of the three: nothing has arrived, nothing ever will, or the mod has
 * confirmed the thing is gone. A tombstone has no observation to carry
 * forward, so admitting `"available"` there would be admitting a modelled
 * value with nothing behind it.
 *
 * `Rk` is which reckoning arms the value-bearing states may carry, and it
 * defaults to `unknown` deliberately: `TopicCurrency<P>` unparameterised is the
 * WIDEST topic reading, so it is what a consumer that reads only the
 * observation should ask for, and every reading in the system satisfies it
 * without the caller having to know which kind it was handed.
 * {@link TopicReading} fills it with {@link TopicReckoning}, and a topic whose
 * contract DECLARES a value reckonable narrows it to
 * {@link DeclaredTopicReckoning}, which is how {@link ReckonableReading} keeps
 * "a declared value always says something about the model" a fact the compiler
 * holds rather than a convention.
 */
export type TopicCurrency<P, Rk = unknown> =
  | { state: "pending"; reckoning: { readonly status: "none" } }
  | { state: "unowned"; reckoning: { readonly status: "none" } }
  | {
      state: "absent";
      reckoning: { readonly status: "none" };
      atUt: Value<"ut">;
    }
  | {
      state: "observed";
      /** The observation itself. Never a modelled value; see `reckoning`. */
      value: P;
      atUt: Value<"ut">;
      reckoning: Rk;
    }
  | {
      state: "stale";
      /** The last REAL observation. Never a modelled value. */
      value: P;
      /** The UT that observation was made at. */
      asOfUt: Value<"ut">;
      grade: StaleGrade;
      reckoning: Rk;
    };

/**
 * The per-field half: one {@link Reading} per payload field, reachable as a
 * PLAIN PROPERTY (`flight.altitudeAsl.reckoning.band`).
 *
 * ## Built from the topic's own model, never from a second read
 *
 * The obvious implementation is to have `flight.altitudeAsl` go and sample the
 * subtopic of that name, and it is wrong in a way nothing would notice.
 * `redirectKinematicSubtopic` rewrites `vessel.flight.altitudeAsl` onto the
 * DERIVED `vessel.state.altitudeAsl`, and a derived channel's reckoner claims
 * the root with no `bandAt` at all, so the delegating version would hand back a
 * modelled altitude with the band silently gone. The field reading is therefore
 * projected out of the reading that already exists: its basis from the
 * {@link ModelledField} covering the path, its value from the modelled payload,
 * its band from {@link TopicReckoningAvailable.bands} at that same path.
 *
 * ## Reserved names lose
 *
 * A payload field spelled like a currency member is EXCLUDED rather than
 * merged: intersecting `"observed" | "stale" | ...` with a `Reading` collapses
 * to `never` and would poison the whole type. Such a field is reached off the
 * payload as it always was, and a call site that reaches for the field reading
 * gets a compile error rather than a `never`.
 *
 * ## The exclusion is a workaround, and codegen now owns the rule
 *
 * Dropping a field from this surface with no diagnostic is the worst half of
 * the bargain: an author gets no field reading and no reason for its absence.
 * `RtConfig.CheckReservedFieldNames` refuses the collision at codegen instead,
 * so the failure lands on whoever spells the field that way, with the topic,
 * the field and a stack.
 *
 * This exclusion stays only while a reserved-name debt list is non-empty. Two
 * contract fields collide today, both declared by Uplink slices and both on
 * those slices' own lists; core cleared its two at contract Major 17, renaming
 * them to `comms.signal.strength` and `comms.control.level`, and
 * `RtConfig.ReservedFieldNameDebt` is now empty. Each remaining one is a
 * wire-visible rename away from gone, which is a Major apiece. When the lists
 * empty, delete the `Exclude` and this paragraph: nothing will be reaching a
 * reserved name to excuse. `styleguide-reserved-reading-keys.test.ts` keeps the
 * two spellings of the key list in step meanwhile.
 *
 * An array payload is left alone entirely: mapping `keyof P` over one would
 * claim a `Reading` at `length`, `map` and every other array member. That is
 * also why the codegen refusal exempts an array topic: five channels carry a
 * reserved name on their ELEMENT (`alarm.scet` is core's) and none of them
 * shadows anything.
 */
export type TopicFields<P> = P extends readonly unknown[]
  ? unknown
  : P extends object
    ? { readonly [K in Exclude<keyof P, ReservedReadingKey>]: Reading<P[K]> }
    : unknown;

/** A currency member's name: what {@link TopicFields} may not shadow. */
export type ReservedReadingKey =
  | "state"
  | "value"
  | "atUt"
  | "asOfUt"
  | "grade"
  | "reckoning";

/**
 * What a model says about ONE value: it ran, nothing offered one, or one was
 * declared and refused for this frame.
 *
 * ## Why a union rather than flat optional fields
 *
 * On a flat shape `modelled` has to stay optional even when the model IS
 * available, because the type cannot say the two go together. Every consumer
 * then writes a fallback for a case that can never fire, and a fallback is
 * exactly where a fabricated number gets in. On this union `modelled` is
 * REQUIRED the moment `status === "available"` has been checked, and reading
 * `declined` without checking is a type error rather than a silent
 * `undefined`.
 *
 * ## `band` stays optional inside the available arm
 *
 * That is correct rather than an oversight. A model can be available and
 * honestly bound nothing: most models cannot produce an interval they would
 * defend, and inventing one is a claim about how well a number is known made by
 * something that does not know. See {@link ReckonedBands}.
 */
export type Reckoning<V> =
  | {
      readonly status: "available";
      /** What the model says the value is at the frame's view time. */
      readonly modelled: V;
      readonly basis: ReckoningBasis;
      /** How far the model would defend `modelled`, where it will say. */
      readonly band?: UncertaintyBand;
    }
  | { readonly status: "none" }
  | { readonly status: "declined"; readonly declined: ReckoningDecline };

/**
 * Currency over ONE value: what was observed, how current it is, and what a
 * model makes of it now.
 *
 * This is what a payload field answers with (see {@link TopicFields}), and what
 * a primitive drawing one number consumes. The whole-topic companion is
 * {@link TopicReading}, which differs only in that its model is keyed by path
 * because a topic has many fields.
 *
 * `value` is present on `observed` and `stale` and absent on the other three,
 * so reaching it still costs a written branch.
 */
export interface Reading<V> {
  readonly state: ReadingState;
  /** The last REAL observation. Never a modelled value; see `reckoning`. */
  readonly value?: V;
  /** When the observation was made, on `absent` and `observed`. */
  readonly atUt?: Value<"ut">;
  /** When the observation was made, on `stale`. */
  readonly asOfUt?: Value<"ut">;
  readonly grade?: StaleGrade;
  readonly reckoning: Reckoning<V>;
}

/**
 * One RECKONABLE topic's value AND its currency, where `T` is the payload and
 * `K` the fields the contract declares a model can carry forward.
 *
 * It is {@link Reading}'s arms with two differences and only two: `reckoned` is
 * the PROJECTION rather than the payload, and the value-bearing `"none"` arms
 * carry a required {@link ReckoningDecline}. Everything `Reading`'s doc says
 * about the states, about the two axes being orthogonal, and about reaching a
 * value costing a written branch is true here unchanged, and is not restated.
 *
 * ## `reckoned` is the projection, because a payload is not one reckoning class
 *
 * Reckonability is declared PER VALUE. `vessel.flight` carries an altitude a
 * conic advances beside a `situation` the game switches, and a model that
 * propagates the first and copies the second would otherwise hand a caller a
 * whole payload labelled "modelled". {@link Reckoning.modelled} says which paths
 * moved, and it says so at runtime, in a field nothing forces a caller to read.
 * `Reckoning<Pick<T, K>>` says the same thing to the COMPILER: reading a field
 * no model moves off `reckoned` does not typecheck, so the mistake cannot be
 * made rather than merely being documented.
 *
 * ## Why a value-bearing arm always says something about the model
 *
 * A declared value always has a model on offer: core ships the vanilla, an
 * Uplink may elect a better one, and the declaration is a promise that the wire
 * carries that model's inputs. So on the arms that carry a value there is no
 * such thing as nothing-to-say. Either `reckoned` is there, or `declined` is
 * there naming what stopped it. That pairing is what "unconditional" buys: not
 * that `reckoned` appears on every arm regardless (it cannot, because a model
 * genuinely does withdraw at an SOI transition, at the atmosphere interface and
 * past its stated horizon), but that a caller who has narrowed to a value can
 * never fall through to a branch where the type declines to comment.
 *
 * The discriminant therefore survives on this type, which is the part worth
 * stating because it looks at first like a regression. What actually goes away
 * is the discriminant on every UNMARKED topic, where it was carrying no
 * information at all.
 *
 * ## A decline is a value-level absence inside a type-level presence
 *
 * The declaration is a statement about the CONTRACT: these inputs are published,
 * so this value can be carried forward. It is static, and it is a property of
 * the wire rather than of any one frame. Whether a model can answer for THIS
 * frame is a different question, answered by the data: the input may not have
 * arrived, the view time may be past where the conic holds, the model may not
 * apply to a vessel on rails at all.
 *
 * So the type says the capability exists and the value says whether it fired,
 * and neither can stand in for the other. Folding the decline into the type (an
 * optional `reckoned`) would lose the reason and re-admit the silent drop that
 * {@link Reading} exists to prevent; folding the capability into the value (a
 * runtime "is this topic reckonable" flag) is pass one, and it is what this
 * type replaces.
 *
 * ## Deliberately NOT assignable to `Reading<T>`
 *
 * `Reckoning<Pick<T, K>>` is not a `Reckoning<T>`, so handing one of these to
 * something typed `Reading<T>` fails to compile. That is the point: the callee
 * would be entitled to read the whole payload off the model. The observed
 * payload overlaid by the modelled fields is
 * `{ ...reading.value, ...reading.reckoning.value }`, written at the call site
 * rather than hidden in a helper, because that spread IS the judgement and it
 * should be visible in review.
 */
export type ReckonableReading<T, K extends keyof T> = TopicCurrency<
  T,
  DeclaredTopicReckoning<Pick<T, K>>
> &
  TopicFields<T>;

/**
 * Which kind of missed-update a stale reading is. A FIELD rather than more arms:
 * see `Reading`'s own doc for the rule.
 *
 * - `held-stale`: this ONE channel's keyframes stopped arriving on cadence, or
 *   the server stamped the point on catch-up
 * - `disconnected`: the whole transport is down, a link-wide fact rather than a
 *   per-topic inference. The operator's next move differs: check the relay,
 *   versus this craft is behind the Mun
 * - `last-before-blackout`: server-stamped, the newest sample that got out
 *   before a blackout the Courier already knew about
 * - `recorded`: server-stamped, taken by the subject while out of contact and
 *   replayed on reacquisition. The odd one out: the value is not uncertain at
 *   all, it is exact for its own `asOfUt`, and what makes it a stale grade is
 *   only that the instant is behind the live edge. Reckon FROM it freely; never
 *   draw it as the state of the craft now
 *
 * Expect `reckoning: "available"` to correlate with `last-before-blackout`
 * without the type enforcing it. A model that integrates from the loss of
 * contact needs to know WHEN contact was lost, and that is the only grade that
 * knows, being stamped with the blackout's start. `held-stale` knows only that a
 * heartbeat was missed. A provider with an independent clock on the loss of
 * contact may legitimately reckon from any grade, and a model whose basis is a
 * CAUSE rather than an integration (a conic, a rate) reckons from a live reading
 * just as honestly. That is why the reckoning axis is by whether a model EXISTS
 * rather than by grade, and why it is not part of `state` at all.
 */
export type StaleGrade =
  | "held-stale"
  | "disconnected"
  | "last-before-blackout"
  | "recorded";

/**
 * The staleness discriminant alone, for the handful of types that carry a
 * reading's ARM beside a value they joined from several topics rather than
 * nesting the `Reading` itself (`BudgetProvenance`, `LevelsProvenance`).
 *
 * Derived rather than written out, because both of those spelled the arms as a
 * literal union and both silently went stale the moment another was added: the
 * compiler caught them here, at the assignment, rather than where the mirror was
 * declared. A derived alias makes the next arm propagate on its own.
 *
 * It carries NOTHING about reckoning, and a provenance type wanting that says so
 * with its own {@link ReadingReckoning} field rather than by widening this one.
 * The two axes are independent in `Reading` and stay independent in a mirror of
 * it.
 *
 * This is NOT a licence to replace a `Reading` with its state. A provenance
 * field is for a value that is not one Topic's anything; a widget reading one
 * topic takes the whole `Reading`, so that reaching the value means branching.
 */
export type ReadingState = TopicCurrency<unknown>["state"];

/** The reckoning discriminant alone, the companion to {@link ReadingState}. */
export type ReadingReckoning = Reckoning<unknown>["status"];

/**
 * Drop the model: the written, greppable way for a widget to decline to
 * propagate.
 *
 * It leaves `state` alone, which is the whole point of the axes being separate.
 * A live reading that declines its model is still `observed`, and a stale one is
 * still `stale` at the same grade. Only `reckoning` moves, to `"none"`, and the
 * return type says so: an {@link UnmodelledReading} has no `reckoned` for a
 * caller to reach for afterwards.
 *
 * Note it does not avoid the model's COST: `reckoned` is computed when the
 * reading is built, so by the time a widget declines it the model has already
 * run. This is about what gets DRAWN, not about saving work; a topic whose model
 * is too expensive to run per frame belongs in `NEVER_RECKONABLE`'s
 * too-expensive group instead.
 *
 * Legitimate for a scalar readout that wants the last observed number with a
 * staleness caption and no modelled figure. It exists as a named helper so the
 * decision shows up in review and "which widgets decline to reckon" is a
 * search. Without one, thirty-nine widgets would ignore the discriminant with an
 * inline fallthrough and the optional field would be back by convention.
 *
 * **Never use this on anything that draws a POSITION or an ATTITUDE.** A marker
 * or a reticle placed from a last-known value asserts something about now that
 * it cannot know, and that is the sharpest form of the failure this type
 * exists to prevent. Such a widget should either propagate or stop drawing.
 *
 * It takes a {@link ReckonableReading} too, and strips the {@link
 * ReckoningDecline} along with the model. A widget that has declined to
 * propagate has no use for the reason the model it is not drawing did not fire,
 * and leaving the field on would let one back into a branch it has already
 * opted out of.
 */
// The ReckonableReading overload comes FIRST, and the order is load-bearing.
// `Reading<Pick<T, K>>` accepts a `ReckonableReading<T, K>` by inference (the
// observation is a `T`, and a `T` is assignable to its own projection), so the
// wider declaration first would silently narrow the answer to the projection.
// The reverse cannot happen: a plain `Reading` has no `declined` on its
// value-bearing `"none"` arms, which this type requires.
export function withoutReckoning<T, K extends keyof T>(
  reading: ReckonableReading<T, K>,
): UnmodelledReading<T>;
export function withoutReckoning<T>(
  reading: TopicReading<T>,
): UnmodelledReading<T>;
export function withoutReckoning<T>(
  reading: TopicReading<T> | ReckonableReading<T, keyof T>,
): UnmodelledReading<T> {
  /*
   * The SAME object where there was nothing to drop, because a widget calling
   * this on an unmodelled reading must not pay a new identity for it: the store
   * hands out one reading per topic per frame precisely so a `useSyncExternal
   * Store` subscriber can compare by reference. The cast is what the narrowing
   * cannot say: `reckoning.status` narrows the reckoning and not the arm
   * carrying it, so the compiler still holds the wider member type.
   */
  if (reading.reckoning.status === "none")
    return reading as UnmodelledReading<T>;
  if (reading.state === "pending" || reading.state === "unowned") {
    return topicReading({
      state: reading.state,
      reckoning: { status: "none" },
    });
  }
  if (reading.state === "absent") {
    return topicReading({
      state: "absent",
      reckoning: { status: "none" },
      atUt: reading.atUt,
    });
  }
  if (reading.state === "observed") {
    return topicReading({
      state: "observed",
      reckoning: { status: "none" },
      value: reading.value,
      atUt: reading.atUt,
    });
  }
  return topicReading({
    state: "stale",
    reckoning: { status: "none" },
    value: reading.value,
    asOfUt: reading.asOfUt,
    grade: reading.grade,
  });
}

/**
 * A `Reading` with no model on offer: every member whose `reckoning` is
 * `"none"`, so `reckoned` is not merely absent at runtime but absent from the
 * type.
 *
 * `stale` is still there and still has to be handled: that is where the
 * judgement lives, and this narrowing does not reduce it. What it removes is a
 * branch a caller could write for a case that cannot occur.
 *
 * Declared here rather than beside `NEVER_RECKONABLE` because two different
 * things produce one: a topic declared unmodellable, and any reading a widget
 * has run {@link withoutReckoning} over.
 */
export type UnmodelledReading<T> = TopicCurrency<
  T,
  { readonly status: "none" }
> &
  TopicFields<T>;

/**
 * The value of an OBSERVED reading, and `undefined` on every other arm.
 *
 * The narrowing to write when a value only means anything if it is CURRENT: a
 * verdict, a band, a status pill, whether a control may be pressed. `pending`,
 * `unowned` and `absent` have no value to give, and `stale` deliberately gives
 * nothing either, because the question asked was what is true now and a
 * last-known figure answers a different one. A widget that wants the last-known
 * figure branches on the `stale` arm itself and captions it with the age from
 * {@link observedAt}, which is what that arm carries `asOfUt` for.
 *
 * It is exported rather than left to each caller because it was written out by
 * hand, identically, in thirty-nine copies across eight Uplinks and the
 * built-in widget library. The reason it was copied instead of imported is that
 * the SDK never offered it: an Uplink may import this package and `ui-kit` and
 * nothing else of the app's, so a helper every consumer needs and the SDK
 * withholds gets duplicated once per consumer.
 *
 * **Not the right read on a reckonable topic, where the model is the point.** A
 * topic the contract declares reckonable answers with a
 * {@link ReckonableReading}, and its `reckoned` is the whole reason the
 * declaration exists: taking the observation there draws the last real sample
 * while a model able to say where the craft IS goes unread. Such a widget
 * branches on `reckoning` and reads `reckoned.value`. This function answers for
 * the OBSERVATION on either union and never consults a model, so on a
 * reckonable topic it is a deliberate choice to ignore one rather than a way of
 * reaching it.
 */
/*
 * The ReckonableReading overload comes FIRST, for the same load-bearing reason
 * `withoutReckoning`'s does: `Reading<Pick<T, K>>` accepts a
 * `ReckonableReading<T, K>` by inference, so declaring the wider one first would
 * type the OBSERVATION as the projection the model moves, and a caller reading
 * any other field of the payload it actually holds would fail to compile.
 */
export function observedValue<T>(reading: TopicCurrency<T>): T | undefined {
  return reading.state === "observed" ? reading.value : undefined;
}

/**
 * One PART of a payload, still carrying the whole reading's currency: the
 * narrowing to write when a primitive draws a single field and has to know
 * whether that field is current.
 *
 * `<Unit>` takes a `Reading<Value<U>>`, and a widget holds a
 * `Reading<VesselOrbit>`. Without this, reaching the first from the second
 * means a switch over the arms at every call site, and a switch written 373
 * times is one that gets written wrongly somewhere: the arm most likely to be
 * dropped is `stale`, which is the arm the whole type exists for.
 *
 * `select` runs only on the arms that HAVE a payload. The other three carry
 * nothing to select from and come through unchanged, so a field of a pending
 * reading is a pending reading rather than an observation of `undefined`.
 *
 * ## It DROPS the model, and that is the honest answer rather than a shortcut
 *
 * A {@link Reckoning} is a projection of the declared fields, keyed by their
 * own paths. A selector is an arbitrary function: it may pick a field no model
 * moves, or compute a magnitude out of three that it does. There is no general
 * way to carry a reckoning through one, and carrying it through unchanged would
 * be worse than dropping it, because the result would claim a model for a
 * quantity the model never spoke about.
 *
 * So the return type is an {@link UnmodelledReading}, exactly as
 * {@link withoutReckoning} produces, and for the same reason: a widget that
 * wants the modelled figure branches on `reckoning` itself and hands the
 * projection over as its own `Value`, which is a written choice and shows up in
 * review.
 */
export function readingOf<T, K extends keyof T, R>(
  reading: ReckonableReading<T, K>,
  select: (payload: T) => R,
): UnmodelledReading<R>;
export function readingOf<T, R>(
  reading: TopicReading<T>,
  select: (payload: T) => R,
): UnmodelledReading<R>;
export function readingOf<T, R>(
  reading: TopicReading<T> | ReckonableReading<T, keyof T>,
  select: (payload: T) => R,
): UnmodelledReading<R> {
  if (reading.state === "observed") {
    return topicReading({
      state: "observed",
      reckoning: { status: "none" },
      value: select(reading.value),
      atUt: reading.atUt,
    });
  }
  if (reading.state === "stale") {
    return topicReading({
      state: "stale",
      reckoning: { status: "none" },
      value: select(reading.value),
      asOfUt: reading.asOfUt,
      grade: reading.grade,
    });
  }
  if (reading.state === "absent") {
    return topicReading({
      state: "absent",
      reckoning: { status: "none" },
      atUt: reading.atUt,
    });
  }
  if (reading.state === "pending")
    return topicReading({ state: "pending", reckoning: { status: "none" } });
  return topicReading({ state: "unowned", reckoning: { status: "none" } });
}

/**
 * The {@link ModelledField} that covers `path`, or `undefined` where no entry
 * does.
 *
 * A basis INHERITS from a shorter path: a model claiming the payload root has
 * moved every field under it, and the most specific claim wins where two apply.
 * A band does not inherit, and {@link fieldReckoning} looks one up at the exact
 * path for that reason: a basis is a property of the model and is true of every
 * path it moves, while a band is two numbers in one quantity's unit, so
 * borrowing the root's would put a metre interval around a speed.
 */
function coveringField(
  modelled: readonly ModelledField[],
  path: string,
): ModelledField | undefined {
  let best: ModelledField | undefined;
  for (const entry of modelled) {
    const covers =
      entry.path === "" ||
      entry.path === path ||
      path.startsWith(`${entry.path}.`);
    if (!covers) continue;
    if (!best || entry.path.length > best.path.length) best = entry;
  }
  return best;
}

/** One dotted step into a payload, or `undefined` where the walk falls off. */
function walkField(payload: unknown, path: string): unknown {
  let current = payload;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * One path's {@link Reckoning}, projected out of the topic's own model.
 *
 * This is the whole reason a field property exists, and the reason it must not
 * be built by reading the subtopic of the same name instead.
 * `redirectKinematicSubtopic` sends `vessel.flight.altitudeAsl` to the DERIVED
 * `vessel.state.altitudeAsl`, whose reckoner claims the root and offers no
 * `bandAt` at all, so a delegating field property would answer with a modelled
 * altitude and no band and nothing would notice the band had gone. Projecting
 * instead keeps the band the topic's own model produced, because it is read out
 * of {@link TopicReckoningAvailable.bands} at this path and never fetched a
 * second time.
 *
 * A path no {@link ModelledField} covers reckons `"none"`, which is the honest
 * answer: the value sitting at that path in the modelled payload is a verbatim
 * copy of the last observation, carried along because the model answers with
 * the whole payload, and labelling it modelled is the failure the `modelled`
 * list exists to prevent.
 */
export function fieldReckoning(
  reckoning: TopicReckoning<unknown>,
  path: string,
): Reckoning<unknown> {
  if (reckoning.status !== "available") return reckoning;
  const covering = coveringField(reckoning.modelled, path);
  if (!covering) return { status: "none" };
  return {
    status: "available",
    modelled: walkField(reckoning.value, path),
    basis: covering.basis,
    band: reckoning.bands?.[path],
  };
}

/** One payload field's {@link Reading}, at the same currency as its topic. */
function projectField(
  currency: TopicCurrency<unknown, TopicReckoning<unknown>>,
  path: string,
): Reading<unknown> {
  const reckoning = fieldReckoning(currency.reckoning, path);
  switch (currency.state) {
    case "pending":
    case "unowned":
      return { state: currency.state, reckoning };
    case "absent":
      return { state: "absent", atUt: currency.atUt, reckoning };
    case "observed":
      return {
        state: "observed",
        value: walkField(currency.value, path),
        atUt: currency.atUt,
        reckoning,
      };
    case "stale":
      return {
        state: "stale",
        value: walkField(currency.value, path),
        asOfUt: currency.asOfUt,
        grade: currency.grade,
        reckoning,
      };
  }
}

/**
 * The currency half plus its per-field readings: what a whole-topic read hands
 * a widget.
 *
 * LAZY, through a proxy, because a topic has as many fields as the contract
 * gives it and a widget reads two of them. `vessel.target` flattens to
 * forty-seven, so building every field eagerly would run the walk and the
 * coverage search forty-five times per frame for nothing. Each answer is cached
 * on first ask, so two reads of one field are one projection and the reading a
 * caller holds keeps its identity.
 *
 * A proxy rather than `Object.defineProperty` over the payload's own keys,
 * because the field half has to be there on `pending`, `unowned` and `absent`
 * too, where there is no payload to enumerate. A widget that reaches
 * `flight.altitudeAsl.state` before the first packet lands must get `"pending"`,
 * not a crash.
 *
 * Spreading one copies the currency and NOT the field readings: `ownKeys` is
 * the currency's, so `{ ...reading }` is what it has always been. Reach a field
 * off the reading itself.
 */
export function topicReading<P>(
  currency: TopicCurrency<P, { readonly status: "none" }>,
): UnmodelledReading<P>;
export function topicReading<P>(
  currency: TopicCurrency<P, TopicReckoning<P>>,
): TopicReading<P>;
export function topicReading<P>(
  currency: TopicCurrency<P, { readonly status: string }>,
): TopicReading<P> {
  const cache = new Map<string, Reading<unknown>>();
  return new Proxy(currency, {
    get(target, prop, receiver) {
      if (typeof prop !== "string" || prop in target)
        return Reflect.get(target, prop, receiver);
      let projected = cache.get(prop);
      if (!projected) {
        projected = projectField(
          target as TopicCurrency<unknown, TopicReckoning<unknown>>,
          prop,
        );
        cache.set(prop, projected);
      }
      return projected;
    },
  }) as TopicReading<P>;
}

/**
 * The band a reckoning offers for one path, or `undefined` where it offers
 * none. `""` is the payload root, which is what a scalar topic's band is under.
 *
 * A one-line lookup, and exported for the one case a typed accessor cannot
 * serve: a path COMPOSED AT RUNTIME, as a model keyed by collection index does
 * (`` `${kerbal}.rules.${index}.value` ``). Reach a band on a known field
 * through the primitive that draws it instead; a widget hand-writing
 * `reading.reckoning.bands?.["field"]` is deciding for itself both what an
 * absent map means and what unit the band came in, and the second of those is
 * `bandIn`'s job.
 *
 * It is also the only place the default path is written down: a caller that
 * forgets `""` and passes the field name of a scalar topic gets `undefined` and
 * draws no band, which is a silent downgrade rather than an error.
 */
export function bandFor(
  reckoning: { readonly bands?: ReckonedBands },
  path = "",
): UncertaintyBand | undefined {
  return reckoning.bands?.[path];
}

/**
 * A band narrowed to the unit a caller expects, or `undefined` where it is in
 * some other unit or is malformed.
 *
 * {@link ReckonedBands} is keyed by a runtime path string, so nothing in the
 * type system knows what unit the band at `"verticalSpeed"` is in and every
 * consumer would otherwise reach its typed band through a cast. This CHECKS
 * instead: the narrowing is real, and a producer that banded a field in the
 * wrong unit hands the consumer nothing rather than a number it will read as
 * metres per second.
 *
 * Answering `undefined` rather than throwing is the same judgement the rest of
 * this file makes about a bad band: the reckoned value is still good, and a
 * consumer with no band behaves exactly as one whose model offered none.
 *
 * It survived a reckoned tail's ends being typed to the tail's own value on
 * 2026-09-14, which looked at first as though it retired the mismatch arm. It
 * does not: that construction ties two ends to ONE value, and this one is
 * reached through {@link ReckonedBands}, a map keyed by a runtime path string
 * whose values are `UncertaintyBand<string>`. Nothing in the type system knows
 * what `"verticalSpeed"` is in, so the mismatch arm here is the only thing that
 * ever knew, and it stays the check rather than a backstop for one.
 */
export function bandIn<U extends string, V extends string = string>(
  band: UncertaintyBand<V> | undefined,
  unit: U,
): UncertaintyBand<U> | undefined {
  if (!band || !bandIsWellFormed(band)) return undefined;
  /*
   * NARROWED, not rebuilt and not cast. `isUnit` is a type predicate over the
   * check this function already performed by hand, so the three components
   * come back out as the ones that went in.
   *
   * Three questions rather than one because a predicate narrows the value it
   * is handed and says nothing about its siblings. That reads as redundant
   * against `bandIsWellFormed`, which has already established all three share
   * a unit, and it is not: what it establishes is that they agree with EACH
   * OTHER, and the runtime knows nothing of `U`. Asking about each is what
   * lets the three be returned as an `UncertaintyBand<U>` with no assertion
   * anywhere.
   */
  if (
    !isUnit(band.value, unit) ||
    !isUnit(band.lo, unit) ||
    !isUnit(band.hi, unit)
  )
    return undefined;
  return { value: band.value, lo: band.lo, hi: band.hi, kind: band.kind };
}

/**
 * Whether a band says something coherent: the ends bracket the value, all
 * three are finite, and all three are in one unit.
 *
 * A producer-facing check rather than a gate. Nothing rejects a malformed band
 * at runtime, because the store cannot tell a model's bug from a model's
 * opinion and refusing the whole reckoning over a bad interval would lose the
 * value too. What this is for is the producer's OWN test: a model that offers
 * a band asserts this over its output, and the store's suite asserts it over
 * every band a built-in model mints.
 *
 * `lo === value === hi` passes. A model claiming it knows a value exactly is
 * making a strong claim, not an ill-formed one, and a quantised or
 * integer-valued quantity is the honest case for it.
 */
export function bandIsWellFormed<U extends string>(
  band: UncertaintyBand<U>,
): boolean {
  const { value: v, lo, hi } = band;
  if (lo.unit !== v.unit || hi.unit !== v.unit) return false;
  if (!lo.isFinite() || !v.isFinite() || !hi.isFinite()) return false;
  return lo.lessThanOrEqual(v) && v.lessThanOrEqual(hi);
}

/**
 * Where a band sits relative to a threshold: wholly under it, wholly over it,
 * or across it.
 *
 * The DECISION primitive, and the reason a band is worth carrying at all for a
 * consumer that renders no picture. A widget comparing a bare reckoned number
 * against a limit gets a verdict on every frame and has no way to say the one
 * true thing, which is that the model does not yet know. `"straddles"` is that
 * third answer, and a widget that acts on it says so rather than guessing.
 *
 * The boundary is INCLUSIVE at both ends: a band whose `hi` lands exactly on
 * the threshold reads `"below"`, not `"straddles"`. An interval touching a
 * limit has not crossed it, and treating equality as unresolved would make
 * every band that happens to close on a round number unresolvable.
 *
 * Both arguments share `U`, so the two units are the same string and compare
 * directly. That is why there is no conversion here and no cast: a mismatch is
 * not representable in the signature.
 */
export function bandSide<U extends string>(
  band: UncertaintyBand<U>,
  threshold: Value<U>,
): "below" | "above" | "straddles" {
  if (band.hi.lessThanOrEqual(threshold)) return "below";
  if (band.lo.greaterThanOrEqual(threshold)) return "above";
  return "straddles";
}

/**
 * Whether the producer has spoken about this topic at all, whatever it said.
 *
 * The question a PRESENCE GATE asks, and five call sites were asking it by hand
 * as `reading.state !== "pending"`: the augment-availability feeder, the map's
 * POI provider gate, the mission log's dock read, the ΔV totals row, and two
 * Uplink test helpers. Every one of them reasoned "pending is the only answer
 * that means nothing is there".
 *
 * That reasoning was complete when `pending` was the only empty arm and stopped
 * being complete the moment `unowned` existed, in the dangerous direction: a
 * hand-rolled `!== "pending"` reads `unowned` as the producer having ANSWERED,
 * when it is the strongest evidence there is that no producer exists. A gate
 * built that way shows an Uplink's UI on an install where the Uplink is not
 * present. Named here so the next arm has one place to be considered rather
 * than five to be missed.
 *
 * `absent` is deliberately TRUE: a producer saying "there is no value" is still
 * a producer, and a tombstone is data. `stale` likewise, since a domain that
 * reported and went quiet is still installed.
 *
 * The two falses are NOT interchangeable even though this collapses them, and a
 * caller that renders something for the user should branch on the arm rather
 * than on this: `pending` may become true on the next frame and `unowned` never
 * will. This answers "should the gate be open", not "what should I say".
 *
 * Takes the discriminant rather than `Reading<T>`, because it reads nothing
 * else and because the callers that need it most cannot supply a `Reading<T>`:
 * a presence gate reads `` `${domain}.available` `` through a runtime `as
 * TopicId` cast, so its reading is the union over EVERY topic and unifies with
 * no single `T`.
 */
export function hasAnswered(reading: {
  readonly state: ReadingState;
}): boolean {
  switch (reading.state) {
    case "pending":
    case "unowned":
      return false;
    case "absent":
    case "observed":
    case "stale":
      return true;
  }
}

/**
 * The instant a reading's OBSERVATION was made, or `undefined` when there has not
 * been one.
 *
 * This replaces `readingAge`, which did the subtraction itself and returned a bare
 * `number`. An age is now `viewUt.minus(observedAt(reading))`, which is a
 * `Value<"s">` natively and renders through `<Unit>` like any other duration: the
 * affine rules made the subtraction say what it means, so a function to do it by hand
 * was one more thing to keep honest.
 *
 * `pending` and `unowned` have no instant: there is no observation to be old, and for
 * `unowned` there never will be. Every other arm has one whether or not a model is on
 * offer, and where one is, the age of the last real contact is the number an operator
 * wants beside the modelled figure.
 *
 * Callers still clamp at zero. Samples arrive out of order (`ClientTimeline`
 * insert-sorts for it), so one can sit marginally ahead of the frame's view time, and
 * "-0.4 s old" is never a thing to render.
 *
 * Takes either union, because the question is about the OBSERVATION and the body
 * switches on `state` alone. A declared value's reading answers it identically:
 * how far a modelled figure has been carried is the same number whether or not
 * the model that carried it was declared in the contract.
 */
export function observedAt<T>(
  reading: TopicCurrency<T>,
): Value<"ut"> | undefined {
  switch (reading.state) {
    case "pending":
    case "unowned":
      return undefined;
    case "absent":
    case "observed":
      return reading.atUt;
    case "stale":
      return reading.asOfUt;
  }
}

/**
 * A provider of forward models, consulted once per reading. Returning
 * `undefined` is the honest majority answer and leaves the reading
 * `reckoning: { status: "none" }`; returning a model makes it `"available"`.
 *
 * `TopicModel.reckon` is what makes the reckoning a pull. This function itself
 * must stay cheap: it is asked whether a model EXISTS and what it covers,
 * which are questions about the basis, not requests to run it.
 *
 * `grade` is `undefined` when the reading is LIVE, and a reckoner is asked on
 * live readings deliberately. A model whose basis is a CAUSE (a conic, a rate)
 * is as true of a value that arrived on time as of one that stopped arriving,
 * and the only thing that used to stop it saying so was reckonability riding the
 * staleness discriminant. A reckoner that genuinely integrates FROM the loss of
 * contact declines on `undefined` and says why.
 *
 * `viewUt` is the third argument because declining is the ONLY way a model has
 * to express a horizon, and a horizon is a statement about how far a value is
 * being carried. Given the point and the grade alone, a reckoner knows when
 * the observation was made and not what it is being asked to reach, so it
 * could not decline at the one moment declining matters. Everything
 * `Reading`'s doc says about `"available"` being the statement of trust rests
 * on this argument existing.
 */
export type ReckonerFor<T> = (
  point: TimelinePoint<T>,
  grade: StaleGrade | undefined,
  viewUt: number,
) => TopicModel<T> | undefined;

/**
 * What one declared dependency resolves to when the STORE resolves it for a
 * reckoner.
 *
 * The notation is `Dep`'s, unchanged, because a reckoner's inputs are the same
 * kind of thing a processor's are and inventing a second spelling for them
 * would be two vocabularies to keep in step. What differs is the RESOLUTION: a
 * Topic id resolves to the `TimelinePoint`, not to the bare payload a processor
 * gets.
 *
 * That is not a convenience. A reckoner is a producer at the timeline layer,
 * and it already holds its own point; an input's `meta.quality` is exactly the
 * sort of fact a forward model withdraws on (the conic refuses a craft that is
 * not on rails), and a payload-only resolution would hide it behind an
 * `undefined` the reckoner could not tell from an absent channel.
 */
type ResolvedReckonerDep<D extends Dep> =
  D extends ProcessorHandle<infer R>
    ? R
    : D extends ReadingDep<infer T>
      ? Reading<TopicPayload<T>>
      : D extends TopicId
        ? TimelinePoint<TopicPayload<D>> | undefined
        : never;

/**
 * How much of its OWN topic's record a reckoner is handed, bounded both ways.
 *
 * A reckoner used to get exactly one point, which is why so little was
 * reckonable: a model that wants a trend (a rate, a drift, a slope) could not
 * take one, so every changing quantity needed a companion rate field published
 * beside it before anything could carry it forward. The window replaces that
 * narrowing with a declaration.
 *
 * ## The two bounds do different jobs, and only one of them refuses
 *
 * `spanUt` and `maxSamples` are a COST CAP. A window that catches more points
 * than `maxSamples` is thinned to that many and the model runs anyway: the
 * reckoner asked for a lookback, not for every sample inside it, and dropping
 * points from a dense stretch costs a rate estimate nothing.
 *
 * `minSamples` is the SUFFICIENCY FLOOR and the only rejection here. Below it
 * the model never runs and the store answers
 * `declined: { reason: "insufficient-history" }` on its behalf, because a slope
 * taken from one point is not a slope, and a model given one anyway would
 * invent the very confidence {@link Reading} exists to withhold.
 *
 * ## It applies to the reckoner's OWN topic, and to nothing else
 *
 * There is no `minSamples` on {@link DepWindow}, and that is the whole reason
 * the two are separate types rather than one with a flag. A floor applied to
 * dependencies would refuse to model anything whose input is a slow-moving
 * constant, which is most of them: `system.bodies` changes once a session, so a
 * two-sample floor on it would decline forever on a fact that was never
 * missing.
 *
 * ## What a span does NOT mean
 *
 * `spanUt` is game seconds of LOOKBACK from the newest observation, never a
 * count of expected samples. The stream is change-gated, so a topic only
 * carries a point when its value actually changed: "changes every twenty
 * seconds" and "is sampled every twenty seconds" are the same thing in the
 * buffer and different things in the world. Nothing here divides a span by an
 * interval, and nothing written against it should.
 */
export interface ReckonerWindow {
  /**
   * Lookback in game seconds, measured back from the newest observation the
   * reckoner can see, NOT from the frame's view time. A model carrying a value
   * across a blackout still wants the last minute of contact, and a window
   * anchored on the view time would empty out exactly when the model was
   * needed.
   */
  readonly spanUt: number;
  /** Cost cap: a fuller window is thinned to this many points, ends kept. */
  readonly maxSamples: number;
  /** Sufficiency floor. Below it the model does not run. Defaults to 1. */
  readonly minSamples?: number;
}

/**
 * A window one DEPENDENCY opts into, turning its resolution from a single point
 * into an array.
 *
 * By default a dep still resolves to one point by hold-last, and that is
 * correct rather than a shortcut: a change-gated timeline only carries a point
 * when the value changed, so a dep that last changed an hour ago has not gone
 * missing, its value now IS that value. `sampleDerivedRange` already leans on
 * exactly this to replay a derived channel over its inputs' change points.
 *
 * No `minSamples`: see {@link ReckonerWindow}.
 */
export interface DepWindow {
  /** As {@link ReckonerWindow.spanUt}, measured back from this dep's own newest point. */
  readonly spanUt: number;
  /** As {@link ReckonerWindow.maxSamples}. */
  readonly maxSamples: number;
  /**
   * Declared as `never` rather than left out, so writing one is an error the
   * compiler gives rather than a key that is quietly ignored. `depWindows` is
   * inferred as a whole object before its constraint is checked, and a
   * constraint check does no excess-property check, so an omitted field would
   * have been accepted here and dropped.
   */
  readonly minSamples?: never;
}

/**
 * The deps a window can be declared for: the Topic ids among them.
 *
 * A `ReadingDep` and a `ProcessorHandle` are excluded because neither is a
 * stored timeline to range over. A reading is one topic's currency AT a view
 * time, and a processor is recomputed per frame and never buffered, so there is
 * no history to hand back for either.
 */
export type WindowableDep<Deps extends readonly Dep[]> = Extract<
  Deps[number],
  TopicId
>;

/**
 * The opt-in map, keyed by the reckoner's OWN declared deps.
 *
 * Keyed by `WindowableDep<Deps>` rather than by `string` so a window declared
 * for a topic this reckoner does not depend on is a compile error rather than a
 * silently ignored key, which is the same failure the bare-string `topic`
 * parameter used to allow one level up.
 */
export type DepWindows<Deps extends readonly Dep[]> = {
  readonly [K in WindowableDep<Deps>]?: DepWindow;
};

/**
 * What one declared dependency resolves to, given which deps opted into a
 * window.
 *
 * `Windowed` is the set of dep ids carrying a {@link DepWindow}, and it is a
 * type parameter rather than a runtime flag so the difference shows up where it
 * matters: a dep that opted in destructures as an ARRAY and one that did not as
 * a single point, with no cast at either call site and no `Array.isArray` check
 * inside a model to find out which it got.
 */
export type ResolvedReckonerDeps<
  Deps extends readonly Dep[],
  Windowed extends TopicId = never,
> = {
  [K in keyof Deps]: Deps[K] extends Dep
    ? Deps[K] extends Windowed
      ? readonly TimelinePoint<TopicPayload<Extract<Deps[K], TopicId>>>[]
      : ResolvedReckonerDep<Deps[K]>
    : never;
};

/** What a reckoner is told about the frame it is running for, beyond its inputs. */
export interface ReckonerFrame<T = unknown> {
  /** `undefined` when the reading is LIVE; see {@link ReckonerFor}. */
  readonly grade: StaleGrade | undefined;
  /** The frame's frozen view time: what the model is being asked to reach. */
  readonly viewUt: number;
  /**
   * The reckoner's own topic across its declared {@link ReckonerWindow},
   * oldest first, the last entry being the same point `reckon` is handed
   * separately.
   *
   * Never empty, and exactly `[point]` when no window is declared: a reckoner
   * that asked for no history is one whose window is a single sample, which is
   * the old behaviour stated as a window rather than a second code path.
   *
   * It stops at the newest break in the record and never spans one. Two things
   * count as a break and both are POSITIVE claims rather than an interval
   * anyone guessed at: a point carrying `meta.gapSinceUt` (the producer saying
   * data existed before it and is gone) and a tombstone (`payload === null`,
   * the value confirmed absent and later back). Samples either side of a
   * blackout are not the same regime, and a model handed both would draw a
   * trend through an outage it has no readings for.
   */
  readonly history: readonly TimelinePoint<T>[];
}

/**
 * A rule about a model's declared INPUTS that the store applies to every
 * registration, whether or not the model's author knew it existed.
 *
 * Both come from the same statement: a forward model is a claim about the
 * future made out of other people's numbers, and it cannot honestly claim more
 * than those numbers support. A model author writing neither of these gets both,
 * which is the point; a model that genuinely needs to exceed one says so in
 * {@link ReckonerExemptions} and gives the reason.
 *
 * - `horizon`: the model is not offered on a frame where one of its declared
 *   inputs is past ITS OWN model's horizon. There is no horizon FIELD to clamp
 *   (see {@link ReckoningDecline}, and {@link Reading}'s "No horizon field"),
 *   so the rule is spelled the only way a horizon is ever spelled here: the
 *   model withdraws for that frame, declining `"beyond-horizon"` and naming the
 *   input that ran out
 * - `band`: the model's {@link UncertaintyBand}s never claim to know more than
 *   the bands on its inputs do. A `sigma1` input caps the output's kind at
 *   `sigma1`, because a hard bound cannot be derived from an error that was
 *   never bounded; and an input band with width forbids a zero-width output
 *   band, because exactness cannot be derived from uncertainty. A band the rule
 *   rejects is DROPPED rather than widened to an invented number, which is the
 *   same answer {@link ReckonedBands} already gives for a model that cannot
 *   bound its own error
 *
 * ## What the band rule deliberately does NOT do
 *
 * It does not compare WIDTHS. A width comparison across an input path and an
 * output path is not sound without knowing the model's sensitivity to that
 * input: an altitude taken from a precise conic and an imprecise body radius is
 * legitimately tighter in metres than either, and averaging independent samples
 * legitimately narrows. So the rule polices the two claims that are wrong
 * whatever the mathematics (a bound out of a sigma, an exact answer out of an
 * inexact input) and leaves the arithmetic to the model.
 */
export type ReckonerInputRule = "horizon" | "band";

/**
 * A model's declared opt-out from an input rule, one key per rule, whose VALUE
 * is the reason its mathematics justifies going beyond.
 *
 * The reason is the value rather than a sibling flag so an opt-out cannot be
 * taken without stating one: there is no spelling of "exempt from the horizon
 * rule" that does not also say why. `registerReckoner` rejects a blank reason
 * for the same purpose, because an empty string is a flag wearing the shape of
 * a sentence.
 *
 * A sound example is the one the rule cannot see from outside: a propagator
 * whose output genuinely outlives an input because that input only SEEDS the
 * integration and is never read again. The seed's own model running out says
 * nothing about how far the integration reaches.
 *
 * Every exemption in the running program is enumerable through
 * `getReckonerExemptions`, so an opt-out is reviewable rather than merely
 * possible: an Uplink's generated page lists its own, and a ledger suite pins
 * the whole set.
 */
export interface ReckonerExemptions {
  /** Why this model may reach past an input's horizon. */
  readonly horizon?: string;
  /** Why this model's band may claim more than its inputs' bands do. */
  readonly band?: string;
}

/**
 * A registered forward model, and the published inputs it needs.
 *
 * This is the registration surface: `registerReckoner` takes one of these, and
 * an Uplink reaches it through its client handle. `ReckonerFor` is the shape
 * the store calls internally once the inputs are resolved, and an author never
 * writes one.
 *
 * ## Why the inputs are DECLARED rather than reached for
 *
 * A reckoner that reaches for whatever it likes cannot be told from one whose
 * inputs never arrived: both answer nothing, and the caller sees a silent
 * `undefined` on a value the contract PROMISED was carriable. Declaring them
 * buys the honest decline that promise is worth: the store resolves each
 * declared input before the model runs, and an input the contract declared and
 * the frame did not carry produces
 * `declined: { reason: "input-absent", input: "@vessel.orbit" }` naming the
 * contract's own spelling, without the model being asked a question it cannot
 * answer.
 *
 * ## What the store enforces, and what it leaves to the model
 *
 * The store declines on behalf of a reckoner for the inputs the CONTRACT
 * declares, because that is exactly the promise a mark makes. A dep declared
 * HERE and not in the contract is the model's own refinement: it resolves to
 * `undefined` and the model decides, which is what lets a conic treat an absent
 * body roster as no evidence of an atmosphere rather than as a reason to blank
 * the reading. Withdrawal takes positive evidence; an absent optional input is
 * not evidence.
 */
export interface ReckonerDefinition<
  T,
  R = T,
  Deps extends readonly Dep[] = readonly Dep[],
  Windows extends DepWindows<Deps> = Record<never, never>,
> {
  /** Declared inputs, in the same notation a Processor's `deps` uses. */
  readonly deps: Deps;
  /**
   * How much of this topic's own record to hand the model, and the floor below
   * which it should not run at all. Omitted means one point: see
   * {@link ReckonerWindow} for why the bounds are shaped the way they are.
   */
  readonly window?: ReckonerWindow;
  /**
   * The deps that want their own history rather than one hold-last point,
   * each with its own span and cap. Keyed by the ids in `deps`.
   */
  readonly depWindows?: Windows;
  /**
   * The {@link ReckonerInputRule}s this model does not obey, each with the
   * reason its mathematics justifies it. Omitted, which is the normal case,
   * means the store applies both.
   */
  readonly exempt?: ReckonerExemptions;
  /**
   * Offer a model for `point` at `frame.viewUt`, or decline and say why. Cheap:
   * it is asked whether a model exists and what it covers.
   */
  reckon(
    point: TimelinePoint<T>,
    resolved: ResolvedReckonerDeps<Deps, Extract<keyof Windows, TopicId>>,
    frame: ReckonerFrame<T>,
  ): ReckonerAnswer<T, R>;
}

/**
 * A reckoner definition as the registry holds one, with its type parameters
 * erased to what a caller holding only a topic string can still say.
 *
 * Written out rather than spelled `ReckonerDefinition<unknown, unknown, ...>`
 * because the erasure IS the point: `reckon` is declared here with the argument
 * types the store passes and the answer type it reads back, so a definition
 * written against a concrete Topic reaches this shape by method bivariance and
 * the store calls it without an assertion in either direction. The two
 * `as unknown as` casts that used to bridge them were the same round trip
 * written twice, and neither said which way it was unsound.
 */
export interface AnyReckonerDefinition {
  /** Declared inputs, in the same notation a Processor's `deps` uses. */
  readonly deps: readonly Dep[];
  /** See {@link ReckonerDefinition.window}. */
  readonly window?: ReckonerWindow;
  /**
   * See {@link ReckonerDefinition.depWindows}. Erased to a string key here
   * for the same reason the rest of this interface is: the store looks a
   * window up by the dep it is already iterating, and holds no `Deps` to key
   * against.
   */
  readonly depWindows?: { readonly [dep: string]: DepWindow | undefined };
  /** See {@link ReckonerDefinition.exempt}. */
  readonly exempt?: ReckonerExemptions;
  /** See {@link ReckonerDefinition.reckon}; the store resolves `deps` in order. */
  reckon(
    point: TimelinePoint<unknown>,
    resolved: readonly unknown[],
    frame: ReckonerFrame<unknown>,
  ): ReckonerAnswer<unknown, unknown>;
}
