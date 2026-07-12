import { getDataSource } from "@ksp-gonogo/core";
import { useMemo } from "react";
import { LEGACY_DATA_CATALOG } from "../schema/legacyDataCatalog";
import type { DataKeyMeta } from "../types";

/**
 * Returns the enriched schema (key + label / unit / group) for the given
 * data source.
 *
 * `sourceId === "data"` (the default) is the legacy Telemachus key
 * catalog — there is no `DataSource` registered under that id any more (it
 * was deleted in `806e7fe2`, the R6 cutover), so this returns
 * `LEGACY_DATA_CATALOG` (`../schema/legacyDataCatalog.ts`), built straight
 * from the stream's `mapTopic`/carried-channels gate instead. Every other
 * `sourceId` (e.g. `"kos"`) still reads a live `DataSource.schema()` — those
 * sources are real and registered.
 *
 * Stable for the lifetime of a session — today every live source registers
 * keys at connect time, and the legacy catalog is static. Phase 6 kOS
 * datastream adds keys dynamically after connect; this memo will need a live
 * schema subscription once that lands (for the `"kos"` branch only).
 */
export function useDataSchema(sourceId = "data"): DataKeyMeta[] {
  return useMemo(() => {
    if (sourceId === "data") return LEGACY_DATA_CATALOG;
    const source = getDataSource(sourceId);
    // Both BufferedDataSource and PeerClientDataSource return DataKeyMeta
    // entries, even though the `DataSource` interface narrows to `DataKey`.
    return (source?.schema() as DataKeyMeta[] | undefined) ?? [];
  }, [sourceId]);
}
