import type { ModelledField, Reading, ReckonerFor } from "../reading";
import { value } from "../unit-system/value";

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
  ReadingReckoning,
  ReadingState,
  ReckonableReading,
  ReckonerAnswer,
  ReckonerFor,
  Reckoning,
  ReckoningBasis,
  ReckoningDecline,
  StaleGrade,
  TopicModel,
  UnmodelledReading,
} from "../reading";
export { hasAnswered, observedAt, withoutReckoning } from "../reading";

import type { TimelinePoint } from "./client-timeline";
import type { StreamStatusValue } from "./stream-status";

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
 * payload root, the reading is `reckoning: "none"` whatever its `state`. That is
 * deliberately the default: absence of a model is a real statement ("nothing
 * trustworthy can be said"), so nothing here invents one, and a model that moves
 * one field of forty-seven has not modelled the payload a whole-topic read asks
 * for.
 *
 * `viewUt` is the frame's frozen view time and is required rather than
 * optional: every reckoning is a function of it, and a default would let a
 * caller build a reading whose modelled value silently answered for the wrong
 * moment.
 *
 * `unowned` is the mod's verdict that nothing will ever publish this topic. It
 * only ever redirects the empty case, and it needs no guard against the OTHER
 * thing an empty case can mean: `status` is `"resyncing"` both for a cold topic
 * and for one whose points a rewind dropped, but the verdict already tells them
 * apart. A topic that has ever published was necessarily acked when it was
 * subscribed, and an ack settles ownership for the life of the connection, so a
 * mid-resync topic can never be carrying an `unowned` verdict. Earning the
 * verdict positively is `TopicOwnershipTracker`'s job; this function trusts it.
 */
export function readingFrom<T>(
  point: TimelinePoint<T> | undefined,
  status: StreamStatusValue,
  viewUt: number,
  reckoner?: ReckonerFor<T>,
  unowned = false,
): Reading<T> {
  if (!point || status === "resyncing") {
    return unowned
      ? { state: "unowned", reckoning: "none" }
      : { state: "pending", reckoning: "none" };
  }
  // A tombstone outranks every staleness grade, the same precedence
  // `sampleRawStatus` uses and for the same reason: a confirmed absence is a
  // stronger claim than "may have changed, cannot tell". It also has no
  // observed VALUE to carry, so nothing here could model it anyway.
  if (point.payload === null || status === "absent") {
    return {
      state: "absent",
      reckoning: "none",
      atUt: value("ut", point.validAt),
    };
  }
  const live = status === "live";
  /*
   * Asked on a LIVE reading too, which is the point of the reckoning axis being
   * separate from the staleness one. A conic solved from the elements on the
   * wire is forward-modelled whether or not the last packet was late, and until
   * the axes split there was no way for the reading to say so: claiming a model
   * meant also claiming we had missed updates. `grade` is `undefined` here, so a
   * reckoner that integrates from the loss of contact can still decline.
   *
   * The model RUNS here, once per reading build, which is once per frame per
   * topic actually read. Eager rather than pulled: provider-supplied compute on
   * the frame path is what this whole pipeline already is, and cost is answered
   * by declaring a topic too expensive rather than by a mechanism in the type.
   * Running it once is also what stops one question asked twice inside a frame
   * giving two answers, which a thunk called at two call sites would.
   */
  const model = reckoner?.(point, live ? undefined : status, viewUt);
  const root = model && rootCoverage(model);
  if (live) {
    if (!model || !root) {
      return {
        state: "observed",
        reckoning: "none",
        value: point.payload,
        atUt: value("ut", point.validAt),
      };
    }
    return {
      state: "observed",
      reckoning: "available",
      value: point.payload,
      atUt: value("ut", point.validAt),
      reckoned: {
        value: model.reckon(viewUt),
        atUt: value("ut", viewUt),
        basis: root.basis,
        modelled: model.modelled,
      },
    };
  }
  if (model && root) {
    return {
      state: "stale",
      reckoning: "available",
      value: point.payload,
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
    reckoning: "none",
    value: point.payload,
    asOfUt: value("ut", point.validAt),
    grade: status,
  };
}
