import { useCallback, useSyncExternalStore } from "react";
import type {
  ReckonableReading,
  TopicReading,
  UnmodelledReading,
} from "../reading";
import { topicReading } from "../reading";
import type { ReckonableFields, ReckonableTopic } from "../reckonability";
import type { TopicId, TopicPayload } from "../topics";
import {
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "./context";
import { useClaimCapability } from "./lock-scope";
import type { NeverReckonable } from "./never-reckonable";
import { subscribeTopicRead } from "./subscribe-read";
import { useTelemetrySubscriberLabel } from "./subscriber-identity";

/**
 * One shared `pending` for the no-provider path. A fresh object per
 * call would fail `useSyncExternalStore`'s reference comparison and loop.
 */
const NO_PROVIDER = topicReading<never>({
  state: "pending",
  reckoning: { status: "none" },
});

/**
 * Subscribes to a Topic and returns its `Reading`: the latest value together
 * with how current it is. The read hook for every Topic with a typed
 * `TopicId`:
 *
 *   const orbit = useTelemetry("vessel.orbit");
 *
 * With no `TelemetryProvider` mounted it answers `pending`. A Topic with no
 * `TopicId` member (a per-subject dynamic namespace such as
 * `vessel.partActions.<flightId>`) is read with `useStream`.
 *
 * The return type follows the Topic:
 *
 * - A Topic the contract declares reckonable answers `ReckonableReading`,
 *   whose `reckoned` holds only the declared fields. It is not assignable to
 *   `TopicReading<payload>`, and the overlay is written
 *   `{ ...reading.value, ...reading.reckoning.value }`
 * - A Topic in `NEVER_RECKONABLE` answers `UnmodelledReading`, which has no
 *   `reckoning: "available"` member
 * - Every other Topic answers `TopicReading`, whose `reckoned` covers the
 *   whole payload and is reachable only when a model is registered for the
 *   Topic, as an Uplink does with `registerReckoner`
 *
 * Branch on the reading's `state` before using its value, even where the
 * compiler does not force it. Where a payload type has every field optional, a
 * `Reading` is structurally assignable to it, so passing this hook's result
 * straight to something that wants the payload typechecks and hands over an
 * object with none of the payload's fields.
 */
export function useTelemetry<Topic extends TopicId>(
  topic: Topic,
): Topic extends ReckonableTopic
  ? ReckonableReading<
      TopicPayload<Topic>,
      ReckonableFields<Topic> & keyof TopicPayload<Topic>
    >
  : Topic extends NeverReckonable
    ? UnmodelledReading<TopicPayload<Topic>>
    : TopicReading<TopicPayload<Topic>>;

export function useTelemetry(topic: TopicId): unknown {
  /*
   * Why the reading and not the payload
   *
   * `Reading`'s whole justification is that "reaching a value at all requires
   * branching on how current it is". There is no way to reach a value without
   * confronting its currency, because the only hook that hands one over makes
   * you write the discriminant first.
   *
   * For a topic in `NEVER_RECKONABLE` the return narrows to `UnmodelledReading`,
   * which drops every `reckoning: "available"` member, so a caller cannot write a
   * branch for a case that can never occur. Reckonability is a second
   * discriminant rather than an arm of `state`, so nothing is dropped from
   * `state` itself: `held` remains, and remains the judgement.
   *
   * The three-way narrowing, and why the marked arm is not simply `Reading`
   *
   * A topic the contract declares reckonable answers with `ReckonableReading`,
   * whose `reckoned` is `Pick<payload, the declared fields>` rather than the whole
   * payload. That is the point of declaring per value: `vessel.flight` carries an
   * altitude a conic advances beside a `situation` the game switches, and reading
   * the second off a modelled value is a mistake the projection makes impossible
   * rather than merely documented.
   *
   * It is deliberately not assignable to `TopicReading<payload>`, so a call site that
   * hands one to a helper typed for the whole payload stops compiling. The overlay
   * is `{ ...reading.value, ...reading.reckoning.value }`, written where it happens
   * because that spread is the judgement.
   *
   * The three arms are exclusive by construction: a marked topic in
   * `NEVER_RECKONABLE` is a contradiction, and `never-reckonable.test.ts` fails on
   * it, so the order the conditional tests them in cannot be load-bearing.
   *
   * Why there is a middle arm
   *
   * The middle arm keeps the whole-payload `reckoned` for the population the
   * contract cannot speak for.
   *
   * That is an Uplink-registered model: `registerReckoner` is keyed by topic
   * string, and an Uplink's own contract slice has no reckonability emission of its own yet (see
   * `RtConfig.EmitReckonability`), so a model it registers on a wire topic has
   * nowhere but this arm to land.
   *
   * The cost is honest and worth stating: 35 wire topics fall here today, each
   * typed with a `reckoned` covering the whole payload, and for each of them core
   * registers nothing, so the arm is reachable only if someone registers a model.
   * Narrowing them to `UnmodelledReading` would type away the Uplink seam, which
   * is the one thing the middle arm is holding open.
   */
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  useClaimCapability("topic", topic);

  // Diagnostics only: which widget this read belongs to, so a topic nothing publishes can be reported with the name of the thing that asked for it.
  const subscriberLabel = useTelemetrySubscriberLabel();
  const subscribeStream = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store) return () => {};
      const releaseInputs = subscribeTopicRead(
        client,
        store,
        topic,
        subscriberLabel,
      );
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        releaseInputs();
      };
    },
    [client, store, topic, subscriberLabel],
  );
  // `sampleReading` memoizes on the store's per-frame cache, and `useSyncExternalStore` compares snapshots by reference, so a fresh object per call would loop.
  const getStreamSnapshot = useCallback(() => {
    if (!client || !store) return NO_PROVIDER;
    return store.sampleReading(topic, store.currentFrame());
  }, [client, store, topic]);
  return useSyncExternalStore(subscribeStream, getStreamSnapshot);
}
