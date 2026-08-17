import { defineProcessor } from "@ksp-gonogo/sitrep-client";

/**
 * The pull point a forward-modelled target position will hang off. **Stubbed:
 * it computes nothing today, deliberately.**
 *
 * A `Reading`'s `reckoned` field is optional precisely so that supplying
 * nothing is a real statement ("nothing trustworthy can be said"), and
 * PRESENCE is the statement of trust. A stub that returned a plausible number
 * would therefore be worse than no stub at all: it would make the type lie in
 * exactly the way the type exists to prevent. So this returns `undefined` and
 * the widget renders no reckoned row.
 *
 * It is a real `defineProcessor` rather than a bare function because the seam
 * is the point: `useProcessor` ref-counts activation and the evaluator
 * memoises per frame, so a reckoning nobody reads costs nothing however many
 * widgets could have read it. Proving that path works end to end is worth more
 * than proving a placeholder returns undefined.
 *
 * ## What it needs before it can be built, and cannot currently have
 *
 * Dead reckoning a relative position needs three things: the last observed
 * position and velocity, the UT that observation was made at, and confirmation
 * that we are actually out of contact rather than merely delayed. Only the
 * first is reachable here. `defineProcessor` deps resolve to
 * `TopicPayload<D> | undefined`, which is the VALUE channel alone: a processor
 * cannot see a topic's status or its `validAt`, so it cannot tell whether it
 * should be reckoning at all, nor what to integrate from.
 *
 * That is a gap in the processor primitive, not in this widget, and the fix is
 * a decision rather than an oversight: either a dep form that resolves to a
 * `Reading<T>` instead of a payload, or a processor-visible frame view time.
 * Flagged rather than worked around, because working around it here would put
 * a second clock in a widget.
 *
 * ## The horizon, when it does get built
 *
 * Relative motion between an orbiting pair is curved, so a linear
 * dead-reckoning from relative velocity is honest for seconds, not minutes.
 * This processor's job is therefore to STOP returning a value past its own
 * horizon rather than to publish one with a caveat attached, which is why
 * `Reading` carries no horizon field for anyone to extrapolate against.
 */
export const targetReckoning = defineProcessor({
  id: "target-reckoning",
  owner: "distance-to-target",
  deps: ["vessel.target"] as const,
  compute: (): { distanceM: number; atUt: number; basis: string } | undefined =>
    undefined,
});
