import type { TimelinePoint } from "./timeline";

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
  atUt: number;
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
 * value (`useStreamStatus`), ui-kit renders it (`StreamStatusBadge`), and the
 * dashboard even derives a per-widget summary from `dataRequirements` and
 * badges the panel header with it (`useWidgetStreamStatus`). It was adopted by
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
  | { state: "absent"; atUt: number }
  | { state: "observed"; value: T; atUt: number }
  | {
      state: "stale";
      /** The last REAL observation. Never a modelled value. */
      value: T;
      /** The UT that observation was made at. */
      asOfUt: number;
      grade: StaleGrade;
    }
  | {
      state: "reckonable";
      /** The last REAL observation, exactly as on `stale`. Never modelled. */
      value: T;
      asOfUt: number;
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
 *
 * Expect `reckonable` to correlate with `last-before-blackout` without the type
 * enforcing it. A model needs to know WHEN contact was lost to integrate from,
 * and that is the only grade that knows, being stamped with the blackout's
 * start. `held-stale` knows only that a heartbeat was missed. A provider with
 * an independent clock on the loss of contact may legitimately reckon from any
 * grade, which is why the arm split is by whether a model EXISTS rather than by
 * grade.
 */
export type StaleGrade = "held-stale" | "disconnected" | "last-before-blackout";

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
 * How old the reading's observation is, in seconds of UT, measured against the
 * FRAME's view time (`useViewUt`) and nothing else.
 *
 * `viewUt` is a parameter rather than something read in here so this stays
 * pure, and so a caller cannot substitute `Date.now()` without it being visible
 * at the call site. Wall clock is the available wrong answer: it lets two reads
 * within one frame disagree about how old the same sample is, which is the bug
 * class `FrameToken` exists to prevent, and a ratchet
 * (`styleguide-wall-clock.test.ts`) now guards it. `undefined` in gives
 * `undefined` out for the same reason: a widget with no provider mounted has no
 * legitimate "now" and should render no age rather than a fabricated one.
 *
 * `pending` has no age: there is no observation to be old. This measures the
 * OBSERVATION in every other case, including `reckonable`, where the age of the
 * last real contact is the number an operator wants next to a modelled figure.
 */
export function readingAge<T>(
  reading: Reading<T>,
  viewUt: number | undefined,
): number | undefined {
  if (viewUt === undefined) return undefined;
  const atUt = observedAtUt(reading);
  if (atUt === undefined) return undefined;
  // Samples arrive out of order (`ClientTimeline` insert-sorts for it), so one
  // can sit marginally ahead of the frame's view time. "-0.4 s old" is never a
  // thing to render.
  return Math.max(0, viewUt - atUt);
}

function observedAtUt<T>(reading: Reading<T>): number | undefined {
  switch (reading.state) {
    case "pending":
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
 * What an instrument may pass judgement on.
 *
 * ## Why this is not a way to skip the decision
 *
 * A generic "just give me the value" accessor would be, and it was rejected for
 * that reason: it lets a call site keep its pre-migration shape and never confront
 * currency at all. This is the opposite. It answers a narrower question, and its
 * `undefined` arm is the decision, not an escape from it:
 *
 * > may this widget draw a verdict from this reading, right now?
 *
 * `observed` yes, because it is the current value. `reckonable` yes, because the
 * value has been modelled forward to the view time and that is what a model is
 * for. `stale` **no**, and that is the whole point: a badge that turns a
 * seconds-old reading into "NOMINAL" states something about the vessel now, from
 * evidence about the vessel then. `pending` and `absent` no, as before.
 *
 * So every caller still has to answer "and what do I render when there is no
 * verdict to give?", which is the question the sweep exists to force. What this
 * removes is twenty copies of the same three-arm switch, not the decision.
 *
 * ## When NOT to use it
 *
 * A widget that can date what it draws should not use this. A number beside a
 * label can carry "as of 14s ago" honestly and stay useful, so a readout should
 * branch on the arms itself and caption the stale case rather than blanking it.
 * This is for the widgets that convert a value into a JUDGEMENT: a band, a pill, a
 * GO/NO-GO, an alarm. A judgement cannot be dated, because its whole content is
 * "this is the situation", and the operator reads it as now.
 */
export function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

/**
 * Whether a reading is being withheld from a judgement because it went stale,
 * rather than because it never arrived.
 *
 * Pairs with `judgeable`: it returns `undefined` for three different reasons, and
 * a widget must not present all three the same way. "Waiting for telemetry" on
 * first paint and "the link dropped mid-flight" are different statements, and an
 * instrument that conflates them accuses the link of dropping every time the page
 * loads.
 */
export function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

/**
 * The value of a fact that stays true until something changes it.
 *
 * Some payloads are not measurements. A crew roster, a vessel name, a part tree,
 * the current game scene: these change when an EVENT changes them, and no event
 * can reach us down a link that is not delivering. So the last one received is
 * still the best answer, and withholding it would be worse than useless: it would
 * blank the roster of a crew that is demonstrably still aboard.
 *
 * That is a real distinction and not a softer version of `judgeable`. The test is
 * whether the value can drift on its own while nobody is looking. An altitude can.
 * A crew manifest cannot.
 *
 * **Use it per field, not per topic.** A topic routinely carries both kinds, and
 * `vessel.crew` is the example: the roster is a fact and keeps its value here,
 * while the EVA suit's oxygen on the same record is a quantity that only falls,
 * and that one goes through `judgeable`. Reaching for this at topic level is how a
 * decaying number gets waved through as a fact.
 *
 * ## Why the second argument is required
 *
 * `absent` means the subject CONFIRMED there is nothing: an empty roster, no
 * targets in range, no contracts accepted. For a fact that is a real answer, and a
 * different one from "nothing has reached us yet".
 *
 * The first version of this returned `undefined` for both, and several widgets
 * already distinguished them, usually by the accident of a gate spelled
 * `=== undefined` against a payload that arrived as `null`. `TargetPicker` renders
 * "No targets in range." for one and "Waiting for target list" for the other, and
 * that survived its migration only because of the accident.
 *
 * Returning `T | null | undefined` would not fix it: `stillTrue(x)?.field`
 * short-circuits on `null` exactly as it does on `undefined`, and so does `??`, so
 * the tombstone would keep vanishing without a single type error. An instrument
 * that cannot express a distinction does not get to ask its callers to remember it.
 *
 * So the tombstone's meaning is named at the call site, and omitting it does not
 * compile. Pass `undefined` deliberately where a confirmed nothing really does read
 * like a wait: that is then a decision on the page rather than a default nobody
 * chose.
 */
export function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

/**
 * A measurement the widget can present with its age attached.
 *
 * The third case, and `judgeable`'s own doc already names it: a number beside a
 * label can carry "as of 14s ago" honestly and stay useful, so blanking it throws
 * away something the operator can still reason about. What separates this from
 * `judgeable` is not the data but what the widget does with it. A band or a
 * countdown is read as "the situation now" and cannot be dated. An orbital element
 * feeding a plan the operator reviews before committing can be.
 *
 * `reckoned` is preferred over `value` where a model exists, because a propagated
 * orbit is not dated at all: it IS the current one, which is the entire reason the
 * reckoning layer exists. `needsDating` is false in that case, so the caller does
 * not caption a value that needs no caption.
 *
 * Returns the value alongside whether it needs dating, because a caller given only
 * the value cannot tell, and one given only the flag has nothing to draw.
 */
export function dateable<T>(reading: Reading<T>): {
  value: T | undefined;
  needsDating: boolean;
} {
  if (reading.state === "observed") {
    return { value: reading.value, needsDating: false };
  }
  if (reading.state === "reckonable") {
    return { value: reading.reckoned.value, needsDating: false };
  }
  if (reading.state === "stale") {
    return { value: reading.value, needsDating: true };
  }
  return { value: undefined, needsDating: false };
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
