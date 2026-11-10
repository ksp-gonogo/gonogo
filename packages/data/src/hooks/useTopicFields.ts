import { onContributedChannelsChange } from "@ksp-gonogo/sitrep-client";
import {
  getRuntimeRegisteredTopicIds,
  subscribeRuntimeTopicRegistry,
} from "@ksp-gonogo/sitrep-sdk";
import { useMemo, useSyncExternalStore } from "react";
import {
  getDerivedTopicIds,
  getTopicFieldCatalog,
  isNumericField,
  isPrintableField,
  type TopicFieldKey,
} from "../schema/topicFieldCatalog";

/** A string, so the snapshot compares by value and a re-read that changed nothing is not a change. */
function derivedTopicsSnapshot(): string {
  return getDerivedTopicIds().join(",");
}

/**
 * Every field of every Topic, contract, registered and derived, keyed by the
 * path a read samples (`../schema/topicFieldCatalog.ts`).
 *
 * Live rather than fixed. An Uplink registers its Topics and contributes its
 * channels when its bundle loads, which is after the app has rendered, so a
 * picker built once at module load could never offer a third party's field.
 */
export function useTopicFieldCatalog(): TopicFieldKey[] {
  const registered = useSyncExternalStore(
    subscribeRuntimeTopicRegistry,
    getRuntimeRegisteredTopicIds,
    getRuntimeRegisteredTopicIds,
  );
  const derived = useSyncExternalStore(
    onContributedChannelsChange,
    derivedTopicsSnapshot,
    derivedTopicsSnapshot,
  );
  return useMemo(
    () => getTopicFieldCatalog(registered, derived.split(",")),
    [registered, derived],
  );
}

/** The numeric fields, with their units: what an alarm threshold, a trigger or a graph axis can compare. */
export function useNumericFields(): TopicFieldKey[] {
  const catalog = useTopicFieldCatalog();
  return useMemo(() => catalog.filter(isNumericField), [catalog]);
}

/** The fields that print as a word or a number, which is what a note tag interpolates. */
export function usePrintableFields(): TopicFieldKey[] {
  const catalog = useTopicFieldCatalog();
  return useMemo(() => catalog.filter(isPrintableField), [catalog]);
}
