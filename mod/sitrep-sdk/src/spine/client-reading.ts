import type {
  ModelledField,
  ReckonableReading,
  ReckonerFor,
  ReckoningDecline,
  TopicReading,
} from "../reading";
import { topicReading } from "../reading";
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
  BandKind,
  DeclaredTopicReckoning,
  ModelledField,
  Reading,
  ReadingReckoning,
  ReadingState,
  ReckonableReading,
  ReckonedBands,
  ReckonerAnswer,
  ReckonerDefinition,
  ReckonerFor,
  ReckonerFrame,
  Reckoning,
  ReckoningBasis,
  ReckoningDecline,
  ReservedReadingKey,
  StaleGrade,
  TopicCurrency,
  TopicFields,
  TopicModel,
  TopicReading,
  TopicReckoning,
  TopicReckoningAvailable,
  UncertaintyBand,
  UnmodelledReading,
} from "../reading";
export {
  bandFor,
  bandIn,
  bandIsWellFormed,
  bandSide,
  fieldReckoning,
  hasAnswered,
  observedAt,
  observedValue,
  readingOf,
  topicReading,
  withoutReckoning,
} from "../reading";

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
 * payload root, the reading is `reckoning: { status: "none" }` whatever its `state`. That is
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
 *
 * `owner` is which registered owner's model this is, stamped onto the reckoning
 * so a caller can tell core's vanilla from an Uplink's without reading the
 * numbers and guessing. It defaults to `"core"` because every model that
 * reaches here without one is core's own: a derived channel's label, or a field
 * read borrowing its record's.
 *
 * `declined` is the caller's answer for a topic whose CONTRACT declares a value
 * reckonable, and it turns the value-bearing `"none"` arms into
 * `ReckonableReading`'s. It is the caller's rather than this function's because
 * the reason is a fact about the TOPIC (which published inputs the mark named,
 * which of them failed to arrive) and this function has never been told which
 * topic it is building for. Omit it and the reading is exactly what it always
 * was: an undeclared topic has nothing to explain, because nothing promised it a
 * model.
 */
export function readingFrom<T>(
  point: TimelinePoint<T> | undefined,
  status: StreamStatusValue,
  viewUt: number,
  reckoner?: ReckonerFor<T>,
  unowned?: boolean,
  declined?: undefined,
  owner?: string,
): TopicReading<T>;
export function readingFrom<T>(
  point: TimelinePoint<T> | undefined,
  status: StreamStatusValue,
  viewUt: number,
  reckoner: ReckonerFor<T> | undefined,
  unowned: boolean,
  declined: ReckoningDecline,
  owner?: string,
): ReckonableReading<T, keyof T>;
export function readingFrom<T>(
  point: TimelinePoint<T> | undefined,
  status: StreamStatusValue,
  viewUt: number,
  reckoner?: ReckonerFor<T>,
  unowned = false,
  declined?: ReckoningDecline,
  owner = "core",
): TopicReading<T> | ReckonableReading<T, keyof T> {
  if (!point || status === "resyncing") {
    return topicReading(
      unowned
        ? { state: "unowned", reckoning: { status: "none" } }
        : { state: "pending", reckoning: { status: "none" } },
    );
  }
  // A tombstone outranks every staleness grade, the same precedence
  // `sampleRawStatus` uses and for the same reason: a confirmed absence is a
  // stronger claim than "may have changed, cannot tell". It also has no
  // observed VALUE to carry, so nothing here could model it anyway.
  if (point.payload === null || status === "absent") {
    return topicReading({
      state: "absent",
      reckoning: { status: "none" },
      atUt: value("ut", point.validAt),
    });
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
  const modelled =
    model && root
      ? ({
          status: "available",
          value: model.reckon(viewUt),
          atUt: value("ut", viewUt),
          basis: root.basis,
          modelled: model.modelled,
          owner,
          /*
           * Asked only where the model was actually used, and at the same
           * `viewUt` it was reckoned for, so a model sharing work between the
           * two can cache on the argument.
           */
          bands: model.bandAt?.(viewUt),
        } as const)
      : undefined;
  /*
   * The three reckoning arms in the order the type ranks them: a model that
   * answered, a declared model that said why it could not, and the silence of a
   * topic nothing ever promised one for. A caller passing `declined` for a
   * topic whose model DID answer gets the answer, which is the point of the
   * decline being an arm rather than a field sitting beside one.
   */
  const reckoning = modelled ??
    (declined ? ({ status: "declined", declined } as const) : undefined) ?? {
      status: "none" as const,
    };
  if (live) {
    return topicReading({
      state: "observed",
      reckoning,
      value: point.payload,
      atUt: value("ut", point.validAt),
    });
  }
  return topicReading({
    state: "stale",
    reckoning,
    value: point.payload,
    asOfUt: value("ut", point.validAt),
    grade: status,
  });
}
