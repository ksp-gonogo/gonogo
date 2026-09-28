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
 * Subscribe to a live value. The canonical telemetry read hook of the Uplink
 * architecture, keyed by a typed `TopicId`: it reads that Topic straight off
 * the mounted `TimelineStore` and answers with the Topic's `Reading`.
 *
 *   const orbit = useTelemetry("vessel.orbit");
 *
 * A read with no `TelemetryProvider` mounted answers `pending`. A Topic with no
 * `TopicId` member (a per-subject dynamic namespace such as
 * `vessel.partActions.<flightId>`) is read with `useStream` instead.
 *
 * ## Why the reading and not the payload
 *
 * `Reading`'s whole justification is that "reaching a value at all requires
 * branching on how current it is". There is no way to reach a value without
 * confronting its currency, because the only hook that hands one over makes
 * you write the discriminant first.
 *
 * For a topic in `NEVER_RECKONABLE` the return narrows to `UnmodelledReading`,
 * which drops every `reckoning: "available"` member, so a caller cannot write a
 * branch for a case that can never occur. Reckonability is a SECOND
 * discriminant rather than an arm of `state`, so nothing is dropped from
 * `state` itself: `stale` remains, and remains the judgement.
 *
 * ## The three-way narrowing, and why the marked arm is not simply `Reading`
 *
 * A topic the CONTRACT declares reckonable answers with `ReckonableReading`,
 * whose `reckoned` is `Pick<payload, the declared fields>` rather than the whole
 * payload. That is the point of declaring per value: `vessel.flight` carries an
 * altitude a conic advances beside a `situation` the game switches, and reading
 * the second off a modelled value is a mistake the projection makes impossible
 * rather than merely documented.
 *
 * It is deliberately NOT assignable to `TopicReading<payload>`, so a call site that
 * hands one to a helper typed for the whole payload stops compiling. The overlay
 * is `{ ...reading.value, ...reading.reckoning.value }`, written where it happens
 * because that spread IS the judgement.
 *
 * The three arms are exclusive by construction: a marked topic in
 * `NEVER_RECKONABLE` is a contradiction, and `never-reckonable.test.ts` fails on
 * it, so the order the conditional tests them in cannot be load-bearing.
 *
 * ## Why there are THREE arms and not the two the design asked for
 *
 * The design said two: `ReckonableReading` where a model exists, plain
 * `Reading` with no `reckoned` member anywhere else. The middle arm is what
 * survives of the second half, and it keeps the whole-payload `reckoned` for the
 * population the CONTRACT cannot speak for.
 *
 * That is an UPLINK-registered model: `registerReckoner` is keyed by topic
 * string, and an Uplink's own contract slice has no reckonability emission of its own yet (see
 * `RtConfig.EmitReckonability`), so a model it registers on a wire topic has
 * nowhere but this arm to land.
 *
 * The cost is honest and worth stating: 35 wire topics fall here today, each
 * typed with a `reckoned` covering the WHOLE payload, and for each of them core
 * registers nothing, so the arm is reachable only if someone registers a model.
 * Narrowing them to `UnmodelledReading` would type away the Uplink seam, which
 * is the one thing the middle arm is holding open.
 *
 * ## The compile break does NOT always happen, and this is the trap
 *
 * Passing this hook's result straight into something that wants the PAYLOAD is
 * meant to be a type error, and usually is. It is not when the payload type has
 * every field optional, which most generated Uplink payloads do: a `Reading` is
 * then structurally assignable to it, so `<Widget weather={useTelemetry(...)} />`
 * typechecks and hands the widget an object carrying none of its fields.
 *
 * That is not hypothetical. An Uplink's radiation-trend test drove a "live
 * trend" off two samples that measured nothing, for exactly this reason, and
 * passed for as long as the widget rendered absence as zero. Unwrap the
 * discriminant, even where the compiler does not force you to.
 */
export function useTelemetry<T extends TopicId>(
  topic: T,
): T extends ReckonableTopic
  ? ReckonableReading<
      TopicPayload<T>,
      ReckonableFields<T> & keyof TopicPayload<T>
    >
  : T extends NeverReckonable
    ? UnmodelledReading<TopicPayload<T>>
    : TopicReading<TopicPayload<T>>;

export function useTelemetry(topic: TopicId): unknown {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();

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
