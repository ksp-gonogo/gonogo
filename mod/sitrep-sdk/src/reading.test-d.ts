import type {
  Reading,
  ReckonableReading,
  ReckoningDecline,
  UnmodelledReading,
} from "./reading";
import type { Value } from "./unit-system/value";

/**
 * The compiler pressure `Reading` exists to apply, asserted rather than
 * believed.
 *
 * `reckonability` moved off `state` and onto its own `reckoning` discriminant so
 * that live-and-reckonable became representable. The obvious way to do that is
 * an OPTIONAL `reckoned` field, and it is the wrong way: an optional field
 * compiles everywhere and answers `undefined`, so a destructuring consumer
 * ignores a reckoning that EXISTS by default and the widget still looks right.
 * That is the exact failure the type is built to prevent, and nothing in a
 * migration of ninety call sites would have noticed the guarantee quietly
 * turning into that.
 *
 * This file runs only under `pnpm typecheck`, the sole pass that compiles
 * `*.test-d.ts` (vitest goes through esbuild and never typechecks).
 *
 * ## Every assertion here is two-sided
 *
 * Each `@ts-expect-error` fails BOTH ways round: it fails if the line starts
 * compiling, because the directive is then unused, and it fails if the line
 * errors for some unrelated reason a reader would misread as the guarantee
 * holding. A one-sided check on absence reports success when it has gone blind,
 * which is how a guarantee gets deleted under a passing suite.
 */

declare const reading: Reading<number>;

/*
 * The guarantee. Reaching a reckoning costs a written test, exactly as reaching
 * a value costs one: on a reading nobody has narrowed, `reckoned` is not merely
 * absent at runtime, it is absent from the type.
 */
// @ts-expect-error `reckoned` is unreachable until `reckoning` is narrowed.
export const unnarrowed = reading.reckoned;

/*
 * And narrowing the OTHER axis does not open it. This is the half that would
 * have been lost by folding the reckoning back into `state`, and the half a
 * migration is most likely to break by accident: a widget that has established
 * a value is not thereby entitled to a model.
 */
export function narrowingStateAloneIsNotEnough(r: Reading<number>) {
  if (r.state === "stale") {
    // @ts-expect-error a value-bearing state does not imply a model.
    return r.reckoned;
  }
  if (r.state === "observed") {
    // @ts-expect-error the same on the live side, which is the new capability.
    return r.reckoned;
  }
  return undefined;
}

/*
 * The axes narrow independently and in either order, which is what makes them
 * orthogonal rather than nested. Both of these compile, and a shape that
 * reintroduced the nesting would break one of them.
 */
export function reckoningNarrowsWithoutState(
  r: Reading<number>,
): number | null {
  return r.reckoning === "available" ? r.reckoned.value : null;
}

export function reckoningSurvivesLive(r: Reading<number>): Value<"ut"> | null {
  /*
   * A live reading carrying a model: unrepresentable before the axes split, and
   * the whole point of splitting them. `atUt` proves the narrowing landed on the
   * observed member rather than collapsing to `never`.
   */
  if (r.state === "observed" && r.reckoning === "available") return r.atUt;
  return null;
}

export function staleWithoutAModelStillHasItsValue(r: Reading<number>): number {
  if (r.state === "stale" && r.reckoning === "none") return r.value;
  return 0;
}

/*
 * `UnmodelledReading` is the type a topic in `NEVER_RECKONABLE` reads as, and
 * the return of `withoutReckoning`. It keeps every state, so the judgement
 * `stale` demands is undiminished, and it can never carry a model.
 */
declare const unmodelled: UnmodelledReading<number>;

// @ts-expect-error an unmodelled reading has no `reckoned` in any state.
export const noModelOnUnmodelled = unmodelled.reckoned;

export const unmodelledKeepsItsStates:
  | "pending"
  | "unowned"
  | "absent"
  | "observed"
  | "stale" = unmodelled.state;

/*
 * A `Reading` is assignable FROM an unmodelled one and not the other way, which
 * is what makes declining to propagate a narrowing rather than a cast.
 */
export const wideningIsFine: Reading<number> = unmodelled;

// @ts-expect-error narrowing back has to be a written decision, not an assignment.
export const narrowingIsNot: UnmodelledReading<number> = reading;

/*
 * `ReckonableReading` is what a topic whose CONTRACT declares a value
 * reckonable reads as. Two things distinguish it and both are asserted here:
 * the model answers with the declared PROJECTION rather than the payload, and a
 * value-bearing arm always says something about the model, either the model
 * itself or the reason it declined.
 *
 * `situation` stands in for the field no model moves. It is the whole reason
 * the projection exists: a conic advances an altitude and does not advance a
 * discrete state the game switches, and before the projection both came back
 * off one object labelled "modelled".
 */
interface Flightish {
  altitudeAsl: number;
  situation: string;
}

