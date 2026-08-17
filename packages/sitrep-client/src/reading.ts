import type { StreamStatusValue } from "./stream-status";
import type { TimelinePoint } from "./timeline";

/**
 * One topic's value AND its currency, as a single thing the compiler will not
 * let a widget read incuriously.
 *
 * A widget that renders stale data as though it were live is this project's
 * most consequential failure mode. The weaker version of this fix already
 * exists and did not work: `StreamStatusValue` rides its own channel beside
 * the value (`useStreamStatus`), ui-kit renders it (`StreamStatusBadge`), and
 * the dashboard even derives a per-widget summary from `dataRequirements` and
 * badges the panel header with it (`useWidgetStreamStatus`). It was adopted by
 * zero of the thirty-nine widgets that read telemetry, because a badge beside
 * a body is chrome, and nothing forces the body to consult it.
 *
 * So the `stale` arm carries NO plain `value`. Reaching a value at all means
 * branching on `state`, and the branch is where the age and the caveat get
 * rendered. That is the entire mechanism, in the same spirit as `Value<"s">`
 * making unit-blindness unrepresentable.
 *
 * ## Delay is not staleness
 *
 * Under a light-time delay every value is old. If that counted as stale the
 * discriminant would read `stale` everywhere and carry no information at all.
 * A value 4 s old under a 4 s light-time is as current as physics permits, and
 * that is `current`. `stale` means we have MISSED updates we should have had,
 * which is what `HeartbeatTracker` infers from keyframe cadence and never from
 * `validAt` age (see its own doc). Reckoning is therefore only needed for
 * genuine loss of contact, not for the delay case.
 *
 * ## What each state means
 *
 * - `pending`: nothing at-or-before the frame's view time yet, a cold topic or
 *   a resync after a rewind. Names the never-arrived case that `undefined`
 *   currently conflates with went-stale
 * - `absent`: a confirmed tombstone, the subject says there is no value.
 *   Carries `atUt` because "confirmed nothing, as of when" is the honest
 *   statement: a tombstone can itself go old, and nothing before this could
 *   say so. It is what lets a widget report "no target set, confirmed 3 s ago"
 *   instead of asserting it for the rest of the mission
 * - `current`: the newest sample that could have reached us
 * - `stale`: we have missed updates. `lastObserved` always reaches the last
 *   REAL value, so the operator's "10% at last contact" is never a second
 *   channel to go and find, it is this same reading
 *
 * ## No horizon field, deliberately
 *
 * Nothing here says how far a `reckoned` value may be trusted. The provider
 * simply stops supplying one past its own horizon, so PRESENCE is the
 * statement of trust and there is nothing to over-extrapolate with. A horizon
 * field would invite a widget to compare against it and reckon anyway.
 *
 * ## The three-channel rule, and why this is its exception
 *
 * `stream-status.ts` and `use-certainty.ts` both state the repo rule: value,
 * staleness/absence, and certainty are three independent channels a widget
 * composes, never nested inside one another. This nests value inside
 * staleness, and does so on the evidence above: the beside-the-value form was
 * built end to end and ignored thirty-nine times out of thirty-nine.
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
  | { state: "current"; value: T; atUt: number }
  | {
      state: "stale";
      /**
       * Which kind of missed-update this is. A FIELD rather than three more
       * arms of the union: every stale renderer branches identically
       * (last-observed, an age, an optional reckoned value) and only the
       * caption differs, so three arms would be three copy-pasted branches in
       * thirty-nine widgets, drifting apart. Nothing is lost by making it a
       * field, because it is only reachable once the compiler has already
       * forced the caller into this arm.
       *
       * - `held-stale`: this ONE channel's keyframes stopped arriving on
       *   cadence, or the server stamped the point on catch-up
       * - `disconnected`: the whole transport is down, a link-wide fact rather
       *   than a per-topic inference. The operator's next move differs: check
       *   the relay, versus this craft is behind the Mun
       * - `last-before-blackout`: server-stamped, the newest sample that got
       *   out before a blackout the Courier already knew about
       */
      grade: "held-stale" | "disconnected" | "last-before-blackout";
      lastObserved: { value: T; atUt: number };
      /**
       * A forward-modelled value, when and only when something can honestly
       * model one. Optional WITHIN `stale` because most data can only be AGED,
       * not forward-modelled, and that is the honest majority.
       *
       * `basis` names the model in the operator's terms, so the rendering can
       * say what it is showing rather than presenting a number of unstated
       * provenance.
       *
       * Expect this to correlate with `grade` without being redundant to it.
       * A model needs to know WHEN contact was lost to integrate from, and
       * `last-before-blackout` is the only grade that knows: it is
       * server-stamped with the blackout's start. `held-stale` knows only that
       * a heartbeat was missed, so a provider will usually decline to reckon
       * from it. That is a tendency of the data, not a rule of the type: a
       * provider with an independent clock on the loss of contact may
       * legitimately reckon from any grade.
       */
      reckoned?: { value: T; atUt: number; basis: string };
    };

/**
 * Build a reading from what the store already knows: the sampled point (or its
 * absence) and the status `TimelineStore.sampleStatus` derived for the same
 * frame. Pure, so the hook is thin and this is what gets tested.
 *
 * Never populates `reckoned`. Reckoning is pulled per frame from a provider
 * that owns a model, and absence of the field is a real statement ("nothing
 * trustworthy can be said"), so fabricating one here would be the exact
 * dishonesty the type exists to prevent.
 */
export function readingFrom<T>(
  point: TimelinePoint<T> | undefined,
  status: StreamStatusValue,
): Reading<T> {
  if (!point || status === "resyncing") return { state: "pending" };
  // A tombstone outranks every staleness grade, the same precedence
  // `sampleRawStatus` uses and for the same reason: a confirmed absence is a
  // stronger claim than "may have changed, cannot tell". It also has no
  // last-observed VALUE to carry, so `stale` could not represent it anyway.
  if (point.payload === null || status === "absent") {
    return { state: "absent", atUt: point.validAt };
  }
  if (status === "live") {
    return { state: "current", value: point.payload, atUt: point.validAt };
  }
  return {
    state: "stale",
    grade: status,
    lastObserved: { value: point.payload, atUt: point.validAt },
  };
}

/**
 * How old the reading's observation is, in seconds of UT, measured against the
 * FRAME's view time (`useViewUt`) and nothing else.
 *
 * `viewUt` is a parameter rather than something read in here so this stays
 * pure, and so the caller cannot substitute `Date.now()` without it being
 * visible at the call site. Wall clock is the available wrong answer: it lets
 * two reads within one frame disagree about how old the same sample is, which
 * is the bug class `FrameToken` exists to prevent. `undefined` in gives
 * `undefined` out for the same reason, a widget with no provider mounted has
 * no legitimate "now" and should render no age rather than a fabricated one.
 *
 * `pending` has no age: there is no observation to be old.
 */
export function readingAge<T>(
  reading: Reading<T>,
  viewUt: number | undefined,
): number | undefined {
  if (viewUt === undefined) return undefined;
  const atUt =
    reading.state === "stale"
      ? reading.lastObserved.atUt
      : reading.state === "pending"
        ? undefined
        : reading.atUt;
  if (atUt === undefined) return undefined;
  // Samples arrive out of order (`ClientTimeline` insert-sorts for it), so one
  // can sit marginally ahead of the frame's view time. "-0.4 s old" is never a
  // thing to render.
  return Math.max(0, viewUt - atUt);
}
