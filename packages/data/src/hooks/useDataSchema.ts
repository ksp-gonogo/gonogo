import { getDataSource } from "@ksp-gonogo/core";
import { useMemo } from "react";
import { TOPIC_FIELD_CATALOG } from "../schema/topicFieldCatalog";
import type { DataKeyMeta } from "../types";

/**
 * Returns the enriched schema (key + label / unit / group) for the given
 * data source.
 *
 * `sourceId === "data"` (the default) is the stream's own vocabulary: every
 * field of every carried Topic and client-derived channel, keyed by the path a
 * read samples, enumerated from the contract's generated metadata
 * (`../schema/topicFieldCatalog.ts`). No `DataSource` is registered under that
 * id; there is nothing to ask. Every other `sourceId` (e.g. `"kos"`) still
 * reads a live `DataSource.schema()`, those sources are real and registered.
 *
 * Stable for the lifetime of a session: every live source registers its keys
 * at connect time and the catalogue is built once at module load. A source that
 * grew keys dynamically after connect would need this memo to take a live
 * schema subscription instead (for the `"kos"` branch only).
 */
export function useDataSchema(sourceId = "data"): DataKeyMeta[] {
  return useMemo(() => {
    if (sourceId === "data") return TOPIC_FIELD_CATALOG;
    const source = getDataSource(sourceId);
    // Both BufferedDataSource and PeerClientDataSource return DataKeyMeta
    // entries, even though the `DataSource` interface narrows to `DataKey`.
    return (source?.schema() as DataKeyMeta[] | undefined) ?? [];
  }, [sourceId]);
}
