import type { StreamStatusValue } from "./stream-status";
import type { TimelinePoint } from "./timeline";

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
 *   observation exactly as `stale` does, plus `reckon()`
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
 * marker in a different place from a last-known position. An optional
 * `reckoned` field was the first shape tried here and it was wrong, because an
 * optional field is one a destructuring consumer ignores by default and
 * ignoring it compiles. A reckoning that EXISTS could be silently dropped while
 * the widget still looked right, which is precisely the failure this type is
 * built to prevent. Arm.
 *
 * A widget may still legitimately decline to propagate (a scalar readout may
 * only want a number and a staleness caption). That has to be a WRITTEN choice:
 * see `withoutReckoning`.
 *
 * ## No horizon field, and no way to over-extrapolate
 *
 * Nothing here says how far a reckoning may be trusted, and `reckon()` never
 * declines. Both fall out of the arm being rebuilt every frame: once the
 * provider's horizon is exceeded it stops offering a model, and the topic
 * simply presents as `stale` from that frame on. So the presence of the arm IS
 * the statement of trust, structurally rather than by convention, and there is
 * no horizon for a caller to compare against and reckon anyway.
 *
 * **Do not add a "reckoning unavailable" return to `reckon()`.** The absence of
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
       * Pull the forward-modelled value. A PULL rather than a field because a
       * reckoning nobody reads must cost nothing: eagerly computing one would
       * propagate every topic with a basis on every frame regardless of
       * consumers. Route the model through `defineProcessor` and the cost is
       * once per frame per topic actually read, and zero otherwise.
       *
       * Frame-stable: the whole reading keeps its identity while its inputs are
       * unchanged (see `readingFrom`'s caller), so this function's identity is
       * stable too and is safe in a dependency array. A fresh identity per
       * frame would have defeated memoisation in every consumer.
       */
      reckon: () => Reckoning<T>;
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
 * A provider of forward models, consulted once per reading. Returning
 * `undefined` is the honest majority answer and produces a `stale` reading;
 * returning a thunk produces `reckonable`.
 *
 * The thunk is what makes the reckoning a pull. This function itself must stay
 * cheap: it is asked whether a model EXISTS, which is a question about the
 * basis, not a request to run the model.
 */
export type ReckonerFor<T> = (
  point: TimelinePoint<T>,
  grade: StaleGrade,
) => (() => Reckoning<T>) | undefined;

/**
 * Build a reading from what the store already knows: the sampled point (or its
 * absence), the status `TimelineStore.sampleStatus` derived for the same frame,
 * and optionally a reckoner to ask for a forward model. Pure, so the hook stays
 * thin and this is what gets tested.
 *
 * With no reckoner, or one that declines, a missed-update reading is `stale`.
 * That is deliberately the default: absence of a model is a real statement
 * ("nothing trustworthy can be said"), so nothing here invents one.
 */
export function readingFrom<T>(
  point: TimelinePoint<T> | undefined,
  status: StreamStatusValue,
  reckoner?: ReckonerFor<T>,
): Reading<T> {
  if (!point || status === "resyncing") return { state: "pending" };
  // A tombstone outranks every staleness grade, the same precedence
  // `sampleRawStatus` uses and for the same reason: a confirmed absence is a
  // stronger claim than "may have changed, cannot tell". It also has no
  // observed VALUE to carry, so the stale arms could not represent it anyway.
  if (point.payload === null || status === "absent") {
    return { state: "absent", atUt: point.validAt };
  }
  if (status === "live") {
    return { state: "observed", value: point.payload, atUt: point.validAt };
  }
  const reckon = reckoner?.(point, status);
  if (reckon) {
    return {
      state: "reckonable",
      value: point.payload,
      asOfUt: point.validAt,
      grade: status,
      reckon,
    };
  }
  return {
    state: "stale",
    value: point.payload,
    asOfUt: point.validAt,
    grade: status,
  };
}

/**
 * Collapse `reckonable` down to `stale`: the written, greppable way for a
 * widget to decline to propagate.
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
