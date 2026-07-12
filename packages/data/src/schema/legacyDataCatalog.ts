import {
  DEFAULT_SITREP_CARRIED_TOPICS,
  isTopicCarried,
  mapTopic,
  PRODUCTION_DERIVED_CHANNELS,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import type { DataKeyMeta } from "../types";
import { enrichKey, TELEMACHUS_META } from "./telemachusMeta";

/**
 * The legacy `"data"` `DataSource` was deleted in `806e7fe2` (R6 cutover) —
 * every widget that used to call `getDataSource("data").schema()` (via
 * `useDataSchema`/`useValueKeys`) got `[]` back forever after, silently
 * breaking every config-UI key picker built on top of it (Graph series,
 * Threshold Alarms, MapView's readout panel, ManeuverPlanner's custom
 * trigger). This module rebuilds that catalog from the stream instead of a
 * live `DataSource`.
 *
 * A legacy key qualifies iff it is BOTH:
 *   - mapped: `mapTopic("data", key)` resolves to a real stream target
 *     (`map-topic.ts`'s `TELEMACHUS_CLEAN_HOMES` + the dynamic families it
 *     recognises); and
 *   - carried: that target is actually promoted to the live stream today
 *     (`isTopicCarried`, gated on `DEFAULT_SITREP_CARRIED_TOPICS` — the same
 *     allowlist `SitrepTelemetryProvider` mounts by default). A
 *     mapped-but-uncarried key would let an operator pick it in a picker but
 *     never see a value — `SitrepTelemetryProvider.mappedAndCarried.test.ts`
 *     is the sibling test guarding that gap doesn't reopen.
 *
 * Reuses `mapTopic`/`isTopicCarried`/`DEFAULT_SITREP_CARRIED_TOPICS` straight
 * from `@ksp-gonogo/sitrep-client` — the exact same helpers `useValueKeys.ts`
 * and the carried test above already depend on — so there is exactly one
 * source of truth for "is this legacy key actually live", not a second
 * hand-rolled copy here.
 *
 * The store built below exists only to run `resolveSubscriptionTopics`
 * (via `isTopicCarried`) — it's never fed real samples, ingested into, or
 * exposed outside this module.
 */
function buildLegacyDataCatalog(): DataKeyMeta[] {
  const store = new TimelineStore(
    new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
  );
  for (const channel of PRODUCTION_DERIVED_CHANNELS) {
    store.registerDerivedChannel(channel);
  }
  const carriedChannels = new Set(DEFAULT_SITREP_CARRIED_TOPICS);

  const catalog: DataKeyMeta[] = [];
  for (const key of Object.keys(TELEMACHUS_META)) {
    const target = mapTopic("data", key);
    if (target === undefined) continue;
    if (!isTopicCarried(store, carriedChannels, target)) continue;
    catalog.push({ key, ...enrichKey(key) });
  }
  return catalog;
}

/**
 * Computed once at module load — `TELEMACHUS_META`, `TELEMACHUS_CLEAN_HOMES`
 * and `DEFAULT_SITREP_CARRIED_TOPICS` are all static, so there's nothing to
 * recompute per render/session. `useDataSchema("data")` returns this array
 * directly (stable identity across renders, same contract the old
 * `DataSource.schema()` read had).
 */
export const LEGACY_DATA_CATALOG: DataKeyMeta[] = buildLegacyDataCatalog();
