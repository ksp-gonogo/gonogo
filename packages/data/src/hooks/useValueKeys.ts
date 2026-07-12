import { mapTopic } from "@ksp-gonogo/sitrep-client";
import { useMemo } from "react";
import type { DataKeyMeta } from "../types";
import { useDataSchema } from "./useDataSchema";

/**
 * The Value-restricted subset of `useDataSchema`'s key list — every key an
 * alarm/maneuver-trigger `DataKeyPicker` may offer. Per the Uplink vocab
 * (Domain/Topic/Value/Stream/Asset), a threshold can only ever be set on a
 * scalar telemetry Value, never a Stream (video) or an Asset (a timeline) —
 * and, now that alarms/triggers read off the stream (`getValue` in
 * `@ksp-gonogo/sitrep-client`) rather than the legacy `"data"` `DataSource`
 * directly, a key also has to actually resolve to a stream home via
 * `mapTopic` or the trigger would silently never fire.
 *
 * Filters `useDataSchema`'s enriched key list down to keys that are BOTH:
 *   - numeric-typed (excludes `bool`/`enum`/`raw` units and the `"Actions"`
 *     group, which are toggles/opaque blobs a threshold comparison can't
 *     use) — the same filter `AlarmsModal`/`ManeuverPlanner` each used to
 *     apply locally before this hook existed;
 *   - `mapTopic`-resolvable — the bounded, typed, stream-mapped set that
 *     dissolves the "arbitrary legacy key" problem `LocalManeuverTriggerService`
 *     used to flag on its own `dataKey` reads.
 *
 * No hand-maintained allowlist: a key becomes eligible the moment
 * `map-topic.ts`'s migration table picks it up, and drops out again if that
 * table ever loses it (e.g. Telemachus deletion retiring a stale entry).
 */
export function useValueKeys(sourceId = "data"): DataKeyMeta[] {
  const schema = useDataSchema(sourceId);
  return useMemo(
    () =>
      schema.filter(
        (k) =>
          k.unit !== "bool" &&
          k.unit !== "enum" &&
          k.unit !== "raw" &&
          k.group !== "Actions" &&
          mapTopic(sourceId, k.key) !== undefined,
      ),
    [schema, sourceId],
  );
}
