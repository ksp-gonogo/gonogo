import type { TimelinePoint } from "./timeline";
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
 */
export type ReckoningBasis =
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
export interface Reckoning<T> {
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
   * whole-topic read only reaches `reckonable` when the model covers the root
   * (see `TopicModel`), so it is always well defined on a reckoning a caller
   * can hold.
   */
  modelled: readonly ModelledField[];
}

/** One path a model moved, and what moved it. See {@link Reckoning.modelled}. */
export interface ModelledField {
  /** Dotted from the payload root. `""` is the whole payload. */
  readonly path: string;
  readonly basis: ReckoningBasis;
}

/**
 * What a reckoner offers: the coverage it claims, and the pull that produces
 * the modelled payload.
 *
 * Coverage sits OUTSIDE the thunk because the store has to know what a model
 * answers for before deciding which arm to build, and running the model to
 * find out would defeat the pull. A model that does not cover the payload root
 * cannot answer for a whole-topic read, so that read stays `stale`.
 */
export interface TopicModel<T> {
  /** Paths this model moves. Empty claims nothing and is never offered. */
  readonly modelled: readonly ModelledField[];
  /** Run the model for `viewUt`. Pure: same inputs, same answer. */
  reckon(viewUt: number): T;
}

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
 * - `stale`: we have missed updates, and nothing can honestly model the gap.
 *   `value` is the last REAL observation, always reachable, and `asOfUt` says
 *   when it was made. This is the honest majority: most data can only be AGED
 * - `reckonable`: we have missed updates, AND a model exists. Carries the last
 *   observation exactly as `stale` does, plus `reckoned`
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
 * ## Why `reckonable` is an arm and `grade` is a field
 *
 * One rule, applied twice: compiler pressure is worth paying where it forces a
 * DIFFERENT branch, and worth trading away where it would force several
 * identical ones.
 *
 * `grade` does not change what you draw, it labels the same render, so three
 * arms would be three copy-pasted bodies drifting apart across thirty-nine
 * widgets. Field.
 *
 * A reckoning DOES change what you draw: a propagated position is a different
 * marker in a different place from a last-known position. An OPTIONAL `reckoned`
 * field on the stale arm was the first shape tried here and it was wrong,
 * because an optional field is one a destructuring consumer ignores by default
 * and ignoring it compiles. A reckoning that EXISTS could be silently dropped
 * while the widget still looked right, which is precisely the failure this type
 * is built to prevent. Arm.
 *
 * `reckoned` IS a plain field today, and that is not the shape that was
 * rejected: it is REQUIRED, and it sits on an arm a caller can only be inside by
 * having branched there. What was rejected was an optional field on an arm that
 * did not need it, where ignoring it was the default. Reaching this one still
 * means writing the discriminant.
 *
 * A widget may still legitimately decline to propagate (a scalar readout may
 * only want a number and a staleness caption). That has to be a WRITTEN choice:
 * see `withoutReckoning`.
 *
 * ## No horizon field, and no way to over-extrapolate
 *
 * Nothing here says how far a reckoning may be trusted, and `reckoned` is never
 * absent on an arm that carries it. Both fall out of the arm being rebuilt every frame: once the
 * provider's horizon is exceeded it stops offering a model, and the topic
 * simply presents as `stale` from that frame on. So the presence of the arm IS
 * the statement of trust, structurally rather than by convention, and there is
 * no horizon for a caller to compare against and reckon anyway.
 *
 * **Do not make `reckoned` able to answer "unavailable".** The absence of
 * the `reckonable` arm already says it, at the only moment it can be said
 * honestly. A failure return would mean a caller could hold a capability that
 * has since gone bad and discover it at call time, which puts an error path in
 * thirty-nine widgets to represent something the discriminant already carries.
 * If a model needs to withdraw, it withdraws by not being offered on the next
 * frame.
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
export type Reading<T> =
  | { state: "pending" }
  | { state: "unowned" }
  | { state: "absent"; atUt: Value<"ut"> }
  | { state: "observed"; value: T; atUt: Value<"ut"> }
  | {
      state: "stale";
      /** The last REAL observation. Never a modelled value. */
      value: T;
      /** The UT that observation was made at. */
      asOfUt: Value<"ut">;
      grade: StaleGrade;
    }
  | {
      state: "reckonable";
      /** The last REAL observation, exactly as on `stale`. Never modelled. */
      value: T;
      asOfUt: Value<"ut">;
      grade: StaleGrade;
      /**
       * The forward-modelled value for this frame's view time, computed when the
       * arm is built.
       *
       * A PLAIN FIELD, and the reasoning is worth keeping because it went the
       * other way twice first. Laziness was justified as "a reckoner is
       * provider-supplied, so its cost is not ours to assume". The same is true
       * of everything else in this system: an Uplink's mapper runs every tick,
       * its derived channel's `derive` runs every frame, its processor's
       * `compute` runs every frame, and class B's projection IS a derived
       * channel. Provider-supplied compute on the frame path is what this whole
       * pipeline is, so reckoning being the single exception was an
       * inconsistency rather than a principle. A mechanism that defends against
       * its own providers is one that expects to be rare, and this one is meant
       * to be universal.
       *
       * Cost is answered by DECLARATION instead: a topic whose model is too
       * expensive to run per frame goes in `NEVER_RECKONABLE`'s
       * too-expensive group, which is a reviewable engineering decision in the
       * same list as every other classification rather than a mechanism hidden
       * in the type.
       *
       * Being a field rather than a getter also removes a whole failure mode
       * instead of defending against it: a getter is lost by a spread, and lost
       * SILENTLY, because the spread evaluates it and freezes one frame's answer
       * as a permanent plain value. A field survives a copy.
       *
       * Fresh per frame either way, which is what the identity contract needs: a
       * reckoning is a function of the view time, so an arm that kept its
       * identity while `viewUt` advanced would answer for a moment that had
       * passed, and a model could never withdraw at its horizon. The store
       * re-derives this arm (and only this arm) when the frame's view time
       * moves; `stale` keeps the frozen identity that stops every widget
       * re-rendering at frame cadence. See `TimelineStore.sampleReading`.
       */
      reckoned: Reckoning<T>;
    };

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
 * Expect `reckonable` to correlate with `last-before-blackout` without the type
 * enforcing it. A model needs to know WHEN contact was lost to integrate from,
 * and that is the only grade that knows, being stamped with the blackout's
 * start. `held-stale` knows only that a heartbeat was missed. A provider with
 * an independent clock on the loss of contact may legitimately reckon from any
 * grade, which is why the arm split is by whether a model EXISTS rather than by
 * grade.
 */
