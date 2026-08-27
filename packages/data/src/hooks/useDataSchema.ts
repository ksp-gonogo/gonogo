import { getDataSource } from "@ksp-gonogo/core";
import { useCarriedChannelsOptional } from "@ksp-gonogo/sitrep-client";
import {
  getRuntimeRegisteredTopicIds,
  subscribeRuntimeTopicRegistry,
} from "@ksp-gonogo/sitrep-sdk";
import { useMemo, useSyncExternalStore } from "react";
import {
  getTopicFieldCatalog,
  type TopicFieldKey,
} from "../schema/topicFieldCatalog";
import type { DataKeyMeta } from "../types";

/**
 * The stream's own vocabulary: every field of every carried Topic, every Topic
 * an Uplink has registered, and every client-derived channel, keyed by the path
 * a read samples (`../schema/topicFieldCatalog.ts`).
 *
 * Live rather than fixed. An Uplink registers its Topics when its bundle loads,
 * which is after the app has rendered, so a picker built once at module load
 * could never offer a third party's field however correctly that Uplink was
 * written. Re-renders on registration and on the carried set growing.
 */
export function useTopicFieldCatalog(): TopicFieldKey[] {
  const registered = useSyncExternalStore(
    subscribeRuntimeTopicRegistry,
    getRuntimeRegisteredTopicIds,
    getRuntimeRegisteredTopicIds,
  );
  const carried = useCarriedChannelsOptional();
  return useMemo(
    () => getTopicFieldCatalog(carried, registered),
    [carried, registered],
  );
}

/**
 * Returns the enriched schema (key + label / unit / group) for the given
 * data source.
 *
 * `sourceId === "data"` (the default) is the stream's own vocabulary, see
 * {@link useTopicFieldCatalog}. No `DataSource` is registered under that id;
 * there is nothing to ask. Every other `sourceId` (e.g. `"kos"`) still reads a
 * live `DataSource.schema()`, those sources are real and registered.
 *
 * The `"kos"` branch is still fixed for the lifetime of a session: a live
 * source registers its keys at connect time. One that grew keys dynamically
 * after connect would need a live schema subscription of its own here.
 */
export function useDataSchema(sourceId = "data"): DataKeyMeta[] {
  const catalog = useTopicFieldCatalog();
  return useMemo(() => {
    if (sourceId === "data") return catalog;
    const source = getDataSource(sourceId);
    // Both BufferedDataSource and PeerClientDataSource return DataKeyMeta
    // entries, even though the `DataSource` interface narrows to `DataKey`.
    return (source?.schema() as DataKeyMeta[] | undefined) ?? [];
  }, [sourceId, catalog]);
}
