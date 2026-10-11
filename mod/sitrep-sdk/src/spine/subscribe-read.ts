import type { TimelineStore } from "./timeline-store";

/**
 * Subscribes everything a live read of `topic` needs on the wire, and returns
 * the function that releases it. Two sets are held: the Topics that feed the
 * read (itself for a raw Topic, the parent record for a field subtopic, a
 * derived channel's inputs resolved recursively), and the Topics the read's
 * elected reckoner declared as deps. Used by every read path, point and series
 * alike, such as `useTelemetry` and `useStream`.
 *
 * The set resolves when the read subscribes, so a reckoner registered after a
 * read mounts is not picked up until the subscription rebuilds.
 */
export function subscribeTopicRead(
  client: ReadTopicSubscriber,
  store: ReadTopicResolver,
  topic: string,
  subscriberLabel?: string,
): () => void {
  /*
   * Two things have to be up:
   *
   * - the topics that feed the read (`resolveSubscriptionTopics`): itself for a
   *   raw topic, the parent record for a raw field subtopic, a derived channel's
   *   declared `inputs` resolved recursively
   * - the topics the read's elected reckoner declared (`reckonerDepTopics`).
   *   `registeredReckoning` declines outright with one declared dep missing, so
   *   without them a lone widget reading `vessel.flight.altitudeAsl` gets
   *   `input-absent` for ever while the same widget beside one reading
   *   `vessel.orbit` reckons fine. Whether a model runs must not depend on the
   *   rest of the dashboard
   *
   * Every read path in the tree, point and series alike, comes through here,
   * and a repo scan holds it that way: call sites that each resolve their own
   * topic list are how one gets written without the reckoner half.
   *
   * No `PerfBudget`. A subscribe call is bounded by mount events rather than by
   * frames, and `client.subscribe` is ref-counted, so N widgets sharing a topic
   * share one wire subscription and the dep half adds at most the deps of the
   * topics already being read.
   */
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

/** The resolving half. `TimelineStore` satisfies it; structural so this module does not name the class for one method. */
export type ReadTopicResolver = Pick<
  TimelineStore,
  "resolveSubscriptionTopics" | "reckonerDepTopics"
>;
