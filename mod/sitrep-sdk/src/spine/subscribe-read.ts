import type { TimelineStore } from "./timeline-store";

/**
 * What a live read of `topic` must hold up on the wire, subscribed for as long
 * as the read is mounted. THE seam: every read path in the tree comes through
 * here rather than resolving its own topic list, so the answer is written down
 * once and an eighth read path cannot be written without it.
 *
 * Two things have to be up, and only one of them was:
 *
 * - the topics that FEED the read (`resolveSubscriptionTopics`): itself for a
 *   raw topic, the parent record for a raw field subtopic, a derived channel's
 *   declared `inputs` resolved recursively. Every read path already did this
 *   one, seven separate times.
 * - the topics the read's elected RECKONER declared (`reckonerDepTopics`).
 *   Nothing held these up. `registeredReckoning` declines outright with one
 *   declared dep missing, which is the whole point of declaring them, so a lone
 *   widget reading `vessel.flight.altitudeAsl` got `input-absent` for ever
 *   while the same widget beside one reading `vessel.orbit` reckoned fine.
 *   Whether a model runs is not supposed to be a fact about the rest of the
 *   dashboard.
 *
 * The dep half was fixed for the SERIES path first, inline. The point path had
 * the same hole in seven separate places, which is why this is a function and
 * not a seventh copy: seven call sites each remembering the rule is how an
 * eighth gets written without it. Every read path in the tree, point and series
 * alike, comes through here, and a repo scan holds it that way.
 *
 * The set resolves at SUBSCRIBE time, so a reckoner registered after a read
 * mounts is not picked up until the subscription rebuilds. That is
 * `resolveSubscriptionTopics`' existing behaviour and this changes nothing
 * about it.
 *
 * No `PerfBudget`. A subscribe CALL is bounded by mount events rather than by
 * frames, and `client.subscribe` is ref-counted, so N widgets sharing a topic
 * share one wire subscription and the dep half adds at most the deps of the
 * topics already being read. Both still hold with this seam in place.
 */
export function subscribeTopicRead(
  client: ReadTopicSubscriber,
  store: ReadTopicResolver,
  topic: string,
  subscriberLabel?: string,
): () => void {
  /*
   * Deduplicated because a reckoner dep is very often also an input of the
   * topic being read (a model may declare the very topic it reckons, or an
   * input the read already resolves to). `client.subscribe` is ref-counted so
   * a double subscribe would be symmetric and harmless, but it would also
   * double every label count, and the labels are what `installUnownedTopicWarning` reports.
   */
  const wireTopics = new Set([
    ...store.resolveSubscriptionTopics(topic),
    ...store.reckonerDepTopics(topic),
  ]);
  const releases: Array<() => void> = [];
  for (const wireTopic of wireTopics) {
    releases.push(client.subscribe(wireTopic, () => {}));
    /*
     * Labelled per WIRE topic rather than per read: a derived topic is not a
     * wire topic and can never be unowned itself, so the diagnostic has to name
     * the raw topics the read actually subscribed.
     */
    if (subscriberLabel !== undefined && client.noteSubscriberLabel) {
      releases.push(client.noteSubscriberLabel(wireTopic, subscriberLabel));
    }
  }
  return () => {
    for (const release of releases) release();
  };
}

/**
 * The subscribing half, structurally rather than as `TelemetryClient`: the
 * processor evaluator subscribes through an injected function and has no client
 * to hand, and a read path that reaches this seam through a test double should
 * not have to build a whole client to do it.
 */
export interface ReadTopicSubscriber {
  subscribe(topic: string, cb: (value: unknown) => void): () => void;
  noteSubscriberLabel?(topic: string, label: string): () => void;
}

/** The resolving half. `TimelineStore` satisfies it; see `carried-channels.ts` for the same shape and the same reason. */
export type ReadTopicResolver = Pick<
  TimelineStore,
  "resolveSubscriptionTopics" | "reckonerDepTopics"
>;
