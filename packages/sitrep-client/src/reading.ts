/**
 * Minting a reading from the timeline.
 *
 * The `Reading` union itself, its reckoning types and every consumer-side accessor
 * live in `@ksp-gonogo/sitrep-sdk`, because an Uplink widget receives one and cannot
 * import this package. Re-exported here so existing imports read the same.
 */
/**
 * Producer-side, and it stays here for a reason worth stating: a reckoner receives a
 * `TimelinePoint`, which is the store's own type. So a third-party Uplink can USE a
 * reading completely and cannot yet PROVIDE a model for one. That is a real gap in
 * the devkit rather than an accident of where this line sits.
 */

export type {
  ModelledField,
  Reading,
  ReckonerFor,
  Reckoning,
  ReckoningBasis,
  StaleGrade,
  TopicModel,
} from "@ksp-gonogo/sitrep-sdk";
export {
  dateable,
  judgeable,
  notCurrent,
  observedAt,
  stillTrue,
  withoutReckoning,
} from "@ksp-gonogo/sitrep-sdk";

import type {
  ModelledField,
  Reading,
  ReckonerFor,
  StaleGrade,
  TopicModel,
} from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import type { StreamStatusValue } from "./stream-status";
import type { TimelinePoint } from "./timeline";

/** The entry in `modelled` covering the whole payload, if the model claims it. */
function rootCoverage(model: {
  modelled: readonly ModelledField[];
}): ModelledField | undefined {
  return model.modelled.find((field) => field.path === "");
}

/**
 * Build a reading from what the store already knows: the sampled point (or its
 * absence), the status `TimelineStore.sampleStatus` derived for the same frame,
 * and optionally a reckoner to ask for a forward model. Pure, so the hook stays
 * thin and this is what gets tested.
 *
 * With no reckoner, one that declines, or one whose coverage does not reach the
 * payload root, a missed-update reading is `stale`. That is deliberately the
 * default: absence of a model is a real statement ("nothing trustworthy can be
 * said"), so nothing here invents one, and a model that moves one field of
 * forty-seven has not modelled the payload a whole-topic read asks for.
 *
 * `viewUt` is the frame's frozen view time and is required rather than
 * optional: every reckoning is a function of it, and a default would let a
 * caller build a reading whose modelled value silently answered for the wrong
 * moment.
 */
export function readingFrom<T>(
  point: TimelinePoint<T> | undefined,
  status: StreamStatusValue,
  viewUt: number,
  reckoner?: ReckonerFor<T>,
): Reading<T> {
  if (!point || status === "resyncing") return { state: "pending" };
  // A tombstone outranks every staleness grade, the same precedence
  // `sampleRawStatus` uses and for the same reason: a confirmed absence is a
  // stronger claim than "may have changed, cannot tell". It also has no
  // observed VALUE to carry, so the stale arms could not represent it anyway.
  if (point.payload === null || status === "absent") {
    return { state: "absent", atUt: value("ut", point.validAt) };
  }
  if (status === "live") {
    return {
      state: "observed",
      value: point.payload,
      atUt: value("ut", point.validAt),
    };
  }
  const model = reckoner?.(point, status, viewUt);
  const root = model && rootCoverage(model);
  if (model && root) {
    const observed = point.payload;
    // Memoised for the life of this arm, which is the life of this frame's view
    // time: the arm is rebuilt whenever `viewUt` moves, so the cache expires
    // with it and needs no invalidation of its own. The same reasoning that
    // makes rebuilding the arm correct makes caching inside it correct.
    //
    // It matters because a call site wanting both the number and its provenance
    // naturally writes `reckon().value` in one place and `reckon().basis` in
    // another. Uncached that is two model runs (for class A, two Kepler solves)
    // and, worse, TWO OBJECT IDENTITIES for one frame's answer: the identity
    // trap already fixed in `sampleReading` and in the processor evaluator,
    // reappearing one layer in. The hazard is not the cost, it is one question
    // asked twice inside a frame being able to give two answers.
    //
    // The model runs HERE, once per arm build, which is once per frame per topic
    // actually read. Eager rather than pulled: provider-supplied compute on the
    // frame path is what this whole pipeline already is, and cost is answered by
    // declaring a topic too expensive rather than by a mechanism in the type.
    // See the arm's own doc.
    return {
      state: "reckonable",
      value: observed,
      asOfUt: value("ut", point.validAt),
      grade: status,
      reckoned: {
        value: model.reckon(viewUt),
        atUt: value("ut", viewUt),
        basis: root.basis,
        modelled: model.modelled,
      },
    };
  }
  return {
    state: "stale",
    value: point.payload,
    asOfUt: value("ut", point.validAt),
    grade: status,
  };
}