declare const reckonable: ReckonableReading<Flightish, "altitudeAsl">;

/*
 * The guarantee `Reading` already applies, applied here too: the projection is
 * unreachable until the reckoning discriminant has been written.
 */
// @ts-expect-error `reckoned` is unreachable until `reckoning` is narrowed.
export const declaredButUnnarrowed = reckonable.reckoned;

/*
 * Narrowing the reckoning alone reaches the model on BOTH value-bearing arms at
 * once, live and stale, which is what makes them one capability rather than two.
 */
export function everyValueBearingArmCarriesTheModel(
  r: ReckonableReading<Flightish, "altitudeAsl">,
): number | null {
  return r.reckoning === "available" ? r.reckoned.value.altitudeAsl : null;
}

/*
 * And the projection really is narrower than the payload. This is the assertion
 * the whole per-value design exists for: a field no model moves is not merely
 * undocumented on `reckoned`, it does not typecheck.
 */
export function theProjectionIsNarrowerThanThePayload(
  r: ReckonableReading<Flightish, "altitudeAsl">,
): string | null {
  if (r.reckoning === "available") {
    // @ts-expect-error no model moves `situation`, so it is not in the projection.
    return r.reckoned.value.situation;
  }
  return null;
}

/*
 * The same fact stated as an assignment, so a projection that quietly widened
 * back to the payload would fail here as well as above.
 */
export function theProjectionIsNotThePayload(
  r: ReckonableReading<Flightish, "altitudeAsl">,
): Flightish | null {
  // @ts-expect-error the modelled fields are not a whole payload.
  if (r.reckoning === "available") return r.reckoned.value;
  return null;
}

/*
 * A decline is REACHABLE on the value-bearing `"none"` arms, and carries the
 * reason. A declared value has a model on offer, so `"none"` there is a specific
 * refusal rather than the honest majority answer it is on a plain `Reading`.
 */
export function aDeclineIsReachableAndSaysWhy(
  r: ReckonableReading<Flightish, "altitudeAsl">,
): ReckoningDecline["reason"] | null {
  if (r.state === "observed" && r.reckoning === "none")
    return r.declined.reason;
  if (r.state === "stale" && r.reckoning === "none") return r.declined.reason;
  return null;
}

/*
 * And the two are exclusive, in both directions. A decline is a value-level
 * absence inside a type-level presence: the declaration says the capability
 * exists, the arm says whether it fired, and neither arm can answer for the
 * other.
 */
export function aDeclinedArmHasNoModel(
  r: ReckonableReading<Flightish, "altitudeAsl">,
) {
  if (r.state === "observed" && r.reckoning === "none") {
    // @ts-expect-error a declined arm carries the reason, never a model.
    return r.reckoned;
  }
  return undefined;
}

export function aModelledArmHasNoDecline(
  r: ReckonableReading<Flightish, "altitudeAsl">,
) {
  if (r.reckoning === "available") {
    // @ts-expect-error a model that answered has nothing to decline.
    return r.declined;
  }
  return undefined;
}

/*
 * The arms that carry no value carry neither. There is nothing to advance, so
 * there is nothing to refuse either.
 */
export function anEmptyArmCarriesNeither(
  r: ReckonableReading<Flightish, "altitudeAsl">,
) {
  if (r.state === "pending") {
    // @ts-expect-error nothing observed, so nothing declined.
    return r.declined;
  }
  return undefined;
}

/*
 * A plain `Reading` is untouched by any of this, which is what keeps every
 * unmarked topic compiling. Its `"none"` arms have no `reckoned`, exactly as
 * before, and they have gained no `declined`: an undeclared topic saying "no
 * model" owes nobody a reason.
 */
export function aPlainReadingIsUnchanged(r: Reading<number>) {
  if (r.reckoning === "none") {
    // @ts-expect-error the unmodelled arms of a plain reading carry no model.
    return r.reckoned;
  }
  return undefined;
}

export function aPlainReadingOwesNoReason(r: Reading<number>) {
  if (r.state === "observed" && r.reckoning === "none") {
    // @ts-expect-error only a DECLARED value's decline has a reason to carry.
    return r.declined;
  }
  return undefined;
}

/*
 * Neither union is assignable to the other, and the failing direction is the
 * load-bearing one: handing a reckonable reading to something typed
 * `Reading<T>` would entitle the callee to read the whole payload off the
 * model. This is the inverse of `wideningIsFine` above, and it has to stay an
 * error for the projection to mean anything.
 */
// @ts-expect-error a projection is not a payload, so this is not a widening.
export const reckonableIsNotAReading: Reading<Flightish> = reckonable;

declare const plainFlight: Reading<Flightish>;

// @ts-expect-error a plain reading declares no model and owes no decline.
export const aReadingIsNotReckonable: ReckonableReading<
  Flightish,
  "altitudeAsl"
> = plainFlight;
