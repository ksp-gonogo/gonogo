import { getDataSource } from "@ksp-gonogo/core";
import { useMemo } from "react";
import type { DataKeyMeta } from "../types";

/**
 * Returns the enriched schema (key + label / unit / group) for the given
 * data source. On the main screen this comes from the BufferedDataSource
 * wrapping the live feed; on stations it comes from PeerClientDataSource,
 * which caches the schema pushed over PeerJS at connect time.
 *
 * Stable for the lifetime of a session — today every source registers keys
 * at connect time. Phase 6 kOS datastream adds keys dynamically after
 * connect; this memo will need a live schema subscription once that lands.
 */
export function useDataSchema(sourceId = "data"): DataKeyMeta[] {
  return useMemo(() => {
    const source = getDataSource(sourceId);
    // Both BufferedDataSource and PeerClientDataSource return DataKeyMeta
    // entries, even though the `DataSource` interface narrows to `DataKey`.
    return (source?.schema() as DataKeyMeta[] | undefined) ?? [];
  }, [sourceId]);
}