export type StaleGrade =
  | "held-stale"
  | "disconnected"
  | "last-before-blackout"
  | "recorded";

/**
 * The discriminant alone, for the handful of types that carry a reading's ARM
 * beside a value they joined from several topics rather than nesting the
 * `Reading` itself (`BudgetProvenance`, `LevelsProvenance`).
 *
 * Derived rather than written out, because both of those spelled the five arms
 * as a literal union and both silently went stale the moment a sixth was added:
 * the compiler caught them here, at the assignment, rather than where the
 * mirror was declared. A derived alias makes the next arm propagate on its own.
 *
 * This is NOT a licence to replace a `Reading` with its state. A provenance
 * field is for a value that is not one Topic's anything; a widget reading one
 * topic takes the whole `Reading`, so that reaching the value means branching.
 */
export type ReadingState = Reading<unknown>["state"];

/**
 * Collapse `reckonable` down to `stale`: the written, greppable way for a
 * widget to decline to propagate.
 *
 * Note it no longer avoids the model's COST: `reckoned` is computed when the arm
 * is built, so by the time a widget collapses the arm the model has already run.
 * This is about what gets DRAWN, not about saving work; a topic whose model is
 * too expensive to run per frame belongs in `NEVER_RECKONABLE`'s too-expensive
 * group instead.
 *
 * Legitimate for a scalar readout that wants the last observed number with a
 * staleness caption and no modelled figure. It exists as a named helper so the
 * decision shows up in review and "which widgets decline to reckon" is a
 * search. Without one, thirty-nine widgets would collapse the two arms with an
 * inline fallthrough and the optional field would be back by convention.
 *
 * **Never use this on anything that draws a POSITION or an ATTITUDE.** A marker
 * or a reticle placed from a last-known value asserts something about now that
 * it cannot know, and that is the sharpest form of the failure this type
 * exists to prevent. Such a widget should either propagate or stop drawing.
 */
export function withoutReckoning<T>(reading: Reading<T>): Reading<T> {
  if (reading.state !== "reckonable") return reading;
  return {
    state: "stale",
    value: reading.value,
    asOfUt: reading.asOfUt,
    grade: reading.grade,
  };
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
 * a producer, and a tombstone is data. `stale` and `reckonable` likewise, since
 * a domain that reported and went quiet is still installed.
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
    case "reckonable":
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
 * `unowned` there never will be. Every other arm has one, `reckonable` included, where
 * the age of the last real contact is the number an operator wants beside a modelled
 * figure.
 *
 * Callers still clamp at zero. Samples arrive out of order (`ClientTimeline`
 * insert-sorts for it), so one can sit marginally ahead of the frame's view time, and
 * "-0.4 s old" is never a thing to render.
 */
export function observedAt<T>(reading: Reading<T>): Value<"ut"> | undefined {
  switch (reading.state) {
    case "pending":
    case "unowned":
      return undefined;
    case "absent":
    case "observed":
      return reading.atUt;
    case "stale":
    case "reckonable":
      return reading.asOfUt;
  }
}

/**
 * A provider of forward models, consulted once per reading. Returning
 * `undefined` is the honest majority answer and produces a `stale` reading;
 * returning a model produces `reckonable`.
 *
 * `TopicModel.reckon` is what makes the reckoning a pull. This function itself
 * must stay cheap: it is asked whether a model EXISTS and what it covers,
 * which are questions about the basis, not requests to run it.
 *
 * `viewUt` is the third argument because declining is the ONLY way a model has
 * to express a horizon, and a horizon is a statement about how far a value is
 * being carried. Given the point and the grade alone, a reckoner knows when
 * the observation was made and not what it is being asked to reach, so it
 * could not decline at the one moment declining matters. Everything
 * `Reading`'s doc says about the arm's presence being the statement of trust
 * rests on this argument existing.
 */
export type ReckonerFor<T> = (
  point: TimelinePoint<T>,
  grade: StaleGrade,
  viewUt: number,
) => TopicModel<T> | undefined;
