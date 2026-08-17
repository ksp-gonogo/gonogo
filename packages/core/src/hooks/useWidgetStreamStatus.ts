import {
  isTopicCarried,
  mapTopic,
  type StreamStatusValue,
  useCarriedChannelsOptional,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
  worstStatus,
} from "@ksp-gonogo/sitrep-client";
import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * The stream status of a WIDGET, derived from the data it already told the
 * registry it needs.
 *
 * Twenty-five widgets used to compute this by hand: each called
 * `useDataStreamStatus("data", k)` for a `k` its author picked as
 * representative, and rendered its own badge in its own bespoke title row.
 * Twenty-two of those twenty-five keys were simply one of the widget's own
 * declared `dataRequirements`, so the whole thing was a derivation written
 * out longhand.
 *
 * Doing it here is also more correct than doing it by hand, in a way that
 * matters: a hand-picked representative reports `"live"` while every OTHER
 * topic the widget draws goes stale. Taking the worst across all of them
 * cannot miss that. `worstStatus` supplies the ranking (see its own comment
 * for why `resyncing` outranks `absent`), so a single degraded topic is
 * enough to badge the panel, which is the honest reading: some of what you
 * are looking at is out of date.
 *
 * Requirements that do not resolve to a carried topic are skipped rather than
 * guessed at. A widget whose requirements ALL fail to resolve returns `null`,
 * meaning "nothing is known", which the Panel renders as no badge, the same
 * as healthy. That is deliberate: an unmigrated widget showed no badge
 * before, and inventing an alarming one for it would be a regression dressed
 * as a feature.
 */
export function useWidgetStreamStatus(
  dataRequirements: readonly string[] | undefined,
  dataSourceId = "data",
): StreamStatusValue | null {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const carriedChannels = useCarriedChannelsOptional();

  // Resolve once per requirement list. `join` rather than the array itself:
  // `registerComponent` hands back a new array identity on every read in some
  // call paths, and a changing dep here would resubscribe every frame.
  const key = (dataRequirements ?? []).join("\u0000");
  const topics = useMemo(() => {
    if (!store || !carriedChannels) return [];
    const out: string[] = [];
    for (const requirement of key.length > 0 ? key.split("\u0000") : []) {
      // `mapTopic` translates a LEGACY DataSource key ("v.altitude") into a
      // topic. A widget may instead declare what it actually reads, which
      // maps to nothing because there is nothing to translate. Skipping those
      // silently is how this hook returned `null` for every native-topic
      // widget and quietly withheld the badge it exists to show: LandingStatus
      // declares ten requirements, all native, and resolved to zero topics, so
      // its panel could never badge no matter how stale the stream got.
      //
      // A declaration is not limited to a two-segment `TopicId`. The modern
      // spelling of `career.funds` is the field subtopic
      // `career.status.economy.funds`, and a widget reading a derived channel
      // wholesale names `vessel.state`; neither is an `isTopicId`, and both
      // are things `isTopicCarried` resolves perfectly well. So an unmapped
      // requirement is passed through and `isTopicCarried` below decides.
      //
      // That check is deliberately permissive: it resolves a PATH, it does not
      // verify the leaf names a real field, so `career.status.economy.notAField`
      // survives it. Proving a declared path resolves against a real payload is
      // `widgetDeclarations.test.ts`'s job in this package, not this hook's:
      // a render-time guess here would be the same silent-`undefined` failure
      // the whole migration exists to remove.
      const topic = mapTopic(dataSourceId, requirement) ?? requirement;
      if (!isTopicCarried(store, carriedChannels, topic)) continue;
      out.push(topic);
    }
    return out;
  }, [key, store, carriedChannels, dataSourceId]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store || topics.length === 0) return () => {};
      // A status read needs the same real `client.subscribe` on each topic's
      // resolved raw inputs as a value read does. Without it a `StubTransport`
      // (and a real one) delivers nothing on an unsubscribed topic, so the
      // topic never leaves `"resyncing"` and every widget would badge
      // SYNCING forever. `useDataStreamStatus` carries the same note.
      const unsubscribeInputs: Array<() => void> = [];
      for (const topic of topics) {
        for (const inputTopic of store.resolveSubscriptionTopics(topic)) {
          unsubscribeInputs.push(client.subscribe(inputTopic, () => {}));
        }
      }
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        for (const unsubscribe of unsubscribeInputs) unsubscribe();
      };
    },
    // `topics` is useMemo'd on the requirement list, so its identity is
    // stable across frames and this does not resubscribe on every tick.
    [client, store, topics],
  );

  const getSnapshot = useCallback(() => {
    if (!store || topics.length === 0) return null;
    const frame = store.currentFrame();
    return worstStatus(topics.map((topic) => store.sampleStatus(topic, frame)));
  }, [store, topics]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
